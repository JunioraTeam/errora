"""Subscribe to ``performance.transaction_stored`` and project AI/MCP spans."""

from __future__ import annotations

import logging

from django.db import transaction
from django.dispatch import receiver

from apps.performance.signals import transaction_stored

from .extract import _likely_ai, extract_ai_spans

logger = logging.getLogger(__name__)


@receiver(transaction_stored, dispatch_uid="insights.extract_ai_spans")
def _on_transaction_stored(sender, *, project, data, event_id, **kwargs) -> None:
    # Most transactions are ordinary HTTP/db traces with no AI spans — skip the
    # savepoint entirely for them (cheap op-scan, no SQL).
    if not _likely_ai(data):
        return
    # Best-effort: AI projection must never break the ingest pipeline. The signal
    # fires inside store_transaction's atomic block, so run extraction in a
    # savepoint — a failure here rolls back only the AI spans, not the stored
    # transaction, and (crucially on Postgres) doesn't poison the outer txn.
    try:
        with transaction.atomic():
            extract_ai_spans(project, data, event_id)
    except Exception:  # noqa: BLE001
        logger.exception("insights: failed to extract AI spans for trace %s", event_id)
