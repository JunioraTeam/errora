from django.core.management.base import BaseCommand

from apps.billing.models import Plan
from apps.billing.plans import DEFAULT_PLANS


class Command(BaseCommand):
    help = "Seed/refresh the default pricing plans (idempotent)."

    def handle(self, *args, **options):
        for data in DEFAULT_PLANS:
            plan, created = Plan.objects.update_or_create(slug=data["slug"], defaults=data)
            verb = "Created" if created else "Updated"
            self.stdout.write(self.style.SUCCESS(f"{verb} plan: {plan.slug}"))
