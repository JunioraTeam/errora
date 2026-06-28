"""Coverage for features added on top of the original suite: OTP gating, org
rename, profile (password + TOTP), auto-fix double-guard + history, event store,
issue search, retention purge, and usage breakdown."""

import time

import pytest
from django.utils import timezone

from apps.accounts import totp as totp_lib
from apps.accounts.models import User
from apps.ai.models import AutoFixRun
from apps.issues.models import Issue
from apps.issues.retention import purge_events_before
from apps.issues.search import apply_issue_search
from apps.issues.services import store_event
from apps.issues.store import get_event_store
from apps.organizations.models import Membership
from apps.organizations.roles import Role


def _exc(type_="ValueError", value="boom"):
    return {
        "exception": {
            "values": [
                {
                    "type": type_,
                    "value": value,
                    "stacktrace": {
                        "frames": [{"filename": "a.py", "function": "f", "in_app": True}]
                    },
                }
            ]
        },
        "level": "error",
    }


# --- OTP gating ------------------------------------------------------------ //
@pytest.mark.django_db
def test_otp_disabled_returns_404(api, settings):
    settings.OTP_ENABLED = False
    resp = api.post("/api/v1/auth/otp/request", {"identifier": "a@b.com"}, format="json")
    assert resp.status_code == 404


@pytest.mark.django_db
def test_otp_enabled_accepts_request(api, settings):
    settings.OTP_ENABLED = True
    resp = api.post("/api/v1/auth/otp/request", {"identifier": "a@b.com"}, format="json")
    assert resp.status_code == 200


# --- Organization rename --------------------------------------------------- //
@pytest.mark.django_db
def test_owner_can_rename_org(auth_api, org):
    resp = auth_api.patch(f"/api/v1/organizations/{org.id}", {"name": "Renamed"}, format="json")
    assert resp.status_code == 200
    org.refresh_from_db()
    assert org.name == "Renamed"


@pytest.mark.django_db
def test_viewer_cannot_rename_org(api, org):
    from apps.accounts.authentication import issue_token_pair

    viewer = User.objects.create_user(email="v@errora.dev", password="password123")
    Membership.objects.create(organization=org, user=viewer, role=Role.VIEWER)
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token_pair(viewer)['access']}")
    resp = api.patch(f"/api/v1/organizations/{org.id}", {"name": "Nope"}, format="json")
    assert resp.status_code == 403


# --- Profile: password change + TOTP --------------------------------------- //
@pytest.mark.django_db
def test_change_password(auth_api, user):
    resp = auth_api.post(
        "/api/v1/auth/password",
        {"current_password": "password123", "new_password": "newpass456"},
        format="json",
    )
    assert resp.status_code == 200
    user.refresh_from_db()
    assert user.check_password("newpass456")


