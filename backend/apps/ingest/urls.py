from django.urls import path

from .views import EnvelopeView, StoreView

# Sentry-compatible ingest paths (note: not under /api/v1 — SDKs post here directly).
# The trailing-slash forms are canonical because the official Sentry SDKs build
# their store/envelope URLs with a trailing slash; the slashless aliases are
# accepted too so no endpoint *requires* a trailing slash.
urlpatterns = [
    path("api/<uuid:project_id>/store/", StoreView.as_view(), name="ingest-store"),
    path("api/<uuid:project_id>/store", StoreView.as_view()),
    path("api/<uuid:project_id>/envelope/", EnvelopeView.as_view(), name="ingest-envelope"),
    path("api/<uuid:project_id>/envelope", EnvelopeView.as_view()),
]
