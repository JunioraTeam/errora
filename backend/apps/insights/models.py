"""
LLM observability data model — the queryable projection of an AI-agent trace.

Sentry's AI-Agents & MCP monitoring is built on **spans**: an agent run is a
``gen_ai.invoke_agent`` span, each model round-trip a ``gen_ai.chat`` span, each
tool a ``gen_ai.execute_tool`` span, and every MCP request an ``mcp.server``
span — all carrying OpenTelemetry ``gen_ai.*`` / ``mcp.*`` attributes.

Errora already stores whole traces in ``performance.Transaction`` (span tree in
a JSONField). That is great for the waterfall but terrible for the aggregate
questions this product asks ("tokens by model", "MCP traffic by client", "most
used tools") which would otherwise mean scanning every transaction's JSON. So at
ingest we **project** the AI/MCP spans of each trace into ``AiSpan`` — one
indexed row per span — and all dashboards query that flat table.
"""

from __future__ import annotations

import uuid

from django.db import models

# Span "kind" — the coarse category we derive from the span op so the dashboards
# can filter cheaply without re-parsing the op string.
KIND_AGENT = "agent"  # gen_ai.invoke_agent
KIND_LLM = "llm"  # gen_ai.chat / responses / generate
KIND_TOOL = "tool"  # gen_ai.execute_tool
KIND_HANDOFF = "handoff"  # gen_ai.handoff (multi-agent)
KIND_EMBEDDINGS = "embeddings"  # gen_ai.embeddings
KIND_MCP = "mcp"  # mcp.server (one MCP JSON-RPC request)

KIND_CHOICES = [
    (KIND_AGENT, "Agent run"),
    (KIND_LLM, "LLM call"),
    (KIND_TOOL, "Tool call"),
    (KIND_HANDOFF, "Handoff"),
    (KIND_EMBEDDINGS, "Embeddings"),
    (KIND_MCP, "MCP request"),
]

# Statuses that do NOT count as failures (mirrors performance.NON_FAILURE_STATUS).
NON_FAILURE_STATUS = {"ok", "cancelled", "unknown", ""}


class AiSpan(models.Model):
    """One gen_ai / mcp span extracted from an ingested trace."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "organizations.Project", on_delete=models.CASCADE, related_name="ai_spans"
    )

    # Trace linkage (an "agent run" == all AiSpans sharing a trace_id).
    trace_id = models.CharField(max_length=32, blank=True, db_index=True)
    transaction_event_id = models.UUIDField(null=True, blank=True)
    span_id = models.CharField(max_length=16, blank=True)
    parent_span_id = models.CharField(max_length=16, blank=True)

    op = models.CharField(max_length=64, blank=True)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, db_index=True)
    description = models.CharField(max_length=512, blank=True)
    # Denormalized display label (agent name / model / tool / mcp method).
    name = models.CharField(max_length=256, blank=True)
    status = models.CharField(max_length=32, blank=True)

    timestamp = models.DateTimeField(db_index=True)
    duration_ms = models.FloatField(default=0.0)
    environment = models.CharField(max_length=64, blank=True, db_index=True)
    release = models.CharField(max_length=128, blank=True)

    # --- LLM / agent ------------------------------------------------------ #
    provider = models.CharField(max_length=64, blank=True)  # gen_ai.system
    model = models.CharField(max_length=128, blank=True, db_index=True)
    agent_name = models.CharField(max_length=128, blank=True)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    total_tokens = models.PositiveIntegerField(default=0)
    cached_input_tokens = models.PositiveIntegerField(default=0)
    reasoning_tokens = models.PositiveIntegerField(default=0)
    cost_usd = models.FloatField(default=0.0)
    tool_name = models.CharField(max_length=128, blank=True, db_index=True)

    # --- MCP -------------------------------------------------------------- #
    mcp_method = models.CharField(max_length=64, blank=True, db_index=True)
    mcp_tool = models.CharField(max_length=128, blank=True)
    mcp_resource = models.CharField(max_length=256, blank=True)
    mcp_prompt = models.CharField(max_length=128, blank=True)
    mcp_transport = models.CharField(max_length=32, blank=True)
    client_address = models.CharField(max_length=128, blank=True, db_index=True)
    client_name = models.CharField(max_length=128, blank=True)

    # Overflow attributes (messages, tool i/o, …) kept for the detail view.
    data = models.JSONField(default=dict)

    class Meta:
        indexes = [
            # The dashboards always filter (project, kind) over a time window, then
            # group by model / tool / client *within* that narrowed set — so the
            # composite below covers them; per-column indexes on model/tool/client
            # only added write amplification on the ingest hot path.
            models.Index(fields=["project", "kind", "-timestamp"]),
            models.Index(fields=["project", "-timestamp"]),
            models.Index(fields=["trace_id"]),
        ]
        ordering = ["-timestamp"]

    def __str__(self) -> str:
        return f"{self.kind}:{self.name or self.op}"

    @property
    def is_failed(self) -> bool:
        return self.status not in NON_FAILURE_STATUS
