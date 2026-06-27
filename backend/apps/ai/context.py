"""Build the fix context for an issue: stacktrace text + relevant source files
fetched from the linked repository."""

from __future__ import annotations

import logging

from apps.integrations.clients import get_client

from .providers.base import FixContext

logger = logging.getLogger(__name__)
MAX_SOURCE_FILES = 5


def _stacktrace_text(event_data: dict) -> tuple[str, list[str]]:
    """Return a readable stacktrace and the list of in-app file paths."""
    lines: list[str] = []
    files: list[str] = []
    exc = event_data.get("exception") or {}
    for value in exc.get("values", []):
        lines.append(f"{value.get('type', 'Error')}: {value.get('value', '')}")
        frames = (value.get("stacktrace") or {}).get("frames", [])
        for f in frames:
            path = f.get("filename") or f.get("abs_path") or "?"
            lines.append(
                f"  at {f.get('function', '?')} ({path}:{f.get('lineno', '?')})"
                + ("  [in-app]" if f.get("in_app") else "")
            )
            if f.get("in_app") and path not in files:
                files.append(path)
    return "\n".join(lines), files


def build_context(issue) -> FixContext:
    from apps.issues.store import get_event_store

    event = get_event_store().latest_for_issue(issue)
    data = event["data"] if event else {}
    stack_text, in_app_files = _stacktrace_text(data)

    source_files: dict[str, str] = {}
    project = issue.project
    repo = project.repository
    if repo is not None:
        client = get_client(repo.integration)
        for path in in_app_files[:MAX_SOURCE_FILES]:
            try:
                source_files[path] = client.get_file(
                    repo.external_id, path.lstrip("/"), repo.default_branch
                )
            except Exception:  # noqa: BLE001 - file may not resolve to repo path
                logger.info("autofix: could not fetch %s from %s", path, repo)

    return FixContext(
        issue_title=issue.title,
        culprit=issue.culprit,
        level=issue.level,
        platform=issue.platform,
        stacktrace_text=stack_text,
        source_files=source_files,
    )
