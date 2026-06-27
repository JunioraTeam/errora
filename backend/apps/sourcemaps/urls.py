from django.urls import path

from .views import ReleaseFileDetailView, ReleaseFileListView

_base = "projects/<uuid:project_pk>/release-files"

urlpatterns = [
    path(_base, ReleaseFileListView.as_view(), name="release-file-list"),
    path(f"{_base}/<uuid:pk>", ReleaseFileDetailView.as_view(), name="release-file-detail"),
]
