"""
Purge old event data for retention. Deletes Events whose ingest time is older
than ``--days`` (default 90), in batches to avoid long locks, then removes
issues left with no events.

Usage:
    python manage.py purge_events            # 90 days
    python manage.py purge_events --days 30
    python manage.py purge_events --days 30 --dry-run
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.issues.retention import count_events_before, purge_events_before


class Command(BaseCommand):
    help = "Delete events (and now-empty issues) older than N days."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=90,
            help="Delete events older than this many days (default: 90).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be deleted without deleting.",
        )

    def handle(self, *args, **options):
        days = options["days"]
        if days <= 0:
            raise CommandError("--days must be a positive integer.")

        cutoff = timezone.now() - timezone.timedelta(days=days)
        self.stdout.write(
            f"Purging events received before {cutoff.isoformat()} (older than {days} days)."
        )

        if options["dry_run"]:
            events, issues = count_events_before(cutoff)
            self.stdout.write(
                self.style.WARNING(
                    f"[dry-run] would delete {events} events and ~{issues} now-empty issues."
                )
            )
            return

        deleted_events, deleted_issues = purge_events_before(cutoff)
        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Deleted {deleted_events} events and {deleted_issues} empty issues."
            )
        )
