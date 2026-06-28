"""
Project the gen_ai / mcp spans of a normalized transaction into ``AiSpan`` rows.

Called (via the ``transaction_stored`` signal) after a trace is stored. Reads the
OpenTelemetry semantic-convention attributes Sentry's AI SDKs emit on each span
and flattens the ones we aggregate on into indexed columns.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from django.utils import timezone

from .models import (
    KIND_AGENT,
    KIND_EMBEDDINGS,
    KIND_HANDOFF,
    KIND_LLM,
    KIND_MCP,
    KIND_TOOL,
    AiSpan,
)

# Attribute keys we lift into indexed columns — stripped from the stored ``data``
# bag so AiSpan.data isn't a verbatim duplicate of Transaction.spans[*].data.
PROMOTED_ATTR_KEYS = frozenset(
    {
        "gen_ai.system",
        "ai.model_provider",
        "gen_ai.request.model",
        "gen_ai.response.model",
        "ai.model_id",
        "gen_ai.agent.name",
        "ai.agent.name",
        "gen_ai.usage.input_tokens",
        "ai.prompt_tokens.used",
        "gen_ai.usage.prompt_tokens",
        "gen_ai.usage.output_tokens",
        "ai.completion_tokens.used",
        "gen_ai.usage.completion_tokens",
        "gen_ai.usage.total_tokens",
        "ai.total_tokens.used",
        "gen_ai.usage.input_tokens.cached",
        "gen_ai.usage.output_tokens.reasoning",
        "gen_ai.usage.total_cost",
        "gen_ai.cost.total_tokens",
        "gen_ai.tool.name",
        "ai.tool.name",
        "mcp.method.name",
        "mcp.request.method",
        "mcp.tool.name",
        "mcp.resource.uri",
        "mcp.resource.name",
        "mcp.prompt.name",
        "mcp.transport",
        "network.transport",
        "client.address",
        "mcp.client.address",
        "mcp.client.name",
        "client.name",
    }
)


def classify(op: str) -> str | None:
    """Map a span op to an AiSpan kind, or ``None`` if it is not an AI/MCP span."""
    op = (op or "").strip().lower()
    # Tolerate both the namespaced ("gen_ai.invoke_agent") and bare ("invoke_agent")
    # forms different SDK versions emit.
    suffix = op.split(".", 1)[1] if op.startswith("gen_ai.") else op
    if op.startswith("mcp"):
        return KIND_MCP
    if suffix in ("invoke_agent", "create_agent"):
        return KIND_AGENT
    if suffix in ("execute_tool", "tool"):
        return KIND_TOOL
    if suffix == "handoff":
        return KIND_HANDOFF
    if suffix == "embeddings":
        return KIND_EMBEDDINGS
    if op.startswith("gen_ai") or op.startswith("ai.") or suffix in ("chat", "responses"):
        return KIND_LLM
    return None


def _int(data: dict, *keys: str) -> int:
    """First present, coercible-to-int key (tokens may arrive as int or str)."""
    for k in keys:
        v = data.get(k)
        if v is None or v == "":
            continue
        try:
            return max(0, int(float(v)))
        except (ValueError, TypeError):
            continue
    return 0


def _float(data: dict, *keys: str) -> float:
    for k in keys:
        v = data.get(k)
        if v is None or v == "":
            continue
        try:
            return float(v)
        except (ValueError, TypeError):
            continue
    return 0.0


def _str(data: dict, *keys: str, limit: int = 256) -> str:
    for k in keys:
        v = data.get(k)
        if v not in (None, ""):
            return str(v)[:limit]
    return ""


def _display_name(kind: str, d: dict[str, Any]) -> str:
    if kind == KIND_AGENT:
        return d["agent_name"] or d["model"] or "agent"
    if kind in (KIND_LLM, KIND_EMBEDDINGS):
        return d["model"] or d["provider"] or "model"
    if kind == KIND_TOOL:
        return d["tool_name"] or "tool"
    if kind == KIND_MCP:
        target = d["mcp_tool"] or d["mcp_resource"] or d["mcp_prompt"]
        return f"{d['mcp_method']} {target}".strip() or d["mcp_method"] or "mcp"
    return d["model"] or ""


def _row_fields(op: str, kind: str, attrs: dict[str, Any]) -> dict[str, Any]:
    """Extract the indexed columns from a span's attribute bag."""
    fields = {
        "provider": _str(attrs, "gen_ai.system", "ai.model_provider", limit=64),
        "model": _str(
            attrs, "gen_ai.request.model", "gen_ai.response.model", "ai.model_id", limit=128
        ),
        "agent_name": _str(attrs, "gen_ai.agent.name", "ai.agent.name", limit=128),
        "input_tokens": _int(
            attrs,
            "gen_ai.usage.input_tokens",
            "ai.prompt_tokens.used",
            "gen_ai.usage.prompt_tokens",
        ),
        "output_tokens": _int(
            attrs,
            "gen_ai.usage.output_tokens",
            "ai.completion_tokens.used",
            "gen_ai.usage.completion_tokens",
        ),
        "total_tokens": _int(attrs, "gen_ai.usage.total_tokens", "ai.total_tokens.used"),
        "cached_input_tokens": _int(attrs, "gen_ai.usage.input_tokens.cached"),
        "reasoning_tokens": _int(attrs, "gen_ai.usage.output_tokens.reasoning"),
        "cost_usd": _float(attrs, "gen_ai.usage.total_cost", "gen_ai.cost.total_tokens"),
        "tool_name": _str(attrs, "gen_ai.tool.name", "ai.tool.name", limit=128),
        "mcp_method": _str(attrs, "mcp.method.name", "mcp.request.method", limit=64),
        "mcp_tool": _str(attrs, "mcp.tool.name", limit=128),
        "mcp_resource": _str(attrs, "mcp.resource.uri", "mcp.resource.name", limit=256),
        "mcp_prompt": _str(attrs, "mcp.prompt.name", limit=128),
        "mcp_transport": _str(attrs, "mcp.transport", "network.transport", limit=32),
        "client_address": _str(attrs, "client.address", "mcp.client.address", limit=128),
        "client_name": _str(attrs, "mcp.client.name", "client.name", limit=128),
    }
    # Derive total from parts when the SDK didn't send it.
    if not fields["total_tokens"]:
        fields["total_tokens"] = fields["input_tokens"] + fields["output_tokens"]
    fields["name"] = _display_name(kind, fields)
    return fields


