"""Channel abstraction. A channel renders + delivers a NotificationMessage.

Add a channel by subclassing and registering in ``channels/__init__.py``."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass

# Default payload template shown in the UI for HTTP webhooks. Users may override
# it per channel; placeholders use ``{{ key }}`` so they never collide with the
# JSON braces around them.
DEFAULT_WEBHOOK_TEMPLATE = (
    "{\n"
    '  "event": "{{ event }}",\n'
    '  "title": "{{ title }}",\n'
    '  "body": "{{ body }}",\n'
    '  "url": "{{ url }}",\n'
    '  "level": "{{ level }}",\n'
    '  "issue_id": "{{ issue_id }}"\n'
    "}"
)

# Default free-text message template for Mattermost/Email/SMS.
DEFAULT_TEXT_TEMPLATE = "{{ title }}\n{{ body }}\n{{ url }}"

_TOKEN_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


@dataclass
class NotificationMessage:
    event_type: str
    title: str
    body: str
    url: str = ""
    payload: dict | None = None

    def template_values(self) -> dict[str, str]:
        """Flat placeholder map available to channel templates."""
        payload = self.payload or {}
        values = {
            "event": self.event_type,
            "event_type": self.event_type,
            "title": self.title,
            "body": self.body,
            "url": self.url,
        }
        for key, val in payload.items():
            values[key] = "" if val is None else str(val)
        return values


def render_template(template: str, message: NotificationMessage) -> str:
    """Substitute ``{{ key }}`` tokens; unknown tokens render as empty strings."""
    values = message.template_values()
    return _TOKEN_RE.sub(lambda m: values.get(m.group(1), ""), template)


class Channel(ABC):
    def __init__(self, model) -> None:
        self.model = model
        self.config = model.config or {}

    @property
    def template(self) -> str:
        """User-provided message/payload template for this channel, if any."""
        return (self.config.get("template") or "").strip()

    @abstractmethod
    def send(self, message: NotificationMessage) -> None: ...
