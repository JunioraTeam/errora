"""
JavaScript stack-frame symbolication using uploaded release artifacts.

For each minified JS frame we:
  1. find the artifact for the frame's file (matched by URL, with ``~`` host
     stripping like Sentry),
  2. discover its source map (a ``Sourcemap`` header, an inline
     ``//# sourceMappingURL=`` comment, or the ``<file>.map`` convention),
  3. look up the original (source, line, column, name) and rewrite the frame,
     attaching original source context.

Symbolication runs at ingest, **before grouping**, so issues group on the stable
original frames rather than per-build minified names.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

from .models import ReleaseArtifact
from .smap import SourceMap

JS_PLATFORMS = {"javascript", "node"}
_SOURCEMAP_COMMENT = re.compile(rb"(?://[#@]\s*sourceMappingURL=|/\*#\s*sourceMappingURL=)\s*(\S+)")
# Cap how much of a JS file we scan for the trailing sourceMappingURL comment.
_TAIL_SCAN = 4096


def should_symbolicate(data: dict) -> bool:
    if not data.get("release"):
        return False  # artifacts are keyed by release
    if data.get("platform") in JS_PLATFORMS:
        return True
    # Fall back to sniffing frame paths for non-"javascript" platforms (e.g. SDKs
    # reporting "node" variants or omitting platform).
    for value in (data.get("exception") or {}).get("values") or []:
        for frame in (value.get("stacktrace") or {}).get("frames") or []:
            path = frame.get("abs_path") or frame.get("filename") or ""
            if path.endswith(".js") or path.endswith(".mjs") or path.endswith(".cjs"):
                return True
    return False


def _url_candidates(path: str) -> list[str]:
    """Names an artifact might be stored under for a given frame path."""
    if not path:
        return []
    out = [path]
    parts = urlsplit(path)
    if parts.scheme and parts.netloc:
        rel = parts.path
        if parts.query:
            rel += f"?{parts.query}"
        out.append(f"~{rel}")  # host-agnostic
        out.append(rel)
    base = path.rsplit("/", 1)[-1]
    if base and base not in out:
        out.append(base)
    # De-dup, preserve order.
    seen: set[str] = set()
    return [c for c in out if not (c in seen or seen.add(c))]


def _join_relative(base_name: str, ref: str) -> str:
    """Resolve a sourceMappingURL ``ref`` relative to the artifact ``base_name``."""
    if ref.startswith(("http://", "https://", "~", "/")):
        return ref
    base_dir = base_name.rsplit("/", 1)[0] if "/" in base_name else ""
    return f"{base_dir}/{ref}" if base_dir else ref


class _Resolver:
    """Per-event artifact lookups + parsed-map cache (one event → many frames)."""

    def __init__(self, project, release: str, dist: str):
        self.project = project
        self.release = release
        self.dist = dist
        self._artifacts: dict[str, ReleaseArtifact | None] = {}
        self._maps: dict[str, SourceMap | None] = {}

    def _artifact(self, names: list[str]) -> ReleaseArtifact | None:
        key = "|".join(names)
        if key not in self._artifacts:
            qs = ReleaseArtifact.objects.filter(
                project=self.project, release=self.release, dist=self.dist, name__in=names
            )
            found = list(qs)
            # Preserve candidate priority order.
            by_name = {a.name: a for a in found}
            self._artifacts[key] = next((by_name[n] for n in names if n in by_name), None)
        return self._artifacts[key]

    def _sourcemap_ref(self, artifact: ReleaseArtifact) -> str | None:
        for header in ("Sourcemap", "SourceMap", "X-SourceMap"):
            ref = (artifact.headers or {}).get(header)
            if ref:
                return ref
        tail = artifact.content[-_TAIL_SCAN:].encode("utf-8", "replace")
        matches = _SOURCEMAP_COMMENT.findall(tail)
        if matches:
            # The real reference is the last trailing comment.
            ref = matches[-1].decode("utf-8", "replace")
            if not ref.startswith("data:"):
                return ref
        return None

    def map_for_frame(self, path: str) -> SourceMap | None:
        min_artifact = self._artifact(_url_candidates(path))
        if min_artifact is not None:
            ref = self._sourcemap_ref(min_artifact)
            map_name = _join_relative(min_artifact.name, ref) if ref else f"{min_artifact.name}.map"
        else:
            # No minified artifact stored — try the ``<path>.map`` convention.
            map_name = f"{path}.map"

        candidates = _url_candidates(map_name)
        # Also try "<minified-candidate>.map" for each frame-path candidate.
        for c in _url_candidates(path):
            cm = f"{c}.map"
            if cm not in candidates:
                candidates.append(cm)

        key = "|".join(candidates)
        if key not in self._maps:
            art = self._artifact(candidates)
            try:
                self._maps[key] = SourceMap.from_json(art.content) if art else None
            except (ValueError, KeyError):
                self._maps[key] = None
        return self._maps[key]


def _symbolicate_frame(frame: dict, resolver: _Resolver) -> bool:
    lineno = frame.get("lineno")
    if not isinstance(lineno, int) or lineno < 1:
        return False
    path = frame.get("abs_path") or frame.get("filename")
    if not path:
        return False

    smap = resolver.map_for_frame(path)
    if smap is None:
        return False

    colno = frame.get("colno")
    col = max((colno - 1) if isinstance(colno, int) and colno > 0 else 0, 0)
    token = smap.lookup(lineno - 1, col)
    if token is None:
        return False

    source = smap.source_name(token)
    if not source:
        return False

    frame["abs_path"] = source
    frame["filename"] = source
    frame["lineno"] = token.src_line + 1
    frame["colno"] = token.src_col + 1
    name = smap.name_of(token)
    if name:
        frame["function"] = name
    ctx = smap.source_context(token)
    if ctx is not None:
        pre, line, post = ctx
        frame["pre_context"] = pre
        frame["context_line"] = line
        frame["post_context"] = post
    frame["in_app"] = "node_modules" not in source
    frame["symbolicated"] = True
    return True


def symbolicate_event(project, data: dict) -> bool:
    """Rewrite minified JS frames in ``data`` in place. Returns whether any frame
    was symbolicated. Best-effort: failures leave the original frame untouched."""
    if not should_symbolicate(data):
        return False
    resolver = _Resolver(project, str(data.get("release") or ""), str(data.get("dist") or ""))
    changed = False
    for value in (data.get("exception") or {}).get("values") or []:
        for frame in (value.get("stacktrace") or {}).get("frames") or []:
            try:
                changed |= _symbolicate_frame(frame, resolver)
            except Exception:  # noqa: BLE001 - never let symbolication break ingest
                continue
    return changed
