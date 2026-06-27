from __future__ import annotations

import uuid

from django.db import models

from apps.common.fields import EncryptedTextField


class Provider(models.TextChoices):
    GITLAB = "gitlab", "GitLab (self-hosted or SaaS)"
    GITHUB = "github", "GitHub"  # scaffolded for future


class Integration(models.Model):
    """
    A connection from an organization to a source-control provider. The access
    token is encrypted at rest. New providers (GitHub, Bitbucket) plug in by
    adding a client under ``clients/`` and a Provider choice.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="integrations"
    )
    provider = models.CharField(max_length=20, choices=Provider.choices)
    name = models.CharField(max_length=120, blank=True)
    # Self-hosted GitLab base URL, e.g. https://gitlab.mycorp.ir
    base_url = models.URLField(default="https://gitlab.com")
    access_token = EncryptedTextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.get_provider_display()} @ {self.organization_id}"


class Repository(models.Model):
    """A repo selectable as a project's source. Mirrors minimal provider data."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    integration = models.ForeignKey(
        Integration, on_delete=models.CASCADE, related_name="repositories"
    )
    external_id = models.CharField(max_length=64)  # provider's numeric/global id
    name = models.CharField(max_length=255)
    path_with_namespace = models.CharField(max_length=512)
    web_url = models.URLField(blank=True)
    default_branch = models.CharField(max_length=120, default="main")

    class Meta:
        unique_together = [("integration", "external_id")]
        verbose_name_plural = "repositories"

    def __str__(self) -> str:
        return self.path_with_namespace
