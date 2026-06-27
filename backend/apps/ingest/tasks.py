"""
Async ingestion pipeline. The HTTP endpoint enqueues raw payloads here so the
request path stays fast; this worker normalizes, stores, groups and meters.

Routed to the dedicated ``ingest`` Celery queue (see settings) so slow AI jobs
never starve event processing.
"""

from __future__ import annotations

import logging

from celery import shared_task

from apps.issues.services import store_event
from apps.organizations.models import Project

from .normalize import normalize_event, normalize_logs, normalize_transaction

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    acks_late=True,
)
def process_event(self, project_id: str, raw: dict) -> str | None:
    try:
        project = Project.objects.select_related("organization").get(id=project_id)
    except Project.DoesNotExist:
        logger.warning("process_event: project %s gone, dropping", project_id)
        return None

    data = normalize_event(raw)
    event = store_event(project, data)  # dict (event store may be OLTP or ClickHouse)

    # Meter usage for billing/quota (best-effort; never block ingestion).
    try:
        from apps.billing.services import record_event_usage

        record_event_usage(project, count=1)
    except Exception:  # noqa: BLE001
        logger.exception("usage metering failed for project %s", project_id)

    return event["event_id"]


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    acks_late=True,
)
def process_transaction(self, project_id: str, raw: dict) -> str | None:
    """Normalize + group a performance transaction (separate from error events;
    transactions are not metered against the event quota)."""
    try:
        project = Project.objects.select_related("organization").get(id=project_id)
    except Project.DoesNotExist:
        logger.warning("process_transaction: project %s gone, dropping", project_id)
        return None

    from apps.performance.services import store_transaction

    data = normalize_transaction(raw)
    result = store_transaction(project, data)
    return result["event_id"]


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    acks_late=True,
)
def process_logs(self, project_id: str, raw: dict) -> int:
    """Normalize + bulk-store a batch of structured logs (one ``log`` envelope
    item carries many records). Logs are not metered against the event quota."""
    try:
        project = Project.objects.select_related("organization").get(id=project_id)
    except Project.DoesNotExist:
        logger.warning("process_logs: project %s gone, dropping", project_id)
        return 0

    from apps.logs.services import store_logs

    items = normalize_logs(raw)
    return store_logs(project, items)
