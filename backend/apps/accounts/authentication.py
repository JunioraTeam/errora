from __future__ import annotations

from datetime import UTC, datetime

import jwt
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import authentication, exceptions


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _encode(user, *, token_type: str, ttl, **extra) -> str:
    return jwt.encode(
        {
            "sub": str(user.id),
            "type": token_type,
            "ver": user.token_version,
            "iat": _now(),
            "exp": _now() + ttl,
            **extra,
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )


def issue_token_pair(user) -> dict[str, str]:
    return {
        "access": _encode(user, token_type="access", ttl=settings.JWT_ACCESS_TTL),
        "refresh": _encode(user, token_type="refresh", ttl=settings.JWT_REFRESH_TTL),
    }


def issue_stream_token(user, *, run_id: str, ttl_seconds: int = 600) -> str:
    """A short-lived, single-purpose token for an SSE stream (EventSource can't
    send Authorization headers, so the token rides in the URL — scope it to one
    run with a short TTL so a leak is near-worthless)."""
    from datetime import timedelta

    return _encode(user, token_type="stream", ttl=timedelta(seconds=ttl_seconds), run=str(run_id))


def decode_token(token: str, *, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise exceptions.AuthenticationFailed("Token expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise exceptions.AuthenticationFailed("Invalid token.") from exc
    if payload.get("type") != expected_type:
        raise exceptions.AuthenticationFailed("Wrong token type.")
    return payload


class JWTAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].decode().lower() != self.keyword.lower():
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed("Invalid Authorization header.")
        payload = decode_token(header[1].decode(), expected_type="access")
        User = get_user_model()
        try:
            user = User.objects.get(id=payload["sub"], is_active=True)
        except User.DoesNotExist as exc:
            raise exceptions.AuthenticationFailed("User not found.") from exc
        if payload.get("ver", 0) != user.token_version:
            raise exceptions.AuthenticationFailed("Token has been revoked.")
        return (user, None)

    def authenticate_header(self, request) -> str:
        # Ensures DRF returns 401 (not 403) when credentials are missing.
        return self.keyword
