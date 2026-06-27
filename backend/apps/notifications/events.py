"""Canonical event types alert rules can subscribe to."""

from __future__ import annotations

from django.db import models


class EventType(models.TextChoices):
    ISSUE_CREATED = "issue.created", "New unique exception type"
    EVENT_RECEIVED = "event.received", "New exception (any event)"
    ISSUE_REGRESSED = "issue.regressed", "Issue regressed"
    AUTOFIX_STARTED = "autofix.started", "AI auto-fix started"
    AUTOFIX_MR_CREATED = "autofix.mr_created", "AI auto-fix MR created"
    AUTOFIX_FAILED = "autofix.failed", "AI auto-fix failed"
