"""Security hardening: SSRF URL guard, ingest decompression-bomb cap, and
cross-org FK injection on alert rules / AI configs."""

import gzip
import uuid

import pytest

from apps.common.net import UnsafeURLError, validate_external_url


# --- SSRF URL guard -------------------------------------------------------- //
@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1/hook",  # loopback
        "https://169.254.169.254/latest/meta-data/",  # cloud metadata (link-local)
        "https://[::1]/x",  # IPv6 loopback
        "http://0.0.0.0/x",  # unspecified
        "ftp://example.com/x",  # bad scheme
        "https://[::ffff:127.0.0.1]/x",  # IPv4-mapped loopback
        "not a url",
    ],
)
def test_validate_rejects_unsafe(url):
    with pytest.raises(UnsafeURLError):
        validate_external_url(url, allow_http=True)


def test_validate_allows_public_ip():
    assert validate_external_url("https://8.8.8.8/path") == {"8.8.8.8"}


def test_https_required_by_default():
    with pytest.raises(UnsafeURLError):
        validate_external_url("http://8.8.8.8/")  # allow_http defaults False
    assert validate_external_url("http://8.8.8.8/", allow_http=True)


def test_private_range_gated_by_setting(settings):
    # Self-host default: private (internal GitLab/LLM) is allowed.
    assert validate_external_url("http://10.0.0.5/", allow_http=True) == {"10.0.0.5"}
    # Multi-tenant operators can opt in to blocking it.
    settings.SSRF_BLOCK_PRIVATE = True
    with pytest.raises(UnsafeURLError):
        validate_external_url("http://10.0.0.5/", allow_http=True)


# --- ingest decompression bomb -------------------------------------------- //
@pytest.mark.django_db
def test_ingest_rejects_decompression_bomb(client, settings):
    settings.INGEST_MAX_DECOMPRESSED_BYTES = 1000
    bomb = gzip.compress(b"A" * 200_000)  # tiny compressed, 200KB inflated
    assert len(bomb) < 1000  # the compressed body itself is small
    resp = client.post(
        f"/api/{uuid.uuid4()}/store/",
        data=bomb,
        content_type="application/json",
        HTTP_CONTENT_ENCODING="gzip",
    )
    # Rejected on decompression, before DSN auth.
    assert resp.status_code == 413


# --- cross-org FK injection ------------------------------------------------ //
@pytest.mark.django_db
def test_alert_rule_rejects_foreign_org_channel(auth_api, org):
    from apps.accounts.models import User
    from apps.notifications.models import NotificationChannel
    from apps.organizations.services import create_organization_with_owner

    # A channel that belongs to a DIFFERENT org the user isn't even in.
    outsider = User.objects.create_user(email="o@errora.dev", password="password123")
    other_org = outsider.organizations.first() or create_organization_with_owner(
        owner=outsider, name="Other"
    )
    foreign_channel = NotificationChannel.objects.create(
        organization=other_org, name="x", type="webhook", config={"url": "https://8.8.8.8/h"}
    )

    resp = auth_api.post(
        f"/api/v1/organizations/{org.id}/alert-rules",
        {"event_type": "issue.created", "channel": str(foreign_channel.id), "enabled": True},
        format="json",
    )
    assert resp.status_code == 400
    assert "organization" in str(resp.data).lower()


@pytest.mark.django_db
def test_channel_rejects_internal_webhook_url(auth_api, org):
    resp = auth_api.post(
        f"/api/v1/organizations/{org.id}/channels",
        {"name": "ssrf", "type": "webhook", "config": {"url": "https://169.254.169.254/"}},
        format="json",
    )
    assert resp.status_code == 400


# --- JWT revocation -------------------------------------------------------- //
@pytest.mark.django_db
def test_password_change_revokes_old_tokens(auth_api):
    assert auth_api.get("/api/v1/auth/me").status_code == 200
    resp = auth_api.post(
        "/api/v1/auth/password",
        {"current_password": "password123", "new_password": "newpassword456"},
        format="json",
    )
    assert resp.status_code == 200
    # The token auth_api still holds was issued before the bump → now revoked.
    assert auth_api.get("/api/v1/auth/me").status_code == 401


@pytest.mark.django_db
def test_logout_revokes_token(auth_api):
    assert auth_api.post("/api/v1/auth/logout").status_code == 200
    assert auth_api.get("/api/v1/auth/me").status_code == 401


@pytest.mark.django_db
def test_invite_bound_to_invited_email(auth_api, org, user):
    from datetime import timedelta

    from django.utils import timezone

    from apps.organizations.models import OrganizationInvite

    invite = OrganizationInvite.objects.create(
        organization=org,
        email="someone-else@errora.dev",  # not the accepting user's email
        invited_by=user,
        expires_at=timezone.now() + timedelta(days=7),
    )
    resp = auth_api.post("/api/v1/invites/accept", {"token": invite.token}, format="json")
    assert resp.status_code == 403


@pytest.mark.django_db
def test_ai_config_rejects_foreign_project(auth_api, org, project):
    from apps.accounts.models import User
    from apps.organizations.services import create_organization_with_owner, create_project

    outsider = User.objects.create_user(email="o2@errora.dev", password="password123")
    other_org = outsider.organizations.first() or create_organization_with_owner(
        owner=outsider, name="Other2"
    )
    foreign_project = create_project(organization=other_org, name="P", platform="python")

    resp = auth_api.post(
        f"/api/v1/organizations/{org.id}/ai-configs",
        {
            "provider": "openai",
            "model": "gpt-4o",
            "project": str(foreign_project.id),
            "base_url": "https://api.openai.com/v1",
        },
        format="json",
    )
    assert resp.status_code == 400
