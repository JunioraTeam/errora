from __future__ import annotations

from adrf import viewsets
from adrf.generics import ListAPIView, aget_object_or_404
from adrf.views import APIView
from asgiref.sync import sync_to_async
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.organizations.models import Organization
from apps.organizations.roles import WEBHOOK_MANAGE
from apps.organizations.services import ahas_permission

from .models import AlertRule, NotificationChannel, NotificationLog
from .serializers import (
    AlertRuleSerializer,
    ChannelSerializer,
    NotificationLogSerializer,
)


class _OrgScopedViewSet(viewsets.ModelViewSet):
    async def _aorg(self) -> Organization:
        return await aget_object_or_404(
            Organization.objects.filter(memberships__user=self.request.user),
            pk=self.kwargs["org_pk"],
        )

    async def _arequire(self, org):
        if not await ahas_permission(self.request.user, WEBHOOK_MANAGE, organization=org):
            raise PermissionDenied()

    async def perform_acreate(self, serializer):
        org = await self._aorg()
        await self._arequire(org)
        await serializer.asave(organization=org)

    async def perform_aupdate(self, serializer):
        await self._arequire(await self._aorg())
        await serializer.asave()

    async def perform_adestroy(self, instance):
        await self._arequire(await self._aorg())
        await instance.adelete()


class ChannelViewSet(_OrgScopedViewSet):
    serializer_class = ChannelSerializer
    queryset = NotificationChannel.objects.all()  # introspection hint only

    def get_queryset(self):
        return NotificationChannel.objects.filter(
            organization_id=self.kwargs["org_pk"],
            organization__memberships__user=self.request.user,
        )


class AlertRuleViewSet(_OrgScopedViewSet):
    serializer_class = AlertRuleSerializer
    queryset = AlertRule.objects.all()  # introspection hint only

    def get_queryset(self):
        return AlertRule.objects.filter(
            organization_id=self.kwargs["org_pk"],
            organization__memberships__user=self.request.user,
        )


class NotificationLogListView(ListAPIView):
    """Webhook/alert delivery history for the dashboard (newest first)."""

    serializer_class = NotificationLogSerializer
    queryset = NotificationLog.objects.all()  # introspection hint only

    def get_queryset(self):
        qs = NotificationLog.objects.filter(
            rule__organization_id=self.kwargs["org_pk"],
            rule__organization__memberships__user=self.request.user,
        )
        params = self.request.query_params
        success = params.get("success")
        if success in ("true", "false"):
            qs = qs.filter(success=(success == "true"))
        if params.get("channel_type"):
            qs = qs.filter(channel_type=params["channel_type"])
        if params.get("event_type"):
            qs = qs.filter(event_type=params["event_type"])
        return qs


class NotificationLogReplayView(APIView):
    """Re-deliver a logged notification (e.g. after a failed webhook)."""

    async def post(self, request, org_pk, pk):
        org = await aget_object_or_404(
            Organization.objects.filter(memberships__user=request.user), pk=org_pk
        )
        if not await ahas_permission(request.user, WEBHOOK_MANAGE, organization=org):
            raise PermissionDenied()
        log = await aget_object_or_404(
            NotificationLog.objects.filter(rule__organization=org), pk=pk
        )
        if log.rule_id is None or not log.message:
            return Response({"detail": "Nothing to replay."}, status=400)

        from .tasks import deliver_notification

        await sync_to_async(deliver_notification.delay)(str(log.rule_id), log.message)
        return Response({"detail": "Replay queued."}, status=202)
