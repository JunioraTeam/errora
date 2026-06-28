import pytest

from apps.accounts.models import User
from apps.issues.models import Issue
from apps.issues.services import store_event
from apps.organizations.models import Membership
from apps.organizations.roles import Role


def _exc():
    return {
        "exception": {
            "values": [
                {
                    "type": "ValueError",
                    "value": "x",
                    "stacktrace": {
                        "frames": [{"filename": "a.py", "function": "f", "in_app": True}]
                    },
                }
            ]
        },
        "level": "error",
    }


@pytest.fixture
def issue(project):
    event = store_event(project, _exc())
    return Issue.objects.get(id=event["issue"])


@pytest.mark.django_db
def test_assign_multiple_members(auth_api, org, project, issue, user):
    member = User.objects.create_user(email="m2@errora.dev", password="password123")
    Membership.objects.create(organization=org, user=member, role=Role.MEMBER)
    url = f"/api/v1/projects/{project.id}/issues/{issue.id}/assign"
    resp = auth_api.post(url, {"assignees": [str(user.id), str(member.id)]}, format="json")
    assert resp.status_code == 200
    assert issue.assignees.count() == 2


@pytest.mark.django_db
def test_assign_rejects_non_member(auth_api, project, issue):
    outsider = User.objects.create_user(email="out@errora.dev", password="password123")
    url = f"/api/v1/projects/{project.id}/issues/{issue.id}/assign"
    resp = auth_api.post(url, {"assignees": [str(outsider.id)]}, format="json")
    assert resp.status_code == 400
    assert issue.assignees.count() == 0


@pytest.mark.django_db
def test_unassign_with_empty_list(auth_api, project, issue, user):
    url = f"/api/v1/projects/{project.id}/issues/{issue.id}/assign"
    auth_api.post(url, {"assignees": [str(user.id)]}, format="json")
    auth_api.post(url, {"assignees": []}, format="json")
    assert issue.assignees.count() == 0
