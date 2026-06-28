"""
LLM observability API. Project-scoped, async DRF (adrf) — same pattern as the
performance views: thin async wrappers that off-load the heavy ORM aggregation in
``queries`` to a thread via ``sync_to_async``.
"""

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


class AgentsOverviewView(_ProjectScoped):
    """Agents dashboard: runs, LLM calls, tool calls, duration, tokens, by-model."""

    async def get(self, request, project_pk):
        project = await self.aget_project(request, project_pk)
        params = request.query_params
        payload = await sync_to_async(queries.agents_overview)(
            project,
            stats_period=params.get("stats_period", queries.DEFAULT_PERIOD),
            start=params.get("start"),
            end=params.get("end"),
        )
        return Response(payload)


class McpOverviewView(_ProjectScoped):
    """MCP dashboard: traffic, by client / method / transport, top tools/resources/prompts."""

    async def get(self, request, project_pk):
        project = await self.aget_project(request, project_pk)
        params = request.query_params
        payload = await sync_to_async(queries.mcp_overview)(
            project,
            stats_period=params.get("stats_period", queries.DEFAULT_PERIOD),
            start=params.get("start"),
            end=params.get("end"),
        )
        return Response(payload)


class AgentRunListView(_ProjectScoped):
    """Recent agent runs (one row per trace) with per-run rollups."""

    async def get(self, request, project_pk):
        project = await self.aget_project(request, project_pk)
        params = request.query_params
        payload = await sync_to_async(queries.list_runs)(
            project,
            stats_period=params.get("stats_period", queries.DEFAULT_PERIOD),
            start=params.get("start"),
            end=params.get("end"),
            limit=self._int(params, "limit", 50, 1, 100),
            offset=self._int(params, "offset", 0, 0),
        )
        return Response(payload)


class AgentRunDetailView(_ProjectScoped):
    """A single agent run: its gen_ai/mcp span timeline + rollup summary."""

    async def get(self, request, project_pk, trace_id):
        project = await self.aget_project(request, project_pk)
        payload = await sync_to_async(queries.run_detail)(project, trace_id)
        if payload is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(payload)
