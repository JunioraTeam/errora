"""
Personal access tokens (bearer credentials for the MCP server / API).

The raw token (``errora_pat_<random>``) is returned to the user exactly once at
creation; only its SHA-256 hash is persisted, so a DB leak can't reveal usable
tokens.
"""

from __future__ import annotations

import hashlib
import secrets

from django.utils import timezone

from .models import ApiToken

TOKEN_PREFIX = "errora_pat_"


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def create_token(user, name: str, *, expires_at=None) -> tuple[ApiToken, str]:
    """Create a token for ``user``. Returns ``(instance, raw_token)`` — the raw
    token is only available here."""
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    token = ApiToken.objects.create(
        user=user,
        name=name[:120] or "token",
        token_prefix=raw[: len(TOKEN_PREFIX) + 6],
        token_hash=_hash(raw),
        expires_at=expires_at,
    )
    return token, raw


def authenticate_token(raw: str):
    """Resolve a raw bearer token to its active user, or ``None``.

    Updates ``last_used_at`` (best-effort). Expired tokens are rejected."""
    if not raw or not raw.startswith(TOKEN_PREFIX):
        return None
    token = ApiToken.objects.select_related("user").filter(token_hash=_hash(raw)).first()
    if token is None or token.is_expired or not token.user.is_active:
        return None
    # Throttle the write: only touch last_used_at at most once a minute.
    now = timezone.now()
    if token.last_used_at is None or (now - token.last_used_at).total_seconds() > 60:
        ApiToken.objects.filter(pk=token.pk).update(last_used_at=now)
    return token.user
