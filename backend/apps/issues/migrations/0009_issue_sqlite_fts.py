"""SQLite FTS5 companion table + sync triggers for Issue(type, value).

No-op on non-SQLite backends, or SQLite builds without the FTS5 module (search
then falls back to ``icontains``). ``atomic = False`` so the FTS5 availability
probe can fail without poisoning a surrounding transaction.
"""

from __future__ import annotations

from django.db import migrations

FTS = "issue_fts"
TRIGGERS = ("issue_fts_ai", "issue_fts_au", "issue_fts_ad")


def add_sqlite_fts(apps, schema_editor):
    conn = schema_editor.connection
    if conn.vendor != "sqlite":
        return
    from apps.common.search import sqlite_fts5_available

    if not sqlite_fts5_available():
        return

    table = apps.get_model("issues", "Issue")._meta.db_table
    qn = conn.ops.quote_name
    ex = schema_editor.execute

    ex(f"CREATE VIRTUAL TABLE IF NOT EXISTS {qn(FTS)} USING fts5(ref_id UNINDEXED, type, value)")
    ex(f"INSERT INTO {qn(FTS)}(ref_id, type, value) SELECT id, type, value FROM {qn(table)}")
    ex(
        f"CREATE TRIGGER IF NOT EXISTS {qn('issue_fts_ai')} AFTER INSERT ON {qn(table)} BEGIN "
        f"INSERT INTO {qn(FTS)}(ref_id, type, value) VALUES (new.id, new.type, new.value); END"
    )
    ex(
        f"CREATE TRIGGER IF NOT EXISTS {qn('issue_fts_ad')} AFTER DELETE ON {qn(table)} BEGIN "
        f"DELETE FROM {qn(FTS)} WHERE ref_id = old.id; END"
    )
    ex(
        f"CREATE TRIGGER IF NOT EXISTS {qn('issue_fts_au')} AFTER UPDATE ON {qn(table)} BEGIN "
        f"DELETE FROM {qn(FTS)} WHERE ref_id = old.id; "
        f"INSERT INTO {qn(FTS)}(ref_id, type, value) VALUES (new.id, new.type, new.value); END"
    )


def drop_sqlite_fts(apps, schema_editor):
    conn = schema_editor.connection
    if conn.vendor != "sqlite":
        return
    qn = conn.ops.quote_name
    for trg in TRIGGERS:
        schema_editor.execute(f"DROP TRIGGER IF EXISTS {qn(trg)}")
    schema_editor.execute(f"DROP TABLE IF EXISTS {qn(FTS)}")


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("issues", "0008_issue_pg_fts")]
    operations = [migrations.RunPython(add_sqlite_fts, drop_sqlite_fts)]
