"""
DSN-based authentication for the ingestion endpoint, compatible with the
**official Sentry SDKs** (no custom SDK required). SDKs authenticate with the
DSN public key, supplied via any of:

* the ``X-Sentry-Auth`` header — ``Sentry sentry_version=7, sentry_key=<KEY>, …``
  (server SDKs: Python, Node, PHP/Laravel, Ruby, Go, Java, …), or
* the ``?sentry_key=`` query string (browser JS SDK, to skip a CORS preflight), or
* the ``dsn`` field of an envelope header (tunnelled/relayed envelopes).

The DSN itself (``scheme://<public_key>@<host>/<project_id>``) is already
Sentry-shaped, so pointing any Sentry SDK's ``dsn`` at an Errora project key
just works.

The project-key lookup is cached in Redis so the hot ingest path avoids a DB
round-trip per event.
"""

from __future__ import annotations

import re

from django.core.cache import cache

from apps.organizations.models import ProjectKey

_KEY_RE = re.compile(r"sentry_key=([0-9a-fA-F]+)")
_CACHE_TTL = 60


def extract_public_key(request) -> str | None:
    """Pull the DSN public key from a Sentry SDK request (header or query)."""
    header = request.headers.get("X-Sentry-Auth", "")
    if header:
        m = _KEY_RE.search(header)
        if m:
            return m.group(1)
    return request.GET.get("sentry_key")


def public_key_from_dsn(dsn: str | None) -> str | None:
    """Extract the public key from a full DSN (``scheme://<key>@host/<id>``)."""
    if not dsn or "@" not in dsn:
        return None
    creds = dsn.split("://", 1)[-1].split("@", 1)[0]
    return creds.split(":", 1)[0] or None


async def aresolve_project(public_key: str, project_id: str):
    """Async: return (project, project_key) for a valid active key, else (None, None).

    Uses native async ORM + async cache so the ingest hot path never blocks the
    event loop (no sync_to_async in app code)."""
    if not public_key:
        return None, None
    cache_key = f"ingest:key:{public_key}"
    cached = await cache.aget(cache_key)
    if cached is None:
        cached = (
            await ProjectKey.objects.select_related("project", "project__organization")
            .filter(public_key=public_key, is_active=True)
            .afirst()
        ) or False
        await cache.aset(cache_key, cached, _CACHE_TTL)
    if not cached:
        return None, None
    if str(cached.project_id) != str(project_id):
        return None, None
    return cached.project, cached
