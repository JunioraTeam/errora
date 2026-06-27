from django.urls import path

from .views import IntegrationViewSet

_list = IntegrationViewSet.as_view({"get": "alist", "post": "acreate"})
_detail = IntegrationViewSet.as_view(
    {"get": "aretrieve", "patch": "partial_aupdate", "delete": "adestroy"}
)
_sync = IntegrationViewSet.as_view({"post": "sync"})
_repos = IntegrationViewSet.as_view({"get": "repositories"})

_base = "organizations/<uuid:org_pk>/integrations"
urlpatterns = [
    path(_base, _list, name="integration-list"),
    path(f"{_base}/<uuid:pk>", _detail, name="integration-detail"),
    path(f"{_base}/<uuid:pk>/sync", _sync, name="integration-sync"),
    path(f"{_base}/<uuid:pk>/repositories", _repos, name="integration-repos"),
]
