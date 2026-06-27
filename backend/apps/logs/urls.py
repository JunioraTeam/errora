from django.urls import path

from .views import LogAttributeKeysView, LogDetailView, LogListView

_base = "projects/<uuid:project_pk>/logs"

urlpatterns = [
    path(_base, LogListView.as_view(), name="log-list"),
    path(f"{_base}/attribute-keys", LogAttributeKeysView.as_view(), name="log-attribute-keys"),
    path(f"{_base}/<uuid:pk>", LogDetailView.as_view(), name="log-detail"),
]
