"""
Ingestion endpoints, compatible with the **official Sentry SDKs**. The URL
layout mirrors Sentry's ``/api/<project_id>/store/`` and
``/api/<project_id>/envelope/`` and the auth follows Sentry's DSN scheme, so any
Sentry SDK can send events to Errora with no custom client — just point its
``dsn`` at an Errora project key.

These are **async** plain Django views (not DRF) — the hot path is fully async
(native async ORM + async cache, no sync_to_async in app code). The endpoint
does the minimum synchronously: authenticate the DSN key, cheap quota gate,
enqueue the raw payload on the Celery ``ingest`` queue, then return 202. All
heavy work (normalize → group → store → meter) happens off-request.

Sentry SDKs gzip/deflate their payloads by default, so request bodies are
transparently decompressed. CORS is allowed so the browser JS SDK can post
cross-origin.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import zlib

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from apps.billing.services import aquota_exceeded

from .auth import aresolve_project, extract_public_key, public_key_from_dsn
from .tasks import process_event, process_logs, process_transaction


class PayloadTooLarge(Exception):
    """Decompressed body exceeded the configured cap (decompression bomb)."""


def _oversized(body: bytes) -> bool:
    cap = getattr(settings, "INGEST_MAX_PAYLOAD_BYTES", 0)
    return bool(cap) and len(body) > cap


def _bounded_decompress(body: bytes, wbits: int) -> bytes:
    """Decompress with a hard output cap so a tiny gzip/deflate bomb can't blow
    up worker memory. ``decompressobj.decompress(data, max_length)`` stops after
    ``max_length`` output bytes and leaves the rest in ``unconsumed_tail`` — a
    non-empty tail means there was more than the cap, so we reject."""
    cap = getattr(settings, "INGEST_MAX_DECOMPRESSED_BYTES", 20_000_000)
    dec = zlib.decompressobj(wbits)
    out = dec.decompress(body, cap)
    if dec.unconsumed_tail:
        raise PayloadTooLarge
    out += dec.flush()
    if len(out) > cap:
        raise PayloadTooLarge
    return out


async def _rate_limited(project) -> bool:
    """Per-project fixed-window (1 min) rate limit, Redis-backed."""
    limit = getattr(settings, "INGEST_RATE_LIMIT_PER_MIN", 0)
    if not limit:
        return False
    window = timezone.now().strftime("%Y%m%d%H%M")
    key = f"ingest:rl:{project.id}:{window}"
    try:
        count = await cache.aincr(key)
    except ValueError:
        await cache.aset(key, 1, timeout=120)
        count = 1
    return count > limit


def _sampled_out(project) -> bool:
    """Drop a fraction of events per the project's sample_rate (1.0 keeps all)."""
    rate = getattr(project, "sample_rate", 1.0)
    if rate is None:
        rate = 1.0
    if rate >= 1.0:
        return False
    if rate <= 0.0:
        return True
    # secrets.randbelow avoids a global RNG dependency; resolution 1/10000.
    return secrets.randbelow(10000) >= int(rate * 10000)


def _decode_body(request) -> bytes:
    """Return the request body, transparently decompressed.

    Sentry SDKs send ``Content-Encoding: gzip`` (default) or ``deflate``. On any
    decompression failure fall back to the raw bytes so we never 500 the SDK."""
    body = request.body
    if not body:
        return body
    encoding = request.headers.get("Content-Encoding", "").lower()
    try:
        if encoding == "gzip":
            return _bounded_decompress(body, 16 + zlib.MAX_WBITS)
        if encoding in ("deflate", "zlib"):
            try:
                return _bounded_decompress(body, zlib.MAX_WBITS)
            except zlib.error:
                return _bounded_decompress(body, -zlib.MAX_WBITS)
    except (OSError, zlib.error):
        return body
    return body


