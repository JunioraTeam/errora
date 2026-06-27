from django.contrib import admin

from .models import Event, Issue, IssueComment, IssueHash


@admin.register(Issue)
class IssueAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "level", "status", "times_seen", "last_seen")
    list_filter = ("status", "level", "platform")
    search_fields = ("type", "value", "culprit")


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ("event_id", "project", "issue", "level", "timestamp")
    list_filter = ("level", "platform", "environment")


admin.site.register([IssueHash, IssueComment])
