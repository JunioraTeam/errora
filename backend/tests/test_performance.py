"""Performance product: transaction normalize/grouping, metrics, ingest, API."""

import json
import time
import uuid

import pytest

from apps.ingest.normalize import normalize_transaction
from apps.performance.metrics import aggregate_metrics, percentile, span_op_breakdown
from apps.performance.models import Transaction, TransactionGroup
from apps.performance.services import store_transaction


def _txn(name="GET /users", op="http.server", duration=0.12, status="ok", start=None):
    start = start if start is not None else time.time()
    return {
        "event_id": uuid.uuid4().hex,
        "transaction": name,
        "start_timestamp": start,
        "timestamp": start + duration,
        "platform": "python",
        "environment": "prod",
        "contexts": {
            "trace": {"trace_id": "a" * 32, "span_id": "b" * 16, "op": op, "status": status}
        },
        "spans": [
            {
                "span_id": "c" * 16,
                "parent_span_id": "b" * 16,
                "op": "db",
                "description": "SELECT 1",
                "start_timestamp": start + 0.01,
                "timestamp": start + 0.05,
                "status": "ok",
                "data": {"db.system": "mysql", "db.statement": "SELECT 1"},
            },
            {
                "span_id": "d" * 16,
                "parent_span_id": "b" * 16,
                "op": "http.client",
                "description": "GET api",
                "start_timestamp": start + 0.06,
                "timestamp": start + 0.10,
                "data": {"http.request.method": "GET", "http.response.status_code": 200},
            },
        ],
    }


# --- pure helpers --------------------------------------------------------- #


def test_normalize_transaction_shape():
    data = normalize_transaction(_txn(duration=0.2))
    assert data["name"] == "GET /users"
    assert data["op"] == "http.server"
    assert data["status"] == "ok"
    assert round(data["duration_ms"]) == 200
    assert len(data["spans"]) == 2
    db = data["spans"][0]
    assert db["op"] == "db"
    assert round(db["start_ms"]) == 10  # 0.01s offset from txn start
    assert round(db["duration_ms"]) == 40
    # Span-level data (DB system/statement, HTTP method/status) is preserved.
    assert db["data"]["db.system"] == "mysql"
    assert data["spans"][1]["data"]["http.response.status_code"] == 200


def test_percentile_and_metrics():
    assert percentile([100, 200, 300], 0.5) == 200
    m = aggregate_metrics(
        [(100.0, "ok"), (200.0, "ok"), (300.0, "internal_error")], window_minutes=1440
    )
    assert m["count"] == 3
    assert m["p50"] == 200
    assert m["failure_rate"] == round(1 / 3, 4)
    # cancelled / unknown are not failures (Sentry parity)
    assert aggregate_metrics([(1.0, "cancelled"), (1.0, "unknown")])["failure_rate"] == 0.0


def test_span_op_breakdown():
    out = span_op_breakdown(
        [
            [
                {"op": "db", "duration_ms": 40},
                {"op": "db", "duration_ms": 60},
                {"op": "http", "duration_ms": 30},
            ]
        ]
    )
    by_op = {x["op"]: x for x in out}
    assert by_op["db"]["count"] == 2
    assert by_op["db"]["total_ms"] == 100
    assert by_op["db"]["avg_ms"] == 50
    # Sorted by total time descending.
    assert out[0]["op"] == "db"


# --- grouping ------------------------------------------------------------- #


@pytest.mark.django_db
def test_store_transaction_groups(project):
    store_transaction(project, normalize_transaction(_txn(name="GET /users")))
    store_transaction(project, normalize_transaction(_txn(name="GET /users")))
    store_transaction(project, normalize_transaction(_txn(name="POST /orders", op="http.server")))

    groups = TransactionGroup.objects.filter(project=project)
    assert groups.count() == 2
    users = groups.get(name="GET /users")
    assert users.times_seen == 2
    assert Transaction.objects.filter(group=users).count() == 2


# --- ingest --------------------------------------------------------------- #


@pytest.mark.django_db
def test_envelope_ingests_transaction(api, project, monkeypatch):
    calls = []
    monkeypatch.setattr(
        "apps.ingest.views.process_transaction.delay", lambda *a, **k: calls.append(a)
    )
    key = project.keys.first().public_key
    body = "\n".join(
        [
            json.dumps({"event_id": "a" * 32}),
            json.dumps({"type": "transaction"}),
            json.dumps(_txn()),
        ]
    )
    resp = api.generic(
        "POST",
        f"/api/{project.id}/envelope/",
        data=body,
        content_type="application/x-sentry-envelope",
        HTTP_X_SENTRY_AUTH=f"Sentry sentry_version=7, sentry_key={key}",
    )
    assert resp.status_code == 202
    assert resp.json()["accepted"] == 1
    assert calls and calls[0][0] == str(project.id)


