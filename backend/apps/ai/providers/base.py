"""
Abstract AI provider. Each provider receives a structured fix request (the
exception, its stacktrace, and relevant source files) and returns a FixResult
with proposed file contents + a human explanation. The orchestrator turns that
into a GitLab merge request.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

SYSTEM_PROMPT = (
    "You are an expert software engineer fixing a production exception. "
    "You are given the error, its stack trace, and the current contents of the "
    "relevant source files. Produce a minimal, correct fix. Respond with STRICT "
    "JSON only, matching this schema:\n"
    '{"explanation": "<what was wrong and how this fixes it>", '
    '"files": [{"path": "<repo-relative path>", "content": "<full new file content>"}]}'
    "\nReturn the COMPLETE new content for each changed file. Do not include files "
    "you did not change. Do not wrap the JSON in markdown fences."
)


@dataclass
class FixContext:
    issue_title: str
    culprit: str
    level: str
    platform: str
    stacktrace_text: str
    source_files: dict[str, str] = field(default_factory=dict)  # path -> content

    def to_user_prompt(self) -> str:
        files = "\n\n".join(
            f"### FILE: {path}\n```\n{content}\n```" for path, content in self.source_files.items()
        )
        return (
            f"Exception: {self.issue_title}\n"
            f"Culprit: {self.culprit}\n"
            f"Platform: {self.platform}  Level: {self.level}\n\n"
            f"Stack trace:\n{self.stacktrace_text}\n\n"
            f"Relevant source files:\n{files or '(none retrieved)'}\n\n"
            "Return the JSON fix now."
        )


@dataclass
class FixResult:
    explanation: str
    changes: dict[str, str]  # path -> new content
    tokens_used: int = 0

    @classmethod
    def from_model_json(cls, text: str, tokens: int = 0) -> FixResult:
        text = text.strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            text = text[4:] if text.startswith("json") else text
        payload = json.loads(text)
        changes = {f["path"]: f["content"] for f in payload.get("files", [])}
        return cls(explanation=payload.get("explanation", ""), changes=changes, tokens_used=tokens)


class AIProvider(ABC):
    def __init__(self, config) -> None:
        self.config = config

    @abstractmethod
    def generate_fix(self, context: FixContext) -> FixResult: ...
