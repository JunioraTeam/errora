"""Personal access token management (account settings). Authenticated with the
normal session/JWT — these endpoints mint the bearer tokens used by the MCP
server."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ApiToken
from .tokens import create_token

MAX_TOKENS_PER_USER = 20


def _token_dict(t: ApiToken) -> dict:
    return {
        "id": str(t.id),
        "name": t.name,
        "token_prefix": t.token_prefix,
        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
        "expires_at": t.expires_at.isoformat() if t.expires_at else None,
        "created_at": t.created_at.isoformat(),
    }


class ApiTokenListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tokens = ApiToken.objects.filter(user=request.user)
        return Response({"results": [_token_dict(t) for t in tokens]})

    def post(self, request):
        if ApiToken.objects.filter(user=request.user).count() >= MAX_TOKENS_PER_USER:
            return Response({"detail": "Token limit reached."}, status=400)
        name = (request.data.get("name") or "").strip() or "MCP token"
        expires_at = None
        days = request.data.get("expires_in_days")
        if days:
            try:
                expires_at = timezone.now() + timedelta(days=max(1, min(int(days), 3650)))
            except (ValueError, TypeError):
                return Response({"detail": "Invalid expiry."}, status=400)
        token, raw = create_token(request.user, name, expires_at=expires_at)
        # The raw token is returned ONCE here.
        return Response({**_token_dict(token), "token": raw}, status=201)


class ApiTokenDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        deleted, _ = ApiToken.objects.filter(user=request.user, pk=pk).delete()
        if not deleted:
            return Response({"detail": "Not found."}, status=404)
        return Response(status=204)
