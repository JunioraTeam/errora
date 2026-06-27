"""Root URL configuration."""

from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def healthz(_request):
    return JsonResponse({"status": "ok"})


api_v1 = [
    path("auth/", include("apps.accounts.urls")),
    path("", include("apps.organizations.urls")),
    path("", include("apps.issues.urls")),
    path("", include("apps.performance.urls")),
    path("", include("apps.logs.urls")),
    path("", include("apps.sourcemaps.urls")),
    path("", include("apps.integrations.urls")),
    path("", include("apps.ai.urls")),
    path("", include("apps.notifications.urls")),
    path("", include("apps.billing.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthz),
    path("api/v1/", include((api_v1, "api"), namespace="v1")),
    # Ingestion endpoint mirrors Sentry's /api/<project_id>/... layout.
    path("", include("apps.ingest.urls")),
    # MCP server (token-authenticated JSON-RPC) at /mcp.
    path("", include("apps.mcp.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
