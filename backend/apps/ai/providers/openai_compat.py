"""OpenAI-compatible provider — works with OpenAI, Azure, OpenRouter, local
servers (vLLM/Ollama) by setting ``base_url``."""

from __future__ import annotations

from django.conf import settings

from apps.common.net import validate_external_url

from .base import SYSTEM_PROMPT, AIProvider, FixContext, FixResult


class OpenAICompatProvider(AIProvider):
    def generate_fix(self, context: FixContext) -> FixResult:
        from openai import OpenAI

        # SSRF guard (re-checked at use time): blocks loopback/metadata.
        if self.config.base_url:
            validate_external_url(self.config.base_url, allow_http=True)

        client = OpenAI(
            api_key=self.config.api_key or "sk-none",
            base_url=self.config.base_url or None,
            timeout=settings.AI_REQUEST_TIMEOUT,
        )
        resp = client.chat.completions.create(
            model=self.config.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": context.to_user_prompt()},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        text = resp.choices[0].message.content or "{}"
        tokens = getattr(resp, "usage", None)
        return FixResult.from_model_json(text, tokens=tokens.total_tokens if tokens else 0)
