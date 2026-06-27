"""
Cursor provider via the **Cursor Python SDK** (``cursor-sdk``).

The user supplies their own Cursor API key on the agent config; it is passed to
the SDK through ``CURSOR_API_KEY``. We run a one-shot prompt in a throwaway
working directory (we only want the JSON fix text back, not on-disk edits) and
parse the JSON fix from the result.

Docs: https://cursor.com/docs/sdk/python
"""

from __future__ import annotations

import tempfile

from .base import SYSTEM_PROMPT, AIProvider, FixContext, FixResult


class CursorProvider(AIProvider):
    DEFAULT_MODEL = "composer-2.5"

    def generate_fix(self, context: FixContext) -> FixResult:
        if not self.config.api_key:
            raise RuntimeError("Cursor provider requires a Cursor API key.")

        from cursor_sdk import Agent, AgentOptions, LocalAgentOptions

        # Cursor has no separate system-prompt field for one-shot prompts, so the
        # JSON-only instructions are prepended to the user prompt. We run in a
        # throwaway working directory — we only want the JSON fix text back.
        prompt = f"{SYSTEM_PROMPT}\n\n{context.to_user_prompt()}"
        with tempfile.TemporaryDirectory() as workdir:
            result = Agent.prompt(
                prompt,
                AgentOptions(
                    model=self.config.model or self.DEFAULT_MODEL,
                    api_key=self.config.api_key,
                    local=LocalAgentOptions(cwd=workdir),
                ),
            )

        text = getattr(result, "result", None) or str(result)
        return FixResult.from_model_json(text)
