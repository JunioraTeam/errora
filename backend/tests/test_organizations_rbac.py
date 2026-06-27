import pytest

from apps.organizations.roles import (
    AI_TRIGGER,
    ORG_MANAGE,
    PROJECT_READ,
    Role,
    role_has,
)
from apps.organizations.services import has_permission


def test_role_matrix():
    assert role_has(Role.OWNER, ORG_MANAGE)
    assert not role_has(Role.MEMBER, ORG_MANAGE)
    assert role_has(Role.MEMBER, AI_TRIGGER)
    assert role_has(Role.VIEWER, PROJECT_READ)
    assert not role_has(Role.VIEWER, AI_TRIGGER)


@pytest.mark.django_db
def test_owner_has_all_org_permissions(user, org):
    assert has_permission(user, ORG_MANAGE, organization=org)


@pytest.mark.django_db
def test_non_member_has_no_permission(db, org):
    from apps.accounts.models import User

    outsider = User.objects.create_user(email="evil@errora.dev", password="password123")
    assert not has_permission(outsider, PROJECT_READ, organization=org)


@pytest.mark.django_db
def test_create_org_endpoint(auth_api, user):
    resp = auth_api.post("/api/v1/organizations", {"name": "Acme"})
    assert resp.status_code == 201
    # creator becomes owner
    from apps.organizations.models import Organization

    acme = Organization.objects.get(name="Acme")
    assert acme.memberships.get(user=user).role == Role.OWNER


@pytest.mark.django_db
def test_create_project_returns_dsn(auth_api, org):
    resp = auth_api.post(
        f"/api/v1/organizations/{org.id}/projects", {"name": "API", "platform": "python"}
    )
    assert resp.status_code == 201
    assert resp.data["keys"][0]["dsn"].startswith("http")


@pytest.mark.django_db
def test_viewer_cannot_create_project(api, db, org):
    from apps.accounts.authentication import issue_token_pair
    from apps.accounts.models import User
    from apps.organizations.models import Membership

    viewer = User.objects.create_user(email="viewer@errora.dev", password="password123")
    Membership.objects.create(organization=org, user=viewer, role=Role.VIEWER)
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token_pair(viewer)['access']}")
    resp = api.post(f"/api/v1/organizations/{org.id}/projects", {"name": "Nope"})
    assert resp.status_code == 403
