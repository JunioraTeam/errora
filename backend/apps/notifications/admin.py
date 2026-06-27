from django.contrib import admin

from .models import AlertRule, NotificationChannel, NotificationLog


@admin.register(NotificationChannel)
class ChannelAdmin(admin.ModelAdmin):
    list_display = ("name", "type", "organization", "is_active")
    list_filter = ("type", "is_active")


@admin.register(AlertRule)
class AlertRuleAdmin(admin.ModelAdmin):
    list_display = ("event_type", "channel", "project", "organization", "enabled")
    list_filter = ("event_type", "enabled")


@admin.register(NotificationLog)
class NotificationLogAdmin(admin.ModelAdmin):
    list_display = ("event_type", "channel_type", "success", "created_at")
    list_filter = ("success", "channel_type", "event_type")
