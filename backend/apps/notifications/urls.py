from django.urls import path

from .views import (
    AlertRuleViewSet,
    ChannelViewSet,
    NotificationLogListView,
    NotificationLogReplayView,
)

_chan_list = ChannelViewSet.as_view({"get": "alist", "post": "acreate"})
_chan_detail = ChannelViewSet.as_view(
    {"get": "aretrieve", "patch": "partial_aupdate", "delete": "adestroy"}
)
_rule_list = AlertRuleViewSet.as_view({"get": "alist", "post": "acreate"})
_rule_detail = AlertRuleViewSet.as_view(
    {"get": "aretrieve", "patch": "partial_aupdate", "delete": "adestroy"}
)

_b = "organizations/<uuid:org_pk>"
urlpatterns = [
    path(f"{_b}/channels", _chan_list, name="channel-list"),
    path(f"{_b}/channels/<uuid:pk>", _chan_detail, name="channel-detail"),
    path(f"{_b}/alert-rules", _rule_list, name="alertrule-list"),
    path(f"{_b}/alert-rules/<uuid:pk>", _rule_detail, name="alertrule-detail"),
    path(f"{_b}/notification-logs", NotificationLogListView.as_view(), name="notiflog-list"),
    path(
        f"{_b}/notification-logs/<uuid:pk>/replay",
        NotificationLogReplayView.as_view(),
        name="notiflog-replay",
    ),
]
