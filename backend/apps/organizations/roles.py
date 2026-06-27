"""
RBAC role + permission model. Roles exist at two scopes: organization and
project. A project-scoped membership (if present) overrides the org role for
that project; otherwise the org role applies.

Permissions are coarse-grained capability strings checked in DRF permission
classes and services. Keep this the single source of truth.
"""

from __future__ import annotations

from django.db import models


class Role(models.TextChoices):
    OWNER = "owner", "Owner"
    ADMIN = "admin", "Admin"
    MEMBER = "member", "Member"
    BILLING = "billing", "Billing"
    VIEWER = "viewer", "Viewer"


# Capabilities
P = type("P", (), {})  # namespace marker only
ORG_MANAGE = "org:manage"  # rename/delete org, manage members & roles
ORG_BILLING = "org:billing"  # view/change plan, see usage & invoices
PROJECT_CREATE = "project:create"
PROJECT_MANAGE = "project:manage"  # settings, keys, integrations, delete
PROJECT_READ = "project:read"  # view issues/events/dashboards
ISSUE_WRITE = "issue:write"  # resolve/ignore/assign/comment
AI_TRIGGER = "ai:trigger"  # kick off auto-fix runs
INTEGRATION_MANAGE = "integration:manage"
WEBHOOK_MANAGE = "webhook:manage"

_MATRIX: dict[str, set[str]] = {
    Role.OWNER: {
        ORG_MANAGE,
        ORG_BILLING,
        PROJECT_CREATE,
        PROJECT_MANAGE,
        PROJECT_READ,
        ISSUE_WRITE,
        AI_TRIGGER,
        INTEGRATION_MANAGE,
        WEBHOOK_MANAGE,
    },
    Role.ADMIN: {
        PROJECT_CREATE,
        PROJECT_MANAGE,
        PROJECT_READ,
        ISSUE_WRITE,
        AI_TRIGGER,
        INTEGRATION_MANAGE,
        WEBHOOK_MANAGE,
    },
    Role.MEMBER: {PROJECT_READ, ISSUE_WRITE, AI_TRIGGER},
    Role.BILLING: {ORG_BILLING, PROJECT_READ},
    Role.VIEWER: {PROJECT_READ},
}


def role_has(role: str, capability: str) -> bool:
    return capability in _MATRIX.get(role, set())
