"""
Event storage & issue aggregation. ``store_event`` is the single entry point
the ingest pipeline calls after a payload has been normalized. It is written to
be idempotent-ish and concurrency-safe: the (project, primary_hash) unique
constraint plus an atomic upsert lets many workers ingest the same group
concurrently without losing counts.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from .grouping import compute_grouping, derive_metadata
from .models import Event, Issue, IssueExternalIssue, IssueHash, IssueStatus, IssueUser
from .signals import event_stored, issue_created, issue_regressed
from .store import get_event_store


def _user_ident(data: dict[str, Any]) -> str | None:
    """A stable identifier for the affected user, preferring id > email >
    username > ip. Returns ``None`` when the event carries no user context."""
    user = data.get("user") or {}
    if not isinstance(user, dict):
        return None
    for key in ("id", "email", "username", "ip_address"):
        val = user.get(key)
        if val:
            return hashlib.sha1(f"{key}:{val}".encode()).hexdigest()
    return None


def _record_user(issue: Issue, data: dict[str, Any]) -> None:
    """Increment ``users_seen`` only the first time we see a given user for an
    issue (de-duplicated via the ``IssueUser`` table)."""
    ident = _user_ident(data)
    if not ident:
        return
    # Savepoint so a unique-constraint race (two workers, same new user) can't
    # poison the surrounding store_event transaction on Postgres.
    try:
        with transaction.atomic():
            _, created = IssueUser.objects.get_or_create(issue=issue, ident=ident)
    except IntegrityError:
        created = False
    if created:
        Issue.objects.filter(pk=issue.pk).update(users_seen=F("users_seen") + 1)


def _parse_ts(raw: Any) -> datetime:
    if isinstance(raw, (int, float)):
        return datetime.fromtimestamp(raw, tz=UTC)
    if isinstance(raw, str):
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            pass
    return timezone.now()


@transaction.atomic
def store_event(project, data: dict[str, Any]) -> Event:
    # Resolve minified JS frames against uploaded source maps before grouping, so
    # issues group on the stable original frames (not per-build minified names).
    from apps.sourcemaps.symbolicate import symbolicate_event

    symbolicate_event(project, data)

    primary_hash, components = compute_grouping(data)
    # Expose how this event was grouped (Sentry's "Event grouping information").
    data["_grouping"] = {
        "hash": primary_hash,
        "config": "errora.exception:stacktrace+type",
        "components": [str(c)[:200] for c in components[:100]],
    }
    meta = derive_metadata(data)
    ts = _parse_ts(data.get("timestamp"))
    level = data.get("level", "error")

    issue, created = Issue.objects.select_for_update().get_or_create(
        project=project,
        primary_hash=primary_hash,
        defaults={
            **meta,
            "level": level,
            "platform": data.get("platform", ""),
            "first_seen": ts,
            "last_seen": ts,
            "times_seen": 0,
        },
    )

    regressed = False
    if created:
        IssueHash.objects.get_or_create(project=project, hash=primary_hash, issue=issue)
    else:
        if issue.status == IssueStatus.RESOLVED:
            issue.status = IssueStatus.UNRESOLVED
            regressed = True

    issue.times_seen = F("times_seen") + 1
    issue.last_seen = max(issue.last_seen, ts) if not created else ts
    if regressed:
        issue.save(update_fields=["times_seen", "last_seen", "status"])
    else:
        issue.save(update_fields=["times_seen", "last_seen"])
    issue.refresh_from_db(fields=["times_seen"])

    # Track unique affected users (drives the "N users" count on the issue page).
    _record_user(issue, data)

    # Link the event to its trace (for the performance product) when present.
    trace_id = ((data.get("contexts") or {}).get("trace") or {}).get("trace_id") or ""

    # Events go through the pluggable store (OLTP Event table or ClickHouse).
    event = get_event_store().write(
        project=project,
        issue=issue,
        fields={
            "trace_id": str(trace_id)[:32],
            "timestamp": ts,
            "level": level,
            "platform": data.get("platform", ""),
            "environment": data.get("environment", ""),
            "release": data.get("release", ""),
            "server_name": data.get("server_name", ""),
            "message": meta["value"] or data.get("message", ""),
            "data": data,
        },
    )

    # Fan out domain signals after commit. Subscribers only use ``issue``; the
    # ``event`` dict is passed through for completeness.
    def _dispatch():
        if created:
            issue_created.send(sender=Issue, issue=issue, event=event)
        if regressed:
            issue_regressed.send(sender=Issue, issue=issue, event=event)
        event_stored.send(sender=Event, issue=issue, event=event, is_new_issue=created)

    transaction.on_commit(_dispatch)
    return event


# --- external issue tracker (GitLab) ------------------------------------- //


def org_repositories(organization) -> list:
    """Repositories reachable from an organization's active integrations."""
    from apps.integrations.models import Repository

    return list(
        Repository.objects.select_related("integration").filter(
            integration__organization=organization,
            integration__is_active=True,
        )
    )


