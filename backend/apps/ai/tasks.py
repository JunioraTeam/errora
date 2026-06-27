"""Auto-fix Celery tasks (routed to the dedicated ``ai`` queue)."""

from __future__ import annotations

import logging

from celery import shared_task

from .models import AutoFixRun
from .services import run_autofix

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=1, acks_late=True)
def run_autofix_task(self, run_id: str) -> str:
    try:
        run = AutoFixRun.objects.select_related("issue", "issue__project").get(id=run_id)
    except AutoFixRun.DoesNotExist:
        logger.warning("run_autofix_task: run %s missing", run_id)
        return "missing"
    run_autofix(run)
    return run.status


@shared_task(ignore_result=True)
def maybe_auto_trigger(issue_id: str) -> None:
    """Open a fix MR automatically when the project's AI config opts in."""
    from apps.issues.models import Issue

    from .services import resolve_config

    issue = Issue.objects.select_related("project").filter(id=issue_id).first()
    if not issue:
        return
    # Skip if a fix is already queued/running for this issue (avoids double-fix).
    if issue.autofix_runs.filter(status__in=AutoFixRun.ACTIVE_STATUSES).exists():
        return
    config = resolve_config(issue.project)
    if config and config.auto_trigger:
        run = AutoFixRun.objects.create(issue=issue, provider=config.provider, model=config.model)
        run_autofix_task.delay(str(run.id))
