"""
Performance monitoring data model — Sentry-style transactions & spans.

A **TransactionGroup** is the performance analogue of an issue: many transaction
occurrences sharing the same (name, op) are grouped so we can show aggregate
throughput / latency percentiles / failure rate. A **Transaction** is a single
occurrence (one trace's root transaction) carrying its span tree for the
waterfall view.

Like events, transactions are the high-volume rows; aggregates are computed in
Python over a bounded recent sample so the percentile math stays DB-portable
(Postgres has ``percentile_cont`` but SQLite/MySQL do not).
"""

from __future__ import annotations

import uuid

from django.db import models

# Trace statuses that do NOT count as failures (mirrors Sentry's
# ``NON_FAILURE_STATUS``); an empty status is treated as success.
NON_FAILURE_STATUS = {"ok", "cancelled", "unknown", ""}


class TransactionGroup(models.Model):
    """A grouped set of transactions sharing a (name, op) fingerprint."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "organizations.Project", on_delete=models.CASCADE, related_name="transaction_groups"
    )
    fingerprint = models.CharField(max_length=64)
    name = models.CharField(max_length=512)
    op = models.CharField(max_length=64, blank=True)

    times_seen = models.PositiveIntegerField(default=0)
    first_seen = models.DateTimeField()
    last_seen = models.DateTimeField()

    class Meta:
        unique_together = [("project", "fingerprint")]
        indexes = [
            models.Index(fields=["project", "-last_seen"]),
            models.Index(fields=["project", "-times_seen"]),
        ]
        ordering = ["-last_seen"]

    def __str__(self) -> str:
        return f"{self.op} {self.name}".strip()


class Transaction(models.Model):
    """A single transaction occurrence (one trace root + its spans)."""

    event_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "organizations.Project", on_delete=models.CASCADE, related_name="transactions"
    )
    group = models.ForeignKey(
        TransactionGroup, on_delete=models.CASCADE, related_name="transactions"
    )

    trace_id = models.CharField(max_length=32, blank=True, db_index=True)
    span_id = models.CharField(max_length=16, blank=True)  # root span id
    name = models.CharField(max_length=512)  # denormalized transaction name
    op = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=32, blank=True)  # trace status
    duration_ms = models.FloatField(default=0.0)

    timestamp = models.DateTimeField(db_index=True)  # start time
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)
    environment = models.CharField(max_length=64, blank=True, db_index=True)
    release = models.CharField(max_length=128, blank=True)
    platform = models.CharField(max_length=32, blank=True)

    # Normalized span tree: list of {span_id, parent_span_id, op, description,
    # status, start_ms (offset from txn start), duration_ms}.
    spans = models.JSONField(default=list)
    # Extra context: {tags, measurements, contexts}.
    data = models.JSONField(default=dict)

    class Meta:
        indexes = [
            models.Index(fields=["group", "-timestamp"]),
            models.Index(fields=["project", "-timestamp"]),
        ]
        ordering = ["-timestamp"]

    @property
    def is_failed(self) -> bool:
        return self.status not in NON_FAILURE_STATUS
