"""
Issue text search, index-backed where the database supports it:

* **PostgreSQL** — a GIN ``to_tsvector`` index on ``Issue(type, value)`` with a
  prefix ``to_tsquery`` match (see ``apps.common.search`` + the FTS migration).
* **MySQL/MariaDB** — a FULLTEXT index used via ``MATCH … AGAINST`` in boolean
  mode.
* **SQLite** — an FTS5 companion table (``issue_fts``) kept in sync by triggers,
  matched with a prefix query.

When none of those are available (e.g. SQLite without FTS5), or for queries with
no word tokens, we fall back to a portable ``icontains`` filter.
"""

from __future__ import annotations

import re

from django.db import connection
from django.db.models import Q

from apps.common.search import is_postgres, is_sqlite, pg_fts_filter, sqlite_fts_filter

from .models import Issue

# Strip boolean-mode operators so user input can't break the AGAINST syntax.
_FT_OPERATORS = re.compile(r'[+\-><()~*"@]+')

# Process-level memo of whether the FULLTEXT index exists (checked once).
_fulltext_cache: dict[str, bool] = {}


def _has_fulltext() -> bool:
    if connection.vendor != "mysql":
        return False
    if "exists" not in _fulltext_cache:
        try:
            with connection.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM information_schema.STATISTICS "
                    "WHERE table_schema = DATABASE() AND table_name = %s "
                    "AND index_type = 'FULLTEXT'",
                    [Issue._meta.db_table],
                )
                _fulltext_cache["exists"] = cur.fetchone()[0] > 0
        except Exception:  # noqa: BLE001 - never let detection break search
            _fulltext_cache["exists"] = False
    return _fulltext_cache["exists"]


def apply_issue_search(qs, q: str):
    """Filter ``qs`` (an Issue queryset) by free-text query ``q``."""
    q = (q or "").strip()
    if not q:
        return qs

    if is_postgres():
        filtered, matched = pg_fts_filter(qs, q, ["type", "value"])
        if matched:
            return filtered
        # No word tokens (e.g. punctuation only) → portable fallback below.

    if is_sqlite():
        filtered, matched = sqlite_fts_filter(qs, q, "issue_fts")
        if matched:
            return filtered

    if _has_fulltext():
        terms = [t for t in _FT_OPERATORS.sub(" ", q).split() if t]
        if terms:
            # Require every term; trailing '*' enables prefix matching.
            boolean = " ".join(f"+{t}*" for t in terms)
            table = connection.ops.quote_name(Issue._meta.db_table)
            type_col = connection.ops.quote_name("type")
            value_col = connection.ops.quote_name("value")
            return qs.extra(  # noqa: S610 - params are bound, not interpolated
                where=[
                    f"MATCH ({table}.{type_col}, {table}.{value_col}) AGAINST (%s IN BOOLEAN MODE)"
                ],
                params=[boolean],
            )

    return qs.filter(Q(value__icontains=q) | Q(type__icontains=q))
