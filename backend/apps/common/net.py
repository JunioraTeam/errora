"""
SSRF guard for outbound requests to user-supplied URLs (notification
webhooks/Mattermost, AI ``base_url``, GitLab ``base_url``).

Errora is self-hosted, so pointing an integration at an *internal* host is often
legitimate (on-prem GitLab, a private Mattermost, a local Ollama/vLLM server).
We therefore always reject the never-legit, highest-impact targets — loopback,
link-local (which includes the cloud-metadata IP ``169.254.169.254``),
unspecified, multicast, reserved — but only reject RFC1918 *private* ranges when
``SSRF_BLOCK_PRIVATE`` is enabled (for multi-tenant deployments where users
shouldn't reach the operator's internal network).

Outbound requests also disable redirects (a ``302`` to an internal URL would
otherwise bypass the check). The robust backstop against DNS rebinding is a
network egress policy on the worker (see ``deploy/k8s``).
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx
from django.conf import settings

_CGNAT = ipaddress.ip_network("100.64.0.0/10")


class UnsafeURLError(ValueError):
    """Raised when a URL is malformed or resolves to a blocked address."""


def _ip_blocked(ip: str, *, block_private: bool) -> bool:
    addr = ipaddress.ip_address(ip)
    # Unwrap IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254) and re-check.
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    # Always blocked — never a legitimate integration target, and the biggest
    # SSRF prizes (cloud metadata via link-local, the app's own loopback).
    if (
        addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    ):
        return True
    if block_private and (addr.is_private or addr in _CGNAT):
        return True
    return False


def validate_external_url(
    url: str, *, allow_http: bool = False, block_private: bool | None = None
) -> set[str]:
    """Validate a user-supplied outbound URL. Returns the set of resolved IPs.

    Raises :class:`UnsafeURLError` for a bad scheme/host, a name that does not
    resolve, or any resolved address in a blocked range. ``block_private``
    defaults to the ``SSRF_BLOCK_PRIVATE`` setting.
    """
    if block_private is None:
        block_private = getattr(settings, "SSRF_BLOCK_PRIVATE", False)

    try:
        parsed = urlparse(url)
    except (ValueError, TypeError) as exc:
        raise UnsafeURLError("Invalid URL.") from exc

    allowed = ("http", "https") if allow_http else ("https",)
    if parsed.scheme not in allowed:
        raise UnsafeURLError(f"URL scheme must be {' or '.join(allowed)}.")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("URL has no host.")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeURLError(f"Could not resolve host: {host}.") from exc
    ips = {info[4][0] for info in infos}
    if not ips:
        raise UnsafeURLError(f"Host did not resolve: {host}.")
    for ip in ips:
        if _ip_blocked(ip, block_private=block_private):
            raise UnsafeURLError("URL resolves to a blocked (internal/metadata) address.")
    return ips


def safe_post(url: str, *, allow_http: bool = True, timeout: float = 10.0, **kwargs):
    """``httpx.post`` to a user-supplied URL, SSRF-validated and with redirects
    disabled (so a redirect to an internal address can't bypass validation)."""
    validate_external_url(url, allow_http=allow_http)
    return httpx.post(url, timeout=timeout, follow_redirects=False, **kwargs)
