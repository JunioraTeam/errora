"""
Iranian mobile number normalization.

The canonical stored form is E.164: ``+989123456789``. Users type the national
number ``9123456789`` (the UI shows ``+98`` as a fixed prefix), but we also
accept the common variants (``09123…``, ``+98…``, ``0098…``) and collapse them
to one canonical value so lookups and uniqueness are stable.
"""

from __future__ import annotations

import re

# A valid Iranian mobile national number: leading 9 + 9 more digits.
NATIONAL_RE = re.compile(r"^9\d{9}$")


def normalize_phone(raw: str | None) -> str | None:
    """Return the canonical ``+98XXXXXXXXXX`` form, or ``None`` if not a valid
    Iranian mobile number."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("0098"):
        digits = digits[4:]
    elif digits.startswith("98") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if NATIONAL_RE.match(digits):
        return f"+98{digits}"
    return None