@pytest.mark.django_db
def test_totp_enable_then_enforced_on_login(auth_api, api, user, settings):
    settings.OTP_ENABLED = True
    setup = auth_api.post("/api/v1/auth/totp/setup").data
    secret = setup["secret"]
    code = totp_lib._hotp(secret, int(time.time()) // 30)
    enabled = auth_api.post("/api/v1/auth/totp/enable", {"code": code}, format="json")
    assert enabled.status_code == 200
    user.refresh_from_db()
    assert user.totp_enabled is True

    # Password login now demands a TOTP code.
    challenge = api.post(
        "/api/v1/auth/login",
        {"identifier": "alice@errora.dev", "password": "password123"},
        format="json",
    )
    assert challenge.status_code == 400
    ok = api.post(
        "/api/v1/auth/login",
        {
            "identifier": "alice@errora.dev",
            "password": "password123",
            "totp": totp_lib._hotp(secret, int(time.time()) // 30),
        },
        format="json",
    )
    assert ok.status_code == 200


# --- Auto-fix double-guard + history --------------------------------------- //
@pytest.fixture
def issue(project):
    return Issue.objects.get(id=store_event(project, _exc())["issue"])


@pytest.mark.django_db
def test_autofix_blocks_concurrent_run(auth_api, project, issue):
    AutoFixRun.objects.create(issue=issue, status=AutoFixRun.Status.ANALYZING)
    resp = auth_api.post(f"/api/v1/projects/{project.id}/issues/{issue.id}/autofix")
    assert resp.status_code == 409


@pytest.mark.django_db
def test_autofix_run_list(auth_api, org, project, issue):
    AutoFixRun.objects.create(issue=issue, status=AutoFixRun.Status.COMPLETED, provider="claude")
    resp = auth_api.get(f"/api/v1/organizations/{org.id}/autofix-runs")
    assert resp.status_code == 200
    results = resp.data["results"] if "results" in resp.data else resp.data
    assert len(results) == 1
    assert results[0]["issue_title"]
    assert results[0]["project_name"] == project.name


# --- Event store ----------------------------------------------------------- //
@pytest.mark.django_db
def test_event_store_roundtrip(project):
    store = get_event_store()
    event = store_event(project, _exc())
    issue = Issue.objects.get(id=event["issue"])

    latest = store.latest_for_issue(issue)
    assert latest["event_id"] == event["event_id"]

    rows, total = store.list_for_issue(issue, limit=10, offset=0)
    assert total == 1 and len(rows) == 1

    fetched = store.get(project, event["event_id"])
    assert fetched and fetched["level"] == "error"


# --- Issue search ---------------------------------------------------------- //
@pytest.mark.django_db
def test_issue_search_matches(project):
    store_event(project, _exc("KeyError", "missing widget"))
    store_event(project, _exc("ValueError", "bad number"))
    qs = apply_issue_search(Issue.objects.filter(project=project), "widget")
    assert qs.count() == 1
    assert apply_issue_search(Issue.objects.filter(project=project), "KeyError").count() == 1


@pytest.mark.django_db
def test_issue_search_uses_sqlite_fts5(project):
    """On SQLite the search is served by the FTS5 companion table, not icontains.

    FTS5 prefix matching is word-anchored: "Value" (a token prefix) matches, but a
    mid-token fragment like "rror" does NOT — whereas an icontains LIKE would. The
    second assertion therefore proves the FTS5 path is active, not the fallback.
    """
    from django.db import connection

    if connection.vendor != "sqlite":
        pytest.skip("SQLite-specific")

    from apps.common.search import _sqlite_cache, sqlite_fts5_available, sqlite_table_exists

    _sqlite_cache.clear()
    if not sqlite_fts5_available():
        pytest.skip("FTS5 not compiled into this SQLite build")
    assert sqlite_table_exists("issue_fts")  # created by migration

    store_event(project, _exc("ValueError", "boom"))
    issues = Issue.objects.filter(project=project)
    assert apply_issue_search(issues, "Value").count() == 1  # token-prefix match
    assert apply_issue_search(issues, "rror").count() == 0  # mid-token → FTS5 miss


# --- Retention purge ------------------------------------------------------- //
@pytest.mark.django_db
def test_purge_events_before(project):
    store_event(project, _exc())
    issue = Issue.objects.filter(project=project).first()
    # Backdate so the issue/events fall before the cutoff.
    Issue.objects.filter(id=issue.id).update(
        last_seen=timezone.now() - timezone.timedelta(days=400)
    )
    from apps.issues.models import Event

    Event.objects.filter(issue=issue).update(
        received_at=timezone.now() - timezone.timedelta(days=400)
    )
    cutoff = timezone.now() - timezone.timedelta(days=90)
    events, issues = purge_events_before(cutoff)
    assert events >= 1
    assert issues >= 1
    assert not Issue.objects.filter(id=issue.id).exists()


# --- Usage breakdown ------------------------------------------------------- //
@pytest.mark.django_db
def test_usage_summary_breakdown(auth_api, org, project):
    store_event(project, _exc())
    resp = auth_api.get(f"/api/v1/organizations/{org.id}/usage")
    assert resp.status_code == 200
    body = resp.data
    assert "by_day" in body and "by_month" in body
    # No subscription → unlimited quota surfaced as null.
    assert body["quota"] is None
    assert sum(d["events"] for d in body["by_day"]) >= 1


# --- Issue merge ----------------------------------------------------------- //
@pytest.mark.django_db
def test_merge_issues_endpoint(auth_api, project):
    from apps.issues.models import Event

    target = Issue.objects.get(id=store_event(project, _exc("ValueError"))["issue"])
    source = Issue.objects.get(id=store_event(project, _exc("KeyError"))["issue"])
    assert target.id != source.id

    resp = auth_api.post(
        f"/api/v1/projects/{project.id}/issues/{target.id}/merge",
        {"sources": [str(source.id)]},
        format="json",
    )
    assert resp.status_code == 200
    assert not Issue.objects.filter(id=source.id).exists()
    target.refresh_from_db()
    assert target.times_seen == 2
    assert Event.objects.filter(issue=target).count() == 2


# --- AI unified diff ------------------------------------------------------- //
def test_render_unified_diff():
    from apps.ai.services import _render_diff

    diff = _render_diff(
        {"a.py": "x = 1\ny = 3\n"},
        {"a.py": "x = 1\ny = 2\n"},
    )
    assert "-y = 2" in diff
    assert "+y = 3" in diff


# --- Invite email ---------------------------------------------------------- //
@pytest.mark.django_db
def test_invite_sends_email(auth_api, org, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    from django.core import mail

    resp = auth_api.post(
        f"/api/v1/organizations/{org.id}/invite",
        {"email": "newbie@errora.dev", "role": "member"},
        format="json",
    )
    assert resp.status_code == 201
    assert len(mail.outbox) == 1
    assert "newbie@errora.dev" in mail.outbox[0].to


@pytest.mark.django_db
def test_invite_preview_public(api, org, user):
    from datetime import timedelta

    from django.utils import timezone

    from apps.organizations.models import OrganizationInvite

    invite = OrganizationInvite.objects.create(
        organization=org,
        email="newbie@errora.dev",
        invited_by=user,
        expires_at=timezone.now() + timedelta(days=7),
    )
    # No auth header: the preview must be reachable by a logged-out recipient.
    resp = api.get(f"/api/v1/invites/preview/{invite.token}")
    assert resp.status_code == 200
    assert resp.data["email"] == "newbie@errora.dev"
    assert resp.data["organization_name"] == org.name
    assert resp.data["valid"] is True


@pytest.mark.django_db
def test_invite_preview_unknown_token(api):
    assert api.get("/api/v1/invites/preview/nope").status_code == 404


@pytest.mark.django_db
def test_signup_auto_joins_pending_invite(api, org, user):
    from datetime import timedelta

    from django.utils import timezone

    from apps.accounts.models import User
    from apps.organizations.models import Membership, OrganizationInvite

    OrganizationInvite.objects.create(
        organization=org,
        email="invited@errora.dev",
        role="member",
        invited_by=user,
        expires_at=timezone.now() + timedelta(days=7),
    )
    # Registering with the invited email should auto-join the org (no link click).
    resp = api.post(
        "/api/v1/auth/register",
        {"identifier": "invited@errora.dev", "password": "password123"},
        format="json",
    )
    assert resp.status_code == 201
    new_user = User.objects.get(email="invited@errora.dev")
    assert Membership.objects.filter(organization=org, user=new_user, role="member").exists()
    # The invite is consumed.
    assert OrganizationInvite.objects.get(email="invited@errora.dev").status == "accepted"


@pytest.mark.django_db
def test_expired_invite_not_auto_joined(api, org, user):
    from datetime import timedelta

    from django.utils import timezone

    from apps.accounts.models import User
    from apps.organizations.models import Membership, OrganizationInvite

    OrganizationInvite.objects.create(
        organization=org,
        email="late@errora.dev",
        invited_by=user,
        expires_at=timezone.now() - timedelta(days=1),  # already expired
    )
    resp = api.post(
        "/api/v1/auth/register",
        {"identifier": "late@errora.dev", "password": "password123"},
        format="json",
    )
    assert resp.status_code == 201
    new_user = User.objects.get(email="late@errora.dev")
    assert not Membership.objects.filter(organization=org, user=new_user).exists()


# --- Webhook delivery log + replay ----------------------------------------- //
@pytest.mark.django_db
def test_notification_replay(auth_api, org, monkeypatch):
    from apps.notifications.models import AlertRule, NotificationChannel, NotificationLog

    channel = NotificationChannel.objects.create(
        organization=org, name="wh", type="webhook", config={"url": "http://x"}
    )
    rule = AlertRule.objects.create(
        organization=org, event_type="issue.created", channel=channel
    )
    log = NotificationLog.objects.create(
        rule=rule,
        channel_type="webhook",
        event_type="issue.created",
        success=False,
        message={"event_type": "issue.created", "title": "t", "body": "b"},
    )
    calls = []
    monkeypatch.setattr(
        "apps.notifications.tasks.deliver_notification.delay",
        lambda *a, **k: calls.append(a),
    )
    resp = auth_api.post(
        f"/api/v1/organizations/{org.id}/notification-logs/{log.id}/replay"
    )
    assert resp.status_code == 202
    assert calls and calls[0][0] == str(rule.id)


# --- Ingest spike protection ----------------------------------------------- //
@pytest.mark.django_db
def test_ingest_payload_too_large(api, project, settings):
    settings.INGEST_MAX_PAYLOAD_BYTES = 10
    key = project.keys.first().public_key
    import json as _json

    resp = api.post(
        f"/api/{project.id}/store/",
        data=_json.dumps({"event_id": "a" * 32, "message": "way too long payload"}),
        content_type="application/json",
        HTTP_X_SENTRY_AUTH=f"Sentry sentry_version=7, sentry_key={key}",
    )
    assert resp.status_code == 413


@pytest.mark.django_db
def test_ingest_sampling_drops_all(api, project, settings, monkeypatch):
    project.sample_rate = 0.0
    project.save(update_fields=["sample_rate"])
    calls = []
    monkeypatch.setattr(
        "apps.ingest.views.process_event.delay", lambda *a, **k: calls.append(a)
    )
    key = project.keys.first().public_key
    import json as _json

    body = "\n".join(
        [_json.dumps({"event_id": "a" * 32}), _json.dumps({"type": "event"}), _json.dumps(_exc())]
    )
    resp = api.post(
        f"/api/{project.id}/envelope/",
        data=body,
        content_type="application/x-sentry-envelope",
        HTTP_X_SENTRY_AUTH=f"Sentry sentry_version=7, sentry_key={key}",
    )
    assert resp.status_code == 202
    assert resp.json()["accepted"] == 0
    assert resp.json()["sampled"] == 1
    assert calls == []


@pytest.mark.django_db
def test_crud_api_is_end_to_end_async(org, project):
    """The DRF CRUD layer was migrated to adrf: the resolved view callables must
    be coroutine functions (a regression to sync handlers would fail here)."""
    from asgiref.sync import iscoroutinefunction
    from django.urls import resolve

    paths = [
        "/api/v1/organizations",  # adrf ModelViewSet (router)
        f"/api/v1/organizations/{org.id}/projects",  # adrf ModelViewSet (manual map)
        f"/api/v1/projects/{project.id}/issues",  # adrf GenericViewSet (hand-rolled)
        f"/api/v1/organizations/{org.id}/usage",  # adrf APIView
        "/api/v1/plans",  # adrf ReadOnlyModelViewSet
        "/api/v1/auth/me",  # adrf APIView
    ]
    for path in paths:
        match = resolve(path)
        assert iscoroutinefunction(match.func), f"{path} resolved to a sync view"


@pytest.mark.django_db
def test_set_priority(auth_api, project):
    issue = Issue.objects.get(id=store_event(project, _exc())["issue"])
    url = f"/api/v1/projects/{project.id}/issues/{issue.id}/priority"
    resp = auth_api.post(url, {"priority": "high"}, format="json")
    assert resp.status_code == 200
    assert resp.data["priority"] == "high"
    issue.refresh_from_db()
    assert issue.priority == "high"
    # Invalid value is rejected.
    assert auth_api.post(url, {"priority": "bogus"}, format="json").status_code == 400


@pytest.mark.django_db
def test_bulk_resolve_and_priority(auth_api, project):
    i1 = Issue.objects.get(id=store_event(project, _exc("ValueError"))["issue"])
    i2 = Issue.objects.get(id=store_event(project, _exc("KeyError"))["issue"])
    url = f"/api/v1/projects/{project.id}/issues/bulk"
    resp = auth_api.post(
        url, {"ids": [str(i1.id), str(i2.id)], "action": "resolve"}, format="json"
    )
    assert resp.status_code == 200
    assert resp.data["updated"] == 2
    i1.refresh_from_db()
    i2.refresh_from_db()
    assert i1.status == "resolved" and i2.status == "resolved"

    resp = auth_api.post(
        url, {"ids": [str(i1.id)], "action": "priority", "value": "low"}, format="json"
    )
    assert resp.status_code == 200
    i1.refresh_from_db()
    assert i1.priority == "low"


@pytest.mark.django_db
def test_bulk_assign(auth_api, project, user):
    issue = Issue.objects.get(id=store_event(project, _exc())["issue"])
    url = f"/api/v1/projects/{project.id}/issues/bulk"
    resp = auth_api.post(
        url,
        {"ids": [str(issue.id)], "action": "assign", "value": [str(user.id)]},
        format="json",
    )
    assert resp.status_code == 200
    assert issue.assignees.count() == 1


@pytest.mark.django_db
def test_issue_trends(auth_api, project):
    issue = Issue.objects.get(id=store_event(project, _exc())["issue"])
    resp = auth_api.get(
        f"/api/v1/projects/{project.id}/issues/trends?ids={issue.id}&days=14"
    )
    assert resp.status_code == 200
    series = resp.data.get(str(issue.id))
    assert series is not None and len(series) == 14
    # The event we just stored lands in today's bucket.
    assert sum(series) >= 1


@pytest.mark.django_db
def test_ingest_store_without_trailing_slash(api, project, monkeypatch):
    """The slashless ingest alias resolves (no trailing slash required)."""
    import json as _json

    calls = []
    monkeypatch.setattr(
        "apps.ingest.views.process_event.delay", lambda *a, **k: calls.append(a)
    )
    key = project.keys.first().public_key
    resp = api.post(
        f"/api/{project.id}/store",  # note: no trailing slash
        data=_json.dumps(_exc()),
        content_type="application/json",
        HTTP_X_SENTRY_AUTH=f"Sentry sentry_version=7, sentry_key={key}",
    )
    assert resp.status_code == 202


@pytest.mark.django_db
def test_issue_unread_then_seen(auth_api, project):
    issue = Issue.objects.get(id=store_event(project, _exc())["issue"])
    base = f"/api/v1/projects/{project.id}/issues"

    # List: unseen → has_seen False, and project name is included.
    resp = auth_api.get(base)
    assert resp.status_code == 200
    row = resp.data["results"][0]
    assert row["has_seen"] is False
    assert row["project_name"] == project.name

    # Opening the issue marks it seen.
    assert auth_api.get(f"{base}/{issue.id}").status_code == 200
    resp = auth_api.get(base)
    assert resp.data["results"][0]["has_seen"] is True
