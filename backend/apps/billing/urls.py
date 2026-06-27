from django.urls import path

from .views import PlanViewSet, SubscriptionView, UsageView

plans = PlanViewSet.as_view({"get": "alist"})

urlpatterns = [
    path("plans", plans, name="plan-list"),
    path("organizations/<uuid:org_pk>/usage", UsageView.as_view(), name="org-usage"),
    path(
        "organizations/<uuid:org_pk>/subscription",
        SubscriptionView.as_view(),
        name="org-subscription",
    ),
]
