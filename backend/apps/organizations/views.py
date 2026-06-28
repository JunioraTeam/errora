from __future__ import annotations

from adrf import viewsets
from adrf.generics import aget_object_or_404
from adrf.views import APIView
from asgiref.sync import sync_to_async
from django.db.models import Count, Max, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.issues.models import IssueStatus

from .models import (
    Membership,
    Organization,
    OrganizationInvite,
    Project,
    ProjectKey,
    _gen_key,
)
from .roles import ORG_MANAGE, PROJECT_CREATE, PROJECT_MANAGE, Role
from .serializers import (
    InviteSerializer,
    MembershipSerializer,
    OrganizationSerializer,
    ProjectKeySerializer,
    ProjectSerializer,
)
from .services import ahas_permission, create_organization_with_owner, create_project


class OrganizationViewSet(viewsets.ModelViewSet):
    serializer_class = OrganizationSerializer

    def get_queryset(self):
        # Lazy queryset only — no DB access here, so it is safe to build inside
        # the async list/retrieve paths (the query executes later, off-loop).
        return Organization.objects.filter(memberships__user=self.request.user).distinct()

    async def perform_acreate(self, serializer):
        org = await sync_to_async(create_organization_with_owner)(
            owner=self.request.user, name=serializer.validated_data["name"]
        )
        serializer.instance = org

    async def _arequire(self, org, capability):
        if not await ahas_permission(self.request.user, capability, organization=org):
            raise PermissionDenied()

    async def perform_aupdate(self, serializer):
        await self._arequire(serializer.instance, ORG_MANAGE)
        await serializer.asave()

    async def perform_adestroy(self, instance):
        await self._arequire(instance, ORG_MANAGE)
        await instance.adelete()

    @action(detail=True, methods=["get"])
    async def members(self, request, pk=None):
        org = await self.aget_object()
        memberships = org.memberships.select_related("user").all()
        return Response(await MembershipSerializer(memberships, many=True).adata)

    @action(detail=True, methods=["patch"], url_path="members/(?P<member_id>[^/.]+)")
    async def update_member(self, request, pk=None, member_id=None):
        org = await self.aget_object()
        await self._arequire(org, ORG_MANAGE)
        membership = await aget_object_or_404(Membership, id=member_id, organization=org)
        role = request.data.get("role")
        if role not in Role.values:
            return Response({"detail": "Invalid role."}, status=400)
        membership.role = role
        await membership.asave(update_fields=["role"])
        return Response(await MembershipSerializer(membership).adata)

    @action(detail=True, methods=["get"])
    async def invites(self, request, pk=None):
        org = await self.aget_object()
        await self._arequire(org, ORG_MANAGE)
        invites = org.invites.order_by("-created_at")
        return Response(await InviteSerializer(invites, many=True).adata)

    @action(detail=True, methods=["post"])
    async def invite(self, request, pk=None):
        org = await self.aget_object()
        await self._arequire(org, ORG_MANAGE)
        ser = InviteSerializer(data=request.data)
        await sync_to_async(ser.is_valid)(raise_exception=True)
        # Upsert on (organization, email): re-inviting the same address resends
        # the invite instead of 500-ing on the unique constraint. A resend mints
        # a fresh token and resets status/expiry so only the newest link works.
        invite, _ = await OrganizationInvite.objects.aupdate_or_create(
            organization=org,
            email=ser.validated_data["email"],
            defaults={
                "role": ser.validated_data.get("role", Role.MEMBER),
                "invited_by": request.user,
                "status": OrganizationInvite.Status.PENDING,
                "token": _gen_key(),
                "expires_at": timezone.now() + timezone.timedelta(days=7),
            },
        )
        # Deliver the invite email off-request (best-effort). ``.delay`` is a
        # blocking broker publish (and runs the task inline under eager mode), so
        # off-load it to a thread rather than calling it on the event loop.
        from .tasks import send_invite_email

        await sync_to_async(send_invite_email.delay)(str(invite.id))
        return Response(await InviteSerializer(invite).adata, status=status.HTTP_201_CREATED)


class InvitePreviewView(APIView):
    """Public lookup of an invite by token so the accept page can show who/what it
    is for *before* the recipient signs in. Leaks only org name + invited email."""

    permission_classes = [AllowAny]

    async def get(self, request, token):
        invite = (
            await OrganizationInvite.objects.select_related("organization")
            .filter(token=token)
            .afirst()
        )
        if invite is None:
            return Response({"detail": "Invite not found."}, status=404)
        valid = not invite.is_expired and invite.status == OrganizationInvite.Status.PENDING
        return Response(
            {
                "email": invite.email,
                "role": invite.role,
                "organization_name": invite.organization.name,
                "status": invite.status,
                "valid": valid,
                "expired": invite.is_expired,
            }
        )


