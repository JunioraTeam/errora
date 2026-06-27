from __future__ import annotations

from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.organizations.models import Project
from apps.organizations.roles import PROJECT_MANAGE, PROJECT_READ
from apps.organizations.services import has_permission

from .models import ReleaseArtifact

# Max source-map / bundle upload size (default 30 MB).
MAX_ARTIFACT_BYTES = getattr(settings, "SOURCEMAP_MAX_BYTES", 30 * 1024 * 1024)


def _artifact_dict(a: ReleaseArtifact) -> dict:
    return {
        "id": str(a.id),
        "release": a.release,
        "dist": a.dist,
        "name": a.name,
        "headers": a.headers,
        "size": a.size,
        "created_at": a.created_at.isoformat(),
    }


class _ProjectScoped(APIView):
    permission_classes = [IsAuthenticated]

    def get_project(self, request, project_pk, capability):
        project = get_object_or_404(
            Project.objects.filter(organization__memberships__user=request.user).select_related(
                "organization"
            ),
            pk=project_pk,
        )
        if not has_permission(
            request.user, capability, organization=project.organization, project=project
        ):
            raise PermissionDenied()
        return project


class ReleaseFileListView(_ProjectScoped):
    """List + upload release artifacts (source maps / bundles) for a project.

    Upload is a multipart POST — designed for a build-step tool (sentry-cli or a
    curl in CI), not the browser:

        POST /api/v1/projects/<id>/release-files
        fields: release, name, [dist], [sourcemap], file=@app.min.js.map
    """

    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, project_pk):
        project = self.get_project(request, project_pk, PROJECT_READ)
        qs = ReleaseArtifact.objects.filter(project=project)
        release = request.query_params.get("release")
        if release:
            qs = qs.filter(release=release)
        dist = request.query_params.get("dist")
        if dist is not None:
            qs = qs.filter(dist=dist)
        return Response({"results": [_artifact_dict(a) for a in qs[:1000]]})

    def post(self, request, project_pk):
        project = self.get_project(request, project_pk, PROJECT_MANAGE)
        release = (request.data.get("release") or "").strip()
        name = (request.data.get("name") or "").strip()
        if not release or not name:
            raise ValidationError({"detail": "`release` and `name` are required."})

        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"detail": "A `file` upload is required."})
        if upload.size and upload.size > MAX_ARTIFACT_BYTES:
            raise ValidationError({"detail": "File too large."})
        content = upload.read().decode("utf-8", "replace")
        if len(content.encode("utf-8")) > MAX_ARTIFACT_BYTES:
            raise ValidationError({"detail": "File too large."})

        dist = (request.data.get("dist") or "").strip()
        headers: dict = {}
        sourcemap = (request.data.get("sourcemap") or "").strip()
        if sourcemap:
            headers["Sourcemap"] = sourcemap

        artifact, created = ReleaseArtifact.objects.update_or_create(
            project=project,
            release=release[:250],
            dist=dist[:64],
            name=name[:1024],
            defaults={"content": content, "size": len(content), "headers": headers},
        )
        return Response(_artifact_dict(artifact), status=201 if created else 200)


class ReleaseFileDetailView(_ProjectScoped):
    def delete(self, request, project_pk, pk):
        project = self.get_project(request, project_pk, PROJECT_MANAGE)
        deleted, _ = ReleaseArtifact.objects.filter(project=project, pk=pk).delete()
        if not deleted:
            return Response({"detail": "Not found."}, status=404)
        return Response(status=204)
