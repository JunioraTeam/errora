import gzip
import json

import pytest

from apps.ingest.normalize import normalize_event
from apps.issues.models import Issue


def _envelope(public_key=None, project_id=None):
    header = {"event_id": "a" * 32}
    if public_key and project_id:
        header["dsn"] = f"http://{public_key}@localhost:8000/{project_id}"
    return "\n".join(
        [json.dumps(header), json.dumps({"type": "event"}), json.dumps(_payload())]
    ).encode()


def _payload(type_="ValueError"):
    return {
        "platform": "python",
        "level": "error",
        "exception": {
            "values": [
                {
                    "type": type_,
                    "value": "boom",
                    "stacktrace": {
                        "frames": [{"filename": "a.py", "function": "f", "in_app": True}]
                    },
                }
            ]
        },
    }


def test_normalize_fills_defaults_and_clamps():
    data = normalize_event({"exception": {"type": "X", "value": "y"}})
    assert data["event_id"]
    assert data["level"] == "error"
    assert data["platform"] == "other"
    assert data["exception"]["values"][0]["type"] == "X"


def test_normalize_rejects_bad_level():
    assert normalize_event({"level": "totally-bogus"})["level"] == "error"


@pytest.mark.django_db
def test_store_endpoint_auth_and_enqueue(api, project, monkeypatch):
    # The endpoint is async; it authenticates then enqueues to the ingest worker.
    # We assert auth + that the task is enqueued (the worker pipeline itself is
    # covered synchronously in test_grouping.py).
    calls = []
    monkeypatch.setattr("apps.ingest.views.process_event.delay", lambda *a, **k: calls.append(a))
    key = project.keys.first().public_key
    url = f"/api/{project.id}/store/"
    # No key -> 401
    assert api.post(url, _payload(), format="json").status_code == 401
    # Valid key -> 202 and the event is enqueued for the project.
    resp = api.post(
        url,
        data=json.dumps(_payload()),
        content_type="application/json",
        HTTP_X_SENTRY_AUTH=f"Sentry sentry_version=7, sentry_key={key}",
    )
    assert resp.status_code == 202
    assert calls and calls[0][0] == str(project.id)


@pytest.mark.django_db
def test_store_endpoint_pipeline_creates_issue(project):
    # Drive the worker task directly (as the broker would) to verify end-to-end.
    from apps.ingest.tasks import process_event

    process_event(str(project.id), _payload())
    assert Issue.objects.filter(project=project, type="ValueError").exists()


@pytest.mark.django_db
def test_store_endpoint_rejects_wrong_project(api, project):
    key = project.keys.first().public_key
    import uuid

    other = uuid.uuid4()
    resp = api.post(
        f"/api/{other}/store/",
        data=json.dumps(_payload()),
        content_type="application/json",
        HTTP_X_SENTRY_AUTH=f"Sentry sentry_version=7, sentry_key={key}",
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_store_endpoint_accepts_querystring_auth(api, project, monkeypatch):
    # Browser JS SDK puts the key on the query string to skip a CORS preflight.
    calls = []
    monkeypatch.setattr("apps.ingest.views.process_event.delay", lambda *a, **k: calls.append(a))
    key = project.keys.first().public_key
    resp = api.post(
        f"/api/{project.id}/store/?sentry_key={key}",
        data=json.dumps(_payload()),
        content_type="application/json",
    )
    assert resp.status_code == 202
    assert calls and calls[0][0] == str(project.id)


@pytest.mark.django_db
def test_envelope_endpoint_gzip_and_header_auth(api, project, monkeypatch):
    # Modern Sentry SDKs default to gzipped envelopes.
    calls = []
    monkeypatch.setattr("apps.ingest.views.process_event.delay", lambda *a, **k: calls.append(a))
    key = project.keys.first().public_key
    resp = api.generic(
        "POST",
        f"/api/{project.id}/envelope/",
        data=gzip.compress(_envelope()),
        content_type="application/x-sentry-envelope",
        HTTP_CONTENT_ENCODING="gzip",
        HTTP_X_SENTRY_AUTH=f"Sentry sentry_version=7, sentry_key={key}",
    )
    assert resp.status_code == 202
    assert resp.json()["accepted"] == 1
    assert calls and calls[0][0] == str(project.id)


@pytest.mark.django_db
def test_envelope_endpoint_auth_via_envelope_dsn(api, project, monkeypatch):
    # No request auth: fall back to the DSN embedded in the envelope header.
    calls = []
    monkeypatch.setattr("apps.ingest.views.process_event.delay", lambda *a, **k: calls.append(a))
    key = project.keys.first().public_key
    resp = api.generic(
        "POST",
        f"/api/{project.id}/envelope/",
        data=_envelope(public_key=key, project_id=project.id),
        content_type="application/x-sentry-envelope",
    )
    assert resp.status_code == 202
    assert calls and calls[0][0] == str(project.id)


@pytest.mark.django_db
def test_envelope_endpoint_rejects_bad_key(api, project):
    resp = api.generic(
        "POST",
        f"/api/{project.id}/envelope/",
        data=_envelope(),
        content_type="application/x-sentry-envelope",
        HTTP_X_SENTRY_AUTH="Sentry sentry_version=7, sentry_key=deadbeef",
    )
    assert resp.status_code == 401
