from __future__ import annotations

from adrf import viewsets
from adrf.generics import aget_object_or_404
from adrf.views import APIView
from asgiref.sync import sync_to_async
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.organizations.models import Organization
from apps.organizations.roles import ORG_BILLING
from apps.organizations.services import ahas_permission

from .models import Plan, Subscription
from .serializers import PlanSerializer, SubscriptionSerializer
from .services import usage_summary


class PlanViewSet(viewsets.ReadOnlyModelViewSet):
    """Public plan catalog for the pricing page."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    serializer_class = PlanSerializer
    queryset = Plan.objects.filter(is_public=True)


class UsageView(APIView):
    async def get(self, request, org_pk):
        org = await aget_object_or_404(
            Organization.objects.filter(memberships__user=request.user), pk=org_pk
        )
        # usage_summary touches Redis + several ORM tables synchronously; run it
        # off the event loop.
        return Response(await sync_to_async(usage_summary)(org))


class SubscriptionView(APIView):
    async def _aorg(self, request, org_pk):
        return await aget_object_or_404(
            Organization.objects.filter(memberships__user=request.user), pk=org_pk
        )

    async def get(self, request, org_pk):
        org = await self._aorg(request, org_pk)
        sub = await Subscription.objects.select_related("plan").filter(organization=org).afirst()
        if not sub:
            return Response({"detail": "No subscription."}, status=404)
        return Response(await SubscriptionSerializer(sub).adata)

    async def post(self, request, org_pk):
        org = await self._aorg(request, org_pk)
        if not await ahas_permission(request.user, ORG_BILLING, organization=org):
            return Response({"detail": "Forbidden."}, status=403)
        ser = SubscriptionSerializer(data=request.data)
        await sync_to_async(ser.is_valid)(raise_exception=True)
        plan = await aget_object_or_404(Plan, slug=ser.validated_data["plan_slug"])
        sub, _ = await Subscription.objects.aupdate_or_create(
            organization=org,
            defaults={"plan": plan, "payg_enabled": ser.validated_data.get("payg_enabled", False)},
        )
        return Response(await SubscriptionSerializer(sub).adata)
