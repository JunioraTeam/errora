"""
Usage metering & quota. The ingest hot path calls :func:`record_event_usage`
and :func:`quota_exceeded`, which use a Redis counter to avoid a DB write per
event. A periodic task (:func:`apps.billing.tasks.flush_usage`) persists the
counters into :class:`UsageRecord` for billing/history.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.core.cache import cache
from django.utils import timezone

from .models import Plan, Subscription, UsageRecord

_COUNTER_TTL = 60 * 60 * 24 * 40  # ~40 days, longer than a billing period


def current_period() -> str:
    return timezone.localdate().strftime("%Y-%m")


def _counter_key(org_id, period: str) -> str:
    return f"usage:{org_id}:{period}"


def record_event_usage(project, count: int = 1) -> None:
    """Increment the org's event counter for the current period (Redis-backed)."""
    key = _counter_key(project.organization_id, current_period())
    try:
        cache.incr(key, count)
    except ValueError:
        # Key missing/expired — seed from the persisted record, then increment.
        # ``add`` is atomic and a no-op if a concurrent worker already seeded, so
        # racing seeds don't clobber each other's increments (lost-update bug).
        base = (
            UsageRecord.objects.filter(
                organization_id=project.organization_id, period=current_period()
            )
            .values_list("events_count", flat=True)
            .first()
            or 0
        )
        cache.add(key, base, _COUNTER_TTL)
        try:
            cache.incr(key, count)
        except ValueError:
            cache.set(key, base + count, _COUNTER_TTL)


def get_usage(organization, period: str | None = None) -> int:
    period = period or current_period()
    cached = cache.get(_counter_key(organization.id, period))
    if cached is not None:
        return int(cached)
    return (
        UsageRecord.objects.filter(organization=organization, period=period)
        .values_list("events_count", flat=True)
        .first()
        or 0
    )


def _plan_for(organization) -> Plan | None:
    sub = Subscription.objects.select_related("plan").filter(organization=organization).first()
    return sub.plan if sub else None


async def aget_usage(organization_id, period: str | None = None) -> int:
    period = period or current_period()
    cached = await cache.aget(_counter_key(organization_id, period))
    if cached is not None:
        return int(cached)
    return (
        await UsageRecord.objects.filter(organization_id=organization_id, period=period)
        .values_list("events_count", flat=True)
        .afirst()
    ) or 0


async def aquota_exceeded(project) -> bool:
    """Async quota gate for the ingest endpoint (native async ORM + cache)."""
    sub = (
        await Subscription.objects.select_related("plan")
        .filter(organization_id=project.organization_id)
        .afirst()
    )
    if sub is None:
        return False
    if sub.payg_enabled or sub.plan.is_payg:
        return False
    used = await aget_usage(project.organization_id)
    return used >= sub.plan.included_events


def quota_exceeded(project) -> bool:
    """True only for non-PAYG plans whose included quota is used up."""
    org = project.organization
    sub = Subscription.objects.select_related("plan").filter(organization=org).first()
    if sub is None:
        return False  # no subscription yet → allow (onboarding grace)
    if sub.payg_enabled or sub.plan.is_payg:
        return False  # PAYG bills overage instead of blocking
    return get_usage(org) >= sub.plan.included_events


def usage_by_day(organization, period: str | None = None) -> list[dict]:
    """Per-day event counts for the given month (``YYYY-MM``), via the event
    store (OLTP or ClickHouse). Only days with events are returned."""
    from apps.issues.store import get_event_store

    period = period or current_period()
    year, month = (int(x) for x in period.split("-"))
    start = date(year, month, 1)
    end = (start + timedelta(days=32)).replace(day=1)
    return get_event_store().count_by_day(organization, start, end)


def usage_by_month(organization, months: int = 12) -> list[dict]:
    """Per-month event totals from persisted UsageRecords, with the current period
    overlaid from the live counter (it may not be flushed yet)."""
    records = {
        r.period: r.events_count for r in UsageRecord.objects.filter(organization=organization)
    }
    records[current_period()] = get_usage(organization)
    ordered = sorted(records.items())[-months:]
    return [{"period": p, "events": c} for p, c in ordered]


def usage_summary(organization) -> dict:
    period = current_period()
    used = get_usage(organization, period)
    sub = Subscription.objects.select_related("plan").filter(organization=organization).first()
    plan = sub.plan if sub else None
    included = plan.included_events if plan else 0
    # A plan with no included allotment (or no subscription at all) means there is
    # no hard quota — surface it as ``null`` so the UI renders it as unlimited (∞).
    quota = included if included else None
    overage = max(0, used - included)
    overage_cost = float(overage * (plan.payg_per_event_toman if plan else 0))

    # Billing period bounds (first → last day of the current calendar month).
    today = timezone.localdate()
    period_start = today.replace(day=1)
    next_month = (period_start + timedelta(days=32)).replace(day=1)
    period_end = next_month - timedelta(days=1)

    return {
        "period": period,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        # Field names the frontend consumes:
        "events_consumed": used,
        "quota": quota,
        # Legacy keys (kept for any internal callers):
        "events_used": used,
        "included_events": included,
        "overage_events": overage,
        "overage_cost_toman": overage_cost,
        "payg_enabled": bool(sub and (sub.payg_enabled or sub.plan.is_payg)),
        "plan": plan.slug if plan else None,
        "by_day": usage_by_day(organization, period),
        "by_month": usage_by_month(organization),
    }
