"""Notification channel factory."""

from __future__ import annotations

from ..models import ChannelType, NotificationChannel
from .base import Channel
from .email import EmailChannel
from .mattermost import MattermostChannel
from .sms import SMSChannel
from .webhook import WebhookChannel

_REGISTRY: dict[str, type[Channel]] = {
    ChannelType.WEBHOOK: WebhookChannel,
    ChannelType.MATTERMOST: MattermostChannel,
    ChannelType.EMAIL: EmailChannel,
    ChannelType.SMS: SMSChannel,
}


def get_channel(channel: NotificationChannel) -> Channel:
    cls = _REGISTRY.get(channel.type)
    if cls is None:
        raise NotImplementedError(f"Unknown channel type {channel.type}")
    return cls(channel)
