from django.urls import path

from .views import (
    AgentRunDetailView,
    AgentRunListView,
    AgentsOverviewView,
    McpOverviewView,
)

_base = "projects/<uuid:project_pk>/insights"

urlpatterns = [
    path(f"{_base}/agents", AgentsOverviewView.as_view(), name="insights-agents"),
    path(f"{_base}/agents/runs", AgentRunListView.as_view(), name="insights-agent-runs"),
    path(
        f"{_base}/agents/runs/<str:trace_id>",
        AgentRunDetailView.as_view(),
        name="insights-agent-run-detail",
    ),
    path(f"{_base}/mcp", McpOverviewView.as_view(), name="insights-mcp"),
]
