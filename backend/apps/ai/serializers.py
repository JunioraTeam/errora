from __future__ import annotations

from adrf.serializers import ModelSerializer
from rest_framework import serializers

from apps.common.net import UnsafeURLError, validate_external_url

from .models import AIConfig, AutoFixRun


class AIConfigSerializer(ModelSerializer):
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    has_key = serializers.SerializerMethodField()

    class Meta:
        model = AIConfig
        fields = [
            "id",
            "organization",
            "project",
            "name",
            "provider",
            "base_url",
            "api_key",
            "has_key",
            "model",
            "auto_trigger",
            "enabled",
            "created_at",
        ]
        read_only_fields = ["id", "organization", "has_key", "created_at"]

    def get_has_key(self, obj) -> bool:
        return bool(obj.api_key)

    def validate_base_url(self, value):
        # SSRF guard: block loopback/link-local/metadata. http is allowed so a
        # local LLM (Ollama/vLLM, reached by service host) still works.
        if value:
            try:
                validate_external_url(value, allow_http=True)
            except UnsafeURLError as exc:
                raise serializers.ValidationError(str(exc)) from exc
        return value

    def validate_project(self, value):
        # Prevent attaching a config (with its own base_url/api_key) to another
        # org's project, which would hijack that project's auto-fix runs.
        view = self.context.get("view")
        org_pk = view.kwargs.get("org_pk") if view else None
        if value is not None and org_pk and str(value.organization_id) != str(org_pk):
            raise serializers.ValidationError("Project does not belong to this organization.")
        return value


class AutoFixRunSerializer(ModelSerializer):
    issue_title = serializers.CharField(source="issue.title", read_only=True)
    project_id = serializers.UUIDField(source="issue.project_id", read_only=True)
    project_name = serializers.CharField(source="issue.project.name", read_only=True)
    triggered_by_name = serializers.CharField(
        source="triggered_by.display_name", read_only=True, default=None
    )

    class Meta:
        model = AutoFixRun
        fields = [
            "id",
            "issue",
            "issue_title",
            "project_id",
            "project_name",
            "provider",
            "model",
            "status",
            "explanation",
            "diff",
            "mr_url",
            "branch",
            "error",
            "tokens_used",
            "triggered_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields
