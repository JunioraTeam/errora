from __future__ import annotations

from adrf.generics import aget_object_or_404
from adrf.views import APIView
from asgiref.sync import sync_to_async
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.organizations.models import Project
from apps.organizations.roles import PROJECT_READ
from apps.organizations.services import ahas_permission

from . import queries


class _ProjectScoped(APIView):
    async def aget_project(self, request, project_pk) -> Project:
        project = await aget_object_or_404(
            Project.objects.filter(organization__memberships__user=request.user).select_related(
                "organization"
            ),
            pk=project_pk,
        )
        if not await ahas_permission(
            request.user, PROJECT_READ, organization=project.organization, project=project
        ):
            raise PermissionDenied()
        return project

    @staticmethod
    def _int(params, key, default, lo=None, hi=None):
        try:
            v = int(params.get(key, default))
        except (ValueError, TypeError):
            v = default
        if lo is not None:
            v = max(v, lo)
        if hi is not None:
            v = min(v, hi)
        return v


class LogListView(_ProjectScoped):
    """Search/filter structured logs over ``?stats_period`` with level facets.

    Query params: ``q`` (Sentry-style search), ``level`` (comma list),
    ``environment``, ``stats_period``, ``limit``, ``offset``.
    """

    async def get(self, request, project_pk):
        project = await self.aget_project(request, project_pk)
        params = request.query_params
        payload = await sync_to_async(queries.list_logs)(
            project,
            q=params.get("q") or "",
            level=params.get("level") or "",
            environment=params.get("environment") or "",
            stats_period=params.get("stats_period", queries.DEFAULT_PERIOD),
            limit=self._int(params, "limit", 50, 1, 100),
            offset=self._int(params, "offset", 0, 0),
        )
        return Response(payload)


class LogDetailView(_ProjectScoped):
    """A single log record with its full attribute bag."""

    async def get(self, request, project_pk, pk):
        project = await self.aget_project(request, project_pk)
        payload = await sync_to_async(queries.log_detail)(project, pk)
        if payload is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(payload)


class LogAttributeKeysView(_ProjectScoped):
    """Distinct attribute keys in the window (filter autocomplete)."""

    async def get(self, request, project_pk):
        project = await self.aget_project(request, project_pk)
        keys = await sync_to_async(queries.attribute_keys)(
            project, stats_period=request.query_params.get("stats_period", queries.DEFAULT_PERIOD)
        )
        return Response({"keys": keys})
