"""SQLite FTS5 companion table + sync triggers for LogEntry(body).

No-op on non-SQLite backends, or SQLite builds without FTS5 (search falls back to
``icontains``).
"""

from __future__ import annotations

from django.db import migrations

FTS = "logentry_fts"
TRIGGERS = ("logentry_fts_ai", "logentry_fts_au", "logentry_fts_ad")


def add_sqlite_fts(apps, schema_editor):
    conn = schema_editor.connection
    if conn.vendor != "sqlite":
        return
    from apps.common.search import sqlite_fts5_available

    if not sqlite_fts5_available():
        return

    table = apps.get_model("logs", "LogEntry")._meta.db_table
    qn = conn.ops.quote_name
    ex = schema_editor.execute

    ex(f"CREATE VIRTUAL TABLE IF NOT EXISTS {qn(FTS)} USING fts5(ref_id UNINDEXED, body)")
    ex(f"INSERT INTO {qn(FTS)}(ref_id, body) SELECT id, body FROM {qn(table)}")
    ex(
        f"CREATE TRIGGER IF NOT EXISTS {qn('logentry_fts_ai')} AFTER INSERT ON {qn(table)} BEGIN "
        f"INSERT INTO {qn(FTS)}(ref_id, body) VALUES (new.id, new.body); END"
    )
    ex(
        f"CREATE TRIGGER IF NOT EXISTS {qn('logentry_fts_ad')} AFTER DELETE ON {qn(table)} BEGIN "
        f"DELETE FROM {qn(FTS)} WHERE ref_id = old.id; END"
    )
    ex(
        f"CREATE TRIGGER IF NOT EXISTS {qn('logentry_fts_au')} AFTER UPDATE ON {qn(table)} BEGIN "
        f"DELETE FROM {qn(FTS)} WHERE ref_id = old.id; "
        f"INSERT INTO {qn(FTS)}(ref_id, body) VALUES (new.id, new.body); END"
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
    dependencies = [("logs", "0002_logentry_body_fts")]
    operations = [migrations.RunPython(add_sqlite_fts, drop_sqlite_fts)]
