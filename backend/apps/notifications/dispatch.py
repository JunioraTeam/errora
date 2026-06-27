"""
Central event → alert-rule fan-out. Domain code calls :func:`dispatch`; matching
rules are resolved and each delivery is enqueued on the ``notifications`` queue
so a slow/failing endpoint never blocks ingestion or the AI worker.
"""

from __future__ import annotations

from django.conf import settings
from django.core.cache import cache
from django.db.models import Q

from .models import AlertRule

# event.received fires for EVERY ingested event, so cache "does this org have any
# matching rule?" to avoid a DB round-trip per event for orgs with no rules.
_RULE_FLAG_TTL = 60


def _rule_flag_key(organization_id, event_type: str) -> str:
    return f"alertrules:has:{organization_id}:{event_type}"


def _has_matching_rule(organization, event_type: str) -> bool:
    key = _rule_flag_key(organization.id, event_type)
    cached = cache.get(key)
    if cached is None:
        cached = AlertRule.objects.filter(
            organization=organization,
            event_type=event_type,
            enabled=True,
            channel__is_active=True,
        ).exists()
        cache.set(key, cached, _RULE_FLAG_TTL)
    return cached


def invalidate_rule_flag(organization_id, event_type: str) -> None:
    cache.delete(_rule_flag_key(organization_id, event_type))


def _frontend_issue_url(issue) -> str:
    return f"{settings.FRONTEND_URL}/dashboard/issues/{issue.id}"


def build_message(event_type: str, *, issue=None, run=None) -> dict:
    """Return a serializable message dict for the delivery task."""
    if run is not None:
        issue = run.issue
    title = issue.title if issue else event_type
    bodies = {
        "issue.created": f"New issue: {title}",
        "event.received": f"New event on: {title}",
        "issue.regressed": f"Issue regressed: {title}",
        "autofix.started": f"AI auto-fix started for: {title}",
        "autofix.mr_created": f"AI opened a fix MR for: {title}",
        "autofix.failed": f"AI auto-fix failed for: {title}",
    }
    payload = {
        "event_type": event_type,
        "title": title,
        "body": bodies.get(event_type, title),
        "url": _frontend_issue_url(issue) if issue else "",
        "payload": {
            "issue_id": str(issue.id) if issue else None,
            "level": getattr(issue, "level", None),
            "times_seen": getattr(issue, "times_seen", None),
            "mr_url": getattr(run, "mr_url", "") if run else "",
        },
    }
    return payload


def dispatch(event_type: str, *, organization, project=None, issue=None, run=None) -> None:
    # Cheap cached gate first — skips the join-heavy query for orgs with no rules.
    if not _has_matching_rule(organization, event_type):
        return

    rules = AlertRule.objects.filter(
        organization=organization, event_type=event_type, enabled=True, channel__is_active=True
    ).filter(Q(project__isnull=True) | Q(project=project))

    if not rules.exists():
        return

    from .tasks import deliver_notification

    message = build_message(event_type, issue=issue, run=run)
    for rule in rules.only("id"):
        deliver_notification.delay(str(rule.id), message)
