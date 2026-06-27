from __future__ import annotations

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_default_organization(sender, instance, created, **kwargs):
    """Every new user gets a personal organization by default (per spec)."""
    if not created:
        return
    # Imported lazily to avoid app-loading order issues.
    from apps.organizations.services import create_organization_with_owner

    create_organization_with_owner(owner=instance, name="Default organization")
