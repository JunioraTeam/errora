"""PostgreSQL full-text search helpers — query shape + tokenization.

These assert the SQL/tsquery we build (so the GIN index is usable); actual
execution is exercised on Postgres deployments. On SQLite the search layer falls
back to ``icontains`` (covered in test_features/test_logs), so this file only
checks the pure builders + the generated SQL string.
"""

import pytest

from apps.common.search import pg_fts_filter, to_tsquery_prefix, tsvector_expr
from apps.issues.models import Issue
from apps.logs.models import LogEntry


@pytest.mark.parametrize(
    "text,expected",
    [
        ("ValueError bad number", "ValueError:* & bad:* & number:*"),
        ("KeyError", "KeyError:*"),
        ("  spaced   out  ", "spaced:* & out:*"),
        ("connection-refused", "connection:* & refused:*"),  # punctuation splits
        ("سلام دنیا", "سلام:* & دنیا:*"),  # unicode (Persian) tokens
        ("!!!", ""),  # no word tokens
        ("", ""),
    ],
)
def test_to_tsquery_prefix(text, expected):
    assert to_tsquery_prefix(text) == expected


def test_tsvector_expr_shape():
    expr = tsvector_expr(["type", "value"])
    assert "to_tsvector('simple'" in expr
    assert "coalesce" in expr.lower()
    assert "|| ' ' ||" in expr
    # Qualified form prefixes the table name.
    qualified = tsvector_expr(["body"], table="logs_logentry")
    assert "logs_logentry" in qualified


def test_pg_fts_filter_builds_tsquery_match():
    qs, matched = pg_fts_filter(Issue.objects.all(), "ValueError boom", ["type", "value"])
    assert matched is True
    sql = str(qs.query)
    assert "to_tsvector('simple'" in sql
    assert "@@ to_tsquery('simple'" in sql


def test_pg_fts_filter_no_tokens_returns_unmatched():
    base = LogEntry.objects.all()
    qs, matched = pg_fts_filter(base, "***", ["body"])
    assert matched is False
    assert qs is base  # caller falls back to icontains
