"""
Transaction storage & grouping. ``store_transaction`` is the single entry point
the ingest pipeline calls after a transaction payload has been normalized. It
upserts the (project, fingerprint) group atomically — like ``store_event`` — so
concurrent workers don't lose counts.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import Transaction, TransactionGroup
from .signals import transaction_stored


def _fingerprint(name: str, op: str) -> str:
    return hashlib.sha1(f"{name}|{op}".encode()).hexdigest()


def _start_dt(data: dict[str, Any]) -> datetime:
    start = data.get("start_timestamp")
    if isinstance(start, (int, float)):
        return datetime.fromtimestamp(start, tz=UTC)
    return timezone.now()


@transaction.atomic
def store_transaction(project, data: dict[str, Any]) -> dict[str, Any]:
    name = data["name"]
    op = data.get("op", "")
    fp = _fingerprint(name, op)
    ts = _start_dt(data)

    group, created = TransactionGroup.objects.select_for_update().get_or_create(
        project=project,
        fingerprint=fp,
        defaults={"name": name, "op": op, "first_seen": ts, "last_seen": ts, "times_seen": 0},
    )
    group.times_seen = F("times_seen") + 1
    group.last_seen = ts if created else max(group.last_seen, ts)
    group.save(update_fields=["times_seen", "last_seen"])

    txn = Transaction.objects.create(
        project=project,
        group=group,
        trace_id=data.get("trace_id", ""),
        span_id=data.get("span_id", ""),
        name=name,
        op=op,
        status=data.get("status", ""),
        duration_ms=data.get("duration_ms", 0.0),
        timestamp=ts,
        environment=data.get("environment", ""),
        release=data.get("release", ""),
        platform=data.get("platform", ""),
        spans=data.get("spans", []),
        data=data.get("data", {}),
    )

    # Fire inside the atomic block so subscribers (e.g. apps.insights projecting
    # AI/MCP spans) write within this same transaction — one SQLite writer-lock
    # acquisition per ingested trace instead of two. Subscribers must be
    # best-effort (swallow their own errors) so they can't roll back the store.
    transaction_stored.send(
        sender=None, project=project, data=data, event_id=str(txn.event_id)
    )
    return {"event_id": str(txn.event_id), "group": str(group.id), "trace_id": txn.trace_id}
