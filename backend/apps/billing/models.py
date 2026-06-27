from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


class Plan(models.Model):
    """
    A pricing plan. Prices are in Toman (تومان); the schema is currency-agnostic
    so USD etc. can be added later via a separate price table or a currency field.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=80)
    name_fa = models.CharField(max_length=80, blank=True)
    description = models.CharField(max_length=255, blank=True)

    price_toman_monthly = models.BigIntegerField(default=0)
    price_toman_yearly = models.BigIntegerField(default=0)
    included_events = models.BigIntegerField(default=0)  # monthly quota
    payg_per_event_toman = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    retention_days = models.PositiveIntegerField(default=30)
    max_seats = models.PositiveIntegerField(default=1)
    is_payg = models.BooleanField(default=False)
    is_public = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    features = models.JSONField(default=list)  # list[str] for marketing display

    class Meta:
        ordering = ["sort_order"]

    def __str__(self) -> str:
        return self.name


class Subscription(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAST_DUE = "past_due", "Past due"
        CANCELED = "canceled", "Canceled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.OneToOneField(
        "organizations.Organization", on_delete=models.CASCADE, related_name="subscription"
    )
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    payg_enabled = models.BooleanField(default=False)
    current_period_start = models.DateField(default=timezone.localdate)
    current_period_end = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class UsageRecord(models.Model):
    """Per-organization event count for a billing period (YYYY-MM)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="usage_records"
    )
    period = models.CharField(max_length=7, db_index=True)  # e.g. "2026-06"
    events_count = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("organization", "period")]