@pytest.mark.django_db
def test_process_transaction_pipeline(project):
    from apps.ingest.tasks import process_transaction

    process_transaction(str(project.id), _txn(name="GET /ping"))
    assert TransactionGroup.objects.filter(project=project, name="GET /ping").exists()


# --- API ------------------------------------------------------------------ #


@pytest.mark.django_db
def test_transaction_list_sorting(auth_api, project):
    # Two groups with different latency + throughput.
    for _ in range(3):
        store_transaction(project, normalize_transaction(_txn(name="GET /fast", duration=0.05)))
    store_transaction(project, normalize_transaction(_txn(name="GET /slow", duration=0.9)))

    base = f"/api/v1/projects/{project.id}/transactions"

    # Sort by p95 descending → slowest first.
    desc = auth_api.get(f"{base}?sort=p95&order=desc")
    assert desc.status_code == 200
    assert desc.data["sort"] == "p95"
    assert desc.data["results"][0]["name"] == "GET /slow"

    # Ascending flips it.
    asc = auth_api.get(f"{base}?sort=p95&order=asc")
    assert asc.data["results"][0]["name"] == "GET /fast"

    # DB-column sort (throughput count) works too.
    by_count = auth_api.get(f"{base}?sort=times_seen&order=desc")
    assert by_count.data["results"][0]["name"] == "GET /fast"

    # Unknown sort falls back to the default without erroring.
    assert auth_api.get(f"{base}?sort=bogus").status_code == 200


@pytest.mark.django_db
def test_transaction_list_and_detail_endpoints(auth_api, project):
    store_transaction(
        project, normalize_transaction(_txn(name="GET /a", duration=0.1, status="ok"))
    )
    store_transaction(
        project, normalize_transaction(_txn(name="GET /a", duration=0.3, status="internal_error"))
    )

    # List
    resp = auth_api.get(f"/api/v1/projects/{project.id}/transactions")
    assert resp.status_code == 200
    assert resp.data["count"] == 1
    row = resp.data["results"][0]
    assert row["name"] == "GET /a"
    assert row["count"] == 2
    assert row["failure_rate"] == 0.5
    assert row["p95"] is not None

    group_id = row["id"]

    # Group detail
    detail = auth_api.get(f"/api/v1/projects/{project.id}/transactions/{group_id}")
    assert detail.status_code == 200
    assert detail.data["count"] == 2
    assert any(b["op"] == "db" for b in detail.data["breakdown"])
    assert len(detail.data["samples"]) == 2

    # Single transaction (waterfall)
    event_id = detail.data["samples"][0]["event_id"]
    txn = auth_api.get(f"/api/v1/projects/{project.id}/transaction-events/{event_id}")
    assert txn.status_code == 200
    assert len(txn.data["spans"]) == 2
    assert txn.data["trace_id"] == "a" * 32


@pytest.mark.django_db
def test_transaction_list_requires_membership(api, project):
    # Unauthenticated → 401.
    assert api.get(f"/api/v1/projects/{project.id}/transactions").status_code == 401


@pytest.mark.django_db
def test_transaction_detail_links_attached_issue(auth_api, project):
    from apps.ingest.normalize import normalize_event
    from apps.issues.services import store_event

    trace = "a" * 32  # _txn() uses this trace_id
    store_event(
        project,
        normalize_event(
            {
                "platform": "php",
                "level": "error",
                "exception": {
                    "values": [
                        {"type": "ValueError", "value": "boom", "stacktrace": {"frames": []}}
                    ]
                },
                "contexts": {"trace": {"trace_id": trace}},
            }
        ),
    )
    store_transaction(project, normalize_transaction(_txn(name="GET /linked")))

    grp = TransactionGroup.objects.get(project=project, name="GET /linked")
    detail = auth_api.get(f"/api/v1/projects/{project.id}/transactions/{grp.id}")
    event_id = detail.data["samples"][0]["event_id"]
    txn = auth_api.get(f"/api/v1/projects/{project.id}/transaction-events/{event_id}")
    assert txn.status_code == 200
    assert txn.data["span_count"] == 2
    assert txn.data["spans_truncated"] is False
    assert any(i["type"] == "ValueError" for i in txn.data["issues"])
