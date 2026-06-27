"""
PostgreSQL full-text search helpers.

When the database is Postgres, free-text search uses a GIN-indexed
``to_tsvector`` / ``to_tsquery`` match instead of a leading-wildcard ``LIKE``
(``icontains``) — index-backed and far cheaper once row counts grow. The
``'simple'`` text-search config is used (no language stemming) so technical
tokens like exception types and identifiers match literally, and Persian text
isn't mangled by an English stemmer.

The ``to_tsvector`` expression here MUST stay identical to the one the matching
migration builds for the functional GIN index, otherwise the planner can't use
the index. Both sides call :func:`tsvector_expr`, so keep that the single source
of truth.
"""

from __future__ import annotations

import re

from django.db import connection

# Words = unicode word chars (covers Latin + Persian/Arabic). Punctuation that
# would otherwise break ``to_tsquery`` syntax is dropped.
_WORD = re.compile(r"\w+", re.UNICODE)
CONFIG = "simple"


def is_postgres() -> bool:
    return connection.vendor == "postgresql"


def to_tsquery_prefix(text: str) -> str:
    """Build a prefix ``to_tsquery`` string requiring every term: ``a:* & b:*``.
    Returns ``""`` when the input has no usable word tokens."""
    terms = _WORD.findall(text or "")
    return " & ".join(f"{t}:*" for t in terms)


def tsvector_expr(columns: list[str], *, table: str | None = None) -> str:
    """SQL for ``to_tsvector('simple', coalesce(col1,'') || ' ' || …)``.

    Pass ``table`` (already a real table name) to qualify the columns in a query;
    omit it for the migration's functional index (Postgres matches the index
    regardless of column qualification)."""
    qn = connection.ops.quote_name
    prefix = f"{qn(table)}." if table else ""
    parts = [f"coalesce({prefix}{qn(c)}, '')" for c in columns]
    joined = " || ' ' || ".join(parts)
    return f"to_tsvector('{CONFIG}', {joined})"


def pg_fts_filter(qs, text: str, columns: list[str]):
    """Filter ``qs`` by a Postgres FTS match over ``columns``.

    Returns ``(queryset, matched)``. When ``matched`` is ``False`` (no word
    tokens in the query) the caller should fall back to ``icontains`` so odd
    queries still behave sensibly.
    """
    tq = to_tsquery_prefix(text)
    if not tq:
        return qs, False
    table = qs.model._meta.db_table
    where = f"{tsvector_expr(columns, table=table)} @@ to_tsquery('{CONFIG}', %s)"
    return qs.extra(where=[where], params=[tq]), True  # noqa: S610 - params are bound


# --- SQLite (FTS5) -------------------------------------------------------- #
#
# SQLite has no functional text index, so each searchable table gets a companion
# FTS5 virtual table (``<table>_fts(ref_id UNINDEXED, <text cols…>)``) kept in
# sync by INSERT/UPDATE/DELETE triggers (created by a migration). Search joins
# back on the stored row id. FTS5 isn't guaranteed to be compiled in, so both the
# migration and the query path probe for it and fall back to ``icontains``.

_sqlite_cache: dict[str, bool] = {}


def is_sqlite() -> bool:
    return connection.vendor == "sqlite"


def sqlite_fts5_available() -> bool:
    """Whether this SQLite build has the FTS5 module (probed once)."""
    if not is_sqlite():
        return False
    if "fts5" not in _sqlite_cache:
        try:
            with connection.cursor() as cur:
                cur.execute("CREATE VIRTUAL TABLE IF NOT EXISTS temp._fts5_probe USING fts5(x)")
                cur.execute("DROP TABLE temp._fts5_probe")
            _sqlite_cache["fts5"] = True
        except Exception:  # noqa: BLE001 - never let detection break search
            _sqlite_cache["fts5"] = False
    return _sqlite_cache["fts5"]


def sqlite_table_exists(name: str) -> bool:
    """Whether an FTS companion table exists (memoized — these are created once
    by a migration and never dropped at runtime)."""
    key = f"table:{name}"
    if key not in _sqlite_cache:
        with connection.cursor() as cur:
            cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=%s", [name])
            _sqlite_cache[key] = cur.fetchone() is not None
    return _sqlite_cache[key]


def sqlite_match_query(text: str) -> str:
    """Build an FTS5 ``MATCH`` string: every word token as a prefix, AND-ed
    (whitespace is implicit AND in FTS5). ``""`` when there are no word tokens."""
    return " ".join(f"{t}*" for t in _WORD.findall(text or ""))


def sqlite_fts_filter(qs, text: str, fts_table: str):
    """Filter ``qs`` via its FTS5 companion table. Returns ``(queryset, matched)``;
    ``matched`` is ``False`` when the FTS table is absent or the query has no word
    tokens, so the caller falls back to ``icontains``."""
    if not sqlite_table_exists(fts_table):
        return qs, False
    match = sqlite_match_query(text)
    if not match:
        return qs, False
    qn = connection.ops.quote_name
    table = qn(qs.model._meta.db_table)
    pk = qn(qs.model._meta.pk.column)
    fts = qn(fts_table)
    where = f"{table}.{pk} IN (SELECT ref_id FROM {fts} WHERE {fts} MATCH %s)"
    return qs.extra(where=[where], params=[match]), True  # noqa: S610 - params are bound
