from __future__ import annotations

from adrf.serializers import ModelSerializer
from rest_framework import serializers

from .models import Event, Issue, IssueComment, IssueExternalIssue


class IssueSerializer(ModelSerializer):
    title = serializers.CharField(read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    has_seen = serializers.SerializerMethodField()
    is_bookmarked = serializers.SerializerMethodField()

    class Meta:
        model = Issue
        fields = [
            "id",
            "project",
            "project_name",
            "title",
            "type",
            "value",
            "culprit",
            "level",
            "status",
            "priority",
            "platform",
            "times_seen",
            "users_seen",
            "first_seen",
            "last_seen",
            "assignees",
            "autofix_state",
            "has_seen",
            "is_bookmarked",
        ]
        read_only_fields = fields

    def get_has_seen(self, obj) -> bool:
        # Read from the list annotation when present; detail marks the issue seen
        # before serializing, so default to True there.
        return bool(getattr(obj, "has_seen", True))

    def get_is_bookmarked(self, obj) -> bool:
        return bool(getattr(obj, "is_bookmarked", False))


class IssueExternalIssueSerializer(ModelSerializer):
    repository_name = serializers.CharField(source="repository.path_with_namespace", read_only=True)

    class Meta:
        model = IssueExternalIssue
        fields = [
            "id",
            "repository",
            "repository_name",
            "provider",
            "external_id",
            "title",
            "web_url",
            "created_at",
        ]
        read_only_fields = fields


class EventSerializer(ModelSerializer):
    class Meta:
        model = Event
        fields = [
            "event_id",
            "issue",
            "timestamp",
            "received_at",
            "level",
            "platform",
            "environment",
            "release",
            "server_name",
            "message",
            "data",
        ]
        read_only_fields = fields


class IssueDetailSerializer(IssueSerializer):
    latest_event = serializers.SerializerMethodField()
    repository = serializers.SerializerMethodField()

    class Meta(IssueSerializer.Meta):
        fields = IssueSerializer.Meta.fields + ["latest_event", "repository"]

    def get_latest_event(self, obj):
        from .store import get_event_store

        return get_event_store().latest_for_issue(obj)

    def get_repository(self, obj):
        """The project's linked source repo — lets the UI build a blame link to
        the suspect frame (a lightweight "suspect commit" pointer)."""
        repo = getattr(obj.project, "repository", None)
        if repo is None:
            return None
        return {
            "provider": repo.integration.provider,
            "web_url": repo.web_url,
            "default_branch": repo.default_branch,
            "path_with_namespace": repo.path_with_namespace,
        }


class IssueCommentSerializer(ModelSerializer):
    author_name = serializers.CharField(source="author.display_name", read_only=True)

    class Meta:
        model = IssueComment
        fields = ["id", "body", "author", "author_name", "created_at"]
        read_only_fields = ["id", "author", "author_name", "created_at"]
