from django.urls import path

from .views import MCPView

urlpatterns = [
    path("mcp", MCPView.as_view(), name="mcp"),
]
