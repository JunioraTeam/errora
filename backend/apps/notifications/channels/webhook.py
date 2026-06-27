from __future__ import annotations

import hashlib
import hmac
import json

from apps.common.net import safe_post

from .base import Channel, NotificationMessage, render_template


class WebhookChannel(Channel):
    """POST a JSON payload; optionally HMAC-sign it with the channel secret.

    When the channel defines a payload template, the rendered template is sent
    verbatim as the request body; otherwise a default JSON envelope is used."""

    def send(self, message: NotificationMessage) -> None:
        url = self.config["url"]
        if self.template:
            body = render_template(self.template, message).encode()
        else:
            body = json.dumps(
                {
                    "event": message.event_type,
                    "title": message.title,
                    "body": message.body,
                    "url": message.url,
                    "data": message.payload or {},
                }
            ).encode()
        headers = {"Content-Type": "application/json", "User-Agent": "Errora-Webhook/1.0"}
        if self.model.secret:
            sig = hmac.new(self.model.secret.encode(), body, hashlib.sha256).hexdigest()
            headers["X-Errora-Signature"] = f"sha256={sig}"
        resp = safe_post(url, content=body, headers=headers)
        resp.raise_for_status()
