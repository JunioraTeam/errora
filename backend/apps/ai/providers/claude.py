"""
Claude provider via the **Claude Agent SDK** (``claude-agent-sdk``).

The user supplies their own Anthropic API key on the agent config; it is passed
to the SDK through ``ANTHROPIC_API_KEY`` for the duration of the call. We run a
single, tool-less turn (the relevant source is already in the prompt) and parse
the JSON fix from the final result message.

Docs: https://code.claude.com/docs/en/agent-sdk/overview
"""

from __future__ import annotations

import asyncio
import os

from .base import SYSTEM_PROMPT, AIProvider, FixContext, FixResult


class ClaudeProvider(AIProvider):
    def generate_fix(self, context: FixContext) -> FixResult:
        if not self.config.api_key:
            raise RuntimeError("Claude provider requires an Anthropic API key.")
        return asyncio.run(self._run(context))

    async def _run(self, context: FixContext) -> FixResult:
        from claude_agent_sdk import ClaudeAgentOptions, query

        options = ClaudeAgentOptions(
            model=self.config.model or "claude-opus-4-8",
            system_prompt=SYSTEM_PROMPT,
            # No tools / no local config: the source is supplied in the prompt and
            # we only want the JSON answer back.
            allowed_tools=[],
            setting_sources=[],
        )

        # The SDK authenticates via ANTHROPIC_API_KEY (and optional base URL).
        saved = {k: os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL")}
        os.environ["ANTHROPIC_API_KEY"] = self.config.api_key
        if self.config.base_url:
            from apps.common.net import validate_external_url

            validate_external_url(self.config.base_url, allow_http=True)  # SSRF guard
            os.environ["ANTHROPIC_BASE_URL"] = self.config.base_url
        try:
            text, tokens = "", 0
            async for message in query(prompt=context.to_user_prompt(), options=options):
                result = getattr(message, "result", None)
                if result:
                    text = result
                usage = getattr(message, "usage", None)
                if isinstance(usage, dict):
                    tokens = int(usage.get("input_tokens", 0)) + int(usage.get("output_tokens", 0))
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        return FixResult.from_model_json(text, tokens=tokens)
