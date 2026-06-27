from __future__ import annotations

import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.text import slugify

from .roles import Role


class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL, through="Membership", related_name="organizations"
    )
    # Org-level data retention override (days). NULL = inherit the plan's
    # retention, falling back to DATA_RETENTION_DAYS_DEFAULT. Owners/admins set it.
    retention_days = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name) or "org"
            slug, i = base, 1
            while Organization.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                i += 1
                slug = f"{base}-{i}"
            self.slug = slug
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.name


class Membership(models.Model):
    """A user's role within an organization."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("organization", "user")]

    def __str__(self) -> str:
        return f"{self.user} @ {self.organization} ({self.role})"


class Project(models.Model):
    class Platform(models.TextChoices):
        PYTHON = "python", "Python"
        PHP = "php", "PHP"
        LARAVEL = "php-laravel", "Laravel"
        NODE = "node", "Node.js"
        JAVASCRIPT = "javascript", "JavaScript"
        GO = "go", "Go"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="projects"
    )
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140)
    platform = models.CharField(max_length=20, choices=Platform.choices, default=Platform.OTHER)
    # Link to the source repo (set when a GitLab/GitHub integration is attached).
    repository = models.ForeignKey(
        "integrations.Repository",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="projects",
    )
    # Fraction of incoming events to store (0..1). 1.0 = keep everything.
    sample_rate = models.FloatField(default=1.0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("organization", "slug")]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name) or "project"
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.organization.slug}/{self.slug}"


class ProjectMembership(models.Model):
    """Optional per-project role override (project-scoped RBAC)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    role = models.CharField(max_length=20, choices=Role.choices)

    class Meta:
        unique_together = [("project", "user")]


def _gen_key() -> str:
    return secrets.token_hex(16)


class ProjectKey(models.Model):
    """A DSN credential for an SDK to send events to a project."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="keys")
    label = models.CharField(max_length=80, default="default")
    public_key = models.CharField(max_length=64, unique=True, default=_gen_key)
    secret_key = models.CharField(max_length=64, default=_gen_key)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def dsn(self, ingest_host: str | None = None) -> str:
        host = ingest_host or settings.SITE_URL.split("://", 1)[-1]
        scheme = "https" if settings.SITE_URL.startswith("https") else "http"
        return f"{scheme}://{self.public_key}@{host}/{self.project_id}"


class OrganizationInvite(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="invites")
    email = models.EmailField()
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)
    token = models.CharField(max_length=64, unique=True, default=_gen_key)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("organization", "email")]

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at
