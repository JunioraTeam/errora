from django.contrib import admin

from .models import AIConfig, AutoFixRun


@admin.register(AIConfig)
class AIConfigAdmin(admin.ModelAdmin):
    list_display = ("organization", "project", "provider", "model", "auto_trigger", "enabled")
    list_filter = ("provider", "enabled", "auto_trigger")


@admin.register(AutoFixRun)
class AutoFixRunAdmin(admin.ModelAdmin):
    list_display = ("issue", "provider", "status", "mr_url", "created_at")
    list_filter = ("status", "provider")
