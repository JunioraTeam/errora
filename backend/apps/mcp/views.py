"""
HTTP transport for the MCP server: a single ``POST /mcp`` endpoint.

Authenticated with a personal access token via ``Authorization: Bearer <token>``
(created in account settings). Accepts a JSON-RPC request (or batch) and returns
a JSON-RPC response. CSRF-exempt — it's a token-authenticated machine API.
"""

from __future__ import annotations

import json

from django.http import HttpResponse, JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from apps.accounts.tokens import authenticate_token

from .server import handle_message


def _bearer(request):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    return authenticate_token(header[7:].strip())


def _unauthorized() -> JsonResponse:
    resp = JsonResponse({"error": "invalid_token", "detail": "Missing or invalid bearer token."})
    resp.status_code = 401
    resp["WWW-Authenticate"] = 'Bearer realm="errora-mcp"'
    return resp


@method_decorator(csrf_exempt, name="dispatch")
class MCPView(View):
    def get(self, request):
        # Discovery convenience; the real transport is POST JSON-RPC.
        if _bearer(request) is None:
            return _unauthorized()
        return JsonResponse({"transport": "streamable-http", "endpoint": "/mcp", "method": "POST"})

    def post(self, request):
        user = _bearer(request)
        if user is None:
            return _unauthorized()

        try:
            body = json.loads(request.body or b"{}")
        except (ValueError, TypeError):
            return JsonResponse(
                {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
            )

        if isinstance(body, list):
            responses = [r for m in body if (r := handle_message(user, m)) is not None]
            if not responses:
                return HttpResponse(status=202)
            return JsonResponse(responses, safe=False)

        response = handle_message(user, body)
        if response is None:
            return HttpResponse(status=202)  # notification
        return JsonResponse(response)