def _start_dt(txn_data: dict[str, Any]) -> datetime:
    start = txn_data.get("start_timestamp")
    if isinstance(start, (int, float)):
        return datetime.fromtimestamp(start, tz=UTC)
    return timezone.now()


def _likely_ai(txn_data: dict[str, Any]) -> bool:
    """Cheap pre-check: does this trace carry any gen_ai/mcp span at all? Lets the
    ingest path skip the savepoint + row build for the (vast) majority of
    non-AI transactions."""
    trace = ((txn_data.get("data") or {}).get("contexts") or {}).get("trace") or {}
    if classify(txn_data.get("op") or trace.get("op") or ""):
        return True
    return any(classify(s.get("op") or "") for s in (txn_data.get("spans") or []))


def _candidate_spans(txn_data: dict[str, Any]) -> list[dict[str, Any]]:
    """The trace's spans, plus a synthetic root span built from the trace context
    (the root agent/mcp span is carried at transaction level, not in ``spans``)."""
    spans = list(txn_data.get("spans") or [])
    trace = ((txn_data.get("data") or {}).get("contexts") or {}).get("trace") or {}
    root_op = txn_data.get("op") or trace.get("op") or ""
    root_span_id = txn_data.get("span_id", "")
    # Don't synthesize a root span if the SDK already included it in ``spans``
    # (some do) — that would double-count the agent run / MCP request.
    already = root_span_id and any(s.get("span_id") == root_span_id for s in spans)
    if classify(root_op) and not already:
        spans.append(
            {
                "span_id": txn_data.get("span_id", ""),
                "parent_span_id": "",
                "op": root_op,
                "description": txn_data.get("name", ""),
                "status": txn_data.get("status", ""),
                "start_ms": 0.0,
                "duration_ms": txn_data.get("duration_ms", 0.0),
                # Root span attributes live on the trace context, not in `data`.
                "data": trace.get("data") or {},
            }
        )
    return spans


def extract_ai_spans(project, txn_data: dict[str, Any], event_id: str | None = None) -> int:
    """Build + bulk-insert AiSpan rows for the AI/MCP spans in a trace. Returns count."""
    start_dt = _start_dt(txn_data)
    trace_id = txn_data.get("trace_id", "")
    environment = txn_data.get("environment", "")
    release = txn_data.get("release", "")

    rows: list[AiSpan] = []
    for s in _candidate_spans(txn_data):
        op = s.get("op") or ""
        kind = classify(op)
        if kind is None:
            continue
        attrs = s.get("data") if isinstance(s.get("data"), dict) else {}
        span_id = str(s.get("span_id") or "")[:16]
        start_ms = float(s.get("start_ms") or 0.0)
        rows.append(
            AiSpan(
                project=project,
                trace_id=trace_id,
                transaction_event_id=event_id,
                span_id=span_id,
                parent_span_id=str(s.get("parent_span_id") or "")[:16],
                op=op[:64],
                kind=kind,
                description=str(s.get("description") or "")[:512],
                status=str(s.get("status") or "")[:32],
                timestamp=start_dt + timezone.timedelta(milliseconds=start_ms),
                duration_ms=float(s.get("duration_ms") or 0.0),
                environment=environment,
                release=release,
                # Drop the keys already lifted into columns so data isn't a dup.
                data={k: v for k, v in attrs.items() if k not in PROMOTED_ATTR_KEYS},
                **_row_fields(op, kind, attrs),
            )
        )

    if not rows:
        return 0

    # Idempotency: a transaction can be reprocessed (Celery acks_late + retries)
    # and distributed traces share a trace_id across transactions. Delete only the
    # exact spans we're about to (re)insert — keyed by (trace_id, span_id) — so a
    # retry overwrites instead of duplicating, without touching sibling
    # transactions' distinct spans.
    span_ids = [r.span_id for r in rows if r.span_id]
    if trace_id and span_ids:
        AiSpan.objects.filter(
            project=project, trace_id=trace_id, span_id__in=span_ids
        ).delete()
    AiSpan.objects.bulk_create(rows, batch_size=500)
    return len(rows)
