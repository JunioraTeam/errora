"""
Sentry-style log search query parser.

A query is a space-separated mix of free-text terms and ``key:value`` tokens:

    "timeout level:error service:checkout trace:abc123"

Free text matches the log ``body`` (case-insensitive substring). ``key:value``
tokens filter on reserved keys (``level``, ``trace``, ``environment``/``env``,
``release``, ``span``) or, for any other key, on a flat ``attributes`` entry.
Quoted values (``msg:"connection refused"``) keep their spaces. Negation with a
leading ``!`` (``level:!info``) excludes instead of includes.
"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass, field

from apps.common.search import is_postgres, is_sqlite, pg_fts_filter, sqlite_fts_filter

# Reserved keys map to model columns; everything else hits the attributes bag.
_RESERVED = {
    "level": "level",
    "trace": "trace_id",
    "trace_id": "trace_id",
    "env": "environment",
    "environment": "environment",
    "release": "release",
    "span": "span_id",
    "span_id": "span_id",
}
_TOKEN = re.compile(r"^(!?)([\w.\-]+):(.*)$")


@dataclass
class ParsedQuery:
    text: str = ""
    # (field, value, negated) where field is a column name.
    column_filters: list[tuple[str, str, bool]] = field(default_factory=list)
    # (key, value, negated) for attribute-bag lookups.
    attr_filters: list[tuple[str, str, bool]] = field(default_factory=list)


def parse_query(q: str) -> ParsedQuery:
    parsed = ParsedQuery()
    if not q or not q.strip():
        return parsed
    try:
        tokens = shlex.split(q)
    except ValueError:
        # Unbalanced quotes — fall back to whitespace splitting.
        tokens = q.split()

    text_parts: list[str] = []
    for tok in tokens:
        m = _TOKEN.match(tok)
        if not m:
            text_parts.append(tok)
            continue
        neg, key, value = m.group(1) == "!", m.group(2).lower(), m.group(3)
        # Negation may sit before the key (``!level:info``) or the value
        # (``level:!info``) — Sentry accepts both.
        if value.startswith("!"):
            neg, value = True, value[1:]
        if value == "":
            text_parts.append(tok)
            continue
        if key in _RESERVED:
            parsed.column_filters.append((_RESERVED[key], value, neg))
        else:
            parsed.attr_filters.append((key, value, neg))
    parsed.text = " ".join(text_parts).strip()
    return parsed


def apply_query(queryset, q: str):
    """Apply a parsed search query to a ``LogEntry`` queryset."""
    parsed = parse_query(q)
    if parsed.text:
        # Index-backed full-text match on the log body where available (Postgres
        # GIN / SQLite FTS5); otherwise — or for token-less queries — icontains.
        matched = False
        if is_postgres():
            queryset, matched = pg_fts_filter(queryset, parsed.text, ["body"])
        elif is_sqlite():
            queryset, matched = sqlite_fts_filter(queryset, parsed.text, "logentry_fts")
        if not matched:
            queryset = queryset.filter(body__icontains=parsed.text)
    for column_filter in parsed.column_filters:
        col, value, neg = column_filter
        # ``level`` accepts a comma list (level:error,fatal) for OR matching.
        if col == "level" and "," in value and not neg:
            queryset = queryset.filter(level__in=[v.strip() for v in value.split(",") if v.strip()])
            continue
        lookup = {col: value} if col in ("level", "environment") else {f"{col}__icontains": value}
        queryset = queryset.exclude(**lookup) if neg else queryset.filter(**lookup)
    for key, value, neg in parsed.attr_filters:
        lookup = {f"attributes__{key}": value}
        queryset = queryset.exclude(**lookup) if neg else queryset.filter(**lookup)
    return queryset
