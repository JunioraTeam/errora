"""
MCP tool definitions for Errora — the capabilities an agent can call.

Each tool is a name + JSON-Schema input + a synchronous handler. Handlers run as
the authenticated token's user and are scoped to that user's org memberships, so
an agent can only see/act on what the user can. Inspired by Sentry's MCP server.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from apps.issues.models import Issue, IssueStatus
from apps.issues.search import apply_issue_search
from apps.issues.store import get_event_store
from apps.logs.queries import list_logs
from apps.organizations.models import Project
from apps.organizations.roles import ISSUE_WRITE
from apps.organizations.services import effective_role, has_permission


class ToolError(Exception):
    """Raised by a handler to return a clean error to the agent."""


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict
    handler: Callable[[Any, dict], Any]


# --- helpers --------------------------------------------------------------- //


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError):
        return False


def _resolve_project(user, ref: str) -> Project:
    """Resolve a project by id or slug within the user's accessible projects."""
    if not ref:
        raise ToolError("`project` (id or slug) is required.")
    qs = Project.objects.filter(organization__memberships__user=user).select_related("organization")
    project = (qs.filter(id=ref).first() if _is_uuid(ref) else None) or qs.filter(slug=ref).first()
    if project is None:
        raise ToolError(f"Project not found or not accessible: {ref}")
    return project


def _issue_dict(i: Issue) -> dict:
    return {
        "id": str(i.id),
        "title": i.title,
        "type": i.type,
        "value": i.value,
        "culprit": i.culprit,
        "level": i.level,
        "status": i.status,
        "priority": i.priority,
        "times_seen": i.times_seen,
        "first_seen": i.first_seen.isoformat(),
        "last_seen": i.last_seen.isoformat(),
    }


# --- handlers -------------------------------------------------------------- //


def whoami(user, _args: dict) -> dict:
    orgs = [
        {
            "id": str(o.id),
            "name": o.name,
            "slug": o.slug,
            "role": effective_role(user, organization=o),
        }
        for o in user.organizations.all()
    ]
    return {
        "id": str(user.id),
        "name": user.display_name,
        "email": user.email,
        "organizations": orgs,
    }


def list_projects(user, args: dict) -> dict:
    qs = Project.objects.filter(organization__memberships__user=user).select_related("organization")
    org_slug = args.get("organization_slug")
    if org_slug:
        qs = qs.filter(organization__slug=org_slug)
    projects = [
        {
            "id": str(p.id),
            "name": p.name,
            "slug": p.slug,
            "platform": p.platform,
            "organization": p.organization.slug,
        }
        for p in qs[:200]
    ]
    return {"projects": projects}


def list_issues(user, args: dict) -> dict:
    project = _resolve_project(user, args.get("project"))
    qs = Issue.objects.filter(project=project)
    status = args.get("status")
    if status in IssueStatus.values:
        qs = qs.filter(status=status)
    query = (args.get("query") or "").strip()
    if query:
        qs = apply_issue_search(qs, query)
    limit = max(1, min(int(args.get("limit") or 25), 100))
    issues = [_issue_dict(i) for i in qs.order_by("-last_seen")[:limit]]
    return {"project": project.slug, "count": len(issues), "issues": issues}


def _frame_summary(frames: list[dict], cap: int = 20) -> list[dict]:
    out = []
    for f in frames[-cap:]:
        out.append(
            {
                "filename": f.get("filename") or f.get("abs_path"),
                "function": f.get("function"),
                "lineno": f.get("lineno"),
                "in_app": f.get("in_app"),
                "context_line": (f.get("context_line") or "").strip() or None,
            }
        )
    return out


