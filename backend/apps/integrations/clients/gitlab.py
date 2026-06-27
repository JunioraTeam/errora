"""
GitLab client (works against self-hosted instances via ``base_url``). Wraps
python-gitlab. Used for repo selection and for the AI auto-fix flow that opens
merge requests.
"""

from __future__ import annotations

import gitlab

from apps.common.net import validate_external_url

from ..models import Integration
from .base import MergeRequestResult, RepoInfo, SourceControlClient, TrackerIssue


class GitLabClient(SourceControlClient):
    def __init__(self, integration: Integration) -> None:
        self.integration = integration
        # SSRF guard: re-validate at use time (the stored token is sent here).
        validate_external_url(integration.base_url, allow_http=True)
        self.gl = gitlab.Gitlab(
            url=integration.base_url,
            private_token=integration.access_token,
            timeout=30,
        )

    def list_repositories(self) -> list[RepoInfo]:
        projects = self.gl.projects.list(membership=True, all=False, per_page=100, iterator=True)
        out: list[RepoInfo] = []
        for p in projects:
            out.append(
                RepoInfo(
                    external_id=str(p.id),
                    name=p.name,
                    path_with_namespace=p.path_with_namespace,
                    web_url=p.web_url,
                    default_branch=getattr(p, "default_branch", "main") or "main",
                )
            )
        return out

    def get_file(self, repo_external_id: str, path: str, ref: str) -> str:
        project = self.gl.projects.get(repo_external_id)
        f = project.files.get(file_path=path, ref=ref)
        return f.decode().decode("utf-8", "replace")

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
        project = self.gl.projects.get(repo_external_id)
        # Create the working branch off the target.
        project.branches.create({"branch": source_branch, "ref": target_branch})

        actions = []
        for path, content in changes.items():
            # Decide create vs update by probing existence.
            try:
                project.files.get(file_path=path, ref=source_branch)
                action = "update"
            except gitlab.exceptions.GitlabGetError:
                action = "create"
            actions.append({"action": action, "file_path": path, "content": content})

        project.commits.create(
            {
                "branch": source_branch,
                "commit_message": title,
                "actions": actions,
            }
        )
        mr = project.mergerequests.create(
            {
                "source_branch": source_branch,
                "target_branch": target_branch,
                "title": title,
                "description": description,
                "remove_source_branch": True,
            }
        )
        return MergeRequestResult(url=mr.web_url, iid=mr.iid, source_branch=source_branch)

    # --- issue tracker ----------------------------------------------------- //

    @staticmethod
    def _issue(i) -> TrackerIssue:
        return TrackerIssue(
            iid=str(i.iid),
            title=i.title,
            web_url=i.web_url,
            state=getattr(i, "state", "") or "",
        )

    def list_issues(
        self, repo_external_id: str, *, search: str = "", state: str = "opened"
    ) -> list[TrackerIssue]:
        project = self.gl.projects.get(repo_external_id)
        kwargs = {"per_page": 20, "order_by": "updated_at"}
        if state:
            kwargs["state"] = state
        if search:
            kwargs["search"] = search
        return [self._issue(i) for i in project.issues.list(**kwargs)]

    def create_issue(self, repo_external_id: str, *, title: str, description: str) -> TrackerIssue:
        project = self.gl.projects.get(repo_external_id)
        issue = project.issues.create({"title": title, "description": description})
        return self._issue(issue)

    def get_issue(self, repo_external_id: str, iid: str) -> TrackerIssue:
        project = self.gl.projects.get(repo_external_id)
        return self._issue(project.issues.get(iid))

    def comment_issue(self, repo_external_id: str, iid: str, body: str) -> None:
        project = self.gl.projects.get(repo_external_id)
        project.issues.get(iid).notes.create({"body": body})
