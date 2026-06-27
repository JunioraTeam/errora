"""
Log storage. ``store_logs`` is the single entry point the ingest pipeline calls
after a batch of log items has been normalized. Logs arrive in batches (one
envelope item carries many records), so we ``bulk_create`` for throughput.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from django.utils import timezone

from .models import LogEntry

# Hard cap on a single batch so a malformed/huge envelope can't blow up memory.
MAX_BATCH = 1000


def _ts(value: Any) -> datetime:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=UTC)
    return timezone.now()


def store_logs(project, items: list[dict[str, Any]]) -> int:
    """Bulk-insert a batch of normalized log dicts. Returns the count stored."""
    rows = [
        LogEntry(
            project=project,
            timestamp=_ts(it.get("timestamp")),
            level=it.get("level", ""),
            severity_number=it.get("severity_number", 0),
            body=it.get("body", ""),
            trace_id=it.get("trace_id", ""),
            span_id=it.get("span_id", ""),
            environment=it.get("environment", ""),
            release=it.get("release", ""),
            attributes=it.get("attributes", {}),
        )
        for it in items[:MAX_BATCH]
    ]
    if not rows:
        return 0
    LogEntry.objects.bulk_create(rows, batch_size=500)
    return len(rows)