def get_issue(user, args: dict) -> dict:
    ref = args.get("issue_id")
    if not ref or not _is_uuid(ref):
        raise ToolError("`issue_id` (uuid) is required.")
    issue = (
        Issue.objects.filter(id=ref, project__organization__memberships__user=user)
        .select_related("project")
        .first()
    )
    if issue is None:
        raise ToolError("Issue not found or not accessible.")

    out = {**_issue_dict(issue), "project": issue.project.slug, "platform": issue.platform}
    event = get_event_store().latest_for_issue(issue)
    if event:
        data = event.get("data") or {}
        values = (data.get("exception") or {}).get("values") or []
        if values:
            exc = values[-1]
            out["latest_event"] = {
                "type": exc.get("type"),
                "value": exc.get("value"),
                "frames": _frame_summary((exc.get("stacktrace") or {}).get("frames") or []),
            }
    return out


def update_issue_status(user, args: dict) -> dict:
    ref = args.get("issue_id")
    status = args.get("status")
    if status not in IssueStatus.values:
        raise ToolError(f"`status` must be one of: {', '.join(IssueStatus.values)}")
    issue = (
        Issue.objects.filter(id=ref, project__organization__memberships__user=user)
        .select_related("project", "project__organization")
        .first()
    )
    if issue is None:
        raise ToolError("Issue not found or not accessible.")
    if not has_permission(
        user, ISSUE_WRITE, organization=issue.project.organization, project=issue.project
    ):
        raise ToolError("You don't have permission to change issue status.")
    issue.status = status
    issue.save(update_fields=["status"])
    return {"id": str(issue.id), "status": issue.status}


def search_logs(user, args: dict) -> dict:
    project = _resolve_project(user, args.get("project"))
    payload = list_logs(
        project,
        q=(args.get("query") or "").strip(),
        level=(args.get("level") or "").strip(),
        stats_period=args.get("stats_period") or "24h",
        limit=max(1, min(int(args.get("limit") or 25), 100)),
    )
    rows = [
        {
            "timestamp": r["timestamp"],
            "level": r["level"],
            "body": r["body"],
            "trace_id": r["trace_id"],
            "attributes": r["attributes"],
        }
        for r in payload["results"]
    ]
    return {"project": project.slug, "count": payload["count"], "logs": rows}


# --- registry -------------------------------------------------------------- //

_PROJECT_ARG = {
    "type": "string",
    "description": "Project id or slug.",
}

TOOLS: list[Tool] = [
    Tool(
        "whoami",
        "Get the authenticated user and the organizations they belong to.",
        {"type": "object", "properties": {}},
        whoami,
    ),
    Tool(
        "list_projects",
        "List the projects the user can access, optionally filtered by organization.",
        {
            "type": "object",
            "properties": {"organization_slug": {"type": "string"}},
        },
        list_projects,
    ),
    Tool(
        "list_issues",
        "List issues for a project. Supports a Sentry-style search query and a status filter.",
        {
            "type": "object",
            "properties": {
                "project": _PROJECT_ARG,
                "query": {"type": "string", "description": "Free-text / token search."},
                "status": {"type": "string", "enum": ["unresolved", "resolved", "ignored"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            "required": ["project"],
        },
        list_issues,
    ),
    Tool(
        "get_issue",
        "Get a single issue's details plus its latest event (exception + stack frames).",
        {
            "type": "object",
            "properties": {"issue_id": {"type": "string", "description": "Issue UUID."}},
            "required": ["issue_id"],
        },
        get_issue,
    ),
    Tool(
        "update_issue_status",
        "Resolve, ignore, or unresolve an issue (requires issue write permission).",
        {
            "type": "object",
            "properties": {
                "issue_id": {"type": "string"},
                "status": {"type": "string", "enum": ["unresolved", "resolved", "ignored"]},
            },
            "required": ["issue_id", "status"],
        },
        update_issue_status,
    ),
    Tool(
        "search_logs",
        "Search a project's structured logs (Sentry-style query + level filter).",
        {
            "type": "object",
            "properties": {
                "project": _PROJECT_ARG,
                "query": {"type": "string"},
                "level": {"type": "string"},
                "stats_period": {"type": "string", "enum": ["1h", "24h", "7d", "14d", "30d"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            "required": ["project"],
        },
        search_logs,
    ),
]

TOOLS_BY_NAME = {t.name: t for t in TOOLS}
