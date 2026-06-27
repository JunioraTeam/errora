"""
Seed a deterministic dataset for the Playwright e2e suite.

Idempotent: running it twice won't duplicate the account or pile up issues. It
creates one known user (phone + password), a project, a handful of issues with
events spread across the last 30 days / 24 hours (so the trend charts render),
plus a couple of transactions and logs. Credentials are intentionally fixed so
the frontend specs can log in without scraping anything.

    python manage.py seed_e2e
"""

from __future__ import annotations

import time

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import User
from apps.accounts.phone import normalize_phone
from apps.ingest.normalize import normalize_event
from apps.issues.models import Issue
from apps.issues.services import store_event
from apps.logs.services import store_logs
from apps.organizations.models import Project
from apps.organizations.services import create_project
from apps.performance.services import store_transaction

# The UI submits the national number; the auth layer stores/looks it up in E.164.
# Seed the canonical form so login matches this account (not auto-registers a new one).
PHONE_NATIONAL = "9123456789"
PHONE = normalize_phone(PHONE_NATIONAL)  # "+989123456789"
PASSWORD = "Password123!"
EMAIL = "e2e@errora.dev"
PROJECT_NAME = "E2E Project"

HOUR = 3600
DAY = 86400


def _exception(type_: str, value: str, fn: str) -> dict:
    return {
        "type": type_,
        "value": value,
        "stacktrace": {
            "frames": [
                {
                    "filename": "app/services/checkout.py",
                    "function": "process",
                    "lineno": 42,
                    "in_app": True,
                    "pre_context": ["def process(order):", "    total = 0"],
                    "context_line": "    return order.total / order.items",
                    "post_context": ["    # unreachable", ""],
                },
                {
                    "filename": f"app/{fn}.py",
                    "function": fn,
                    "lineno": 17,
                    "in_app": True,
                    "context_line": f"    raise {type_}({value!r})",
                },
            ]
        },
    }


def _raw_event(type_: str, value: str, fn: str, ts: float, user_id: str) -> dict:
    return {
        "platform": "python",
        "level": "error",
        "timestamp": ts,
        "environment": "production",
        "release": "1.4.2",
        "user": {"id": user_id, "email": f"{user_id}@example.com", "ip_address": "203.0.113.7"},
        "request": {
            "method": "POST",
            "url": "https://shop.example.com/api/checkout",
            "headers": [["Referer", "https://shop.example.com/cart"]],
        },
        "breadcrumbs": [
            {
                "timestamp": ts - 1,
                "category": "db.sql.query",
                "message": "SELECT * FROM orders WHERE id = 42 AND status = 'open'",
            },
            {
                "timestamp": ts - 0.5,
                "category": "http",
                "data": {
                    "method": "GET",
                    "url": "https://api.example.com/rates",
                    "status_code": 200,
                },
            },
        ],
        "exception": {"values": [_exception(type_, value, fn)]},
    }


ISSUES = [
    ("ValueError", "division by zero", "checkout"),
    ("KeyError", "'user_id'", "auth"),
    ("TimeoutError", "upstream timed out", "gateway"),
]


class Command(BaseCommand):
    help = "Seed a deterministic dataset for the Playwright e2e suite."

    @transaction.atomic
    def handle(self, *args, **options):
        user, created = User.objects.get_or_create(
            email=EMAIL, defaults={"phone": PHONE, "phone_verified": True}
        )
        user.phone = PHONE
        user.phone_verified = True
        user.is_active = True
        user.set_password(PASSWORD)
        user.save()

        org = user.organizations.first()
        if org is None:
            from apps.organizations.services import create_organization_with_owner

            org = create_organization_with_owner(owner=user, name="E2E Org")

        project = Project.objects.filter(organization=org, name=PROJECT_NAME).first()
        if project is None:
            project = create_project(organization=org, name=PROJECT_NAME, platform="python")

        if Issue.objects.filter(project=project).exists():
            self.stdout.write(self.style.WARNING("Already seeded; refreshing credentials only."))
            self._report(project)
            return

        now = time.time()
        # Main issue: many events across the last 30 days AND the last 24 hours so
        # both trend-chart windows have data. Two distinct users → users_seen = 2.
        type_, value, fn = ISSUES[0]
        offsets = [d * DAY + 12 * HOUR for d in range(0, 30, 2)] + [
            h * HOUR for h in range(0, 24, 3)
        ]
        for i, off in enumerate(offsets):
            raw = _raw_event(type_, value, fn, now - off, user_id=f"user-{i % 2}")
            store_event(project, normalize_event(raw))

        # A couple of secondary issues with a few recent events each.
        for type_, value, fn in ISSUES[1:]:
            for off in (1 * HOUR, 5 * HOUR, 2 * DAY):
                raw = _raw_event(type_, value, fn, now - off, user_id="user-0")
                store_event(project, normalize_event(raw))

        # Transactions (feed the project-card trend + performance page).
        for i in range(8):
            store_transaction(
                project,
                {
                    "name": "GET /api/checkout",
                    "op": "http.server",
                    "status": "ok" if i % 4 else "internal_error",
                    "duration_ms": 120 + i * 15,
                    "start_timestamp": now - i * 3 * HOUR,
                    "environment": "production",
                    "release": "1.4.2",
                    "platform": "python",
                    "spans": [],
                },
            )

        # Logs.
        store_logs(
            project,
            [
                {
                    "timestamp": now - i * HOUR,
                    "level": ["info", "warn", "error"][i % 3],
                    "body": f"Checkout pipeline step {i} completed",
                    "environment": "production",
                    "release": "1.4.2",
                    "attributes": {"step": i, "service": "checkout"},
                }
                for i in range(6)
            ],
        )

        self.stdout.write(self.style.SUCCESS("Seeded e2e dataset."))
        self._report(project)

    def _report(self, project: Project) -> None:
        key = project.keys.first()
        self.stdout.write(f"  user phone : {PHONE}")
        self.stdout.write(f"  password   : {PASSWORD}")
        self.stdout.write(f"  project    : {project.name} ({project.id})")
        if key:
            self.stdout.write(f"  dsn        : {key.dsn()}")
