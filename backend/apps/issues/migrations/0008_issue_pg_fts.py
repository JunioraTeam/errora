"""Add a PostgreSQL GIN full-text index on Issue(type, value).

No-op on other backends (MySQL uses a FULLTEXT index from 0004; SQLite falls
back to ``icontains``). The indexed expression matches ``apps.common.search``'s
``tsvector_expr`` so the query planner can use this index.
"""

from __future__ import annotations

from django.db import migrations

INDEX_NAME = "issue_type_value_fts"


def add_pg_fts(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    from apps.common.search import tsvector_expr

    table = apps.get_model("issues", "Issue")._meta.db_table
    qn = schema_editor.connection.ops.quote_name
    expr = tsvector_expr(["type", "value"])
    schema_editor.execute(
        f"CREATE INDEX IF NOT EXISTS {qn(INDEX_NAME)} ON {qn(table)} USING GIN ({expr})"
    )


def drop_pg_fts(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    qn = schema_editor.connection.ops.quote_name
    schema_editor.execute(f"DROP INDEX IF EXISTS {qn(INDEX_NAME)}")


class Migration(migrations.Migration):
    dependencies = [("issues", "0007_event_trace_id")]
    operations = [migrations.RunPython(add_pg_fts, drop_pg_fts)]
