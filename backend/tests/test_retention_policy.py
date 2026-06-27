"""Per-organization data retention: resolution precedence + the user-facing API."""

import pytest

from apps.billing.models import Plan, Subscription
from apps.organizations.models import Membership
from apps.organizations.retention import (
    default_retention_days,
    effective_retention_days,
    global_default,
)
from apps.organizations.roles import Role


# --- resolution precedence ------------------------------------------------- //
@pytest.mark.django_db
def test_effective_retention_precedence(org, settings):
    settings.DATA_RETENTION_DAYS_DEFAULT = 90

    # No plan, no override → global default.
    assert effective_retention_days(org) == 90

    # Plan retention overrides the global default.
    plan = Plan.objects.create(slug="team", name="Team", retention_days=180)
    Subscription.objects.create(organization=org, plan=plan)
    org.refresh_from_db()
    assert default_retention_days(org) == 180
    assert effective_retention_days(org) == 180

    # Org override beats the plan.
    org.retention_days = 14
    org.save(update_fields=["retention_days"])
    assert effective_retention_days(org) == 14
    assert default_retention_days(org) == 180  # default still reflects the plan


def test_global_default_setting(settings):
    settings.DATA_RETENTION_DAYS_DEFAULT = 45
    assert global_default() == 45


# --- API ------------------------------------------------------------------- //
@pytest.mark.django_db
def test_owner_sets_and_clears_retention(auth_api, org, settings):
    settings.DATA_RETENTION_DAYS_DEFAULT = 90

    resp = auth_api.patch(f"/api/v1/organizations/{org.id}", {"retention_days": 30}, format="json")
    assert resp.status_code == 200
    assert resp.data["retention_days"] == 30
    assert resp.data["default_retention_days"] == 90
    org.refresh_from_db()
    assert org.retention_days == 30

    # Clearing the override (null) reverts to inheriting the default.
    resp = auth_api.patch(
        f"/api/v1/organizations/{org.id}", {"retention_days": None}, format="json"
    )
    assert resp.status_code == 200
    assert resp.data["retention_days"] is None
    org.refresh_from_db()
    assert org.retention_days is None


@pytest.mark.django_db
@pytest.mark.parametrize("bad", [0, -5, 99999])
def test_retention_bounds_rejected(auth_api, org, bad):
    resp = auth_api.patch(
        f"/api/v1/organizations/{org.id}", {"retention_days": bad}, format="json"
    )
    assert resp.status_code == 400
    assert "retention_days" in resp.data


@pytest.mark.django_db
def test_viewer_cannot_set_retention(api, org):
    from apps.accounts.authentication import issue_token_pair
    from apps.accounts.models import User

    viewer = User.objects.create_user(email="v-ret@errora.dev", password="password123")
    Membership.objects.create(organization=org, user=viewer, role=Role.VIEWER)
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token_pair(viewer)['access']}")
    resp = api.patch(f"/api/v1/organizations/{org.id}", {"retention_days": 10}, format="json")
    assert resp.status_code == 403


@pytest.mark.django_db
def test_purge_uses_org_retention(project, settings):
    """The nightly purge honours the org override."""
    from django.utils import timezone

    from apps.billing.tasks import purge_expired_events
    from apps.issues.models import Issue
    from apps.issues.services import store_event

    settings.DATA_RETENTION_DAYS_DEFAULT = 365
    org = project.organization
    org.retention_days = 7
    org.save(update_fields=["retention_days"])

    store_event(
        project,
        {
            "level": "error",
            "exception": {"values": [{"type": "E", "value": "v", "stacktrace": {"frames": []}}]},
        },
    )
    issue = Issue.objects.filter(project=project).first()
    Issue.objects.filter(id=issue.id).update(last_seen=timezone.now() - timezone.timedelta(days=30))
    from apps.issues.store import get_event_store

    get_event_store()  # ensure store initialized
    # Backdate the event past the 7-day override (but within the 365 default).
    from apps.issues.models import Event

    Event.objects.filter(issue=issue).update(
        received_at=timezone.now() - timezone.timedelta(days=30)
    )

    result = purge_expired_events()
    assert result["issues"] >= 1
    assert not Issue.objects.filter(id=issue.id).exists()
