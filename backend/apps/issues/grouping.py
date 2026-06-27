"""
Event fingerprinting & grouping — a pragmatic take on Sentry's algorithm.

Strategy precedence (first that yields components wins):
  1. Explicit ``fingerprint`` on the event ("{{ default }}" expands to the
     computed default).
  2. Exception: group by the chain of ``(type, normalized stack frames)``.
  3. Log message (template before interpolation).
  4. Raw message / exception value.

The result is a hex digest stored as ``Issue.primary_hash`` (unique per
project). Keeping this isolated makes it easy to add new grouping strategies
or a server-side "grouping config" per project later.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

# Strip line numbers / addresses / hex so frames group despite churn.
_HEX_RE = re.compile(r"0x[0-9a-fA-F]+")
_NUM_RE = re.compile(r"\b\d+\b")


def _normalize_frame(frame: dict[str, Any]) -> str | None:
    """Prefer symbolic identity (module.function); fall back to file path."""
    module = frame.get("module")
    function = frame.get("function")
    filename = frame.get("filename") or frame.get("abs_path")
    if function and (module or filename):
        return f"{module or filename}:{function}"
    if filename:
        return filename
    return None


def _frames_component(stacktrace: dict[str, Any]) -> list[str]:
    frames = stacktrace.get("frames") or []
    # In-app frames carry the most grouping signal; use them if present.
    in_app = [f for f in frames if f.get("in_app")]
    chosen = in_app or frames
    components = [c for f in chosen if (c := _normalize_frame(f))]
    return components


def _exception_components(exception: dict[str, Any]) -> list[str]:
    values = exception.get("values") or ([exception] if exception else [])
    components: list[str] = []
    for exc in values:
        exc_type = exc.get("type") or "Error"
        components.append(f"type:{exc_type}")
        stack = exc.get("stacktrace") or {}
        frame_components = _frames_component(stack)
        if frame_components:
            components.extend(frame_components)
        else:
            # No stack — fall back to the message so distinct errors don't merge.
            val = exc.get("value") or ""
            components.append(f"value:{_scrub(val)}")
    return components


def _scrub(text: str) -> str:
    text = _HEX_RE.sub("<hex>", text)
    text = _NUM_RE.sub("<n>", text)
    return text.strip()[:200]


def _digest(components: list[str]) -> str:
    h = hashlib.sha1()  # noqa: S324 - grouping hash, not security
    for c in components:
        h.update(c.encode("utf-8", "replace"))
        h.update(b"\x1f")
    return h.hexdigest()


def compute_grouping(data: dict[str, Any]) -> tuple[str, list[str]]:
    """Return ``(primary_hash, components)`` for a normalized event payload."""
    explicit = data.get("fingerprint")
    if explicit and "{{ default }}" not in explicit and "{{default}}" not in explicit:
        return _digest([str(p) for p in explicit]), [str(p) for p in explicit]

    components: list[str] = []
    if data.get("exception"):
        components = _exception_components(data["exception"])
    if not components and data.get("logentry"):
        msg = data["logentry"].get("message") or ""
        components = [f"log:{_scrub(msg)}"]
    if not components:
        components = [f"msg:{_scrub(data.get('message', '') or 'unknown')}"]

    if explicit:  # contains "{{ default }}" — combine custom parts with default
        extra = [str(p) for p in explicit if "default" not in str(p)]
        components = extra + components
    return _digest(components), components


def derive_metadata(data: dict[str, Any]) -> dict[str, str]:
    """Extract title parts (type/value/culprit) for denormalized Issue columns."""
    type_ = value = culprit = ""
    exc = data.get("exception")
    if exc:
        values = exc.get("values") or [exc]
        if values:
            last = values[-1]
            type_ = last.get("type", "") or ""
            value = last.get("value", "") or ""
            frames = (last.get("stacktrace") or {}).get("frames") or []
            if frames:
                top = frames[-1]
                culprit = top.get("function") or top.get("filename") or ""
    if not type_ and not value:
        value = (data.get("logentry") or {}).get("message") or data.get("message", "")
    culprit = culprit or data.get("transaction", "") or ""
    return {"type": type_[:255], "value": value, "culprit": culprit[:512]}
