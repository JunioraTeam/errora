"""
Read-side query assembly for the performance product. These are synchronous,
DB-portable functions (heavy ORM + Python aggregation) that the async views call
through ``sync_to_async`` — the same pattern the rest of the API uses for
multi-statement read paths.

Metrics are always computed over the selected ``stats_period`` window; an empty
window yields null/zero metrics (the UI lets the user widen the period).
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from django.utils import timezone

from .metrics import aggregate_metrics, duration_histogram, span_op_breakdown
from .models import Transaction, TransactionGroup

# Supported stats windows → minutes.
WINDOWS = {"1h": 60, "24h": 24 * 60, "7d": 7 * 24 * 60, "14d": 14 * 24 * 60, "30d": 30 * 24 * 60}
DEFAULT_PERIOD = "24h"
# Cap rows scanned for the list view's metric aggregation.
LIST_ROW_CAP = 100_000
# Cap transactions sampled for percentile/breakdown math on the detail view.
DETAIL_SAMPLE = 1000

# Sortable columns. DB-backed ones sort + paginate in the database (cheap). The
# rest are Python-computed metrics: sorting them requires computing metrics for
# all matching groups (capped) before paginating.
DB_SORTS = {"name", "last_seen", "first_seen", "times_seen"}
METRIC_SORTS = {"count", "tpm", "p50", "p75", "p95", "p99", "avg", "failure_rate"}
DEFAULT_SORT = "last_seen"
# Max groups whose metrics we compute when sorting by a metric column.
GROUP_SCAN_CAP = 1000


def _window_minutes(period: str) -> int:
    return WINDOWS.get(period, WINDOWS[DEFAULT_PERIOD])


def _since(period: str):
    return timezone.now() - timezone.timedelta(minutes=_window_minutes(period))


def _group_dict(g: TransactionGroup) -> dict:
    return {
        "id": str(g.id),
        "name": g.name,
        "op": g.op,
        "times_seen": g.times_seen,
        "first_seen": g.first_seen.isoformat(),
        "last_seen": g.last_seen.isoformat(),
    }


def _metrics_for(groups, *, since, minutes) -> list[dict]:
    """Build {group fields + metrics} rows for the given groups (one bulk query)."""
    ids = [g.id for g in groups]
    buckets: dict = {gid: [] for gid in ids}
    if ids:
        rows = Transaction.objects.filter(group_id__in=ids, timestamp__gte=since).values_list(
            "group_id", "duration_ms", "status"
        )[:LIST_ROW_CAP]
        for gid, dur, status in rows:
            buckets[gid].append((dur, status))
    return [
        {**_group_dict(g), **aggregate_metrics(buckets[g.id], window_minutes=minutes)}
        for g in groups
    ]


def list_groups(
    project,
    *,
    q: str = "",
    stats_period: str = DEFAULT_PERIOD,
    sort: str = DEFAULT_SORT,
    order: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> dict:
    minutes = _window_minutes(stats_period)
    since = _since(stats_period)
    desc = order != "asc"

    groups = TransactionGroup.objects.filter(project=project)
    if q:
        groups = groups.filter(name__icontains=q)
    total = groups.count()

    if sort in DB_SORTS:
        # Sort + paginate in the DB, then compute metrics for just the page.
        ordering = f"{'-' if desc else ''}{sort}"
        page = list(groups.order_by(ordering, "-last_seen")[offset : offset + limit])
        results = _metrics_for(page, since=since, minutes=minutes)
    else:
        # Metric sort: compute metrics for all (capped) groups, then sort/paginate.
        if sort not in METRIC_SORTS:
            sort = DEFAULT_SORT
        scanned = list(groups.order_by("-last_seen")[:GROUP_SCAN_CAP])
        rows = _metrics_for(scanned, since=since, minutes=minutes)
        rows.sort(key=lambda r: (r.get(sort) is None, r.get(sort) or 0), reverse=desc)
        results = rows[offset : offset + limit]

    return {
        "count": total,
        "results": results,
        "stats_period": stats_period,
        "sort": sort,
        "order": order,
    }


def group_detail(project, group_id, *, stats_period: str = DEFAULT_PERIOD) -> dict:
    minutes = _window_minutes(stats_period)
    since = _since(stats_period)
    group = get_object_or_404(TransactionGroup, project=project, id=group_id)

    in_window = Transaction.objects.filter(group=group, timestamp__gte=since)
    window_count = in_window.count()
    txns = list(in_window.order_by("-timestamp")[:DETAIL_SAMPLE])

    metrics = aggregate_metrics([(t.duration_ms, t.status) for t in txns], window_minutes=minutes)
    # The percentile sample is capped at DETAIL_SAMPLE, but report the true count.
    metrics["count"] = window_count
    metrics["tpm"] = round(window_count / minutes, 3) if minutes else 0.0

    return {
        **_group_dict(group),
        **metrics,
        "breakdown": span_op_breakdown([t.spans for t in txns]),
        "histogram": duration_histogram([t.duration_ms for t in txns]),
        "samples": [
            {
                "event_id": str(t.event_id),
                "duration_ms": t.duration_ms,
                "status": t.status,
                "timestamp": t.timestamp.isoformat(),
                "trace_id": t.trace_id,
                "is_failed": t.is_failed,
            }
            for t in txns[:20]
        ],
        "stats_period": stats_period,
    }


# Cap how many spans the trace view renders; when exceeded, keep the slowest
# spans (plus their ancestors so the tree stays connected).
SPAN_DISPLAY_CAP = 100


def _cap_spans(spans: list[dict]) -> tuple[list[dict], bool]:
    if len(spans) <= SPAN_DISPLAY_CAP:
        return spans, False
    by_id = {s.get("span_id"): s for s in spans if s.get("span_id")}
    keep = {
        s.get("span_id")
        for s in sorted(spans, key=lambda s: -(s.get("duration_ms") or 0))[:SPAN_DISPLAY_CAP]
        if s.get("span_id")
    }
    for sid in list(keep):
        cur = by_id.get(sid, {}).get("parent_span_id")
        guard = 0
        while cur and cur in by_id and cur not in keep and guard < 100:
            keep.add(cur)
            cur = by_id[cur].get("parent_span_id")
            guard += 1
    shown = [s for s in spans if (s.get("span_id") in keep) or (not s.get("span_id"))]
    return shown, True


def _issues_for_trace(project, trace_id) -> list[dict]:
    if not trace_id:
        return []
    from apps.issues.models import Issue
    from apps.issues.store import get_event_store

    issue_ids = get_event_store().issues_for_trace(project, trace_id)
    if not issue_ids:
        return []
    return [
        {
            "id": str(i.id),
            "title": i.title,
            "type": i.type,
            "value": i.value,
            "level": i.level,
            "status": i.status,
            "culprit": i.culprit,
        }
        for i in Issue.objects.filter(project=project, id__in=issue_ids)[:10]
    ]


def transaction_detail(project, event_id) -> dict | None:
    t = Transaction.objects.filter(project=project, event_id=event_id).first()
    if t is None:
        return None
    spans = t.spans or []
    shown, truncated = _cap_spans(spans)
    return {
        "event_id": str(t.event_id),
        "name": t.name,
        "op": t.op,
        "status": t.status,
        "trace_id": t.trace_id,
        "span_id": t.span_id,
        "duration_ms": t.duration_ms,
        "timestamp": t.timestamp.isoformat(),
        "environment": t.environment,
        "release": t.release,
        "platform": t.platform,
        "is_failed": t.is_failed,
        "spans": shown,
        "span_count": len(spans),
        "spans_truncated": truncated,
        "issues": _issues_for_trace(project, t.trace_id),
    }
