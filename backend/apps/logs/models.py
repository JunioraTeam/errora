"""
Structured logs — Errora's analogue of Sentry Logs.

A **LogEntry** is one structured log record: a severity ``level``, a free-text
``body``, and a flat bag of typed ``attributes`` (the log's tags). Logs are a
high-volume, append-only telemetry stream (like transactions) — there is no
grouping; the product is search + filter + tag faceting over recent rows.

Each log may carry a ``trace_id``/``span_id`` so the UI can pivot from a log to
the trace (and the errors/transactions sharing it).
"""

from __future__ import annotations

import uuid

from django.db import models

# Severity ladder (low→high), mirroring Sentry/OTel log levels. ``severity_number``
# follows OTel's 1–24 scale; we keep a coarse per-level mapping.
LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"]
SEVERITY_NUMBER = {"trace": 1, "debug": 5, "info": 9, "warn": 13, "error": 17, "fatal": 21}


class LogEntry(models.Model):
    """A single structured log record."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "organizations.Project", on_delete=models.CASCADE, related_name="logs"
    )

    timestamp = models.DateTimeField(db_index=True)  # when the log was emitted
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)

    level = models.CharField(max_length=16, blank=True, db_index=True)
    severity_number = models.PositiveSmallIntegerField(default=0)
    body = models.TextField(blank=True)

    trace_id = models.CharField(max_length=32, blank=True, db_index=True)
    span_id = models.CharField(max_length=16, blank=True)

    environment = models.CharField(max_length=64, blank=True, db_index=True)
    release = models.CharField(max_length=128, blank=True)

    # Flat {key: value} bag of typed attributes (strings/numbers/bools). This is
    # what the UI tags/filters on. JSONField key lookups (``attributes__foo``)
    # work on Postgres and SQLite, keeping the query layer DB-portable.
    attributes = models.JSONField(default=dict)

    class Meta:
        indexes = [
            models.Index(fields=["project", "-timestamp"]),
            models.Index(fields=["project", "level", "-timestamp"]),
            models.Index(fields=["project", "trace_id"]),
        ]
        ordering = ["-timestamp"]

    def __str__(self) -> str:
        return f"[{self.level}] {self.body[:60]}"
