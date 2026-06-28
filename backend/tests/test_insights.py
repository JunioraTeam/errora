"""LLM observability: gen_ai/mcp span extraction, dashboards, runs, API."""

import time
import uuid

import pytest

from apps.ingest.normalize import normalize_transaction
from apps.insights import queries
from apps.insights.extract import _likely_ai, classify, extract_ai_spans
from apps.insights.models import AiSpan
from apps.insights.queries import resolve_window
from apps.performance.services import store_transaction


def _agent_txn(
    *,
    model="gpt-4o",
    provider="openai",
    agent="research-agent",
    input_tokens=120,
    output_tokens=40,
    cached=30,
    tool="web_search",
    start=None,
    trace=None,
):
    """A gen_ai trace: invoke_agent root + a chat span + an execute_tool span."""
    start = start if start is not None else time.time()
    trace = trace or uuid.uuid4().hex
    return {
        "event_id": uuid.uuid4().hex,
        "transaction": f"invoke_agent {agent}",
        "start_timestamp": start,
        "timestamp": start + 1.5,
        "platform": "python",
        "environment": "prod",
        "contexts": {
            "trace": {
                "trace_id": trace,
                "span_id": "a" * 16,
                "op": "gen_ai.invoke_agent",
                "status": "ok",
                "data": {"gen_ai.agent.name": agent, "gen_ai.request.model": model},
            }
        },
        "spans": [
            {
                "span_id": "b" * 16,
                "parent_span_id": "a" * 16,
                "op": "gen_ai.chat",
                "description": f"chat {model}",
                "start_timestamp": start + 0.1,
                "timestamp": start + 1.0,
                "status": "ok",
                "data": {
                    "gen_ai.system": provider,
                    "gen_ai.request.model": model,
                    "gen_ai.usage.input_tokens": input_tokens,
                    "gen_ai.usage.output_tokens": output_tokens,
                    "gen_ai.usage.input_tokens.cached": cached,
                    "gen_ai.usage.total_tokens": input_tokens + output_tokens,
                },
            },
            {
                "span_id": "c" * 16,
                "parent_span_id": "a" * 16,
                "op": "gen_ai.execute_tool",
                "description": f"execute_tool {tool}",
                "start_timestamp": start + 1.0,
                "timestamp": start + 1.3,
                "status": "ok",
                "data": {"gen_ai.tool.name": tool},
            },
        ],
    }


def _mcp_txn(*, method="tools/call", tool="search_issues", client="127.0.0.1", start=None):
    start = start if start is not None else time.time()
    return {
        "event_id": uuid.uuid4().hex,
        "transaction": f"mcp.server {method}",
        "start_timestamp": start,
        "timestamp": start + 0.2,
        "platform": "python",
        "environment": "prod",
        "contexts": {
            "trace": {
                "trace_id": uuid.uuid4().hex,
                "span_id": "d" * 16,
                "op": "mcp.server",
                "status": "ok",
                "data": {
                    "mcp.method.name": method,
                    "mcp.tool.name": tool,
                    "mcp.transport": "http",
                    "client.address": client,
                },
            }
        },
        "spans": [],
    }


# --- pure classification -------------------------------------------------- #


def test_classify():
    assert classify("gen_ai.invoke_agent") == "agent"
    assert classify("invoke_agent") == "agent"
    assert classify("gen_ai.chat") == "llm"
    assert classify("gen_ai.execute_tool") == "tool"
    assert classify("gen_ai.handoff") == "handoff"
    assert classify("mcp.server") == "mcp"
    assert classify("db.query") is None
    assert classify("http.server") is None


# --- extraction ----------------------------------------------------------- #


@pytest.mark.django_db
def test_extract_creates_ai_spans(project):
    data = normalize_transaction(_agent_txn())
    n = extract_ai_spans(project, data, data["event_id"])
    # invoke_agent (root) + chat + execute_tool
    assert n == 3
    chat = AiSpan.objects.get(project=project, kind="llm")
    assert chat.model == "gpt-4o"
    assert chat.provider == "openai"
    assert chat.input_tokens == 120
    assert chat.output_tokens == 40
    assert chat.cached_input_tokens == 30
    assert chat.total_tokens == 160
    tool = AiSpan.objects.get(project=project, kind="tool")
    assert tool.tool_name == "web_search"
    agent = AiSpan.objects.get(project=project, kind="agent")
    assert agent.agent_name == "research-agent"


@pytest.mark.django_db
def test_non_ai_transaction_extracts_nothing(project):
    data = normalize_transaction(
        {
            "event_id": uuid.uuid4().hex,
            "transaction": "GET /users",
            "start_timestamp": time.time(),
            "timestamp": time.time() + 0.1,
            "contexts": {"trace": {"op": "http.server", "trace_id": "f" * 32}},
            "spans": [{"op": "db", "span_id": "1" * 16}],
        }
    )
    assert extract_ai_spans(project, data, data["event_id"]) == 0


