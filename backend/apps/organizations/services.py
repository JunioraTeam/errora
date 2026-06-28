"""Domain operations for organizations, memberships and effective permissions."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from .models import (
    Membership,
    Organization,
    OrganizationInvite,
    Project,
    ProjectKey,
    ProjectMembership,
)
from .roles import Role, role_has


@transaction.atomic
def create_organization_with_owner(*, owner, name: str) -> Organization:
    org = Organization.objects.create(name=name)
    Membership.objects.create(organization=org, user=owner, role=Role.OWNER)
    return org


@transaction.atomic
def accept_pending_invites(user) -> int:
    """Convert every pending, unexpired invite addressed to this user's email into
    a membership. Called on signup so an invited user who registers (instead of
    clicking the email link) still lands in the organization automatically.

    Returns the number of organizations joined.
    """
    if not user.email:
        return 0
    invites = OrganizationInvite.objects.filter(
        email__iexact=user.email,
        status=OrganizationInvite.Status.PENDING,
        expires_at__gt=timezone.now(),
    )
    joined = 0
    for invite in invites:
        Membership.objects.get_or_create(
            organization_id=invite.organization_id,
            user=user,
            defaults={"role": invite.role},
        )
        invite.status = OrganizationInvite.Status.ACCEPTED
        invite.save(update_fields=["status"])
        joined += 1
    return joined


@transaction.atomic
def create_project(*, organization: Organization, name: str, platform: str = "other") -> Project:
    project = Project.objects.create(organization=organization, name=name, platform=platform)
    ProjectKey.objects.create(project=project)  # default DSN
    return project


def effective_role(
    user, *, organization: Organization, project: Project | None = None
) -> str | None:
    """Resolve the user's effective role: project override > org membership."""
    if project is not None:
        pm = ProjectMembership.objects.filter(project=project, user=user).first()
        if pm:
            return pm.role
    m = Membership.objects.filter(organization=organization, user=user).first()
    return m.role if m else None


def has_permission(user, capability: str, *, organization, project=None) -> bool:
    if user.is_superuser:
        return True
    role = effective_role(user, organization=organization, project=project)
    return role is not None and role_has(role, capability)


async def aeffective_role(
    user, *, organization: Organization, project: Project | None = None
) -> str | None:
    """Async twin of :func:`effective_role` (native async ORM, no thread offload)."""
    if project is not None:
        pm = await ProjectMembership.objects.filter(project=project, user=user).afirst()
        if pm:
            return pm.role
    m = await Membership.objects.filter(organization=organization, user=user).afirst()
    return m.role if m else None


async def ahas_permission(user, capability: str, *, organization, project=None) -> bool:
    """Async twin of :func:`has_permission` for use inside async views."""
    if user.is_superuser:
        return True
    role = await aeffective_role(user, organization=organization, project=project)
    return role is not None and role_has(role, capability)
