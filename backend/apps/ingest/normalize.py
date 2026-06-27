"""
Normalize a raw SDK payload into Errora's canonical event interface before it
reaches grouping/storage. Keeps the ingest contract stable across SDK versions
and clamps unbounded fields to protect the store.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

MAX_FRAMES = 250
MAX_VALUE = 8192
MAX_SPANS = 1000
MAX_BREADCRUMBS = 100
MAX_MODULES = 1000
ALLOWED_LEVELS = {"debug", "info", "warning", "error", "fatal"}


def _clamp(text: Any, length: int = MAX_VALUE) -> str:
    if text is None:
        return ""
    return str(text)[:length]


def _normalize_exception(exc: dict[str, Any]) -> dict[str, Any]:
    values = exc.get("values")
    if values is None and ("type" in exc or "value" in exc):
        values = [exc]
    out_values = []
    for v in values or []:
        stack = v.get("stacktrace") or {}
        frames = (stack.get("frames") or [])[:MAX_FRAMES]
        mech = v.get("mechanism") or {}
        out_values.append(
            {
                "type": _clamp(v.get("type"), 255),
                "value": _clamp(v.get("value")),
                "module": _clamp(v.get("module"), 255),
                # Preserve handled/unhandled + mechanism type (Sentry's "Mechanism").
                "mechanism": {
                    "type": _clamp(mech.get("type"), 64),
                    "handled": mech.get("handled"),
                }
                if mech
                else {},
                "stacktrace": {"frames": frames} if frames else {},
            }
        )
    return {"values": out_values}


def _normalize_breadcrumbs(raw: Any) -> list[dict[str, Any]]:
    """Keep the breadcrumb trail (SQL queries, cache, navigation, http, …)."""
    values = raw.get("values") if isinstance(raw, dict) else raw
    out: list[dict[str, Any]] = []
    for b in (values or [])[:MAX_BREADCRUMBS]:
        if not isinstance(b, dict):
            continue
        out.append(
            {
                "timestamp": b.get("timestamp"),
                "type": _clamp(b.get("type"), 32),
                "category": _clamp(b.get("category"), 64),
                "level": _clamp(b.get("level"), 16),
                "message": _clamp(b.get("message")),
                "data": b.get("data") if isinstance(b.get("data"), dict) else {},
            }
        )
    return out


def _tags_to_dict(tags: Any) -> dict[str, str]:
    """Accept either Sentry's list-of-pairs or a plain dict of tags."""
    if isinstance(tags, dict):
        return {str(k): _clamp(v, 200) for k, v in tags.items()}
    if isinstance(tags, list):
        out = {}
        for pair in tags:
            if isinstance(pair, (list, tuple)) and len(pair) == 2:
                out[str(pair[0])] = _clamp(pair[1], 200)
        return out
    return {}


def _ctx_label(ctx: dict[str, Any], combined_key: str) -> str:
    """A "name version" label for a context (browser/os/runtime)."""
    if ctx.get(combined_key):
        return _clamp(ctx[combined_key], 96)
    name = ctx.get("name") or ""
    version = ctx.get("version") or ""
    return _clamp(f"{name} {version}".strip(), 96)


def _derive_tags(data: dict[str, Any]) -> dict[str, str]:
    """Compute indexable tags from contexts/request — like Sentry's relay does —
    so the UI can show browser/os/runtime/url/transaction/handled without the SDK
    having set them explicitly."""
    tags: dict[str, str] = {}
    ctx = data.get("contexts") or {}

    browser = ctx.get("browser") or {}
    if browser.get("name"):
        tags["browser.name"] = _clamp(browser["name"], 64)
        tags["browser"] = _ctx_label(browser, "browser")
    osc = ctx.get("os") or {}
    if osc.get("name"):
        tags["os.name"] = _clamp(osc["name"], 64)
        tags["os"] = _ctx_label(osc, "os")
    runtime = ctx.get("runtime") or {}
    if runtime.get("name"):
        tags["runtime.name"] = _clamp(runtime["name"], 64)
        tags["runtime"] = _ctx_label(runtime, "runtime")
    device = ctx.get("device") or {}
    if device.get("family"):
        tags["device.family"] = _clamp(device["family"], 64)
    if device.get("model"):
        tags["device"] = _clamp(device["model"], 64)

    if (data.get("request") or {}).get("url"):
        tags["url"] = _clamp(data["request"]["url"], 200)
    for key in ("transaction", "environment", "release", "server_name", "level"):
        if data.get(key):
            tags[key] = _clamp(data[key], 200)

    values = (data.get("exception") or {}).get("values") or []
    if values:
        mech = values[-1].get("mechanism") or {}
        if mech.get("type"):
            tags["mechanism"] = _clamp(mech["type"], 32)
        if mech.get("handled") is not None:
            tags["handled"] = "yes" if mech["handled"] else "no"
    return tags


