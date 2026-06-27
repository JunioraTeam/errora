"""
Abstract source-control client. The AI auto-fix flow and repo browsing depend
only on this interface, so adding GitHub later means implementing these methods
without touching the ai/issues apps.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class RepoInfo:
    external_id: str
    name: str
    path_with_namespace: str
    web_url: str
    default_branch: str


@dataclass
class MergeRequestResult:
    url: str
    iid: int | str
    source_branch: str


@dataclass
class TrackerIssue:
    iid: str
    title: str
    web_url: str
    state: str = ""


class SourceControlClient(ABC):
    @abstractmethod
    def list_repositories(self) -> list[RepoInfo]: ...

    @abstractmethod
    def get_file(self, repo_external_id: str, path: str, ref: str) -> str: ...

    @abstractmethod
    def create_merge_request(
        self,
        repo_external_id: str,
        *,
        source_branch: str,
        target_branch: str,
        title: str,
        description: str,
        changes: dict[str, str],
    ) -> MergeRequestResult:
        """Create ``source_branch`` off ``target_branch``, commit ``changes``
        ({path: new_content}), and open an MR. Returns the MR result."""

    # --- issue tracker (optional per provider) ----------------------------- //

    def list_issues(
        self, repo_external_id: str, *, search: str = "", state: str = "opened"
    ) -> list[TrackerIssue]:
        raise NotImplementedError

    def create_issue(self, repo_external_id: str, *, title: str, description: str) -> TrackerIssue:
        raise NotImplementedError

    def get_issue(self, repo_external_id: str, iid: str) -> TrackerIssue:
        raise NotImplementedError

    def comment_issue(self, repo_external_id: str, iid: str, body: str) -> None:
        raise NotImplementedError
