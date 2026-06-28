"""
Read-side aggregation for the LLM-observability product. Synchronous, DB-portable
ORM aggregation (the async views call these through ``sync_to_async``) over the
selected ``stats_period`` window.

Two dashboards:

* **Agents** — agent runs, LLM calls, tool calls, duration, tokens (cached vs
  not), LLM calls / tokens by model, most-used tools, plus a recent-runs table.
* **MCP** — request volume + duration, traffic by client, by method/transport,
  and the most-used tools / resources / prompts.
"""

from __future__ import annotations

import hashlib
import math
from datetime import UTC, datetime

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Max, Min, Q, Sum
from django.db.models.functions import TruncDay, TruncHour
from django.shortcuts import get_object_or_404
from django.utils import timezone

from apps.organizations.models import Project

from .models import (
    KIND_AGENT,
    KIND_EMBEDDINGS,
    KIND_HANDOFF,
    KIND_LLM,
    KIND_MCP,
    KIND_TOOL,
    NON_FAILURE_STATUS,
    AiSpan,
)

WINDOWS = {"1h": 60, "24h": 24 * 60, "7d": 7 * 24 * 60, "14d": 14 * 24 * 60, "30d": 30 * 24 * 60}
DEFAULT_PERIOD = "24h"
TOP_N = 10
# Cap rows scanned for the Python percentile math (series no longer pull rows —
# they aggregate in SQL). Beyond this the duration stats are sampled.
SERIES_ROW_CAP = 100_000
# Short overview cache so a dashboard refresh / multi-widget load doesn't re-run
# the full aggregation each time. Tunable (0 disables) — a freshly ingested run
# can lag the dashboard by up to this many seconds. See INSIGHTS_OVERVIEW_CACHE_TTL.
OVERVIEW_CACHE_TTL = getattr(settings, "INSIGHTS_OVERVIEW_CACHE_TTL", 30)

# All AI/agent span kinds (for run grouping); token usage is only summed over
# TOKEN_KINDS — the invoke_agent span re-reports its children's token totals, so
# including it would double-count.
GEN_KINDS = [KIND_AGENT, KIND_LLM, KIND_TOOL, KIND_HANDOFF, KIND_EMBEDDINGS]
TOKEN_KINDS = [KIND_LLM, KIND_EMBEDDINGS]
_FAILED = ~Q(status__in=NON_FAILURE_STATUS)
_IS_TOKEN_KIND = Q(kind__in=TOKEN_KINDS)


def _cache_key(name: str, project, stats_period, start, end) -> str:
    raw = f"{name}:{project.id}:{stats_period}:{start}:{end}"
    return f"insights:{hashlib.sha1(raw.encode()).hexdigest()}"


# Hard cap on a custom range so a hostile/huge start..end can't unbound scans.
MAX_RANGE_MINUTES = 366 * 24 * 60


