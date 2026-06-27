import pytest

from apps.issues.grouping import compute_grouping, derive_metadata
from apps.issues.models import Issue, IssueStatus
from apps.issues.services import store_event


def _exc(type_="ValueError", value="bad", fn="run", file="app/svc.py"):
    return {
        "exception": {
            "values": [
                {
                    "type": type_,
                    "value": value,
                    "stacktrace": {"frames": [{"filename": file, "function": fn, "in_app": True}]},
                }
            ]
        },
        "level": "error",
        "platform": "python",
    }


def test_same_exception_groups_deterministically():
    h1, _ = compute_grouping(_exc())
    h2, _ = compute_grouping(_exc(value="different message but same frames"))
    assert h1 == h2  # message does not affect grouping when a stacktrace exists


def test_different_type_groups_separately():
    assert compute_grouping(_exc("ValueError"))[0] != compute_grouping(_exc("KeyError"))[0]


def test_explicit_fingerprint_overrides():
    data = _exc()
    data["fingerprint"] = ["my-custom-group"]
    h_custom, _ = compute_grouping(data)
    assert h_custom != compute_grouping(_exc())[0]


def test_derive_metadata_extracts_title():
    meta = derive_metadata(_exc("RuntimeError", "kaboom"))
    assert meta["type"] == "RuntimeError"
    assert meta["value"] == "kaboom"
    assert meta["culprit"] == "run"


@pytest.mark.django_db
def test_store_event_aggregates(project):
    store_event(project, _exc())
    store_event(project, _exc())
    store_event(project, _exc("KeyError"))
    assert Issue.objects.filter(project=project).count() == 2
    value_issue = Issue.objects.get(project=project, type="ValueError")
    assert value_issue.times_seen == 2
    assert value_issue.events.count() == 2


@pytest.mark.django_db
def test_resolved_issue_regresses(project):
    store_event(project, _exc())
    issue = Issue.objects.get(project=project)
    issue.status = IssueStatus.RESOLVED
    issue.save()
    store_event(project, _exc())
    issue.refresh_from_db()
    assert issue.status == IssueStatus.UNRESOLVED
