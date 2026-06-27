"""Add a PostgreSQL GIN full-text index on LogEntry(body).

No-op on non-Postgres backends, where log body search falls back to
``icontains``. The indexed expression matches ``apps.common.search``'s
``tsvector_expr`` so the planner can use this index.
"""

from __future__ import annotations

from django.db import migrations

INDEX_NAME = "logentry_body_fts"


def add_pg_fts(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    from apps.common.search import tsvector_expr

    table = apps.get_model("logs", "LogEntry")._meta.db_table
    qn = schema_editor.connection.ops.quote_name
    expr = tsvector_expr(["body"])
    schema_editor.execute(
        f"CREATE INDEX IF NOT EXISTS {qn(INDEX_NAME)} ON {qn(table)} USING GIN ({expr})"
    )


def drop_pg_fts(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    qn = schema_editor.connection.ops.quote_name
    schema_editor.execute(f"DROP INDEX IF EXISTS {qn(INDEX_NAME)}")


class Migration(migrations.Migration):
    dependencies = [("logs", "0001_initial")]
    operations = [migrations.RunPython(add_pg_fts, drop_pg_fts)]
