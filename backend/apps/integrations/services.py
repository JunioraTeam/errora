from __future__ import annotations

from django.db import transaction

from .clients import get_client
from .models import Integration, Repository


@transaction.atomic
def sync_repositories(integration: Integration) -> list[Repository]:
    """Pull the repo list from the provider and upsert local mirrors."""
    client = get_client(integration)
    repos = []
    for info in client.list_repositories():
        repo, _ = Repository.objects.update_or_create(
            integration=integration,
            external_id=info.external_id,
            defaults={
                "name": info.name,
                "path_with_namespace": info.path_with_namespace,
                "web_url": info.web_url,
                "default_branch": info.default_branch,
            },
        )
        repos.append(repo)
    return repos
