from __future__ import annotations

from adrf.serializers import ModelSerializer
from rest_framework import serializers

from .models import (
    Membership,
    Organization,
    OrganizationInvite,
    Project,
    ProjectKey,
)
from .retention import MAX_RETENTION_DAYS, MIN_RETENTION_DAYS


class ProjectKeySerializer(ModelSerializer):
    dsn = serializers.SerializerMethodField()

    class Meta:
        model = ProjectKey
        fields = ["id", "label", "public_key", "is_active", "dsn", "created_at"]

    def get_dsn(self, obj) -> str:
        return obj.dsn()


class ProjectSerializer(ModelSerializer):
    keys = ProjectKeySerializer(many=True, read_only=True)
    # Populated by ProjectViewSet.get_queryset annotations; default keeps the
    # field present even when the project is serialized without annotation.
    open_issues_count = serializers.IntegerField(read_only=True, default=0)
    last_event_at = serializers.DateTimeField(read_only=True, default=None)

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "slug",
            "platform",
            "repository",
            "keys",
            "open_issues_count",
            "last_event_at",
            "created_at",
        ]
        read_only_fields = ["id", "slug", "keys", "created_at"]


class OrganizationSerializer(ModelSerializer):
    role = serializers.SerializerMethodField()
    project_count = serializers.IntegerField(source="projects.count", read_only=True)
    # Effective retention shown to the UI when no org override is set (the plan's
    # value, or the global default).
    default_retention_days = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = [
            "id",
            "name",
            "slug",
            "role",
            "project_count",
            "retention_days",
            "default_retention_days",
            "created_at",
        ]
        read_only_fields = ["id", "slug", "created_at"]

    def get_role(self, obj) -> str | None:
        user = self.context["request"].user
        m = obj.memberships.filter(user=user).first()
        return m.role if m else None

    def get_default_retention_days(self, obj) -> int:
        from .retention import default_retention_days

        return default_retention_days(obj)

    def validate_retention_days(self, value):
        if value is None:
            return value  # clear the override → inherit the plan/default
        if value < MIN_RETENTION_DAYS or value > MAX_RETENTION_DAYS:
            raise serializers.ValidationError(
                f"Retention must be between {MIN_RETENTION_DAYS} and {MAX_RETENTION_DAYS} days."
            )
        return value


class MembershipSerializer(ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_name = serializers.CharField(source="user.display_name", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "user", "user_email", "user_name", "role", "created_at"]
        read_only_fields = ["id", "user", "created_at"]


class InviteSerializer(ModelSerializer):
    class Meta:
        model = OrganizationInvite
        fields = ["id", "email", "role", "status", "expires_at", "created_at"]
        read_only_fields = ["id", "status", "expires_at", "created_at"]
