"""Rich event data: normalize preservation, derived tags, grouping info, repo."""

import pytest

from apps.ingest.normalize import normalize_event
from apps.issues.services import store_event


def _event():
    return {
        "event_id": "f" * 32,
        "platform": "php",
        "level": "error",
        "environment": "production",
        "release": "app@1.2.3",
        "dist": "build-9",
        "server_name": "web-1",
        "transaction": "/purchase/{id}/recover",
        "exception": {
            "values": [
                {
                    "type": "Exception",
                    "value": "Gateway -112",
                    "mechanism": {"type": "generic", "handled": False},
                    "stacktrace": {
                        "frames": [
                            {
                                "filename": "/app/Services/Pay.php",
                                "function": "pay",
                                "in_app": True,
                                "lineno": 47,
                            }
                        ]
                    },
                }
            ]
        },
        "request": {
            "url": "https://juniora.org/purchase/164288/recover",
            "method": "GET",
            "headers": [["Host", "juniora.org"], ["User-Agent", "Facebot/1.1"]],
        },
        "contexts": {
            "browser": {"name": "FacebookBot", "version": "1.1"},
            "os": {"name": "Linux", "version": "5.15.0"},
            "runtime": {"name": "php", "version": "8.5.7"},
            "device": {"family": "Spider", "model": "Desktop"},
            "trace": {"trace_id": "a" * 32, "op": "http.server"},
        },
        "sdk": {
            "name": "sentry.php.laravel",
            "version": "4.26.0",
            "packages": [{"name": "sentry/sentry", "version": "4.28.0"}],
        },
        "modules": {"laravel/framework": "v11.0", "guzzlehttp/guzzle": "7.8"},
        "breadcrumbs": {
            "values": [
                {
                    "category": "db.sql.query",
                    "level": "info",
                    "message": "select * from `t` where id = ?",
                    "data": {"bindings": ["1"], "executionTimeMs": 1.17},
                },
                {"category": "cache", "level": "info", "message": "Missed: key"},
            ]
        },
        "tags": [["custom", "value"]],
    }


def test_normalize_preserves_rich_fields():
    n = normalize_event(_event())
    assert len(n["breadcrumbs"]) == 2
    assert n["breadcrumbs"][0]["category"] == "db.sql.query"
    assert n["breadcrumbs"][0]["data"]["executionTimeMs"] == 1.17
    assert n["modules"]["laravel/framework"] == "v11.0"
    assert n["dist"] == "build-9"
    mech = n["exception"]["values"][-1]["mechanism"]
    assert mech == {"type": "generic", "handled": False}


def test_normalize_derives_tags():
    tags = normalize_event(_event())["tags"]
    assert tags["browser.name"] == "FacebookBot"
    assert tags["runtime"] == "php 8.5.7"
    assert tags["os.name"] == "Linux"
    assert tags["url"].startswith("https://juniora.org")
    assert tags["transaction"] == "/purchase/{id}/recover"
    assert tags["handled"] == "no"
    assert tags["mechanism"] == "generic"
    # SDK-provided tag is merged in.
    assert tags["custom"] == "value"


@pytest.mark.django_db
def test_store_event_attaches_grouping(project):
    ev = store_event(project, normalize_event(_event()))
    grouping = ev["data"]["_grouping"]
    assert grouping["hash"]
    assert grouping["components"]
    assert "config" in grouping


@pytest.mark.django_db
def test_issue_detail_exposes_rich_event_and_null_repo(auth_api, project):
    ev = store_event(project, normalize_event(_event()))
    issue_id = ev["issue"]
    resp = auth_api.get(f"/api/v1/projects/{project.id}/issues/{issue_id}")
    assert resp.status_code == 200
    data = resp.data
    # No repo linked → null (suspect-commit link unavailable).
    assert data["repository"] is None
    le = data["latest_event"]["data"]
    assert len(le["breadcrumbs"]) == 2
    assert le["modules"]["laravel/framework"] == "v11.0"
    assert le["tags"]["runtime"] == "php 8.5.7"
    assert le["_grouping"]["hash"]


@pytest.mark.django_db
def test_issue_detail_exposes_repository(auth_api, org, project):
    from apps.integrations.models import Integration, Repository

    integ = Integration.objects.create(
        organization=org, provider="gitlab", name="gl", base_url="https://gitlab.com"
    )
    repo = Repository.objects.create(
        integration=integ,
        external_id="1",
        name="app",
        path_with_namespace="team/app",
        web_url="https://gitlab.com/team/app",
        default_branch="main",
    )
    project.repository = repo
    project.save(update_fields=["repository"])

    ev = store_event(project, normalize_event(_event()))
    resp = auth_api.get(f"/api/v1/projects/{project.id}/issues/{ev['issue']}")
    assert resp.status_code == 200
    assert resp.data["repository"]["web_url"] == "https://gitlab.com/team/app"
    assert resp.data["repository"]["default_branch"] == "main"
