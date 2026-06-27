"""MCP server: token management API + JSON-RPC tools over /mcp."""

import json

import pytest

from apps.accounts.models import ApiToken
from apps.accounts.tokens import authenticate_token, create_token
from apps.issues.models import Issue, IssueStatus


def _exc(type_="ValueError", value="boom"):
    return {
        "platform": "python",
        "level": "error",
        "exception": {
            "values": [
                {
                    "type": type_,
                    "value": value,
                    "stacktrace": {
                        "frames": [
                            {
                                "filename": "app.py",
                                "function": "f",
                                "lineno": 10,
                                "in_app": True,
                                "context_line": "    raise ValueError('boom')",
                            }
                        ]
                    },
                }
            ]
        },
    }


def _store_issue(project):
    from apps.ingest.normalize import normalize_event
    from apps.issues.services import store_event

    store_event(project, normalize_event(_exc()))
    return Issue.objects.filter(project=project).first()


def _rpc(client, raw_token, method, params=None, mid=1):
    body = {"jsonrpc": "2.0", "id": mid, "method": method}
    if params is not None:
        body["params"] = params
    resp = client.post(
        "/mcp",
        data=json.dumps(body),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {raw_token}",
    )
    return resp


def _call(client, raw_token, tool, args, mid=1):
    resp = _rpc(client, raw_token, "tools/call", {"name": tool, "arguments": args}, mid)
    assert resp.status_code == 200, resp.content
    result = resp.json()["result"]
    text = result["content"][0]["text"]
    return result, (json.loads(text) if not result.get("isError") else text)


# --- token service + API --------------------------------------------------- //
@pytest.mark.django_db
def test_token_create_and_authenticate(user):
    token, raw = create_token(user, "my token")
    assert raw.startswith("errora_pat_")
    assert token.token_prefix and "errora_pat_" not in token.token_hash  # only hash stored
    assert authenticate_token(raw) == user
    assert authenticate_token("errora_pat_wrong") is None


@pytest.mark.django_db
def test_token_api_crud(auth_api, user):
    created = auth_api.post("/api/v1/auth/tokens", {"name": "CI"}, format="json")
    assert created.status_code == 201
    raw = created.data["token"]  # returned once
    assert raw.startswith("errora_pat_")
    tid = created.data["id"]

    listed = auth_api.get("/api/v1/auth/tokens")
    assert listed.status_code == 200
    assert len(listed.data["results"]) == 1
    assert "token" not in listed.data["results"][0]  # never returned again

    deleted = auth_api.delete(f"/api/v1/auth/tokens/{tid}")
    assert deleted.status_code == 204
    assert not ApiToken.objects.filter(id=tid).exists()


@pytest.mark.django_db
def test_token_api_requires_auth(api):
    assert api.get("/api/v1/auth/tokens").status_code == 401


# --- MCP transport / handshake -------------------------------------------- //
@pytest.mark.django_db
def test_mcp_requires_bearer(client):
    resp = client.post("/mcp", data="{}", content_type="application/json")
    assert resp.status_code == 401
    assert "WWW-Authenticate" in resp


@pytest.mark.django_db
def test_mcp_initialize_and_tools_list(client, user):
    _token, raw = create_token(user, "t")
    init = _rpc(client, raw, "initialize", {"protocolVersion": "2025-06-18"})
    assert init.status_code == 200
    data = init.json()["result"]
    assert data["serverInfo"]["name"] == "errora-mcp"
    assert data["protocolVersion"] == "2025-06-18"

    listed = _rpc(client, raw, "tools/list")
    names = {t["name"] for t in listed.json()["result"]["tools"]}
    assert {"whoami", "list_projects", "list_issues", "get_issue", "update_issue_status"} <= names

    # Notifications get a 202 with no body.
    note = client.post(
        "/mcp",
        data=json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {raw}",
    )
    assert note.status_code == 202


# --- tools ----------------------------------------------------------------- //
@pytest.mark.django_db
def test_mcp_whoami_and_projects(client, user, project):
    _token, raw = create_token(user, "t")

    _r, who = _call(client, raw, "whoami", {})
    assert who["id"] == str(user.id)
    assert any(o["role"] == "owner" for o in who["organizations"])

    _r, projects = _call(client, raw, "list_projects", {})
    assert any(p["id"] == str(project.id) for p in projects["projects"])


@pytest.mark.django_db
def test_mcp_list_and_get_issue(client, user, project):
    issue = _store_issue(project)
    _token, raw = create_token(user, "t")

    _r, listed = _call(client, raw, "list_issues", {"project": project.slug})
    assert listed["count"] == 1
    assert listed["issues"][0]["type"] == "ValueError"

    _r, detail = _call(client, raw, "get_issue", {"issue_id": str(issue.id)})
    assert detail["id"] == str(issue.id)
    assert detail["latest_event"]["type"] == "ValueError"
    assert detail["latest_event"]["frames"][0]["function"] == "f"


@pytest.mark.django_db
def test_mcp_update_issue_status(client, user, project):
    issue = _store_issue(project)
    _token, raw = create_token(user, "t")

    _r, out = _call(
        client, raw, "update_issue_status", {"issue_id": str(issue.id), "status": "resolved"}
    )
    assert out["status"] == "resolved"
    issue.refresh_from_db()
    assert issue.status == IssueStatus.RESOLVED


@pytest.mark.django_db
def test_mcp_scoping_hides_other_users_projects(client, project):
    # A token for a DIFFERENT user (no membership) can't see the project.
    from apps.accounts.models import User

    outsider = User.objects.create_user(email="outsider@errora.dev", password="password123")
    _token, raw = create_token(outsider, "t")

    result, payload = _call(client, raw, "list_issues", {"project": project.slug})
    assert result["isError"] is True
    assert "not accessible" in payload.lower()


@pytest.mark.django_db
def test_mcp_unknown_tool_errors(client, user):
    _token, raw = create_token(user, "t")
    resp = _rpc(client, raw, "tools/call", {"name": "nope", "arguments": {}})
    assert resp.status_code == 200
    assert resp.json()["error"]["code"] == -32602
