"""Provider client factory."""

from __future__ import annotations

from ..models import Integration, Provider
from .base import SourceControlClient
from .gitlab import GitLabClient


def get_client(integration: Integration) -> SourceControlClient:
    if integration.provider == Provider.GITLAB:
        return GitLabClient(integration)
    raise NotImplementedError(f"No client for provider {integration.provider}")
