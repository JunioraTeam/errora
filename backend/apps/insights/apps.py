from __future__ import annotations

from django.apps import AppConfig


class InsightsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.insights"
    label = "insights"

    def ready(self) -> None:
        # Subscribe to performance's transaction_stored signal so we extract the
        # gen_ai / mcp spans of each AI-agent trace into the queryable AiSpan table.
        from . import signals  # noqa: F401
