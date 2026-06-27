from __future__ import annotations

from apps.common.net import safe_post

from .base import Channel, NotificationMessage, render_template


class MattermostChannel(Channel):
    """Post to a Mattermost incoming webhook URL."""

    def send(self, message: NotificationMessage) -> None:
        url = self.config["url"]
        if self.template:
            text = render_template(self.template, message)
        else:
            text = f"**{message.title}**\n{message.body}"
            if message.url:
                text += f"\n[View in Errora]({message.url})"
        payload = {"text": text}
        if self.config.get("channel"):
            payload["channel"] = self.config["channel"]
        if self.config.get("username"):
            payload["username"] = self.config["username"]
        resp = safe_post(url, json=payload)
        resp.raise_for_status()
