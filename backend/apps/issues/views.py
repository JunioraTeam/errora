from __future__ import annotations

from adrf import viewsets
from adrf.generics import aget_object_or_404
from asgiref.sync import sync_to_async
from django.db.models import Exists, OuterRef
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.organizations.models import Membership, Project
from apps.organizations.roles import ISSUE_WRITE, PROJECT_READ
from apps.organizations.services import ahas_permission

from .models import Issue, IssueComment, IssuePriority, IssueStatus
from .search import apply_issue_search
from .serializers import (
    IssueCommentSerializer,
    IssueDetailSerializer,
    IssueExternalIssueSerializer,
    IssueSerializer,
)
from .services import (
    create_tracker_issue,
    link_tracker_issue,
    merge_issues,
    org_repositories,
    resolve_repository,
    search_tracker_issues,
)
from .store import get_event_store


class ProjectScopedMixin:
    async def aget_project(self) -> Project:
        cached = getattr(self, "_project_cache", None)
        if cached is not None:
            return cached
        project = await aget_object_or_404(
            Project.objects.filter(
                organization__memberships__user=self.request.user
            ).select_related("organization"),
            pk=self.kwargs["project_pk"],
        )
        if not await ahas_permission(
            self.request.user, PROJECT_READ, organization=project.organization, project=project
        ):
            raise PermissionDenied()
        self._project_cache = project
        return project

    async def arequire_write(self, project):
        if not await ahas_permission(
            self.request.user, ISSUE_WRITE, organization=project.organization, project=project
        ):
            raise PermissionDenied()


