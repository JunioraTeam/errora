from django.urls import path

from .views import EventDetailView, IssueViewSet

issue_list = IssueViewSet.as_view({"get": "alist"})
issue_detail = IssueViewSet.as_view({"get": "aretrieve"})
issue_events = IssueViewSet.as_view({"get": "events"})
issue_comments = IssueViewSet.as_view({"get": "comments", "post": "comments"})
issue_external = IssueViewSet.as_view({"get": "external_issues", "post": "external_issues"})
event_detail = EventDetailView.as_view({"get": "retrieve"})


def _action(name):
    return IssueViewSet.as_view({"post": name})


_base = "projects/<uuid:project_pk>/issues"
urlpatterns = [
    path(f"{_base}", issue_list, name="issue-list"),
    # Collection-level actions (matched before the <uuid:pk> detail route; the
    # literals are not UUIDs so there is no real ambiguity either way).
    path(f"{_base}/bulk", IssueViewSet.as_view({"post": "bulk"}), name="issue-bulk"),
    path(f"{_base}/trends", IssueViewSet.as_view({"get": "trends"}), name="issue-trends"),
    path(f"{_base}/<uuid:pk>", issue_detail, name="issue-detail"),
    path(f"{_base}/<uuid:pk>/events", issue_events, name="issue-events"),
    path(
        f"{_base}/<uuid:pk>/series",
        IssueViewSet.as_view({"get": "series"}),
        name="issue-series",
    ),
    path(f"{_base}/<uuid:pk>/priority", _action("set_priority"), name="issue-priority"),
    path(f"{_base}/<uuid:pk>/comments", issue_comments, name="issue-comments"),
    path(f"{_base}/<uuid:pk>/resolve", _action("resolve"), name="issue-resolve"),
    path(f"{_base}/<uuid:pk>/ignore", _action("ignore"), name="issue-ignore"),
    path(f"{_base}/<uuid:pk>/unresolve", _action("unresolve"), name="issue-unresolve"),
    path(f"{_base}/<uuid:pk>/archive", _action("archive"), name="issue-archive"),
    path(f"{_base}/<uuid:pk>/bookmark", _action("bookmark"), name="issue-bookmark"),
    path(f"{_base}/<uuid:pk>/assign", _action("assign"), name="issue-assign"),
    path(f"{_base}/<uuid:pk>/merge", _action("merge"), name="issue-merge"),
    path(
        f"{_base}/<uuid:pk>/repositories",
        IssueViewSet.as_view({"get": "repositories"}),
        name="issue-repositories",
    ),
    path(
        f"{_base}/<uuid:pk>/external-issues/search",
        IssueViewSet.as_view({"get": "search_external"}),
        name="issue-external-search",
    ),
    path(f"{_base}/<uuid:pk>/external-issues", issue_external, name="issue-external"),
    path("projects/<uuid:project_pk>/events/<uuid:pk>", event_detail, name="event-detail"),
]
