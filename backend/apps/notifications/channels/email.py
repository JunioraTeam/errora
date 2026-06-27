from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail

from .base import Channel, NotificationMessage, render_template


class EmailChannel(Channel):
    def send(self, message: NotificationMessage) -> None:
        recipients = self.config.get("to") or []
        if not recipients:
            return
        if self.template:
            body = render_template(self.template, message)
        else:
            body = message.body + (f"\n\n{message.url}" if message.url else "")
        send_mail(
            subject=f"[Errora] {message.title}",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=recipients,
        )