def resolve_repository(organization, repository_id):
    from apps.integrations.models import Repository

    return (
        Repository.objects.select_related("integration")
        .filter(
            integration__organization=organization,
            integration__is_active=True,
            id=repository_id,
        )
        .first()
    )


def search_tracker_issues(repository, query: str) -> list[dict]:
    from apps.integrations.clients import get_client

    client = get_client(repository.integration)
    return [vars(i) for i in client.list_issues(repository.external_id, search=query)]


def _store_external_link(issue, repository, tracker_issue, user) -> IssueExternalIssue:
    link, _ = IssueExternalIssue.objects.update_or_create(
        issue=issue,
        repository=repository,
        external_id=str(tracker_issue.iid),
        defaults={
            "provider": repository.integration.provider,
            "title": tracker_issue.title,
            "web_url": tracker_issue.web_url,
            "created_by": user,
        },
    )
    return link


def create_tracker_issue(issue, repository, *, title, description, user) -> IssueExternalIssue:
    from apps.integrations.clients import get_client

    client = get_client(repository.integration)
    ti = client.create_issue(repository.external_id, title=title, description=description)
    return _store_external_link(issue, repository, ti, user)


def link_tracker_issue(issue, repository, *, external_id, comment, user) -> IssueExternalIssue:
    from apps.integrations.clients import get_client

    client = get_client(repository.integration)
    ti = client.get_issue(repository.external_id, str(external_id))
    if comment:
        client.comment_issue(repository.external_id, str(external_id), comment)
    return _store_external_link(issue, repository, ti, user)


@transaction.atomic
def merge_issues(target: Issue, sources: list[Issue]) -> Issue:
    """Fold ``sources`` into ``target``: reassign their secondary hashes + events,
    combine counters/timestamps, then delete the sources."""
    store = get_event_store()
    source_ids = [s.id for s in sources]

    IssueHash.objects.filter(issue_id__in=source_ids).update(issue=target)
    store.reassign_events(source_ids, target.id)

    # Re-point distinct-user rows to the target (dropping idents it already has),
    # so users_seen is a true union — not max() — and future events from a
    # source's user still de-duplicate correctly.
    seen = set(IssueUser.objects.filter(issue=target).values_list("ident", flat=True))
    IssueUser.objects.filter(issue_id__in=source_ids, ident__in=seen).delete()
    IssueUser.objects.filter(issue_id__in=source_ids).update(issue=target)

    for s in sources:
        target.times_seen += s.times_seen
        target.first_seen = min(target.first_seen, s.first_seen)
        target.last_seen = max(target.last_seen, s.last_seen)
    target.users_seen = IssueUser.objects.filter(issue=target).count()

    Issue.objects.filter(id__in=source_ids).delete()
    target.save(update_fields=["times_seen", "users_seen", "first_seen", "last_seen"])
    return target
