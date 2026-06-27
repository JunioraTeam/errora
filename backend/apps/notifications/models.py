from __future__ import annotations

import uuid

from django.db import models

from apps.common.fields import EncryptedTextField

from .events import EventType


class ChannelType(models.TextChoices):
    WEBHOOK = "webhook", "HTTP Webhook"
    MATTERMOST = "mattermost", "Mattermost"
    EMAIL = "email", "Email"
    SMS = "sms", "SMS"


class NotificationChannel(models.Model):
    """A delivery destination. ``config`` shape depends on ``type``:
    webhook/mattermost: {"url": ...}; email: {"to": [...]}; sms: {"to": [...]}.
    Secrets within config (e.g. signing secret) are stored encrypted separately.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="channels"
    )
    name = models.CharField(max_length=120)
    type = models.CharField(max_length=20, choices=ChannelType.choices)
    config = models.JSONField(default=dict)
    secret = EncryptedTextField(blank=True)  # webhook signing secret / API token
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.name} ({self.type})"


class AlertRule(models.Model):
    """Routes an event type to a channel, optionally scoped to one project."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="alert_rules"
    )
    project = models.ForeignKey(
        "organizations.Project",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="alert_rules",
    )
    event_type = models.CharField(max_length=32, choices=EventType.choices)
    channel = models.ForeignKey(NotificationChannel, on_delete=models.CASCADE, related_name="rules")
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["organization", "event_type", "enabled"])]


class NotificationLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rule = models.ForeignKey(AlertRule, on_delete=models.SET_NULL, null=True)
    channel_type = models.CharField(max_length=20)
    event_type = models.CharField(max_length=32)
    success = models.BooleanField(default=False)
    detail = models.TextField(blank=True)
    # The rendered message, kept so a failed delivery can be replayed.
    message = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
