from django.contrib import admin

from .models import Plan, Subscription, UsageRecord


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "price_toman_monthly", "included_events", "is_payg")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ("organization", "plan", "status", "payg_enabled")
    list_filter = ("status", "payg_enabled")


@admin.register(UsageRecord)
class UsageRecordAdmin(admin.ModelAdmin):
    list_display = ("organization", "period", "events_count", "updated_at")
    list_filter = ("period",)
