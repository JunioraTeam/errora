from __future__ import annotations

from apps.accounts.sms import get_sms_provider

from .base import Channel, NotificationMessage, render_template


class SMSChannel(Channel):
    """Reuses the configured SMS provider (Kavenegar by default)."""

    def send(self, message: NotificationMessage) -> None:
        recipients = self.config.get("to") or []
        provider = get_sms_provider()
        if self.template:
            text = render_template(self.template, message)
        else:
            text = f"Errora: {message.title}"
        for phone in recipients:
            provider.send_text(phone, text)