@pytest.mark.django_db
def test_signal_fires_on_ingest(project):
    """store_transaction → transaction_stored signal → insights extraction."""
    from apps.ingest.tasks import process_transaction

    process_transaction.run(str(project.id), _agent_txn())
    assert AiSpan.objects.filter(project=project).count() == 3


# --- dashboards ----------------------------------------------------------- #


@pytest.mark.django_db
def test_agents_overview(project):
    for _ in range(3):
        store_and_extract(project, _agent_txn(model="gpt-4o"))
    store_and_extract(project, _agent_txn(model="claude-3-5-sonnet"))

    ov = queries.agents_overview(project, stats_period="24h")
    assert ov["totals"]["agent_runs"] == 4
    assert ov["totals"]["llm_calls"] == 4
    assert ov["totals"]["tool_calls"] == 4
    tok = ov["totals"]["tokens"]
    assert tok["input"] == 120 * 4
    assert tok["cached"] == 30 * 4
    assert tok["not_cached"] == (120 - 30) * 4
    models = {m["key"]: m for m in ov["llm_by_model"]}
    assert models["gpt-4o"]["count"] == 3
    assert models["claude-3-5-sonnet"]["count"] == 1
    tools = {t["key"]: t for t in ov["top_tools"]}
    assert tools["web_search"]["count"] == 4


@pytest.mark.django_db
def test_mcp_overview(project):
    store_and_extract(project, _mcp_txn(tool="search_issues", client="10.0.0.1"))
    store_and_extract(project, _mcp_txn(tool="search_issues", client="10.0.0.1"))
    store_and_extract(project, _mcp_txn(tool="get_event", client="10.0.0.2"))

    ov = queries.mcp_overview(project, stats_period="24h")
    assert ov["totals"]["requests"] == 3
    assert ov["totals"]["clients"] == 2
    clients = {c["key"]: c["count"] for c in ov["by_client"]}
    assert clients["10.0.0.1"] == 2
    tools = {t["key"]: t["count"] for t in ov["top_tools"]}
    assert tools["search_issues"] == 2


@pytest.mark.django_db
def test_list_and_detail_runs(project):
    trace = uuid.uuid4().hex
    store_and_extract(project, _agent_txn(trace=trace))

    runs = queries.list_runs(project, stats_period="24h")
    assert runs["count"] == 1
    run = runs["results"][0]
    assert run["trace_id"] == trace
    assert run["llm_calls"] == 1
    assert run["tool_calls"] == 1
    assert run["total_tokens"] == 160

    detail = queries.run_detail(project, trace)
    assert detail is not None
    assert len(detail["spans"]) == 3
    assert detail["summary"]["llm_calls"] == 1
    assert detail["summary"]["tokens"]["cached"] == 30
    assert queries.run_detail(project, "nope") is None


# --- API ------------------------------------------------------------------ #


@pytest.mark.django_db
def test_agents_api(auth_api, project):
    store_and_extract(project, _agent_txn())
    r = auth_api.get(f"/api/v1/projects/{project.id}/insights/agents?stats_period=24h")
    assert r.status_code == 200
    assert r.json()["totals"]["agent_runs"] == 1


@pytest.mark.django_db
def test_mcp_api(auth_api, project):
    store_and_extract(project, _mcp_txn())
    r = auth_api.get(f"/api/v1/projects/{project.id}/insights/mcp")
    assert r.status_code == 200
    assert r.json()["totals"]["requests"] == 1


@pytest.mark.django_db
def test_runs_api_requires_membership(api, project):
    r = api.get(f"/api/v1/projects/{project.id}/insights/agents/runs")
    assert r.status_code in (401, 403)


def store_and_extract(project, raw):
    # store_transaction fires transaction_stored → insights extraction, so the
    # AI spans land without an explicit extract_ai_spans call.
    store_transaction(project, normalize_transaction(raw))


# --- review fixes --------------------------------------------------------- #


@pytest.mark.django_db
def test_tokens_not_double_counted(project):
    """The invoke_agent root span re-reports its children's token totals; those
    must not be added on top of the chat span's tokens (C1)."""
    raw = _agent_txn(input_tokens=100, output_tokens=20, cached=10)
    # Mirror the child tokens onto the invoke_agent root (what real SDKs do).
    raw["contexts"]["trace"]["data"].update(
        {
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 20,
            "gen_ai.usage.input_tokens.cached": 10,
            "gen_ai.usage.total_tokens": 120,
        }
    )
    store_and_extract(project, raw)

    ov = queries.agents_overview(project, stats_period="24h")
    tok = ov["totals"]["tokens"]
    assert tok["input"] == 100  # not 200
    assert tok["output"] == 20
    assert tok["total"] == 120
    assert tok["cached"] == 10
    # Per-run rollup must agree.
    run = queries.list_runs(project, stats_period="24h")["results"][0]
    assert run["total_tokens"] == 120
    assert run["input_tokens"] == 100


