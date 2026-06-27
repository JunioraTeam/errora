from django.urls import path

from .views import (
    TransactionDetailView,
    TransactionGroupDetailView,
    TransactionGroupListView,
)

_base = "projects/<uuid:project_pk>/transactions"

urlpatterns = [
    path(_base, TransactionGroupListView.as_view(), name="transaction-group-list"),
    path(
        f"{_base}/<uuid:pk>", TransactionGroupDetailView.as_view(), name="transaction-group-detail"
    ),
    path(
        "projects/<uuid:project_pk>/transaction-events/<uuid:pk>",
        TransactionDetailView.as_view(),
        name="transaction-detail",
    ),
]
