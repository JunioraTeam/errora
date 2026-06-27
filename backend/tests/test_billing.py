import pytest

from apps.billing.models import Plan, Subscription
from apps.billing.plans import DEFAULT_PLANS
from apps.billing.services import get_usage, quota_exceeded, record_event_usage, usage_summary


@pytest.fixture
def plans(db):
    for data in DEFAULT_PLANS:
        Plan.objects.update_or_create(slug=data["slug"], defaults=data)
    return Plan.objects.all()


@pytest.mark.django_db
def test_record_and_read_usage(project):
    record_event_usage(project, count=3)
    record_event_usage(project)
    assert get_usage(project.organization) == 4


@pytest.mark.django_db
def test_quota_not_exceeded_without_subscription(project):
    assert quota_exceeded(project) is False


@pytest.mark.django_db
def test_quota_enforced_for_fixed_plan(project, plans):
    free = Plan.objects.get(slug="free")
    free.included_events = 2
    free.save()
    Subscription.objects.create(organization=project.organization, plan=free)
    record_event_usage(project, count=2)
    assert quota_exceeded(project) is True


@pytest.mark.django_db
def test_payg_never_blocks(project, plans):
    payg = Plan.objects.get(slug="payg")
    Subscription.objects.create(organization=project.organization, plan=payg)
    record_event_usage(project, count=10_000)
    assert quota_exceeded(project) is False
    summary = usage_summary(project.organization)
    assert summary["payg_enabled"] is True
    assert summary["events_used"] == 10_000


@pytest.mark.django_db
def test_plans_endpoint_public(api, plans):
    resp = api.get("/api/v1/plans")
    assert resp.status_code == 200
    slugs = (
        {p["slug"] for p in resp.data["results"]}
        if "results" in resp.data
        else {p["slug"] for p in resp.data}
    )
    assert "team" in slugs
