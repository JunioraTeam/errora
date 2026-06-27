"""
Data-retention resolution for an organization.

Precedence (highest first):
  1. the org's own ``retention_days`` override (set by an owner/admin),
  2. the org's plan ``retention_days`` (from its billing subscription),
  3. the global ``DATA_RETENTION_DAYS_DEFAULT`` setting.
"""

from __future__ import annotations

from django.conf import settings

# Bounds for the user-settable override.
MIN_RETENTION_DAYS = 1
MAX_RETENTION_DAYS = 3650  # 10 years


def global_default() -> int:
    return getattr(settings, "DATA_RETENTION_DAYS_DEFAULT", 90)


def default_retention_days(org) -> int:
    """Retention the org would get WITHOUT its own override (plan → global)."""
    sub = getattr(org, "subscription", None)
    if sub is not None and sub.plan_id and sub.plan and sub.plan.retention_days:
        return sub.plan.retention_days
    return global_default()


def effective_retention_days(org) -> int:
    """The retention actually applied to the org (override → plan → global)."""
    if org.retention_days:
        return org.retention_days
    return default_retention_days(org)
