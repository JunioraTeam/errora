"""Add a MySQL/MariaDB FULLTEXT index on Issue(type, value).

No-op on other backends (Postgres/SQLite), where issue search falls back to a
portable ``icontains`` filter — see ``apps.issues.search``.
"""

from __future__ import annotations

from django.db import migrations

INDEX_NAME = "issue_type_value_ft"


def add_fulltext(apps, schema_editor):
    if schema_editor.connection.vendor != "mysql":
        return
    table = apps.get_model("issues", "Issue")._meta.db_table
    qn = schema_editor.connection.ops.quote_name
    schema_editor.execute(
        f"ALTER TABLE {qn(table)} ADD FULLTEXT {qn(INDEX_NAME)} ({qn('type')}, {qn('value')})"
    )


def drop_fulltext(apps, schema_editor):
    if schema_editor.connection.vendor != "mysql":
        return
    table = apps.get_model("issues", "Issue")._meta.db_table
    qn = schema_editor.connection.ops.quote_name
    schema_editor.execute(f"ALTER TABLE {qn(table)} DROP INDEX {qn(INDEX_NAME)}")


class Migration(migrations.Migration):
    dependencies = [("issues", "0003_alter_event_received_at")]
    operations = [migrations.RunPython(add_fulltext, drop_fulltext)]
