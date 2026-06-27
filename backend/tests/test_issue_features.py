"""Issue extras: unique users, bookmark/archive, trend series, project stats,
and GitLab external-issue create/link (provider mocked)."""

import pytest

from apps.integrations.clients.base import TrackerIssue
from apps.integrations.models import Integration, Repository
from apps.issues.models import Issue, IssueExternalIssue, IssueStatus, IssueUser


def _exc(value="boom", user=None):
    data = {
        "platform": "python",
        "level": "error",
        "exception": {
            "values": [{"type": "ValueError", "value": value, "stacktrace": {"frames": []}}]
        },
    }
    if user is not None:
        data["user"] = user
    return data


def _store(project, **kw):
    from apps.ingest.normalize import normalize_event
    from apps.issues.services import store_event

    store_event(project, normalize_event(_exc(**kw)))
    return Issue.objects.filter(project=project).first()


# --- unique users --------------------------------------------------------- //
@pytest.mark.django_db
def test_users_seen_counts_distinct_identities(project):
    _store(project, user={"id": "u1"})
    _store(project, user={"id": "u1"})  # same user → no increment
    _store(project, user={"id": "u2"})
    _store(project, user={})  # anonymous → ignored
    issue = Issue.objects.get(project=project)
    assert issue.users_seen == 2
    assert IssueUser.objects.filter(issue=issue).count() == 2


# --- bookmark + archive --------------------------------------------------- //
@pytest.mark.django_db
def test_bookmark_toggle_and_archive(auth_api, project):
    issue = _store(project, user={"id": "u1"})
    base = f"/api/v1/projects/{project.id}/issues/{issue.id}"

    r = auth_api.post(f"{base}/bookmark", {}, format="json")
    assert r.status_code == 200 and r.data["is_bookmarked"] is True
    # Detail reflects the per-user bookmark.
    assert auth_api.get(base).data["is_bookmarked"] is True
    r = auth_api.post(f"{base}/bookmark", {}, format="json")
    assert r.data["is_bookmarked"] is False

    r = auth_api.post(f"{base}/archive", {}, format="json")
    assert r.status_code == 200 and r.data["status"] == IssueStatus.ARCHIVED


# --- trend series --------------------------------------------------------- //
@pytest.mark.django_db
def test_issue_series_endpoint(auth_api, project):
    issue = _store(project, user={"id": "u1"})
    for period, n in (("24h", 24), ("30d", 30)):
        r = auth_api.get(f"/api/v1/projects/{project.id}/issues/{issue.id}/series?period={period}")
        assert r.status_code == 200
        assert r.data["period"] == period
        assert len(r.data["buckets"]) == n
        assert sum(b["count"] for b in r.data["buckets"]) >= 1


# --- project stats -------------------------------------------------------- //
@pytest.mark.django_db
def test_project_stats_endpoint(auth_api, org, project):
    _store(project, user={"id": "u1"})
    r = auth_api.get(f"/api/v1/organizations/{org.id}/projects/stats?days=7")
    assert r.status_code == 200
    entry = r.data[str(project.id)]
    assert len(entry["errors"]) == 7 and len(entry["transactions"]) == 7
    assert sum(entry["errors"]) >= 1


# --- GitLab external issues (provider mocked) ----------------------------- //
class _FakeClient:
    def __init__(self, integration):
        self.integration = integration

    def create_issue(self, repo_id, *, title, description):
        return TrackerIssue(
            iid="42", title=title, web_url="https://gl/x/-/issues/42", state="opened"
        )

    def get_issue(self, repo_id, iid):
        return TrackerIssue(iid=iid, title="Existing", web_url=f"https://gl/x/-/issues/{iid}")

    def comment_issue(self, repo_id, iid, body):
        self.commented = (iid, body)

    def list_issues(self, repo_id, *, search="", state="opened"):
        return [TrackerIssue(iid="7", title=f"hit {search}", web_url="https://gl/x/-/issues/7")]


@pytest.fixture
def repo(org):
    integ = Integration.objects.create(
        organization=org, provider="gitlab", base_url="https://gl", access_token="t"
    )
    return Repository.objects.create(
        integration=integ, external_id="100", name="x", path_with_namespace="g/x", web_url="https://gl/x"
    )


@pytest.mark.django_db
def test_create_and_link_gitlab_issue(auth_api, project, repo, monkeypatch):
    monkeypatch.setattr("apps.integrations.clients.get_client", lambda i: _FakeClient(i))
    issue = _store(project, user={"id": "u1"})
    base = f"/api/v1/projects/{project.id}/issues/{issue.id}/external-issues"

    created = auth_api.post(
        base, {"repository": str(repo.id), "title": "Crash", "description": "d"}, format="json"
    )
    assert created.status_code == 201
    assert created.data["external_id"] == "42"
    assert created.data["web_url"].endswith("/42")

    linked = auth_api.post(
        base,
        {"repository": str(repo.id), "mode": "link", "external_id": "99", "comment": "see errora"},
        format="json",
    )
    assert linked.status_code == 201 and linked.data["external_id"] == "99"

    listed = auth_api.get(base)
    assert {row["external_id"] for row in listed.data} == {"42", "99"}
    assert IssueExternalIssue.objects.filter(issue=issue).count() == 2


@pytest.mark.django_db
def test_search_and_list_repositories(auth_api, project, repo, monkeypatch):
    monkeypatch.setattr("apps.integrations.clients.get_client", lambda i: _FakeClient(i))
    issue = _store(project, user={"id": "u1"})
    base = f"/api/v1/projects/{project.id}/issues/{issue.id}"

    repos = auth_api.get(f"{base}/repositories")
    assert repos.status_code == 200 and repos.data[0]["path_with_namespace"] == "g/x"

    found = auth_api.get(f"{base}/external-issues/search?repository={repo.id}&q=boom")
    assert found.status_code == 200
    assert found.data["results"][0]["iid"] == "7"
