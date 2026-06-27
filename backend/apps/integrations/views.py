from __future__ import annotations

from adrf import viewsets
from adrf.generics import aget_object_or_404
from asgiref.sync import sync_to_async
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.organizations.models import Organization
from apps.organizations.roles import INTEGRATION_MANAGE
from apps.organizations.services import ahas_permission

from .models import Integration
from .serializers import IntegrationSerializer, RepositorySerializer
from .services import sync_repositories


class IntegrationViewSet(viewsets.ModelViewSet):
    serializer_class = IntegrationSerializer
    queryset = Integration.objects.all()  # introspection hint only

    def get_queryset(self):
        # Lazy + membership-scoped; ``select_related`` lets detail actions read
        # ``integration.organization`` without a sync query.
        return Integration.objects.filter(
            organization_id=self.kwargs["org_pk"],
            organization__memberships__user=self.request.user,
        ).select_related("organization")

    async def _aorg(self) -> Organization:
        return await aget_object_or_404(
            Organization.objects.filter(memberships__user=self.request.user),
            pk=self.kwargs["org_pk"],
        )

    async def _arequire_manage(self, org):
        if not await ahas_permission(self.request.user, INTEGRATION_MANAGE, organization=org):
            raise PermissionDenied()

    async def perform_acreate(self, serializer):
        org = await self._aorg()
        await self._arequire_manage(org)
        await serializer.asave(organization=org)

    async def perform_aupdate(self, serializer):
        await self._arequire_manage(await self._aorg())
        await serializer.asave()

    @action(detail=True, methods=["post"])
    async def sync(self, request, org_pk=None, pk=None):
        integration = await self.aget_object()
        await self._arequire_manage(integration.organization)
        try:
            repos = await sync_to_async(sync_repositories)(integration)
        except Exception as exc:  # noqa: BLE001 - surface provider errors to the user
            raise ValidationError(f"Sync failed: {exc}") from exc
        return Response(await RepositorySerializer(repos, many=True).adata)

    @action(detail=True, methods=["get"])
    async def repositories(self, request, org_pk=None, pk=None):
        integration = await self.aget_object()
        repos = integration.repositories.all()
        return Response(await RepositorySerializer(repos, many=True).adata)
