from __future__ import annotations

from adrf.serializers import ModelSerializer
from rest_framework import serializers

from .models import Plan, Subscription


class PlanSerializer(ModelSerializer):
    class Meta:
        model = Plan
        fields = [
            "id",
            "slug",
            "name",
            "name_fa",
            "description",
            "price_toman_monthly",
            "price_toman_yearly",
            "included_events",
            "payg_per_event_toman",
            "retention_days",
            "max_seats",
            "is_payg",
            "features",
            "sort_order",
        ]


class SubscriptionSerializer(ModelSerializer):
    plan = PlanSerializer(read_only=True)
    plan_slug = serializers.SlugField(write_only=True)

    class Meta:
        model = Subscription
        fields = [
            "id",
            "plan",
            "plan_slug",
            "status",
            "payg_enabled",
            "current_period_start",
            "current_period_end",
        ]
        read_only_fields = ["id", "status", "current_period_start", "current_period_end"]
