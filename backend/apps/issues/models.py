from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class IssueStatus(models.TextChoices):
    UNRESOLVED = "unresolved", "Unresolved"
    RESOLVED = "resolved", "Resolved"
    IGNORED = "ignored", "Ignored"
    ARCHIVED = "archived", "Archived"


class Level(models.TextChoices):
    DEBUG = "debug", "Debug"
    INFO = "info", "Info"
    WARNING = "warning", "Warning"
    ERROR = "error", "Error"
    FATAL = "fatal", "Fatal"


class IssuePriority(models.TextChoices):
    LOW = "low", "Low"
    MEDIUM = "medium", "Medium"
    HIGH = "high", "High"


class Issue(models.Model):
    """
    A group of events sharing a fingerprint — analogous to a Sentry "issue".
    The primary grouping hash is unique per project; additional hashes (after a
    merge or secondary grouping strategy) live in :class:`IssueHash`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "organizations.Project", on_delete=models.CASCADE, related_name="issues"
    )
    primary_hash = models.CharField(max_length=64)

    # Denormalized title parts for fast list rendering (Sentry does the same).
    type = models.CharField(max_length=255, blank=True)  # e.g. "ValueError"
    value = models.TextField(blank=True)  # exception message
    culprit = models.CharField(max_length=512, blank=True)  # function / transaction

    level = models.CharField(max_length=10, choices=Level.choices, default=Level.ERROR)
    status = models.CharField(
        max_length=12, choices=IssueStatus.choices, default=IssueStatus.UNRESOLVED
    )
    priority = models.CharField(
        max_length=10, choices=IssuePriority.choices, default=IssuePriority.MEDIUM
    )
    platform = models.CharField(max_length=32, blank=True)

    times_seen = models.PositiveIntegerField(default=0)
    users_seen = models.PositiveIntegerField(default=0)
    first_seen = models.DateTimeField()
    last_seen = models.DateTimeField()

    # An issue can be assigned to one or many organization members.
    assignees = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="assigned_issues"
    )
    # Users who have opened this issue at least once (Sentry's "has seen" — drives
    # the unread dot in the issues list).
    seen_by = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="seen_issues"
    )
    # Per-user bookmark (Sentry's star). A personal flag, not shared state.
    bookmarked_by = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="bookmarked_issues"
    )
    # AI auto-fix linkage (set by the ai app when a Seer-style run starts).
    autofix_state = models.CharField(max_length=20, blank=True, default="")

    class Meta:
        unique_together = [("project", "primary_hash")]
        indexes = [
            models.Index(fields=["project", "status", "-last_seen"]),
            models.Index(fields=["project", "-times_seen"]),
        ]
        ordering = ["-last_seen"]

    @property
    def title(self) -> str:
        if self.type and self.value:
            return f"{self.type}: {self.value[:120]}"
        return self.type or self.value or "Error"

    def __str__(self) -> str:
        return f"{self.title} ({self.project_id})"


class IssueHash(models.Model):
    """Secondary fingerprints pointing at an issue (supports merge & regrouping)."""

    hash = models.CharField(max_length=64)
    project = models.ForeignKey("organizations.Project", on_delete=models.CASCADE)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="hashes")

    class Meta:
        unique_together = [("project", "hash")]


class Event(models.Model):
    """
    A single occurrence. The full normalized payload is kept in ``data`` (JSON);
    hot query columns are denormalized. This model is intentionally behind the
    ingest pipeline so the backing store can later move to ClickHouse without
    changing the public API (see ``apps.issues.store``).
    """

    event_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "organizations.Project", on_delete=models.CASCADE, related_name="events"
    )
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="events")

    # Trace this event belongs to (links errors to performance transactions).
    trace_id = models.CharField(max_length=32, blank=True, db_index=True)

    timestamp = models.DateTimeField(db_index=True)
    # Indexed: usage-by-day aggregation range-scans on ingest time.
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)
    level = models.CharField(max_length=10, choices=Level.choices, default=Level.ERROR)
    platform = models.CharField(max_length=32, blank=True)
    environment = models.CharField(max_length=64, blank=True, db_index=True)
    release = models.CharField(max_length=128, blank=True)
    server_name = models.CharField(max_length=255, blank=True)

    message = models.TextField(blank=True)
    # Normalized interfaces: {"exception": {...}, "request": {...}, "tags": {...}, ...}
    data = models.JSONField(default=dict)

    class Meta:
        indexes = [
            models.Index(fields=["issue", "-timestamp"]),
            models.Index(fields=["project", "-timestamp"]),
        ]
        ordering = ["-timestamp"]


class IssueComment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)


class IssueUser(models.Model):
    """One row per distinct user that has triggered an issue. Backs ``users_seen``
    without scanning every event: a hashed identifier (id/email/username/ip)
    de-duplicates occurrences, so the count of rows == unique affected users."""

    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="seen_users")
    ident = models.CharField(max_length=64)  # sha1 of the user identifier

    class Meta:
        unique_together = [("issue", "ident")]


class IssueExternalIssue(models.Model):
    """A link between an Errora issue and a tracker issue in a connected provider
    (e.g. a GitLab issue), either created from Errora or linked to an existing one."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="external_issues")
    repository = models.ForeignKey(
        "integrations.Repository", on_delete=models.CASCADE, related_name="external_issues"
    )
    provider = models.CharField(max_length=20)  # "gitlab"
    external_id = models.CharField(max_length=64)  # provider issue iid
    title = models.CharField(max_length=512, blank=True)
    web_url = models.URLField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("issue", "repository", "external_id")]
        ordering = ["-created_at"]
