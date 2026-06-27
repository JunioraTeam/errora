"""
Read-side query assembly for the logs product. Synchronous, DB-portable
functions the async views call through ``sync_to_async`` (same pattern as the
performance app). Everything is scoped to a project and a ``stats_period`` window.
"""

from __future__ import annotations

from django.db.models import Count
from django.utils import timezone

from .models import LOG_LEVELS, LogEntry
from .search import apply_query

# Supported stats windows → minutes (mirrors the performance app).
WINDOWS = {"1h": 60, "24h": 24 * 60, "7d": 7 * 24 * 60, "14d": 14 * 24 * 60, "30d": 30 * 24 * 60}
DEFAULT_PERIOD = "24h"
MAX_LIMIT = 100
# Cap rows scanned when building level facets so the count stays cheap.
FACET_ROW_CAP = 50_000
# Distinct attribute keys surfaced for the filter UI.
ATTR_KEY_CAP = 200


def _window_minutes(period: str) -> int:
    return WINDOWS.get(period, WINDOWS[DEFAULT_PERIOD])


def _since(period: str):
    return timezone.now() - timezone.timedelta(minutes=_window_minutes(period))


def _base(project, *, stats_period: str, environment: str = ""):
    qs = LogEntry.objects.filter(project=project, timestamp__gte=_since(stats_period))
    if environment:
        qs = qs.filter(environment=environment)
    return qs


def _row(log: LogEntry) -> dict:
    return {
        "id": str(log.id),
        "timestamp": log.timestamp.isoformat(),
        "level": log.level,
        "severity_number": log.severity_number,
        "body": log.body,
        "trace_id": log.trace_id,
        "span_id": log.span_id,
        "environment": log.environment,
        "release": log.release,
        "attributes": log.attributes or {},
    }


def list_logs(
    project,
    *,
    q: str = "",
    level: str = "",
    environment: str = "",
    stats_period: str = DEFAULT_PERIOD,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Search + filter logs, newest first. Returns rows + total + level facets."""
    limit = max(1, min(limit, MAX_LIMIT))
    offset = max(0, offset)

    qs = _base(project, stats_period=stats_period, environment=environment)
    if q:
        qs = apply_query(qs, q)
    if level:
        levels = [v.strip() for v in level.split(",") if v.strip() in LOG_LEVELS]
        if levels:
            qs = qs.filter(level__in=levels)

    total = qs.count()
    page = list(qs.order_by("-timestamp")[offset : offset + limit])

    # Level facets reflect the same query EXCEPT the level filter, so the user
    # can see counts for the levels they haven't selected (Sentry behaviour).
    facet_qs = _base(project, stats_period=stats_period, environment=environment)
    if q:
        facet_qs = apply_query(facet_qs, q)
    facet_rows = facet_qs.values("level").order_by().annotate(count=Count("id"))
    facets = {lvl: 0 for lvl in LOG_LEVELS}
    for r in facet_rows:
        if r["level"] in facets:
            facets[r["level"]] = r["count"]

    return {
        "results": [_row(log) for log in page],
        "count": total,
        "facets": {"level": facets},
        "stats_period": stats_period,
    }


def log_detail(project, pk) -> dict | None:
    log = LogEntry.objects.filter(project=project, pk=pk).first()
    return _row(log) if log else None


def attribute_keys(project, *, stats_period: str = DEFAULT_PERIOD) -> list[str]:
    """Distinct attribute keys seen in the window, for filter autocomplete."""
    keys: set[str] = set()
    rows = (
        _base(project, stats_period=stats_period)
        .order_by("-timestamp")
        .values_list("attributes", flat=True)[:FACET_ROW_CAP]
    )
    for attrs in rows.iterator(chunk_size=2000):
        if isinstance(attrs, dict):
            keys.update(attrs.keys())
        if len(keys) >= ATTR_KEY_CAP:
            break
    return sorted(keys)[:ATTR_KEY_CAP]
