"""AI provider factory. New providers register here."""

from __future__ import annotations

from ..models import AIConfig, AIProviderType
from .base import AIProvider, FixResult
from .claude import ClaudeProvider
from .cursor import CursorProvider
from .openai_compat import OpenAICompatProvider

__all__ = ["AIProvider", "FixResult", "get_provider"]


def get_provider(config: AIConfig) -> AIProvider:
    mapping = {
        AIProviderType.OPENAI: OpenAICompatProvider,
        AIProviderType.CLAUDE: ClaudeProvider,
        AIProviderType.CURSOR: CursorProvider,
    }
    cls = mapping.get(config.provider)
    if cls is None:
        raise NotImplementedError(f"Unknown AI provider {config.provider}")
    return cls(config)
