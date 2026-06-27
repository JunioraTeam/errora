"""Periodic billing tasks: flush Redis usage counters to the DB, and purge
expired event data per each organization's plan retention."""

from __future__ import annotations

from celery import shared_task
from django.core.cache import cache
from django.utils import timezone

from apps.organizations.models import Organization

from .models import UsageRecord
from .services import _counter_key, current_period


@shared_task(ignore_result=True)
def flush_usage() -> int:
    """Persist current-period counters for every org. Schedule via celery beat."""
    period = current_period()
    flushed = 0
    for org_id in Organization.objects.values_list("id", flat=True):
        value = cache.get(_counter_key(org_id, period))
        if value is None:
            continue
        UsageRecord.objects.update_or_create(
            organization_id=org_id, period=period, defaults={"events_count": int(value)}
        )
        flushed += 1
    return flushed


@shared_task(ignore_result=True)
def purge_expired_events() -> dict:
    """Delete event/log data older than each org's effective retention (org
    override → plan → ``DATA_RETENTION_DAYS_DEFAULT``). Schedule nightly via beat."""
    from apps.issues.retention import purge_events_before
    from apps.logs.models import LogEntry
    from apps.organizations.retention import effective_retention_days

    total_events = total_issues = total_logs = 0
    for org in Organization.objects.select_related("subscription__plan").all():
        days = effective_retention_days(org)
        cutoff = timezone.now() - timezone.timedelta(days=days)
        events, issues = purge_events_before(cutoff, organization=org)
        deleted_logs, _ = LogEntry.objects.filter(
            project__organization=org, timestamp__lt=cutoff
        ).delete()
        total_events += events
        total_issues += issues
        total_logs += deleted_logs
    return {"events": total_events, "issues": total_issues, "logs": total_logs}