class InviteAcceptView(viewsets.ViewSet):
    async def acreate(self, request):
        token = request.data.get("token", "")
        invite = await aget_object_or_404(OrganizationInvite, token=token)
        if invite.is_expired or invite.status != OrganizationInvite.Status.PENDING:
            return Response({"detail": "Invite is no longer valid."}, status=400)
        # Bind the invite to its addressee: the accepting account must own the
        # invited email (otherwise a leaked token would let anyone join).
        user_email = (request.user.email or "").lower()
        if not user_email or user_email != invite.email.lower():
            return Response(
                {"detail": "This invite was sent to a different email address."}, status=403
            )
        await Membership.objects.aget_or_create(
            organization_id=invite.organization_id,
            user=request.user,
            defaults={"role": invite.role},
        )
        invite.status = OrganizationInvite.Status.ACCEPTED
        await invite.asave(update_fields=["status"])
        return Response(
            {"detail": "Joined organization.", "organization": str(invite.organization_id)}
        )


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer

    async def _aorg(self) -> Organization:
        return await aget_object_or_404(
            Organization.objects.filter(memberships__user=self.request.user),
            pk=self.kwargs["org_pk"],
        )

    def get_queryset(self):
        # Membership is enforced inside the filter (no eager DB call here), so the
        # queryset stays lazy and async-safe. ``select_related("organization")``
        # lets detail actions read ``project.organization`` without a sync query.
        return (
            Project.objects.filter(
                organization_id=self.kwargs["org_pk"],
                organization__memberships__user=self.request.user,
            )
            .select_related("organization")
            .prefetch_related("keys")
            .annotate(
                open_issues_count=Count(
                    "issues",
                    filter=Q(issues__status=IssueStatus.UNRESOLVED),
                    distinct=True,
                ),
                last_event_at=Max("events__received_at"),
            )
            .distinct()
        )

    async def perform_acreate(self, serializer):
        org = await self._aorg()
        if not await ahas_permission(self.request.user, PROJECT_CREATE, organization=org):
            raise PermissionDenied()
        serializer.instance = await sync_to_async(create_project)(
            organization=org,
            name=serializer.validated_data["name"],
            platform=serializer.validated_data.get("platform", "other"),
        )

    @action(detail=False, methods=["get"])
    async def stats(self, request, org_pk=None):
        """Per-project daily errors + transactions over the last ``days`` (1–30,
        default 7) for the project-card trend bars. Returns
        ``{project_id: {"errors": [...], "transactions": [...]}}``."""
        org = await self._aorg()
        try:
            days = min(max(int(request.query_params.get("days", 7)), 1), 30)
        except ValueError:
            days = 7
        data = await sync_to_async(self._project_stats)(org, days)
        return Response(data)

    def _project_stats(self, org, days: int) -> dict:
        from datetime import timedelta

        from django.db.models.functions import TruncDate

        from apps.issues.store import get_event_store
        from apps.performance.models import Transaction

        today = timezone.localdate()
        start = today - timedelta(days=days - 1)
        index = {start + timedelta(days=i): i for i in range(days)}

        project_ids = list(
            Project.objects.filter(
                organization=org, organization__memberships__user=self.request.user
            )
            .values_list("id", flat=True)
            .distinct()
        )
        errors = get_event_store().daily_counts_per_project(project_ids, start, days)
        out = {
            str(p): {"errors": errors.get(str(p), [0] * days), "transactions": [0] * days}
            for p in project_ids
        }
        tx_rows = (
            Transaction.objects.filter(project_id__in=project_ids, timestamp__date__gte=start)
            .annotate(day=TruncDate("timestamp"))
            .values("project_id", "day")
            .annotate(c=Count("event_id"))
        )
        for r in tx_rows:
            key = str(r["project_id"])
            i = index.get(r["day"])
            if key in out and i is not None:
                out[key]["transactions"][i] = r["c"]
        return out

    @action(detail=True, methods=["post"], url_path="keys")
    async def create_key(self, request, org_pk=None, pk=None):
        project = await self.aget_object()
        if not await ahas_permission(
            request.user, PROJECT_MANAGE, organization=project.organization, project=project
        ):
            raise PermissionDenied()
        key = await ProjectKey.objects.acreate(
            project=project, label=request.data.get("label", "default")
        )
        return Response(await ProjectKeySerializer(key).adata, status=status.HTTP_201_CREATED)