def _cors(response: HttpResponse) -> HttpResponse:
    """Allow the browser JS SDK to post events cross-origin."""
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Headers"] = "X-Sentry-Auth, Content-Type, Content-Encoding"
    response["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


class _IngestView(View):
    async def options(self, request, *args, **kwargs):
        return _cors(HttpResponse(status=204))


@method_decorator(csrf_exempt, name="dispatch")
class StoreView(_IngestView):
    """Accept a single JSON event (legacy Sentry ``/store/`` endpoint)."""

    async def post(self, request, project_id):
        try:
            body = _decode_body(request)
        except PayloadTooLarge:
            return _cors(JsonResponse({"detail": "Payload too large."}, status=413))
        if _oversized(body):
            return _cors(JsonResponse({"detail": "Payload too large."}, status=413))
        project, _key = await aresolve_project(extract_public_key(request), project_id)
        if project is None:
            return _cors(JsonResponse({"detail": "Invalid DSN key."}, status=401))
        if await aquota_exceeded(project):
            return _cors(JsonResponse({"detail": "Event quota exceeded."}, status=429))
        if await _rate_limited(project):
            return _cors(JsonResponse({"detail": "Rate limit exceeded."}, status=429))
        try:
            payload = json.loads(body)
        except (ValueError, TypeError):
            return _cors(JsonResponse({"detail": "Malformed payload."}, status=400))

        # Spike/cost control: drop a fraction of events per sample_rate.
        if _sampled_out(project):
            return _cors(JsonResponse({"id": payload.get("event_id"), "sampled": True}, status=202))

        # Enqueue for the ingest worker. The broker publish is a blocking socket
        # call, so run it off the event loop via a thread (no sync_to_async).
        await asyncio.to_thread(process_event.delay, str(project.id), payload)
        return _cors(JsonResponse({"id": payload.get("event_id")}, status=202))


@method_decorator(csrf_exempt, name="dispatch")
class EnvelopeView(_IngestView):
    """
    Accept a newline-delimited envelope (header line, then item header + item
    pairs) — the default transport for modern Sentry SDKs. ``event``,
    ``transaction`` and ``log`` items are processed; others (sessions, …) are
    ignored.
    """

    async def post(self, request, project_id):
        public_key = extract_public_key(request)

        try:
            body = _decode_body(request)
        except PayloadTooLarge:
            return _cors(JsonResponse({"detail": "Payload too large."}, status=413))
        if _oversized(body):
            return _cors(JsonResponse({"detail": "Payload too large."}, status=413))
        lines = body.decode("utf-8", "replace").splitlines()
        if not lines:
            return _cors(JsonResponse({"detail": "Empty envelope."}, status=400))

        # Fallback: SDKs that don't set auth on the request put the DSN in the
        # envelope header instead.
        try:
            env_header = json.loads(lines[0])
        except ValueError:
            env_header = {}
        if not public_key:
            public_key = public_key_from_dsn(env_header.get("dsn"))

        project, _key = await aresolve_project(public_key, project_id)
        if project is None:
            return _cors(JsonResponse({"detail": "Invalid DSN key."}, status=401))
        if await aquota_exceeded(project):
            return _cors(JsonResponse({"detail": "Event quota exceeded."}, status=429))
        if await _rate_limited(project):
            return _cors(JsonResponse({"detail": "Rate limit exceeded."}, status=429))

        accepted = 0
        sampled = 0
        logs = 0
        i = 1  # skip envelope header
        while i < len(lines):
            try:
                item_header = json.loads(lines[i])
            except ValueError:
                break
            payload_line = lines[i + 1] if i + 1 < len(lines) else "{}"
            i += 2
            item_type = item_header.get("type")
            try:
                item = json.loads(payload_line)
            except ValueError:
                continue
            if item_type == "log":
                # A log item is a batch container ({"items": [...]}); enqueue the
                # whole batch. Logs are not metered against the event quota, so
                # no per-event sampling here.
                count = int(item_header.get("item_count") or len(item.get("items") or []))
                await asyncio.to_thread(process_logs.delay, str(project.id), item)
                logs += count
            elif item_type in ("event", "transaction"):
                if _sampled_out(project):
                    sampled += 1
                    continue
                task = process_event if item_type == "event" else process_transaction
                await asyncio.to_thread(task.delay, str(project.id), item)
                accepted += 1
        return _cors(
            JsonResponse({"accepted": accepted, "sampled": sampled, "logs": logs}, status=202)
        )
