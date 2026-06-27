"""Source-map symbolication: VLQ codec, parser, end-to-end ingest, upload API."""

import json

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounts.authentication import issue_token_pair
from apps.accounts.models import User
from apps.organizations.models import Membership
from apps.organizations.roles import Role
from apps.sourcemaps.models import ReleaseArtifact
from apps.sourcemaps.smap import SourceMap, vlq_decode, vlq_encode

# Original source the minified bundle was built from.
ORIGINAL = 'export function greet(name) {\n  throw new Error("boom: " + name);\n}\n'
# The "throw" token sits at generated line 0, column 28 of the one-line bundle.
THROW_COL = 28


def _build_map() -> str:
    """A hand-built v3 source map: gen(0,0)→orig(0,0,0), gen(0,28)→orig(0,1,2)."""
    seg0 = vlq_encode([0, 0, 0, 0])  # genCol 0  → src0 line0 col0
    seg1 = vlq_encode([THROW_COL, 0, 1, 2, 0])  # genCol 28 → src0 line1 col2, name "greet"
    return json.dumps(
        {
            "version": 3,
            "sources": ["src/app.js"],
            "sourcesContent": [ORIGINAL],
            "names": ["greet"],
            "mappings": f"{seg0},{seg1}",
        }
    )


# --- VLQ codec ------------------------------------------------------------- //
@pytest.mark.parametrize(
    "text,values",
    [("AAAA", [0, 0, 0, 0]), ("A", [0]), ("C", [1]), ("D", [-1]), ("KAAA", [5, 0, 0, 0])],
)
def test_vlq_decode_known_vectors(text, values):
    assert vlq_decode(text) == values


@pytest.mark.parametrize("values", [[0], [1], [-1], [28, 0, 1, 2], [5, 0, 0, 0], [-123, 456]])
def test_vlq_roundtrip(values):
    assert vlq_decode(vlq_encode(values)) == values


# --- parser ---------------------------------------------------------------- //
def test_sourcemap_lookup_and_context():
    smap = SourceMap.from_json(_build_map())
    token = smap.lookup(0, THROW_COL)
    assert token is not None
    assert smap.source_name(token) == "src/app.js"
    assert token.src_line == 1
    assert token.src_col == 2

    pre, line, post = smap.source_context(token)
    assert line == '  throw new Error("boom: " + name);'
    assert pre == ["export function greet(name) {"]
    assert post == ["}", ""]


def test_sourcemap_lookup_nearest_preceding():
    smap = SourceMap.from_json(_build_map())
    # A column between the two tokens resolves to the earlier (col-0) token.
    token = smap.lookup(0, 10)
    assert token.src_line == 0 and token.src_col == 0


def test_indexed_sourcemap_rejected():
    with pytest.raises(ValueError):
        SourceMap.from_json(json.dumps({"version": 3, "sections": []}))


# --- end-to-end ingest ----------------------------------------------------- //
def _minified_event():
    return {
        "platform": "javascript",
        "release": "1.0.0",
        "level": "error",
        "exception": {
            "values": [
                {
                    "type": "Error",
                    "value": "boom: world",
                    "stacktrace": {
                        "frames": [
                            {
                                "abs_path": "https://app.example.com/static/app.min.js",
                                "filename": "app.min.js",
                                "function": "o",
                                "lineno": 1,
                                "colno": THROW_COL + 1,  # frames are 1-based
                            }
                        ]
                    },
                }
            ]
        },
    }


@pytest.mark.django_db
def test_symbolication_resolves_frame(project):
    from apps.ingest.normalize import normalize_event
    from apps.issues.services import store_event
    from apps.issues.store import get_event_store

    ReleaseArtifact.objects.create(
        project=project,
        release="1.0.0",
        name="~/static/app.min.js.map",
        content=_build_map(),
        size=len(_build_map()),
    )

    stored = store_event(project, normalize_event(_minified_event()))
    event = get_event_store().get(project, stored["event_id"])
    frame = event["data"]["exception"]["values"][0]["stacktrace"]["frames"][0]

    assert frame["symbolicated"] is True
    assert frame["filename"] == "src/app.js"
    assert frame["lineno"] == 2
    assert frame["colno"] == 3
    assert frame["function"] == "greet"  # recovered original name
    assert frame["context_line"] == '  throw new Error("boom: " + name);'
    assert frame["in_app"] is True


@pytest.mark.django_db
def test_no_symbolication_without_artifact(project):
    from apps.ingest.normalize import normalize_event
    from apps.issues.services import store_event
    from apps.issues.store import get_event_store

    stored = store_event(project, normalize_event(_minified_event()))
    event = get_event_store().get(project, stored["event_id"])
    frame = event["data"]["exception"]["values"][0]["stacktrace"]["frames"][0]
    # Untouched: still the minified frame.
    assert frame.get("symbolicated") is not True
    assert frame["filename"] == "app.min.js"


# --- upload API ------------------------------------------------------------ //
@pytest.mark.django_db
def test_upload_and_list_release_file(auth_api, project):
    body = _build_map()
    upload = SimpleUploadedFile("app.min.js.map", body.encode(), content_type="application/json")
    resp = auth_api.post(
        f"/api/v1/projects/{project.id}/release-files",
        {"release": "1.0.0", "name": "~/static/app.min.js.map", "file": upload},
        format="multipart",
    )
    assert resp.status_code == 201
    assert resp.data["name"] == "~/static/app.min.js.map"
    assert ReleaseArtifact.objects.filter(project=project, release="1.0.0").count() == 1

    listed = auth_api.get(f"/api/v1/projects/{project.id}/release-files?release=1.0.0")
    assert listed.status_code == 200
    assert len(listed.data["results"]) == 1

    # Re-upload same name → upsert (200, still one row).
    again = SimpleUploadedFile("app.min.js.map", body.encode())
    resp2 = auth_api.post(
        f"/api/v1/projects/{project.id}/release-files",
        {"release": "1.0.0", "name": "~/static/app.min.js.map", "file": again},
        format="multipart",
    )
    assert resp2.status_code == 200
    assert ReleaseArtifact.objects.filter(project=project, release="1.0.0").count() == 1


@pytest.mark.django_db
def test_upload_requires_manage_permission(api, project):
    member = User.objects.create_user(email="m-sm@errora.dev", password="password123")
    Membership.objects.create(organization=project.organization, user=member, role=Role.MEMBER)
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token_pair(member)['access']}")

    upload = SimpleUploadedFile("x.map", b"{}")
    resp = api.post(
        f"/api/v1/projects/{project.id}/release-files",
        {"release": "1.0.0", "name": "~/x.js.map", "file": upload},
        format="multipart",
    )
    assert resp.status_code == 403