class IssueViewSet(ProjectScopedMixin, viewsets.GenericViewSet):
    serializer_class = IssueSerializer
    queryset = Issue.objects.all()  # introspection hint only; never executed directly
    ALLOWED_ORDERING = {"last_seen", "first_seen", "times_seen"}

    def get_serializer_class(self):
        return IssueDetailSerializer if self.action == "aretrieve" else IssueSerializer

    def _issue_queryset(self, project):
        """Build the (lazy) Issue queryset with all filters applied.

        Runs off the event loop via ``sync_to_async`` because the FULLTEXT
        capability probe in :func:`apply_issue_search` issues a sync DB query on
        MySQL/MariaDB; the queryset itself is not executed here.
        """
        # prefetch assignees to avoid an N+1 (the serializer renders the M2M).
        qs = (
            Issue.objects.filter(project=project)
            .select_related("project")
            .prefetch_related("assignees")
        )
        params = self.request.query_params
        for field in ("status", "level", "platform"):
            val = params.get(field)
            if val:
                qs = qs.filter(**{field: val})
        q = params.get("q")
        if q:
            qs = apply_issue_search(qs, q)
        env = params.get("environment")
        if env:
            qs = qs.filter(events__environment=env).distinct()

        # Datetime range filter on last_seen. Accepts ISO-8601 date or datetime;
        # invalid values are ignored rather than 400-ing.
        date_from = parse_datetime(params.get("date_from") or "") or parse_date(
            params.get("date_from") or ""
        )
        date_to = parse_datetime(params.get("date_to") or "") or parse_date(
            params.get("date_to") or ""
        )
        if date_from:
            qs = qs.filter(last_seen__gte=date_from)
        if date_to:
            qs = qs.filter(last_seen__lte=date_to)

        ordering = params.get("ordering")
        if ordering and ordering.lstrip("-") in self.ALLOWED_ORDERING:
            qs = qs.order_by(ordering)

        # Per-user "has seen" flag (drives the unread dot) + bookmark star.
        seen = Issue.seen_by.through.objects.filter(
            issue_id=OuterRef("pk"), user_id=self.request.user.id
        )
        bookmarked = Issue.bookmarked_by.through.objects.filter(
            issue_id=OuterRef("pk"), user_id=self.request.user.id
        )
        return qs.annotate(has_seen=Exists(seen), is_bookmarked=Exists(bookmarked))

    async def aget_issue(self) -> Issue:
        project = await self.aget_project()
        return await aget_object_or_404(
            Issue.objects.filter(project=project).select_related(
                "project",
                "project__organization",
                "project__repository",
                "project__repository__integration",
            ),
            pk=self.kwargs["pk"],
        )

    async def alist(self, request, *args, **kwargs):
        project = await self.aget_project()
        queryset = await sync_to_async(self._issue_queryset)(project)
        page = await self.apaginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return await self.get_apaginated_response(await serializer.adata)
        serializer = self.get_serializer(queryset, many=True)
        return Response(await serializer.adata)

    async def aretrieve(self, request, *args, **kwargs):
        issue = await self.aget_issue()
        # Opening an issue marks it read for this user.
        await issue.seen_by.aadd(request.user)
        issue.is_bookmarked = await issue.bookmarked_by.filter(pk=request.user.id).aexists()
        serializer = self.get_serializer(issue)
        return Response(await serializer.adata)

    async def _aset_status(self, status_value):
        issue = await self.aget_issue()
        await self.arequire_write(issue.project)
        issue.status = status_value
        await issue.asave(update_fields=["status"])
        return Response(await IssueSerializer(issue).adata)

    async def resolve(self, request, project_pk=None, pk=None):
        return await self._aset_status(IssueStatus.RESOLVED)

    async def ignore(self, request, project_pk=None, pk=None):
        return await self._aset_status(IssueStatus.IGNORED)

    async def unresolve(self, request, project_pk=None, pk=None):
        return await self._aset_status(IssueStatus.UNRESOLVED)

    async def archive(self, request, project_pk=None, pk=None):
        return await self._aset_status(IssueStatus.ARCHIVED)

    async def bookmark(self, request, project_pk=None, pk=None):
        """Toggle the current user's bookmark (star) on this issue. Body may set
        {"bookmarked": true|false}; omitted toggles."""
        issue = await self.aget_issue()
        want = request.data.get("bookmarked")
        is_set = await issue.bookmarked_by.filter(pk=request.user.id).aexists()
        target = (not is_set) if want is None else bool(want)
        if target and not is_set:
            await issue.bookmarked_by.aadd(request.user)
        elif not target and is_set:
            await issue.bookmarked_by.aremove(request.user)
        issue.is_bookmarked = target
        return Response(await IssueSerializer(issue).adata)

    async def assign(self, request, project_pk=None, pk=None):
        """Assign to one or many organization members. Body: {"assignees": [user_id, ...]}
        (a single id is also accepted). Pass an empty list to unassign."""
        issue = await self.aget_issue()
        await self.arequire_write(issue.project)
        raw = request.data.get("assignees", request.data.get("assignee") or [])
        ids = raw if isinstance(raw, list) else [raw]
        ids = [str(i) for i in ids if i]

        valid = {
            str(uid)
            async for uid in Membership.objects.filter(
                organization=issue.project.organization, user_id__in=ids
            ).values_list("user_id", flat=True)
        }
        invalid = [i for i in ids if i not in valid]
        if invalid:
            return Response(
                {
                    "detail": "Some assignees are not members of this organization.",
                    "invalid": invalid,
                },
                status=400,
            )
        await issue.assignees.aset(ids)
        return Response(await IssueSerializer(issue).adata)

    async def merge(self, request, project_pk=None, pk=None):
        """Merge one or more source issues into this one. Body: {"sources": [id, ...]}.
        Their hashes + events are reassigned and counters folded in; sources are deleted."""
        target = await self.aget_issue()
        await self.arequire_write(target.project)
        raw = request.data.get("sources") or []
        source_ids = [str(s) for s in raw if str(s) != str(target.id)]
        sources = [
            s
            async for s in Issue.objects.filter(project=target.project, id__in=source_ids).exclude(
                id=target.id
            )
        ]
        if not sources:
            return Response({"detail": "No valid source issues to merge."}, status=400)
        await sync_to_async(merge_issues)(target, sources)
        return Response(await IssueSerializer(target).adata)

    async def events(self, request, project_pk=None, pk=None):
        issue = await self.aget_issue()
        try:
            limit = min(int(request.query_params.get("limit", 50)), 100)
        except ValueError:
            limit = 50
        try:
            offset = max(int(request.query_params.get("offset", 0)), 0)
        except ValueError:
            offset = 0
        rows, total = await sync_to_async(
            lambda: get_event_store().list_for_issue(issue, limit, offset)
        )()
        return Response({"count": total, "next": None, "previous": None, "results": rows})

    async def comments(self, request, project_pk=None, pk=None):
        issue = await self.aget_issue()
        if request.method == "POST":
            await self.arequire_write(issue.project)
            ser = IssueCommentSerializer(data=request.data)
            await sync_to_async(ser.is_valid)(raise_exception=True)
            comment = await IssueComment.objects.acreate(
                issue=issue, author=request.user, body=ser.validated_data["body"]
            )
            return Response(await IssueCommentSerializer(comment).adata, status=201)
        comments = issue.comments.select_related("author").all()
        return Response(await IssueCommentSerializer(comments, many=True).adata)

    async def set_priority(self, request, project_pk=None, pk=None):
        """Set issue priority. Body: {"priority": "low"|"medium"|"high"}."""
        issue = await self.aget_issue()
        await self.arequire_write(issue.project)
        value = request.data.get("priority")
        if value not in IssuePriority.values:
            return Response({"detail": "Invalid priority."}, status=400)
        issue.priority = value
        await issue.asave(update_fields=["priority"])
        return Response(await IssueSerializer(issue).adata)

    async def bulk(self, request, project_pk=None):
        """Apply an action to many issues at once. Body:
        {"ids": [...], "action": "resolve|ignore|unresolve|priority|assign", "value": ...}.
        Returns {"updated": <count>}."""
        project = await self.aget_project()
        await self.arequire_write(project)
        ids = [str(i) for i in (request.data.get("ids") or []) if i]
        action = request.data.get("action")
        if not ids or not action:
            return Response({"detail": "ids and action are required."}, status=400)
        qs = Issue.objects.filter(project=project, id__in=ids)

        status_map = {
            "resolve": IssueStatus.RESOLVED,
            "ignore": IssueStatus.IGNORED,
            "unresolve": IssueStatus.UNRESOLVED,
        }
        if action in status_map:
            updated = await qs.aupdate(status=status_map[action])
        elif action == "priority":
            value = request.data.get("value")
            if value not in IssuePriority.values:
                return Response({"detail": "Invalid priority."}, status=400)
            updated = await qs.aupdate(priority=value)
        elif action == "assign":
            assignee_ids = [str(v) for v in (request.data.get("value") or []) if v]
            valid = {
                str(uid)
                async for uid in Membership.objects.filter(
                    organization=project.organization, user_id__in=assignee_ids
                ).values_list("user_id", flat=True)
            }
            bad = [i for i in assignee_ids if i not in valid]
            if bad:
                return Response(
                    {
                        "detail": "Some assignees are not members of this organization.",
                        "invalid": bad,
                    },
                    status=400,
                )
            updated = 0
            async for issue in qs.aiterator():
                await issue.assignees.aset(assignee_ids)
                updated += 1
        else:
            return Response({"detail": "Unknown action."}, status=400)
        return Response({"updated": updated})

    async def trends(self, request, project_pk=None):
        """Per-issue event counts for the list sparklines. Query: ?ids=a,b,c with
        either ?period=24h|30d (hourly/daily buckets) or ?days=14 (daily, legacy).
        Returns {issue_id: [counts oldest→newest]}."""
        project = await self.aget_project()
        ids = [i for i in request.query_params.get("ids", "").split(",") if i]
        period = request.query_params.get("period")
        try:
            days = min(max(int(request.query_params.get("days", 14)), 1), 90)
        except ValueError:
            days = 14
        if not ids:
            return Response({})
        # Restrict to issues that actually belong to this project.
        scoped = [
            str(x)
            async for x in Issue.objects.filter(project=project, id__in=ids).values_list(
                "id", flat=True
            )
        ]
        if not scoped:
            return Response({})
        if period in ("24h", "30d"):
            data = await sync_to_async(
                lambda: get_event_store().series_for_issues(scoped, period)
            )()
        else:
            since = timezone.now() - timezone.timedelta(days=days)
            data = await sync_to_async(
                lambda: get_event_store().trend_for_issues(scoped, since, days)
            )()
        return Response(data)

    async def series(self, request, project_pk=None, pk=None):
        """Bucketed event counts for one issue's trend chart. Query: ?period=24h|30d."""
        issue = await self.aget_issue()
        period = request.query_params.get("period", "24h")
        if period not in ("24h", "30d"):
            period = "24h"
        data = await sync_to_async(lambda: get_event_store().series_for_issue(issue, period))()
        return Response({"period": period, "buckets": data})

    # --- external issue tracker (GitLab) ----------------------------------- //

    async def repositories(self, request, project_pk=None, pk=None):
        """Repositories the org can open/link tracker issues in (for the modal)."""
        issue = await self.aget_issue()
        repos = await sync_to_async(org_repositories)(issue.project.organization)
        from apps.integrations.serializers import RepositorySerializer

        return Response(await RepositorySerializer(repos, many=True).adata)

    async def search_external(self, request, project_pk=None, pk=None):
        """Search a repository's tracker issues. Query: ?repository=<id>&q=<text>."""
        issue = await self.aget_issue()
        repo = await sync_to_async(resolve_repository)(
            issue.project.organization, request.query_params.get("repository")
        )
        if repo is None:
            return Response({"detail": "Repository not found."}, status=404)
        try:
            results = await sync_to_async(search_tracker_issues)(
                repo, request.query_params.get("q", "")
            )
        except Exception as exc:  # noqa: BLE001 - surface provider errors
            return Response({"detail": f"Provider error: {exc}"}, status=502)
        return Response({"results": results})

    async def external_issues(self, request, project_pk=None, pk=None):
        """GET: list linked tracker issues. POST: create or link one.

        Create body: {"repository": id, "title": ..., "description": ...}.
        Link body:   {"repository": id, "external_id": iid, "comment": optional, "mode": "link"}.
        """
        issue = await self.aget_issue()
        if request.method == "GET":
            links = [link async for link in issue.external_issues.select_related("repository")]
            return Response(await IssueExternalIssueSerializer(links, many=True).adata)

        await self.arequire_write(issue.project)
        repo = await sync_to_async(resolve_repository)(
            issue.project.organization, request.data.get("repository")
        )
        if repo is None:
            return Response({"detail": "Repository not found."}, status=404)
        try:
            if request.data.get("mode") == "link":
                external_id = request.data.get("external_id")
                if not external_id:
                    return Response({"detail": "external_id is required."}, status=400)
                link = await sync_to_async(link_tracker_issue)(
                    issue,
                    repo,
                    external_id=external_id,
                    comment=request.data.get("comment", ""),
                    user=request.user,
                )
            else:
                title = (request.data.get("title") or "").strip()
                if not title:
                    return Response({"detail": "title is required."}, status=400)
                link = await sync_to_async(create_tracker_issue)(
                    issue,
                    repo,
                    title=title,
                    description=request.data.get("description", ""),
                    user=request.user,
                )
        except Exception as exc:  # noqa: BLE001 - surface provider errors
            return Response({"detail": f"Provider error: {exc}"}, status=502)
        return Response(await IssueExternalIssueSerializer(link).adata, status=201)


class EventDetailView(ProjectScopedMixin, viewsets.ViewSet):
    """Single event lookup through the pluggable event store."""

    async def retrieve(self, request, project_pk=None, pk=None):
        project = await self.aget_project()
        event = await sync_to_async(lambda: get_event_store().get(project, pk))()
        if event is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(event)