@pytest.mark.django_db
def test_extract_is_idempotent(project):
    """Reprocessing the same trace (Celery retry) overwrites, not duplicates (H1)."""
    raw = _agent_txn(trace="a" * 32)
    store_and_extract(project, raw)
    assert AiSpan.objects.filter(project=project).count() == 3
    store_and_extract(project, raw)  # redelivery
    assert AiSpan.objects.filter(project=project).count() == 3


@pytest.mark.django_db
def test_synthetic_root_not_doubled(project):
    """If the SDK already includes the root span in ``spans``, don't synthesize
    a second one (L1)."""
    raw = _agent_txn()
    raw["spans"].append(
        {
            "span_id": "a" * 16,  # == trace context span_id
            "parent_span_id": "",
            "op": "gen_ai.invoke_agent",
            "start_timestamp": raw["start_timestamp"],
            "timestamp": raw["start_timestamp"] + 1.5,
            "data": {"gen_ai.agent.name": "research-agent"},
        }
    )
    store_and_extract(project, raw)
    assert AiSpan.objects.filter(project=project, kind="agent").count() == 1


def test_likely_ai_predicate():
    assert _likely_ai(normalize_transaction(_agent_txn())) is True
    assert _likely_ai(normalize_transaction(_mcp_txn())) is True
    non_ai = {
        "transaction": "GET /x",
        "start_timestamp": time.time(),
        "timestamp": time.time() + 0.1,
        "contexts": {"trace": {"op": "http.server", "trace_id": "f" * 32}},
        "spans": [{"op": "db", "span_id": "1" * 16}],
    }
    assert _likely_ai(normalize_transaction(non_ai)) is False


def test_resolve_window():
    s, e, bounded = resolve_window(None, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")
    assert bounded is True
    assert (e - s).days == 1
    # No/invalid custom range → relative preset, open-ended at the top.
    _, _, b2 = resolve_window("24h", None, None)
    assert b2 is False
    _, _, b3 = resolve_window("24h", "not-a-date", None)
    assert b3 is False
    # Over-long custom range is clamped from the end.
    s2, e2, _ = resolve_window(None, "2000-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
    assert (e2 - s2).days <= 366


@pytest.mark.django_db
def test_series_buckets_aligned(project):
    store_and_extract(project, _agent_txn())
    ov = queries.agents_overview(project, stats_period="24h")
    s = ov["series"]
    # Hourly window → start aligned to the top of an hour, one value per bucket.
    assert s["unit"] == "hour"
    assert s["start"].endswith(":00:00+00:00") or ":00:00" in s["start"]
    assert len(s["runs"]) == s["buckets"]
    assert sum(s["runs"]) == 1


@pytest.mark.django_db
def test_series_daily_bucket_matches_span_date(project):
    """A span must land in the bucket whose label is its own UTC date — guards the
    Trunc(tzinfo=UTC) alignment against the non-UTC default TIME_ZONE."""
    from datetime import UTC as _UTC
    from datetime import date, datetime, timedelta

    ts = datetime(2026, 6, 20, 15, 0, tzinfo=_UTC).timestamp()
    store_and_extract(project, _agent_txn(start=ts))

    ov = queries.agents_overview(project, start="2026-06-18T00:00:00Z", end="2026-06-25T00:00:00Z")
    s = ov["series"]
    assert s["unit"] == "day"
    assert sum(s["runs"]) == 1
    idx = next(i for i, v in enumerate(s["runs"]) if v)
    bucket_dt = datetime.fromisoformat(s["start"]) + timedelta(minutes=s["width_minutes"] * idx)
    assert bucket_dt.date() == date(2026, 6, 20)


@pytest.mark.django_db
def test_series_hourly_bucket_matches_span_hour(project):
    from datetime import UTC as _UTC
    from datetime import datetime, timedelta

    ts = datetime(2026, 6, 20, 3, 30, tzinfo=_UTC).timestamp()
    store_and_extract(project, _agent_txn(start=ts))

    ov = queries.agents_overview(project, start="2026-06-20T00:00:00Z", end="2026-06-20T06:00:00Z")
    s = ov["series"]
    assert s["unit"] == "hour"
    idx = next(i for i, v in enumerate(s["runs"]) if v)
    bucket_dt = datetime.fromisoformat(s["start"]) + timedelta(minutes=s["width_minutes"] * idx)
    assert bucket_dt.hour == 3


@pytest.mark.django_db
def test_runs_pagination(project):
    for _ in range(5):
        store_and_extract(project, _agent_txn(trace=uuid.uuid4().hex))
    page1 = queries.list_runs(project, stats_period="24h", limit=2, offset=0)
    assert page1["count"] == 5
    assert len(page1["results"]) == 2
    page3 = queries.list_runs(project, stats_period="24h", limit=2, offset=4)
    assert len(page3["results"]) == 1
