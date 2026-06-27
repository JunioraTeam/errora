"""
Symmetric encryption for secrets stored at rest (integration tokens, AI API
keys). Uses Fernet with ``settings.SECRETS_ENCRYPTION_KEY``. In dev, if no key
is configured a deterministic key is derived from SECRET_KEY so the app still
runs — production MUST set SECRETS_ENCRYPTION_KEY.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _fernet() -> Fernet:
    key = settings.SECRETS_ENCRYPTION_KEY
    if not key:
        digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
        key = base64.urlsafe_b64encode(digest).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return ""
