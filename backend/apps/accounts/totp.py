"""
Minimal RFC 6238 TOTP (time-based one-time password) implemented with the
standard library — no extra dependency. Used for optional two-factor auth on
the profile page. Compatible with Google Authenticator / Authy / 1Password.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote, urlencode

_DIGITS = 6
_PERIOD = 30


def generate_secret(length: int = 20) -> str:
    """Return a base32-encoded random secret (no padding)."""
    return base64.b32encode(secrets.token_bytes(length)).decode("ascii").rstrip("=")


def _hotp(secret: str, counter: int) -> str:
    # Re-pad the base32 secret to a multiple of 8 chars before decoding.
    padded = secret.upper() + "=" * (-len(secret) % 8)
    key = base64.b32decode(padded, casefold=True)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**_DIGITS)
    return str(code).zfill(_DIGITS)


def verify(secret: str, code: str, *, window: int = 1) -> bool:
    """True if ``code`` matches within ±``window`` time steps (clock skew)."""
    if not secret or not code:
        return False
    code = code.strip().replace(" ", "")
    if not code.isdigit():
        return False
    counter = int(time.time()) // _PERIOD
    for drift in range(-window, window + 1):
        if hmac.compare_digest(_hotp(secret, counter + drift), code):
            return True
    return False


def provisioning_uri(secret: str, *, label: str, issuer: str = "Errora") -> str:
    """``otpauth://`` URI for QR-code enrollment."""
    params = urlencode(
        {
            "secret": secret,
            "issuer": issuer,
            "algorithm": "SHA1",
            "digits": _DIGITS,
            "period": _PERIOD,
        }
    )
    return f"otpauth://totp/{quote(issuer)}:{quote(label)}?{params}"