def normalize_event(raw: dict[str, Any]) -> dict[str, Any]:
    data: dict[str, Any] = {
        "event_id": raw.get("event_id") or uuid.uuid4().hex,
        "timestamp": raw.get("timestamp"),
        "platform": _clamp(raw.get("platform", "other"), 32),
        "level": raw.get("level") if raw.get("level") in ALLOWED_LEVELS else "error",
        "environment": _clamp(raw.get("environment"), 64),
        "release": _clamp(raw.get("release"), 128),
        "dist": _clamp(raw.get("dist"), 64),
        "server_name": _clamp(raw.get("server_name"), 255),
        "transaction": _clamp(raw.get("transaction"), 512),
        "message": _clamp(raw.get("message")),
        "extra": raw.get("extra") or {},
        "user": raw.get("user") or {},
        "request": raw.get("request") or {},
        "contexts": raw.get("contexts") or {},
        "sdk": raw.get("sdk") or {},
        # Installed packages / dependency versions (Sentry "Packages").
        "modules": dict(list((raw.get("modules") or {}).items())[:MAX_MODULES]),
        "breadcrumbs": _normalize_breadcrumbs(raw.get("breadcrumbs")),
    }
    if raw.get("fingerprint"):
        data["fingerprint"] = raw["fingerprint"]
    if raw.get("exception"):
        data["exception"] = _normalize_exception(raw["exception"])
    if raw.get("logentry"):
        data["logentry"] = {"message": _clamp(raw["logentry"].get("message"))}
    elif raw.get("message"):
        data["logentry"] = {"message": data["message"]}

    # Derived tags first, then let any SDK-provided tags override.
    data["tags"] = {**_derive_tags(data), **_tags_to_dict(raw.get("tags"))}
    return data


def _clamp_span_data(raw: Any, max_keys: int = 50, max_len: int = 2048) -> dict[str, Any]:
    """Keep a span's structured ``data`` (db.system / db.statement, http method +
    status, cache hit/key, rows, …) — clamped so a span can't bloat the store."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in list(raw.items())[:max_keys]:
        if isinstance(v, str):
            out[str(k)] = v[:max_len]
        elif isinstance(v, (int, float, bool)) or v is None:
            out[str(k)] = v
        else:
            out[str(k)] = str(v)[:max_len]
    return out


def _epoch(raw: Any) -> float | None:
    """Parse an SDK timestamp (epoch float/int or ISO-8601 string) to epoch seconds."""
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def normalize_transaction(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a Sentry ``transaction`` envelope item into Errora's shape.

    Duration is ``timestamp - start_timestamp`` (ms); each span's ``start_ms`` is
    its offset from the transaction start so the UI can lay out a waterfall.
    """
    trace = (raw.get("contexts") or {}).get("trace") or {}
    start = _epoch(raw.get("start_timestamp"))
    end = _epoch(raw.get("timestamp"))
    duration_ms = max(0.0, (end - start) * 1000) if (start and end) else 0.0

    spans = []
    for s in (raw.get("spans") or [])[:MAX_SPANS]:
        ss = _epoch(s.get("start_timestamp"))
        se = _epoch(s.get("timestamp"))
        spans.append(
            {
                "span_id": _clamp(s.get("span_id"), 16),
                "parent_span_id": _clamp(s.get("parent_span_id"), 16),
                "op": _clamp(s.get("op"), 64),
                # SQL statement / cache key / URL — give it room.
                "description": _clamp(s.get("description"), 2048),
                "status": _clamp(s.get("status"), 32),
                "start_ms": round((ss - start) * 1000, 3) if (ss and start) else 0.0,
                "duration_ms": max(0.0, (se - ss) * 1000) if (ss and se) else 0.0,
                "data": _clamp_span_data(s.get("data")),
            }
        )

    return {
        "event_id": raw.get("event_id") or uuid.uuid4().hex,
        "name": _clamp(raw.get("transaction") or "<unnamed>", 512),
        "op": _clamp(trace.get("op"), 64),
        "status": _clamp(trace.get("status"), 32),
        "trace_id": _clamp(trace.get("trace_id"), 32),
        "span_id": _clamp(trace.get("span_id"), 16),
        "platform": _clamp(raw.get("platform", "other"), 32),
        "environment": _clamp(raw.get("environment"), 64),
        "release": _clamp(raw.get("release"), 128),
        "start_timestamp": start,
        "timestamp": end,
        "duration_ms": round(duration_ms, 3),
        "spans": spans,
        "data": {
            "tags": raw.get("tags") or {},
            "measurements": raw.get("measurements") or {},
            "contexts": raw.get("contexts") or {},
        },
    }


