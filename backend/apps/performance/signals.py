"""
Domain signals emitted by the performance app. Cross-app subscribers (e.g.
``apps.insights``, which projects AI/MCP spans out of a stored trace) wire up in
their ``AppConfig.ready()`` — see AGENTS.md: cross-app side effects go through
signals, not direct imports.
"""

from __future__ import annotations

from django.dispatch import Signal

# Fired after a transaction (trace) has been normalized + stored.
# kwargs: project, data (normalized transaction dict), event_id (str)
transaction_stored = Signal()
