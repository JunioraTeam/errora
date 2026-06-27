from django.urls import path

from .views import (
    AIConfigViewSet,
    AutoFixRunListView,
    AutoFixRunStreamView,
    AutoFixStreamTicketView,
    TriggerAutoFixView,
)

_cfg_list = AIConfigViewSet.as_view({"get": "alist", "post": "acreate"})
_cfg_detail = AIConfigViewSet.as_view(
    {"get": "aretrieve", "patch": "partial_aupdate", "delete": "adestroy"}
)

urlpatterns = [
    path("organizations/<uuid:org_pk>/ai-configs", _cfg_list, name="aiconfig-list"),
    path("organizations/<uuid:org_pk>/ai-configs/<uuid:pk>", _cfg_detail, name="aiconfig-detail"),
    path(
        "organizations/<uuid:org_pk>/autofix-runs",
        AutoFixRunListView.as_view(),
        name="autofix-run-list",
    ),
    path(
        "autofix-runs/<uuid:run_id>/stream",
        AutoFixRunStreamView.as_view(),
        name="autofix-run-stream",
    ),
    path(
        "projects/<uuid:project_pk>/issues/<uuid:pk>/autofix",
        TriggerAutoFixView.as_view(),
        name="issue-autofix",
    ),
    path(
        "projects/<uuid:project_pk>/issues/<uuid:pk>/autofix/stream-ticket",
        AutoFixStreamTicketView.as_view(),
        name="issue-autofix-stream-ticket",
    ),
]
