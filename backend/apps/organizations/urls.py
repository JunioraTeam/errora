from adrf.routers import DefaultRouter
from django.urls import include, path

from .views import InviteAcceptView, OrganizationViewSet, ProjectViewSet

# adrf's router rewrites the standard CRUD action map (list/create/…) to the
# async ``a``-prefixed handlers for async viewsets.
router = DefaultRouter(trailing_slash=False)
router.register("organizations", OrganizationViewSet, basename="organization")
router.register("invites/accept", InviteAcceptView, basename="invite-accept")

# Projects are nested under an organization. These manual maps bypass the router,
# so they must reference the async action names directly.
project_list = ProjectViewSet.as_view({"get": "alist", "post": "acreate"})
project_detail = ProjectViewSet.as_view(
    {"get": "aretrieve", "patch": "partial_aupdate", "delete": "adestroy"}
)
project_keys = ProjectViewSet.as_view({"post": "create_key"})
project_stats = ProjectViewSet.as_view({"get": "stats"})

urlpatterns = [
    path("", include(router.urls)),
    path("organizations/<uuid:org_pk>/projects/stats", project_stats, name="project-stats"),
    path("organizations/<uuid:org_pk>/projects", project_list, name="project-list"),
    path("organizations/<uuid:org_pk>/projects/<uuid:pk>", project_detail, name="project-detail"),
    path("organizations/<uuid:org_pk>/projects/<uuid:pk>/keys", project_keys, name="project-keys"),
]