# --- Logs ----------------------------------------------------------------- #

# Sentry/OTel log severities (low→high) and their coarse numeric mapping.
LOG_LEVELS = {"trace", "debug", "info", "warn", "error", "fatal"}
LOG_SEVERITY = {"trace": 1, "debug": 5, "info": 9, "warn": 13, "error": 17, "fatal": 21}
MAX_LOG_BODY = 8192
MAX_LOG_ATTRS = 100
MAX_LOG_BATCH = 1000
# Attribute keys we promote to first-class columns rather than leaving in the bag.
_RESERVED_ATTRS = {
    "sentry.environment": "environment",
    "sentry.release": "release",
    "sentry.trace.parent_span_id": "span_id",
    "environment": "environment",
    "release": "release",
}


def _norm_level(level: Any, severity_number: Any) -> tuple[str, int]:
    """Resolve a log level + numeric severity from either field, tolerating aliases."""
    lvl = str(level or "").lower().strip()
    if lvl in ("warning",):
        lvl = "warn"
    if lvl not in LOG_LEVELS:
        lvl = ""
    if isinstance(severity_number, (int, float)) and severity_number:
        num = int(severity_number)
    else:
        num = LOG_SEVERITY.get(lvl, 0)
    if not lvl and num:
        # Derive a level from the numeric severity bucket (OTel 1–24 ranges).
        lvl = next(
            (k for k, v in sorted(LOG_SEVERITY.items(), key=lambda kv: -kv[1]) if num >= v), ""
        )
    return lvl, num


def _flatten_attributes(raw: Any) -> dict[str, Any]:
    """Flatten Sentry's typed attribute map ``{k: {value, type}}`` (or a plain
    ``{k: v}`` dict) into a flat ``{k: scalar}`` bag, clamping strings."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in list(raw.items())[:MAX_LOG_ATTRS]:
        val = v.get("value") if isinstance(v, dict) and "value" in v else v
        if isinstance(val, str):
            out[str(k)] = val[:1024]
        elif isinstance(val, (int, float, bool)) or val is None:
            out[str(k)] = val
        else:
            out[str(k)] = str(val)[:1024]
    return out


def _normalize_log_item(item: dict[str, Any]) -> dict[str, Any]:
    attrs = _flatten_attributes(item.get("attributes"))
    level, severity = _norm_level(item.get("level"), item.get("severity_number"))
    # Promote reserved attributes into columns, then drop them from the bag.
    promoted: dict[str, str] = {}
    for src, dest in _RESERVED_ATTRS.items():
        if src in attrs and attrs[src] not in (None, ""):
            promoted[dest] = str(attrs.pop(src))
    return {
        "timestamp": _epoch(item.get("timestamp")),
        "level": level,
        "severity_number": severity,
        "body": _clamp(item.get("body") or item.get("message"), MAX_LOG_BODY),
        "trace_id": _clamp(item.get("trace_id"), 32),
        "span_id": promoted.get("span_id") or _clamp(item.get("span_id"), 16),
        "environment": _clamp(promoted.get("environment") or item.get("environment"), 64),
        "release": _clamp(promoted.get("release") or item.get("release"), 128),
        "attributes": attrs,
    }


def normalize_logs(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize a Sentry ``log`` envelope item (a batch container shaped
    ``{"items": [...]}``) into a list of canonical log dicts."""
    items = raw.get("items") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        items = [raw] if isinstance(raw, dict) else []
    return [_normalize_log_item(it) for it in items[:MAX_LOG_BATCH] if isinstance(it, dict)]


# Re-export UTC for callers that build datetimes from the parsed epoch.
__all__ = ["normalize_event", "normalize_transaction", "normalize_logs", "UTC"]
