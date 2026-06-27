from __future__ import annotations

import asyncio
import json

from adrf import viewsets
from adrf.generics import ListAPIView, aget_object_or_404
from adrf.views import APIView
from asgiref.sync import sync_to_async
from django.contrib.auth import get_user_model
from django.http import JsonResponse, StreamingHttpResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.authentication import decode_token
from apps.issues.models import Issue
from apps.organizations.models import Organization, Project
from apps.organizations.roles import AI_TRIGGER, INTEGRATION_MANAGE
from apps.organizations.services import ahas_permission

from .models import AIConfig, AutoFixRun
from .serializers import AIConfigSerializer, AutoFixRunSerializer
from .tasks import run_autofix_task

User = get_user_model()


class AIConfigViewSet(viewsets.ModelViewSet):
    serializer_class = AIConfigSerializer
    queryset = AIConfig.objects.all()  # introspection hint only

    def get_queryset(self):
        # Lazy + membership-scoped (no eager DB), so it is async-safe.
        return AIConfig.objects.filter(
            organization_id=self.kwargs["org_pk"],
            organization__memberships__user=self.request.user,
        )

    async def _arequire_manage(self):
        org = await aget_object_or_404(
            Organization.objects.filter(memberships__user=self.request.user),
            pk=self.kwargs["org_pk"],
        )
        if not await ahas_permission(self.request.user, INTEGRATION_MANAGE, organization=org):
            raise PermissionDenied()
        return org

    async def perform_acreate(self, serializer):
        org = await self._arequire_manage()
        await serializer.asave(organization=org)

    async def perform_aupdate(self, serializer):
        # Without this, any member could rewrite base_url / api_key / auto_trigger.
        await self._arequire_manage()
        await serializer.asave()

    async def perform_adestroy(self, instance):
        await self._arequire_manage()
        await instance.adelete()


class TriggerAutoFixView(APIView):
    async def post(self, request, project_pk, pk):
        project = await aget_object_or_404(
            Project.objects.filter(organization__memberships__user=request.user).select_related(
                "organization"
            ),
            pk=project_pk,
        )
        if not await ahas_permission(
            request.user, AI_TRIGGER, organization=project.organization, project=project
        ):
            raise PermissionDenied()
        issue = await aget_object_or_404(Issue, pk=pk, project=project)

        # Don't start a second fix while one is already in flight for this issue.
        active = await issue.autofix_runs.filter(status__in=AutoFixRun.ACTIVE_STATUSES).afirst()
        if active is not None:
            return Response(await AutoFixRunSerializer(active).adata, status=409)

        run = await AutoFixRun.objects.acreate(issue=issue, triggered_by=request.user)
        await sync_to_async(run_autofix_task.delay)(str(run.id))
        return Response(await AutoFixRunSerializer(run).adata, status=202)

    async def get(self, request, project_pk, pk):
        issue = await aget_object_or_404(
            Issue.objects.filter(project__organization__memberships__user=request.user),
            pk=pk,
            project_id=project_pk,
        )
        runs = issue.autofix_runs.select_related("issue", "issue__project", "triggered_by").all()
        return Response(await AutoFixRunSerializer(runs, many=True).adata)


def _run_snapshot(run: AutoFixRun) -> dict:
    return {
        "id": str(run.id),
        "status": run.status,
        "provider": run.provider,
        "model": run.model,
        "explanation": run.explanation,
        "error": run.error,
        "mr_url": run.mr_url,
        "branch": run.branch,
        "tokens_used": run.tokens_used,
        "updated_at": run.updated_at.isoformat(),
    }


class AutoFixStreamTicketView(APIView):
    """Mint a short-lived, single-run token the browser can put in the SSE URL.
    Authenticated with the normal bearer token; the access token itself never
    goes in a URL (where it would leak to logs/history/Referer)."""

    async def post(self, request, project_pk, pk):
        issue = await aget_object_or_404(
            Issue.objects.filter(project__organization__memberships__user=request.user),
            pk=pk,
            project_id=project_pk,
        )
        run_id = request.data.get("run_id")
        run = await issue.autofix_runs.filter(id=run_id).afirst() if run_id else None
        if run is None:
            return Response({"detail": "Run not found."}, status=404)
        from apps.accounts.authentication import issue_stream_token

        return Response({"token": issue_stream_token(request.user, run_id=str(run.id))})


@method_decorator(csrf_exempt, name="dispatch")
class AutoFixRunStreamView(View):
    """
    Server-Sent Events stream of a single auto-fix run's live status/logs. Polls
    the row and emits an event whenever it changes, until the run reaches a
    terminal state. EventSource can't set headers, so a **short-lived, run-scoped
    stream token** (minted via the ticket endpoint) is passed as ``?token=`` —
    not the long-lived access token.
    """

    POLL_SECONDS = 1
    MAX_TICKS = 600  # ~10 min safety cap

    async def get(self, request, run_id):
        user = await self._authenticate(request, run_id)
        if user is None:
            return JsonResponse({"detail": "Authentication required."}, status=401)
        run = await self._get_run(run_id, user)
        if run is None:
            return JsonResponse({"detail": "Run not found."}, status=404)

        response = StreamingHttpResponse(
            self._event_stream(run_id), content_type="text/event-stream"
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"  # disable nginx buffering
        return response

    @sync_to_async
    def _authenticate(self, request, run_id):
        token = request.GET.get("token", "")
        try:
            payload = decode_token(token, expected_type="stream")
            if str(payload.get("run")) != str(run_id):
                return None
            user = User.objects.get(id=payload["sub"], is_active=True)
        except Exception:  # noqa: BLE001
            return None
        if payload.get("ver", 0) != user.token_version:
            return None
        return user

    @sync_to_async
    def _get_run(self, run_id, user):
        return (
            AutoFixRun.objects.filter(
                id=run_id, issue__project__organization__memberships__user=user
            )
            .select_related("issue")
            .first()
        )

    async def _event_stream(self, run_id):
        last = None
        for _ in range(self.MAX_TICKS):
            run = await AutoFixRun.objects.filter(id=run_id).afirst()
            if run is None:
                break
            snapshot = _run_snapshot(run)
            if snapshot != last:
                yield f"data: {json.dumps(snapshot)}\n\n"
                last = snapshot
            if run.status in (
                AutoFixRun.Status.COMPLETED,
                AutoFixRun.Status.FAILED,
            ):
                break
            await asyncio.sleep(self.POLL_SECONDS)
        yield "event: done\ndata: {}\n\n"


class AutoFixRunListView(ListAPIView):
    """Org-wide auto-fix history (the AI-fix status page). Newest first; supports
    ?status= and ?project= filters."""

    serializer_class = AutoFixRunSerializer
    queryset = AutoFixRun.objects.all()  # introspection hint only

    def get_queryset(self):
        qs = AutoFixRun.objects.filter(
            issue__project__organization_id=self.kwargs["org_pk"],
            issue__project__organization__memberships__user=self.request.user,
        ).select_related("issue", "issue__project", "triggered_by")
        params = self.request.query_params
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("project"):
            qs = qs.filter(issue__project_id=params["project"])
        return qs
