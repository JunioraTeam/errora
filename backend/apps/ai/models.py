from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models

from apps.common.fields import EncryptedTextField


class AIProviderType(models.TextChoices):
    OPENAI = "openai", "OpenAI-compatible"
    CLAUDE = "claude", "Claude Agent SDK"
    CURSOR = "cursor", "Cursor Agents SDK"


class AIConfig(models.Model):
    """
    An AI auto-fix *agent*, attachable at organization or project scope. An
    organization can configure multiple agents (e.g. a Claude agent and a Cursor
    agent); project-scoped agents override org-scoped ones. API keys are
    encrypted at rest. Claude/Cursor agents use the user's subscription and need
    no key.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="ai_configs"
    )
    project = models.ForeignKey(
        "organizations.Project",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="ai_configs",
    )
    name = models.CharField(max_length=120, blank=True, help_text="Label for this agent.")
    provider = models.CharField(max_length=20, choices=AIProviderType.choices)
    # base_url lets any OpenAI-compatible endpoint (Azure, OpenRouter, local) be used.
    base_url = models.URLField(blank=True)
    api_key = EncryptedTextField(blank=True)
    model = models.CharField(max_length=120, default="claude-opus-4-8")
    auto_trigger = models.BooleanField(
        default=False, help_text="Automatically open a fix MR on new unique issues."
    )
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Multiple agents per org/project are allowed; agents are ordered newest
        # first so resolution is deterministic.
        ordering = ["-created_at"]


class AutoFixRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        ANALYZING = "analyzing", "Analyzing"
        GENERATING = "generating", "Generating fix"
        CREATING_MR = "creating_mr", "Creating merge request"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    # Statuses that mean a run is still in flight — used to block a second,
    # concurrent auto-fix on the same issue.
    ACTIVE_STATUSES = (
        Status.QUEUED,
        Status.ANALYZING,
        Status.GENERATING,
        Status.CREATING_MR,
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey("issues.Issue", on_delete=models.CASCADE, related_name="autofix_runs")
    provider = models.CharField(max_length=20)
    model = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED)

    explanation = models.TextField(blank=True)
    diff = models.TextField(blank=True)
    mr_url = models.URLField(blank=True)
    branch = models.CharField(max_length=200, blank=True)
    error = models.TextField(blank=True)
    tokens_used = models.PositiveIntegerField(default=0)

    triggered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
