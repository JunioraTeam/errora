"""Organization-related async tasks (invite email delivery)."""

from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


@shared_task(ignore_result=True, max_retries=3, default_retry_delay=30)
def send_invite_email(invite_id: str) -> None:
    """Email an organization invite with its accept link."""
    from .models import OrganizationInvite

    invite = OrganizationInvite.objects.select_related("organization").filter(id=invite_id).first()
    if invite is None or not invite.email:
        return

    accept_url = f"{settings.FRONTEND_URL}/invite?token={invite.token}"
    org_name = invite.organization.name
    send_mail(
        subject=f"You're invited to {org_name} on Errora",
        message=(
            f"You have been invited to join {org_name} as {invite.role}.\n\n"
            f"Accept the invite:\n{accept_url}\n\n"
            "This link expires in 7 days."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[invite.email],
        fail_silently=True,
    )
