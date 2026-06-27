"""Notification delivery tasks (routed to the ``notifications`` queue)."""

from __future__ import annotations

import logging

from celery import shared_task

from .channels import get_channel
from .channels.base import NotificationMessage
from .models import AlertRule, NotificationLog

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=5)
def deliver_notification(self, rule_id: str, message: dict) -> str:
    rule = AlertRule.objects.select_related("channel").filter(id=rule_id, enabled=True).first()
    if rule is None:
        return "rule-missing"

    msg = NotificationMessage(
        event_type=message["event_type"],
        title=message["title"],
        body=message["body"],
        url=message.get("url", ""),
        payload=message.get("payload"),
    )
    try:
        get_channel(rule.channel).send(msg)
    except Exception as exc:  # noqa: BLE001
        NotificationLog.objects.create(
            rule=rule,
            channel_type=rule.channel.type,
            event_type=msg.event_type,
            success=False,
            detail=str(exc)[:2000],
            message=message,
        )
        # Exponential backoff: 10s, 20s, 40s, 80s, 160s.
        countdown = 10 * (2**self.request.retries)
        raise self.retry(exc=exc, countdown=countdown) from exc
    NotificationLog.objects.create(
        rule=rule,
        channel_type=rule.channel.type,
        event_type=msg.event_type,
        success=True,
        message=message,
    )
    return "delivered"
