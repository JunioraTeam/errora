from __future__ import annotations

from adrf.serializers import ModelSerializer
from rest_framework import serializers

from apps.common.net import UnsafeURLError, validate_external_url

from .models import Integration, Repository


class IntegrationSerializer(ModelSerializer):
    # Write-only token; never returned.
    access_token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    connected = serializers.SerializerMethodField()

    class Meta:
        model = Integration
        fields = [
            "id",
            "provider",
            "name",
            "base_url",
            "access_token",
            "is_active",
            "connected",
            "created_at",
        ]
        read_only_fields = ["id", "connected", "created_at"]

    def get_connected(self, obj) -> bool:
        return bool(obj.access_token)

    def validate_base_url(self, value):
        # SSRF guard: the provider host must resolve to a public address (the
        # access token is sent to it).
        if value:
            try:
                validate_external_url(value, allow_http=True)
            except UnsafeURLError as exc:
                raise serializers.ValidationError(str(exc)) from exc
        return value


class RepositorySerializer(ModelSerializer):
    class Meta:
        model = Repository
        fields = ["id", "external_id", "name", "path_with_namespace", "web_url", "default_branch"]
        read_only_fields = fields
