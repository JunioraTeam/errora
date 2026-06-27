from __future__ import annotations

from adrf.serializers import ModelSerializer
from rest_framework import serializers

from apps.common.net import UnsafeURLError, validate_external_url

from .models import AlertRule, NotificationChannel, NotificationLog

_URL_CHANNEL_TYPES = {"webhook", "mattermost"}


def _org_pk_from(serializer) -> str | None:
    view = serializer.context.get("view")
    return view.kwargs.get("org_pk") if view else None


class ChannelSerializer(ModelSerializer):
    secret = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = NotificationChannel
        fields = ["id", "name", "type", "config", "secret", "is_active", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        # SSRF guard: a webhook/Mattermost URL must resolve to a public address.
        ctype = attrs.get("type") or getattr(self.instance, "type", None)
        config = attrs.get("config", getattr(self.instance, "config", None)) or {}
        if ctype in _URL_CHANNEL_TYPES:
            url = config.get("url")
            if not url:
                raise serializers.ValidationError({"config": "A 'url' is required."})
            try:
                validate_external_url(url, allow_http=True)
            except UnsafeURLError as exc:
                raise serializers.ValidationError({"config": str(exc)}) from exc
        return attrs


class AlertRuleSerializer(ModelSerializer):
    class Meta:
        model = AlertRule
        fields = ["id", "project", "event_type", "channel", "enabled", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_channel(self, value):
        # Prevent wiring this org's events to another org's channel.
        org_pk = _org_pk_from(self)
        if org_pk and str(value.organization_id) != str(org_pk):
            raise serializers.ValidationError("Channel does not belong to this organization.")
        return value

    def validate_project(self, value):
        org_pk = _org_pk_from(self)
        if value is not None and org_pk and str(value.organization_id) != str(org_pk):
            raise serializers.ValidationError("Project does not belong to this organization.")
        return value


class NotificationLogSerializer(ModelSerializer):
    class Meta:
        model = NotificationLog
        fields = [
            "id",
            "rule",
            "channel_type",
            "event_type",
            "success",
            "detail",
            "message",
            "created_at",
        ]
        read_only_fields = fields
