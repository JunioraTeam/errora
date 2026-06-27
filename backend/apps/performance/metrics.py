"""
Pure aggregation helpers for performance metrics. Kept dependency-free and
DB-agnostic (percentiles are computed in Python) so the same math runs on
SQLite, Postgres and MySQL.
"""

from __future__ import annotations

import math

from .models import NON_FAILURE_STATUS


def percentile(sorted_vals: list[float], p: float) -> float:
    """Linear-interpolation percentile (``p`` in [0, 1]) over a sorted list."""
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


def aggregate_metrics(rows: list[tuple[float, str]], window_minutes: float | None = None) -> dict:
    """Aggregate (duration_ms, status) rows into latency/failure/throughput stats."""
    durs = sorted(d for d, _ in rows)
    n = len(durs)
    if n == 0:
        return {
            "count": 0,
            "p50": None,
            "p75": None,
            "p95": None,
            "p99": None,
            "avg": None,
            "failure_rate": 0.0,
            "tpm": 0.0,
        }
    failed = sum(1 for _, s in rows if s not in NON_FAILURE_STATUS)
    tpm = round(n / window_minutes, 3) if window_minutes else 0.0
    return {
        "count": n,
        "p50": round(percentile(durs, 0.50), 3),
        "p75": round(percentile(durs, 0.75), 3),
        "p95": round(percentile(durs, 0.95), 3),
        "p99": round(percentile(durs, 0.99), 3),
        "avg": round(sum(durs) / n, 3),
        "failure_rate": round(failed / n, 4),
        "tpm": tpm,
    }


def span_op_breakdown(span_lists: list[list[dict]]) -> list[dict]:
    """Aggregate spans across transactions by ``op``: total/avg self time + count."""
    agg: dict[str, dict] = {}
    for spans in span_lists:
        for s in spans:
            op = s.get("op") or "default"
            a = agg.setdefault(op, {"op": op, "count": 0, "total_ms": 0.0})
            a["count"] += 1
            a["total_ms"] += float(s.get("duration_ms") or 0.0)
    out = sorted(agg.values(), key=lambda x: -x["total_ms"])
    for a in out:
        a["total_ms"] = round(a["total_ms"], 3)
        a["avg_ms"] = round(a["total_ms"] / a["count"], 3) if a["count"] else 0.0
    return out


def duration_histogram(durations: list[float], bins: int = 20) -> list[dict]:
    """Bucket durations into ``bins`` equal-width bins between 0 and max."""
    if not durations:
        return []
    hi = max(durations)
    if hi <= 0:
        return [{"start": 0.0, "end": 0.0, "count": len(durations)}]
    width = hi / bins
    counts = [0] * bins
    for d in durations:
        idx = min(int(d / width), bins - 1)
        counts[idx] += 1
    return [
        {"start": round(i * width, 3), "end": round((i + 1) * width, 3), "count": c}
        for i, c in enumerate(counts)
    ]
