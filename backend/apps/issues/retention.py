"""
Shared data-retention purge logic, used by the ``purge_events`` management
command and the nightly Celery task. Deletes events older than a cutoff in
batches (so a single huge transaction never locks the table), then removes
issues left with no events.
"""

from __future__ import annotations

from django.db.models import Count

from .models import Issue
from .store import get_event_store

BATCH_SIZE = 5000


def _batched_delete(queryset) -> int:
    model = queryset.model
    total = 0
    while True:
        ids = list(queryset.order_by("pk").values_list("pk", flat=True)[:BATCH_SIZE])
        if not ids:
            break
        model._default_manager.filter(pk__in=ids).delete()
        total += len(ids)
    return total


def purge_events_before(cutoff, organization=None) -> tuple[int, int]:
    """Delete events received before ``cutoff`` (optionally scoped to one org)
    via the event store, then any now-empty issues last seen before the cutoff.
    Returns ``(events_deleted, issues_deleted)``."""
    deleted_events = get_event_store().delete_before(cutoff, organization=organization)

    issues = Issue.objects.filter(last_seen__lt=cutoff)
    if organization is not None:
        issues = issues.filter(project__organization=organization)
    empty_issues = issues.annotate(n=Count("events")).filter(n=0)
    deleted_issues = _batched_delete(empty_issues)
    return deleted_events, deleted_issues


def count_events_before(cutoff, organization=None) -> tuple[int, int]:
    """Dry-run counterpart of :func:`purge_events_before`. Counts events through
    the active event store, so ``--dry-run`` is accurate under ClickHouse too."""
    event_count = get_event_store().count_before(cutoff, organization=organization)
    issues = Issue.objects.filter(last_seen__lt=cutoff)
    if organization is not None:
        issues = issues.filter(project__organization=organization)
    empty_issues = issues.annotate(n=Count("events")).filter(n=0)
    return event_count, empty_issues.count()
