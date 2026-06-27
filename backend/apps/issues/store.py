"""
Pluggable event store. Events are the high-volume data; everything else
(issues, grouping, assignments) stays in the OLTP database. Set
``EVENT_STORE_BACKEND=clickhouse`` (plus ``CLICKHOUSE_*`` settings) to keep
events in ClickHouse instead of the OLTP ``Event`` table — the rest of the app
is unaffected because all event access goes through this interface.

Both backends speak the same dict shape (matching ``EventSerializer`` fields),
so views/serializers don't care which store is active.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC
from functools import lru_cache

from django.conf import settings
from django.db.models import Count
from django.db.models.functions import TruncDate, TruncHour

from .models import Event

EVENT_FIELDS = [
    "event_id",
    "issue",
    "trace_id",
    "timestamp",
    "received_at",
    "level",
    "platform",
    "environment",
    "release",
    "server_name",
    "message",
    "data",
]


def _serialize_orm(e: Event) -> dict:
    return {
        "event_id": str(e.event_id),
        "issue": str(e.issue_id),
        "trace_id": e.trace_id,
        "timestamp": e.timestamp.isoformat() if e.timestamp else None,
        "received_at": e.received_at.isoformat() if e.received_at else None,
        "level": e.level,
        "platform": e.platform,
        "environment": e.environment,
        "release": e.release,
        "server_name": e.server_name,
        "message": e.message,
        "data": e.data,
    }


class OrmEventStore:
    """Default backend: the Django ``Event`` model in the OLTP database."""

    def write(self, *, project, issue, fields: dict) -> dict:
        return _serialize_orm(Event.objects.create(project=project, issue=issue, **fields))

    def latest_for_issue(self, issue) -> dict | None:
        e = issue.events.order_by("-timestamp").first()
        return _serialize_orm(e) if e else None

    def list_for_issue(self, issue, limit: int, offset: int) -> tuple[list[dict], int]:
        qs = issue.events.all()
        total = qs.count()
        return [_serialize_orm(e) for e in qs[offset : offset + limit]], total

    def get(self, project, event_id) -> dict | None:
        e = Event.objects.filter(project=project, event_id=event_id).first()
        return _serialize_orm(e) if e else None

    def issues_for_trace(self, project, trace_id) -> list[str]:
        if not trace_id:
            return []
        ids = (
            Event.objects.filter(project=project, trace_id=trace_id)
            .values_list("issue_id", flat=True)
            .distinct()
        )
        return [str(i) for i in ids]

    def count_by_day(self, organization, start, end) -> list[dict]:
        rows = (
            Event.objects.filter(
                project__organization=organization,
                received_at__date__gte=start,
                received_at__date__lt=end,
            )
            .annotate(day=TruncDate("received_at"))
            .values("day")
            .annotate(events=Count("event_id"))
            .order_by("day")
        )
        return [{"date": r["day"].isoformat(), "events": r["events"]} for r in rows]

    def trend_for_issues(self, issue_ids, since, days) -> dict:
        from django.utils import timezone

        rows = (
            Event.objects.filter(issue_id__in=list(issue_ids), timestamp__gte=since)
            .annotate(day=TruncDate("timestamp"))
            .values("issue_id", "day")
            .annotate(c=Count("event_id"))
        )
        today = timezone.localdate()
        index = {today - timezone.timedelta(days=days - 1 - i): i for i in range(days)}
        out = {str(iid): [0] * days for iid in issue_ids}
        for r in rows:
            key = str(r["issue_id"])
            i = index.get(r["day"])
            if key in out and i is not None:
                out[key][i] = r["c"]
        return out

    def series_for_issue(self, issue, period: str) -> list[dict]:
        """Event counts for one issue, bucketed for a trend chart. ``period`` is
        ``"24h"`` (24 hourly buckets) or ``"30d"`` (30 daily buckets). Returns a
        list of ``{"ts": iso, "count": int}`` oldest→newest."""
        from django.utils import timezone

        now = timezone.now()
        if period == "24h":
            n = 24
            start = (
                (now - timezone.timedelta(hours=n - 1))
                .astimezone(UTC)
                .replace(minute=0, second=0, microsecond=0)
            )
            rows = (
                issue.events.filter(timestamp__gte=start)
                .annotate(b=TruncHour("timestamp", tzinfo=UTC))
                .values("b")
                .annotate(c=Count("event_id"))
            )
            buckets = [start + timezone.timedelta(hours=i) for i in range(n)]
            index = {b: i for i, b in enumerate(buckets)}
            out = [0] * n
            for r in rows:
                i = index.get(r["b"])
                if i is not None:
                    out[i] = r["c"]
            return [{"ts": buckets[i].isoformat(), "count": out[i]} for i in range(n)]

        n = 30
        today = timezone.localdate()
        start_date = today - timezone.timedelta(days=n - 1)
        rows = (
            issue.events.filter(timestamp__date__gte=start_date)
            .annotate(b=TruncDate("timestamp"))
            .values("b")
            .annotate(c=Count("event_id"))
        )
        index = {start_date + timezone.timedelta(days=i): i for i in range(n)}
        out = [0] * n
        for r in rows:
            i = index.get(r["b"])
            if i is not None:
                out[i] = r["c"]
        days = [start_date + timezone.timedelta(days=i) for i in range(n)]
        return [{"ts": days[i].isoformat(), "count": out[i]} for i in range(n)]

    def series_for_issues(self, issue_ids, period: str) -> dict:
        """Bucketed event counts for many issues at once (issues-list trend column).
        ``period`` is ``"24h"`` (24 hourly) or ``"30d"`` (30 daily). Returns
        ``{issue_id: [counts oldest→newest]}``."""
        from django.utils import timezone

        ids = list(issue_ids)
        if period == "24h":
            n = 24
            start = (
                (timezone.now() - timezone.timedelta(hours=n - 1))
                .astimezone(UTC)
                .replace(minute=0, second=0, microsecond=0)
            )
            rows = (
                Event.objects.filter(issue_id__in=ids, timestamp__gte=start)
                .annotate(b=TruncHour("timestamp", tzinfo=UTC))
                .values("issue_id", "b")
                .annotate(c=Count("event_id"))
            )
            buckets = [start + timezone.timedelta(hours=i) for i in range(n)]
        else:
            n = 30
            start_date = timezone.localdate() - timezone.timedelta(days=n - 1)
            rows = (
                Event.objects.filter(issue_id__in=ids, timestamp__date__gte=start_date)
                .annotate(b=TruncDate("timestamp"))
                .values("issue_id", "b")
                .annotate(c=Count("event_id"))
            )
            buckets = [start_date + timezone.timedelta(days=i) for i in range(n)]
        index = {b: i for i, b in enumerate(buckets)}
        out = {str(i): [0] * n for i in ids}
        for r in rows:
            key = str(r["issue_id"])
            i = index.get(r["b"])
            if key in out and i is not None:
                out[key][i] = r["c"]
        return out

    def daily_counts_per_project(self, project_ids, start_date, days) -> dict:
        """Per-project daily event counts over ``days`` ending today. Returns
        ``{project_id: [counts oldest→newest]}``."""
        from django.utils import timezone

        rows = (
            Event.objects.filter(project_id__in=list(project_ids), timestamp__date__gte=start_date)
            .annotate(day=TruncDate("timestamp"))
            .values("project_id", "day")
            .annotate(c=Count("event_id"))
        )
        index = {start_date + timezone.timedelta(days=i): i for i in range(days)}
        out = {str(p): [0] * days for p in project_ids}
        for r in rows:
            key = str(r["project_id"])
            i = index.get(r["day"])
            if key in out and i is not None:
                out[key][i] = r["c"]
        return out

    def count_before(self, cutoff, organization=None) -> int:
        qs = Event.objects.filter(received_at__lt=cutoff)
        if organization is not None:
            qs = qs.filter(project__organization=organization)
        return qs.count()

    def delete_before(self, cutoff, organization=None) -> int:
        qs = Event.objects.filter(received_at__lt=cutoff)
        if organization is not None:
            qs = qs.filter(project__organization=organization)
        total = 0
        while True:
            ids = list(qs.order_by("pk").values_list("pk", flat=True)[:5000])
            if not ids:
                break
            Event.objects.filter(pk__in=ids).delete()
            total += len(ids)
        return total

    def reassign_events(self, from_issue_ids, to_issue_id) -> int:
        return Event.objects.filter(issue_id__in=list(from_issue_ids)).update(issue_id=to_issue_id)


class ClickHouseEventStore:
    """
    ClickHouse backend (driver: ``clickhouse-connect``). The events table is
    created on first use. Reads/writes mirror the OLTP shape. Issues stay in the
    OLTP DB; only the per-event rows live here.
    """

    TABLE = "events"

    def __init__(self):
        self._client = None
        self._ready = False

    def _conn(self):
        if self._client is None:
            import clickhouse_connect

            self._client = clickhouse_connect.get_client(
                host=settings.CLICKHOUSE_HOST,
                port=settings.CLICKHOUSE_PORT,
                username=settings.CLICKHOUSE_USER,
                password=settings.CLICKHOUSE_PASSWORD,
                database=settings.CLICKHOUSE_DATABASE,
            )
        if not self._ready:
            self._client.command(
                f"""
                CREATE TABLE IF NOT EXISTS {self.TABLE} (
                    event_id UUID,
                    issue_id UUID,
                    project_id UUID,
                    organization_id UUID,
                    trace_id String,
                    timestamp DateTime64(3),
                    received_at DateTime64(3) DEFAULT now64(3),
                    level String,
                    platform String,
                    environment String,
                    release String,
                    server_name String,
                    message String,
                    data String
                ) ENGINE = MergeTree ORDER BY (project_id, timestamp)
                """
            )
            self._ready = True
        return self._client

    def _row_to_dict(self, row: dict) -> dict:
        return {
            "event_id": str(row["event_id"]),
            "issue": str(row["issue_id"]),
            "trace_id": row.get("trace_id", ""),
            "timestamp": row["timestamp"].isoformat() if row["timestamp"] else None,
            "received_at": row["received_at"].isoformat() if row["received_at"] else None,
            "level": row["level"],
            "platform": row["platform"],
            "environment": row["environment"],
            "release": row["release"],
            "server_name": row["server_name"],
            "message": row["message"],
            "data": json.loads(row["data"] or "{}"),
        }

    def _query_dicts(self, sql: str, params: dict) -> list[dict]:
        client = self._conn()
        result = client.query(sql, parameters=params)
        cols = result.column_names
        return [self._row_to_dict(dict(zip(cols, r, strict=False))) for r in result.result_rows]

    def write(self, *, project, issue, fields: dict) -> dict:
        client = self._conn()
        event_id = uuid.uuid4()
        from django.utils import timezone

        received_at = timezone.now()
        row = [
            event_id,
            issue.id,
            project.id,
            project.organization_id,
            fields.get("trace_id", ""),
            fields["timestamp"],
            received_at,
            fields.get("level", ""),
            fields.get("platform", ""),
            fields.get("environment", ""),
            fields.get("release", ""),
            fields.get("server_name", ""),
            fields.get("message", ""),
            json.dumps(fields.get("data", {})),
        ]
        client.insert(
            self.TABLE,
            [row],
            column_names=[
                "event_id",
                "issue_id",
                "project_id",
                "organization_id",
                "trace_id",
                "timestamp",
                "received_at",
                "level",
                "platform",
                "environment",
                "release",
                "server_name",
                "message",
                "data",
            ],
        )
        return {
            "event_id": str(event_id),
            "issue": str(issue.id),
            "timestamp": fields["timestamp"].isoformat() if fields.get("timestamp") else None,
            "received_at": received_at.isoformat(),
            "level": fields.get("level", ""),
            "platform": fields.get("platform", ""),
            "environment": fields.get("environment", ""),
            "release": fields.get("release", ""),
            "server_name": fields.get("server_name", ""),
            "message": fields.get("message", ""),
            "trace_id": fields.get("trace_id", ""),
            "data": fields.get("data", {}),
        }

    def issues_for_trace(self, project, trace_id) -> list[str]:
        if not trace_id:
            return []
        rows = (
            self._conn()
            .query(
                f"SELECT DISTINCT issue_id FROM {self.TABLE} "
                "WHERE project_id = %(pid)s AND trace_id = %(tid)s",
                parameters={"pid": str(project.id), "tid": str(trace_id)},
            )
            .result_rows
        )
        return [str(r[0]) for r in rows]

    def latest_for_issue(self, issue) -> dict | None:
        rows = self._query_dicts(
            f"SELECT * FROM {self.TABLE} WHERE issue_id = %(iid)s ORDER BY timestamp DESC LIMIT 1",
            {"iid": str(issue.id)},
        )
        return rows[0] if rows else None

    def list_for_issue(self, issue, limit: int, offset: int) -> tuple[list[dict], int]:
        client = self._conn()
        total = client.query(
            f"SELECT count() FROM {self.TABLE} WHERE issue_id = %(iid)s",
            parameters={"iid": str(issue.id)},
        ).result_rows[0][0]
        rows = self._query_dicts(
            f"SELECT * FROM {self.TABLE} WHERE issue_id = %(iid)s "
            "ORDER BY timestamp DESC LIMIT %(lim)s OFFSET %(off)s",
            {"iid": str(issue.id), "lim": limit, "off": offset},
        )
        return rows, int(total)

    def get(self, project, event_id) -> dict | None:
        rows = self._query_dicts(
            f"SELECT * FROM {self.TABLE} WHERE project_id = %(pid)s AND event_id = %(eid)s LIMIT 1",
            {"pid": str(project.id), "eid": str(event_id)},
        )
        return rows[0] if rows else None

    def count_by_day(self, organization, start, end) -> list[dict]:
        client = self._conn()
        rows = client.query(
            f"SELECT toDate(received_at) AS d, count() AS c FROM {self.TABLE} "
            "WHERE organization_id = %(oid)s "
            "AND received_at >= %(start)s AND received_at < %(end)s "
            "GROUP BY d ORDER BY d",
            parameters={"oid": str(organization.id), "start": start, "end": end},
        ).result_rows
        return [{"date": r[0].isoformat(), "events": int(r[1])} for r in rows]

    def trend_for_issues(self, issue_ids, since, days) -> dict:
        from django.utils import timezone

        ids = [str(i) for i in issue_ids]
        if not ids:
            return {}
        client = self._conn()
        rows = client.query(
            f"SELECT issue_id, toDate(timestamp) AS d, count() AS c FROM {self.TABLE} "
            "WHERE issue_id IN %(ids)s AND timestamp >= %(since)s GROUP BY issue_id, d",
            parameters={"ids": ids, "since": since},
        ).result_rows
        today = timezone.localdate()
        index = {today - timezone.timedelta(days=days - 1 - i): i for i in range(days)}
        out = {i: [0] * days for i in ids}
        for issue_id, d, c in rows:
            key = str(issue_id)
            i = index.get(d)
            if key in out and i is not None:
                out[key][i] = int(c)
        return out

    def series_for_issue(self, issue, period: str) -> list[dict]:
        from django.utils import timezone

        now = timezone.now()
        client = self._conn()
        if period == "24h":
            n = 24
            # Align to UTC so the buckets match ClickHouse's UTC toStartOfHour
            # (matches the ORM path; otherwise non-UTC TIME_ZONE → all-zero chart).
            start = (
                (now - timezone.timedelta(hours=n - 1))
                .astimezone(UTC)
                .replace(minute=0, second=0, microsecond=0)
            )
            rows = client.query(
                f"SELECT toStartOfHour(timestamp) AS b, count() AS c FROM {self.TABLE} "
                "WHERE issue_id = %(iid)s AND timestamp >= %(start)s GROUP BY b",
                parameters={"iid": str(issue.id), "start": start},
            ).result_rows
            buckets = [start + timezone.timedelta(hours=i) for i in range(n)]
            index = {b.replace(tzinfo=None): i for i, b in enumerate(buckets)}
            out = [0] * n
            for b, c in rows:
                i = index.get(b.replace(tzinfo=None) if hasattr(b, "tzinfo") else b)
                if i is not None:
                    out[i] = int(c)
            return [{"ts": buckets[i].isoformat(), "count": out[i]} for i in range(n)]

        n = 30
        today = timezone.localdate()
        start_date = today - timezone.timedelta(days=n - 1)
        rows = client.query(
            f"SELECT toDate(timestamp) AS b, count() AS c FROM {self.TABLE} "
            "WHERE issue_id = %(iid)s AND toDate(timestamp) >= %(start)s GROUP BY b",
            parameters={"iid": str(issue.id), "start": start_date},
        ).result_rows
        index = {start_date + timezone.timedelta(days=i): i for i in range(n)}
        out = [0] * n
        for b, c in rows:
            i = index.get(b)
            if i is not None:
                out[i] = int(c)
        days = [start_date + timezone.timedelta(days=i) for i in range(n)]
        return [{"ts": days[i].isoformat(), "count": out[i]} for i in range(n)]

    def series_for_issues(self, issue_ids, period: str) -> dict:
        from django.utils import timezone

        ids = [str(i) for i in issue_ids]
        out = {i: [0] * (24 if period == "24h" else 30) for i in ids}
        if not ids:
            return out
        client = self._conn()
        if period == "24h":
            n = 24
            start = (
                (timezone.now() - timezone.timedelta(hours=n - 1))
                .astimezone(UTC)
                .replace(minute=0, second=0, microsecond=0)
            )
            rows = client.query(
                f"SELECT issue_id, toStartOfHour(timestamp) AS b, count() AS c FROM {self.TABLE} "
                "WHERE issue_id IN %(ids)s AND timestamp >= %(start)s GROUP BY issue_id, b",
                parameters={"ids": ids, "start": start},
            ).result_rows
            buckets = [start + timezone.timedelta(hours=i) for i in range(n)]
            index = {b.replace(tzinfo=None): i for i, b in enumerate(buckets)}
            for issue_id, b, c in rows:
                key = str(issue_id)
                i = index.get(b.replace(tzinfo=None) if hasattr(b, "tzinfo") else b)
                if key in out and i is not None:
                    out[key][i] = int(c)
            return out
        n = 30
        start_date = timezone.localdate() - timezone.timedelta(days=n - 1)
        rows = client.query(
            f"SELECT issue_id, toDate(timestamp) AS b, count() AS c FROM {self.TABLE} "
            "WHERE issue_id IN %(ids)s AND toDate(timestamp) >= %(start)s GROUP BY issue_id, b",
            parameters={"ids": ids, "start": start_date},
        ).result_rows
        index = {start_date + timezone.timedelta(days=i): i for i in range(n)}
        for issue_id, b, c in rows:
            key = str(issue_id)
            i = index.get(b)
            if key in out and i is not None:
                out[key][i] = int(c)
        return out

    def daily_counts_per_project(self, project_ids, start_date, days) -> dict:
        from django.utils import timezone

        ids = [str(p) for p in project_ids]
        out = {p: [0] * days for p in ids}
        if not ids:
            return out
        rows = (
            self._conn()
            .query(
                f"SELECT project_id, toDate(timestamp) AS d, count() AS c FROM {self.TABLE} "
                "WHERE project_id IN %(ids)s AND toDate(timestamp) >= %(start)s "
                "GROUP BY project_id, d",
                parameters={"ids": ids, "start": start_date},
            )
            .result_rows
        )
        index = {start_date + timezone.timedelta(days=i): i for i in range(days)}
        for project_id, d, c in rows:
            key = str(project_id)
            i = index.get(d)
            if key in out and i is not None:
                out[key][i] = int(c)
        return out

    def count_before(self, cutoff, organization=None) -> int:
        where = "received_at < %(cutoff)s"
        params = {"cutoff": cutoff}
        if organization is not None:
            where += " AND organization_id = %(oid)s"
            params["oid"] = str(organization.id)
        return int(
            self._conn()
            .query(f"SELECT count() FROM {self.TABLE} WHERE {where}", parameters=params)
            .result_rows[0][0]
        )

    def delete_before(self, cutoff, organization=None) -> int:
        client = self._conn()
        where = "received_at < %(cutoff)s"
        params = {"cutoff": cutoff}
        if organization is not None:
            where += " AND organization_id = %(oid)s"
            params["oid"] = str(organization.id)
        before = client.query(
            f"SELECT count() FROM {self.TABLE} WHERE {where}", parameters=params
        ).result_rows[0][0]
        client.command(f"ALTER TABLE {self.TABLE} DELETE WHERE {where}", parameters=params)
        return int(before)

    def reassign_events(self, from_issue_ids, to_issue_id) -> int:
        client = self._conn()
        ids = [str(i) for i in from_issue_ids]
        if not ids:
            return 0
        client.command(
            f"ALTER TABLE {self.TABLE} UPDATE issue_id = %(to)s WHERE issue_id IN %(ids)s",
            parameters={"to": str(to_issue_id), "ids": ids},
        )
        return len(ids)


@lru_cache(maxsize=1)
def get_event_store():
    backend = getattr(settings, "EVENT_STORE_BACKEND", "orm")
    if backend == "clickhouse":
        return ClickHouseEventStore()
    return OrmEventStore()