def _parse_dt(value):
    """Parse an ISO-8601 datetime (tolerating a trailing ``Z``) into an aware dt."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def resolve_window(stats_period=None, start=None, end=None):
    """Resolve a window from either an explicit ``start``/``end`` datetime range or
    a relative ``stats_period`` preset (the fallback).

    Returns ``(since, until, bounded)``. ``until`` is always set (so the time
    series has an axis end), but the upper bound is only *enforced* on the query
    for an explicit custom range (``bounded=True``). Relative windows stay
    open-ended at the top so a span that just arrived — or one whose timestamp is
    marginally ahead of the server clock — is never dropped.
    """
    now = timezone.now()
    s = _parse_dt(start)
    e = _parse_dt(end) or now
    if s is not None and e > s:
        # Clamp an over-long custom range from the END so recent data is kept.
        if (e - s) > timezone.timedelta(minutes=MAX_RANGE_MINUTES):
            s = e - timezone.timedelta(minutes=MAX_RANGE_MINUTES)
        return s, e, True
    minutes = WINDOWS.get(stats_period or DEFAULT_PERIOD, WINDOWS[DEFAULT_PERIOD])
    return now - timezone.timedelta(minutes=minutes), now, False


def _base(project, since, until, *, bounded):
    qs = AiSpan.objects.filter(project=project, timestamp__gte=since)
    return qs.filter(timestamp__lt=until) if bounded else qs


def _tokens(qs) -> dict:
    agg = qs.aggregate(
        input=Sum("input_tokens"),
        output=Sum("output_tokens"),
        total=Sum("total_tokens"),
        cached=Sum("cached_input_tokens"),
        reasoning=Sum("reasoning_tokens"),
        cost=Sum("cost_usd"),
    )
    inp = agg["input"] or 0
    cached = agg["cached"] or 0
    return {
        "input": inp,
        "output": agg["output"] or 0,
        "total": agg["total"] or 0,
        "cached": cached,
        # Sentry splits the input bar into cached vs fresh ("not cached").
        "not_cached": max(0, inp - cached),
        "reasoning": agg["reasoning"] or 0,
        "cost_usd": round(agg["cost"] or 0.0, 6),
    }


def _duration_stats(qs) -> dict:
    """avg / p50 / p95 over a span queryset's durations (Python percentile so the
    math is identical on SQLite / Postgres / MySQL). Flags when the percentile
    sample was capped so the UI can say so instead of silently understating."""
    durs = sorted(qs.values_list("duration_ms", flat=True)[: SERIES_ROW_CAP + 1])
    sampled = len(durs) > SERIES_ROW_CAP
    if sampled:
        durs = durs[:SERIES_ROW_CAP]
    n = len(durs)
    if not n:
        return {"avg": None, "p50": None, "p95": None, "sampled": False}

    def pct(p: float) -> float:
        if n == 1:
            return durs[0]
        k = (n - 1) * p
        f, c = math.floor(k), math.ceil(k)
        if f == c:
            return durs[int(k)]
        return durs[f] * (c - k) + durs[c] * (k - f)

    return {
        "avg": round(sum(durs) / n, 3),
        "p50": round(pct(0.50), 3),
        "p95": round(pct(0.95), 3),
        "sampled": sampled,
    }


def _bucket_meta(since, until):
    """Calendar-aligned bucketing for the [since, until] window: hourly for ≤2
    days, else daily. Returns (unit, Trunc fn, width_minutes, aligned_start, n)."""
    minutes = max(1, (until - since).total_seconds() / 60)
    if minutes <= 2 * 24 * 60:
        unit, trunc, width = "hour", TruncHour, 60
        start = since.replace(minute=0, second=0, microsecond=0)
    else:
        unit, trunc, width = "day", TruncDay, 1440
        start = since.replace(hour=0, minute=0, second=0, microsecond=0)
    span = max(0.0, (until - start).total_seconds() / 60)
    n = max(1, math.ceil(span / width) + 1)
    return unit, trunc, width, start, n


def _series(qs, *, since, until, aggs: dict[str, object]) -> dict:
    """Bucket a queryset into a calendar-aligned time series **in SQL**
    (``Trunc`` + group-by — no row scan). ``aggs`` maps output key → aggregate
    expression; returns one list per key aligned to ``buckets`` buckets."""
    unit, trunc, width, start, n = _bucket_meta(since, until)
    keys = list(aggs)
    cols = {k: [0] * n for k in keys}
    # Truncate in UTC — ``start`` is UTC-aligned, but with USE_TZ + a non-UTC
    # TIME_ZONE (default Asia/Tehran, +03:30) Trunc would otherwise bucket on the
    # local calendar, shifting every bar off its label (a whole day for daily).
    rows = (
        qs.annotate(_b=trunc("timestamp", tzinfo=UTC)).values("_b").annotate(**aggs).order_by("_b")
    )
    for r in rows:
        b = r["_b"]
        if b is None:
            continue
        idx = int((b - start).total_seconds() / 60 / width)
        if 0 <= idx < n:
            for k in keys:
                cols[k][idx] = r[k] or 0
    return {
        "unit": unit,
        "buckets": n,
        "start": start.isoformat(),
        "width_minutes": width,
        "cols": cols,
    }


def _breakdown(qs, field: str, *, limit: int = TOP_N) -> list[dict]:
    """Top-N ``field`` values by occurrence (+ summed tokens), excluding blanks."""
    rows = (
        qs.exclude(**{f"{field}": ""})
        .values(field)
        .annotate(
            count=Count("id"),
            input_tokens=Sum("input_tokens"),
            output_tokens=Sum("output_tokens"),
            total_tokens=Sum("total_tokens"),
            cached_input_tokens=Sum("cached_input_tokens"),
        )
        .order_by("-count")[:limit]
    )
    return [
        {
            "key": r[field] or "",
            "count": r["count"],
            "input_tokens": r["input_tokens"] or 0,
            "output_tokens": r["output_tokens"] or 0,
            "total_tokens": r["total_tokens"] or 0,
            "cached_input_tokens": r["cached_input_tokens"] or 0,
        }
        for r in rows
    ]


# --- Agents dashboard ----------------------------------------------------- #


def agents_overview(project, *, stats_period=DEFAULT_PERIOD, start=None, end=None) -> dict:
    key = _cache_key("agents", project, stats_period, start, end)
    cached = cache.get(key)
    if cached is not None:
        return cached

    since, until, bounded = resolve_window(stats_period, start, end)
    base = _base(project, since, until, bounded=bounded)

    agents = base.filter(kind=KIND_AGENT)
    llms = base.filter(kind=KIND_LLM)
    tools = base.filter(kind=KIND_TOOL)
    gen = base.filter(kind__in=GEN_KINDS)
    tokenable = base.filter(_IS_TOKEN_KIND)

    agent_runs = agents.count()
    # Fall back to distinct traces when the SDK emits chat spans without an
    # explicit invoke_agent wrapper.
    if not agent_runs:
        agent_runs = gen.values("trace_id").distinct().count()

    runs_series = _series(agents, since=since, until=until, aggs={"runs": Count("id")})
    llm_series = _series(
        llms,
        since=since,
        until=until,
        aggs={
            "calls": Count("id"),
            "tin": Sum("input_tokens"),
            "tout": Sum("output_tokens"),
        },
    )

    payload = {
        "stats_period": stats_period,
        "start": since.isoformat(),
        "end": until.isoformat(),
        "totals": {
            "agent_runs": agent_runs,
            "llm_calls": llms.count(),
            "tool_calls": tools.count(),
            "errors": gen.filter(_FAILED).count(),
            "tokens": _tokens(tokenable),
            "duration": _duration_stats(agents if agent_runs else llms),
        },
        "llm_by_model": _breakdown(llms, "model"),
        "by_provider": _breakdown(llms, "provider"),
        "by_agent": _breakdown(agents, "agent_name"),
        "top_tools": _breakdown(tools, "tool_name"),
        "series": {
            "unit": runs_series["unit"],
            "buckets": runs_series["buckets"],
            "start": runs_series["start"],
            "width_minutes": runs_series["width_minutes"],
            "runs": runs_series["cols"]["runs"],
            "llm_calls": llm_series["cols"]["calls"],
            "tokens_input": llm_series["cols"]["tin"],
            "tokens_output": llm_series["cols"]["tout"],
        },
    }
    if OVERVIEW_CACHE_TTL:
        cache.set(key, payload, OVERVIEW_CACHE_TTL)
    return payload


# --- MCP dashboard -------------------------------------------------------- #


def mcp_overview(project, *, stats_period=DEFAULT_PERIOD, start=None, end=None) -> dict:
    key = _cache_key("mcp", project, stats_period, start, end)
    cached = cache.get(key)
    if cached is not None:
        return cached

    since, until, bounded = resolve_window(stats_period, start, end)
    mcp = _base(project, since, until, bounded=bounded).filter(kind=KIND_MCP)

    series = _series(mcp, since=since, until=until, aggs={"requests": Count("id")})

    payload = {
        "stats_period": stats_period,
        "start": since.isoformat(),
        "end": until.isoformat(),
        "totals": {
            "requests": mcp.count(),
            "errors": mcp.filter(_FAILED).count(),
            "clients": mcp.exclude(client_address="").values("client_address").distinct().count(),
            "tools": mcp.exclude(mcp_tool="").values("mcp_tool").distinct().count(),
            "duration": _duration_stats(mcp),
        },
        "by_client": _breakdown(mcp, "client_address"),
        "by_method": _breakdown(mcp, "mcp_method"),
        "by_transport": _breakdown(mcp, "mcp_transport"),
        "top_tools": _breakdown(mcp, "mcp_tool"),
        "top_resources": _breakdown(mcp, "mcp_resource"),
        "top_prompts": _breakdown(mcp, "mcp_prompt"),
        "series": {
            "unit": series["unit"],
            "buckets": series["buckets"],
            "start": series["start"],
            "width_minutes": series["width_minutes"],
            "requests": series["cols"]["requests"],
        },
    }
    if OVERVIEW_CACHE_TTL:
        cache.set(key, payload, OVERVIEW_CACHE_TTL)
    return payload


# --- Agent runs list + detail --------------------------------------------- #


def list_runs(
    project, *, stats_period=DEFAULT_PERIOD, start=None, end=None, limit: int = 50, offset: int = 0
) -> dict:
    """Recent agent runs (one row per trace), with per-run LLM/tool/token rollups."""
    since, until, bounded = resolve_window(stats_period, start, end)
    base = _base(project, since, until, bounded=bounded).filter(kind__in=GEN_KINDS)

    traces = (
        base.values("trace_id")
        .annotate(
            last_seen=Max("timestamp"),
            first_seen=Min("timestamp"),
            llm_calls=Count("id", filter=Q(kind=KIND_LLM)),
            tool_calls=Count("id", filter=Q(kind=KIND_TOOL)),
            # Token sums only over LLM/embeddings spans — the invoke_agent span
            # re-reports the same totals, which would otherwise double-count.
            total_tokens=Sum("total_tokens", filter=_IS_TOKEN_KIND),
            input_tokens=Sum("input_tokens", filter=_IS_TOKEN_KIND),
            output_tokens=Sum("output_tokens", filter=_IS_TOKEN_KIND),
            cached_input_tokens=Sum("cached_input_tokens", filter=_IS_TOKEN_KIND),
            errors=Count("id", filter=_FAILED),
        )
        .order_by("-last_seen")
    )
    total = traces.count()
    page = list(traces[offset : offset + limit])
    trace_ids = [r["trace_id"] for r in page]

    # Enrich each run with its anchor span (agent span preferred) for the
    # display name / model / duration / event_id link.
    anchors: dict[str, AiSpan] = {}
    if trace_ids:
        for s in AiSpan.objects.filter(
            project=project, trace_id__in=trace_ids, kind__in=GEN_KINDS
        ).order_by("trace_id", "-duration_ms"):
            # Prefer an agent span; otherwise keep the longest span seen.
            cur = anchors.get(s.trace_id)
            if cur is None or (s.kind == KIND_AGENT and cur.kind != KIND_AGENT):
                anchors[s.trace_id] = s

    results = []
    for r in page:
        a = anchors.get(r["trace_id"])
        run_ms = a.duration_ms if a else 0.0
        if not run_ms and r["last_seen"] and r["first_seen"]:
            run_ms = (r["last_seen"] - r["first_seen"]).total_seconds() * 1000
        results.append(
            {
                "trace_id": r["trace_id"],
                "event_id": str(a.transaction_event_id) if a and a.transaction_event_id else None,
                "name": (a.agent_name or a.name) if a else "",
                "model": a.model if a else "",
                "provider": a.provider if a else "",
                "status": a.status if a else "",
                "is_failed": bool(r["errors"]),
                "duration_ms": round(run_ms, 3),
                "llm_calls": r["llm_calls"],
                "tool_calls": r["tool_calls"],
                "total_tokens": r["total_tokens"] or 0,
                "input_tokens": r["input_tokens"] or 0,
                "output_tokens": r["output_tokens"] or 0,
                "cached_input_tokens": r["cached_input_tokens"] or 0,
                "timestamp": r["last_seen"].isoformat() if r["last_seen"] else None,
            }
        )

    return {
        "count": total,
        "results": results,
        "stats_period": stats_period,
    }


def _span_dict(s: AiSpan) -> dict:
    return {
        "id": str(s.id),
        "span_id": s.span_id,
        "parent_span_id": s.parent_span_id,
        "op": s.op,
        "kind": s.kind,
        "name": s.name,
        "description": s.description,
        "status": s.status,
        "is_failed": s.is_failed,
        "duration_ms": s.duration_ms,
        "timestamp": s.timestamp.isoformat(),
        "provider": s.provider,
        "model": s.model,
        "agent_name": s.agent_name,
        "tool_name": s.tool_name,
        "input_tokens": s.input_tokens,
        "output_tokens": s.output_tokens,
        "total_tokens": s.total_tokens,
        "cached_input_tokens": s.cached_input_tokens,
        "reasoning_tokens": s.reasoning_tokens,
        "cost_usd": s.cost_usd,
        "mcp_method": s.mcp_method,
        "mcp_tool": s.mcp_tool,
        "mcp_resource": s.mcp_resource,
        "mcp_prompt": s.mcp_prompt,
        "mcp_transport": s.mcp_transport,
        "client_address": s.client_address,
        "data": s.data,
    }


def run_detail(project, trace_id: str) -> dict | None:
    """A single agent run: its AI/MCP spans (timeline) + rollup summary."""
    spans = list(AiSpan.objects.filter(project=project, trace_id=trace_id).order_by("timestamp"))
    if not spans:
        return None
    qs = AiSpan.objects.filter(project=project, trace_id=trace_id)
    agent = next((s for s in spans if s.kind == KIND_AGENT), None)
    event_id = next((s.transaction_event_id for s in spans if s.transaction_event_id), None)
    return {
        "trace_id": trace_id,
        "event_id": str(event_id) if event_id else None,
        "name": (agent.agent_name or agent.name) if agent else spans[0].name,
        "model": agent.model if agent else "",
        "timestamp": spans[0].timestamp.isoformat(),
        "summary": {
            "llm_calls": qs.filter(kind=KIND_LLM).count(),
            "tool_calls": qs.filter(kind=KIND_TOOL).count(),
            "mcp_requests": qs.filter(kind=KIND_MCP).count(),
            "errors": qs.filter(_FAILED).count(),
            "tokens": _tokens(qs.filter(_IS_TOKEN_KIND)),
            "duration_ms": agent.duration_ms
            if agent
            else round(sum(s.duration_ms for s in spans), 3),
        },
        "spans": [_span_dict(s) for s in spans],
    }


def get_project_for(user, project_pk) -> Project:
    return get_object_or_404(
        Project.objects.filter(organization__memberships__user=user), pk=project_pk
    )
