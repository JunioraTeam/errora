"""Logs product: normalize, search parser, ingest, store, API filter/facets."""

import time

import pytest

from apps.ingest.normalize import normalize_logs
from apps.logs.models import LogEntry
from apps.logs.search import parse_query
from apps.logs.services import store_logs


def _log(body="hello world", level="info", attrs=None, trace="a" * 32, ts=None):
    return {
        "timestamp": ts if ts is not None else time.time(),
        "level": level,
        "body": body,
        "trace_id": trace,
        "attributes": attrs or {},
    }


def _envelope_item(*logs):
    """Shape a Sentry ``log`` envelope item: a batch container of records."""
    return {"items": list(logs)}


# --- normalize ------------------------------------------------------------ #


def test_normalize_logs_flattens_typed_attributes():
    raw = _envelope_item(
        {
            "timestamp": 1000.0,
            "level": "error",
            "body": "boom",
            "trace_id": "f" * 32,
            "attributes": {
                "service": {"value": "checkout", "type": "string"},
                "retries": {"value": 3, "type": "integer"},
                "sentry.environment": {"value": "prod", "type": "string"},
            },
        }
    )
    items = normalize_logs(raw)
    assert len(items) == 1
    it = items[0]
    assert it["level"] == "error"
    assert it["severity_number"] == 17
    assert it["body"] == "boom"
    assert it["attributes"] == {"service": "checkout", "retries": 3}
    # Reserved attribute promoted to a column, removed from the bag.
    assert it["environment"] == "prod"
    assert "sentry.environment" not in it["attributes"]


def test_normalize_logs_level_aliases_and_severity_fallback():
    items = normalize_logs(_envelope_item({"level": "warning", "body": "x"}))
    assert items[0]["level"] == "warn"
    # Derive level from a numeric severity when the string level is missing.
    items = normalize_logs(_envelope_item({"severity_number": 17, "body": "y"}))
    assert items[0]["level"] == "error"


def test_normalize_logs_accepts_bare_record():
    items = normalize_logs({"level": "info", "body": "solo"})
    assert len(items) == 1 and items[0]["body"] == "solo"


# --- search parser -------------------------------------------------------- #


def test_parse_query_splits_text_and_tokens():
    p = parse_query("timeout level:error service:checkout trace:abc")
    assert p.text == "timeout"
    assert ("level", "error", False) in p.column_filters
    assert ("trace_id", "abc", False) in p.column_filters
    assert ("service", "checkout", False) in p.attr_filters


def test_parse_query_negation_and_quotes():
    p = parse_query('level:!info msg:"connection refused"')
    assert ("level", "info", True) in p.column_filters
    assert ("msg", "connection refused", False) in p.attr_filters


# --- store ---------------------------------------------------------------- #


@pytest.mark.django_db
def test_store_logs_bulk_inserts(project):
    n = store_logs(project, normalize_logs(_envelope_item(_log(), _log(level="error"))))
    assert n == 2
    assert LogEntry.objects.filter(project=project).count() == 2


@pytest.mark.django_db
def test_process_logs_pipeline(project):
    from apps.ingest.tasks import process_logs

    process_logs(str(project.id), _envelope_item(_log(body="pipeline log")))
    assert LogEntry.objects.filter(project=project, body="pipeline log").exists()


# --- API ------------------------------------------------------------------ #


@pytest.mark.django_db
def test_log_list_search_filter_and_facets(auth_api, project):
    store_logs(
        project,
        normalize_logs(
            _envelope_item(
                _log(body="user signed in", level="info", attrs={"service": "auth"}),
                _log(body="payment failed", level="error", attrs={"service": "billing"}),
                _log(body="payment retried", level="warn", attrs={"service": "billing"}),
            )
        ),
    )

    # Plain list → all 3 + level facets.
    resp = auth_api.get(f"/api/v1/projects/{project.id}/logs")
    assert resp.status_code == 200
    assert resp.data["count"] == 3
    assert resp.data["facets"]["level"]["error"] == 1
    assert resp.data["facets"]["level"]["info"] == 1

    # Level filter param.
    resp = auth_api.get(f"/api/v1/projects/{project.id}/logs?level=error,warn")
    assert resp.data["count"] == 2

    # Free-text body search.
    resp = auth_api.get(f"/api/v1/projects/{project.id}/logs?q=payment")
    assert resp.data["count"] == 2

    # Attribute token search.
    resp = auth_api.get(f"/api/v1/projects/{project.id}/logs?q=service:auth")
    assert resp.data["count"] == 1
    assert resp.data["results"][0]["body"] == "user signed in"

    # key:value + free text combined.
    resp = auth_api.get(f"/api/v1/projects/{project.id}/logs?q=payment level:error")
    assert resp.data["count"] == 1


@pytest.mark.django_db
def test_log_detail_and_attribute_keys(auth_api, project):
    store_logs(
        project, normalize_logs(_envelope_item(_log(attrs={"service": "auth", "region": "eu"})))
    )
    log = LogEntry.objects.get(project=project)

    detail = auth_api.get(f"/api/v1/projects/{project.id}/logs/{log.id}")
    assert detail.status_code == 200
    assert detail.data["attributes"]["service"] == "auth"

    keys = auth_api.get(f"/api/v1/projects/{project.id}/logs/attribute-keys")
    assert keys.status_code == 200
    assert set(keys.data["keys"]) == {"service", "region"}


@pytest.mark.django_db
def test_log_list_requires_membership(api, project):
    assert api.get(f"/api/v1/projects/{project.id}/logs").status_code == 401


@pytest.mark.django_db
def test_envelope_routes_log_items(api, project, monkeypatch):
    """The envelope endpoint recognises ``log`` items, counts them, and enqueues
    the batch (the store pipeline itself is covered by test_process_logs_pipeline)."""
    import json

    calls = []
    monkeypatch.setattr("apps.ingest.views.process_logs.delay", lambda *a, **k: calls.append(a))
    key = project.keys.first().public_key
    item_header = json.dumps({"type": "log", "item_count": 2})
    payload = json.dumps(_envelope_item(_log(body="a"), _log(body="b")))
    body = f"{{}}\n{item_header}\n{payload}"

    resp = api.generic(
        "POST",
        f"/api/{project.id}/envelope/",
        data=body,
        content_type="application/x-sentry-envelope",
        HTTP_X_SENTRY_AUTH=f"Sentry sentry_version=7, sentry_key={key}",
    )
    assert resp.status_code == 202
    assert resp.json()["logs"] == 2
    assert calls and calls[0][0] == str(project.id)
