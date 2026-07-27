"""SSRF guard for server-side outbound HTTP fetches.

Several agent services fetch fully user-controlled URLs server-side (document /
sidecar content URLs from the ``/r`` request payload, ``<img src>`` URLs from
uploaded design bundles) and save the response into an LLM-readable artifact. On
the self-hosted OSS container the ``/r`` endpoint is unauthenticated, so without
a guard an attacker can point those fetches at cloud metadata
(``169.254.169.254``), loopback services (``127.0.0.1:<port>``), or RFC1918
hosts and exfiltrate internal responses.

``assert_safe_url`` enforces http(s)-only and rejects any host that IS — or DNS
resolves to — a private / loopback / link-local / metadata / reserved address.
Callers must ALSO disable automatic redirect following and re-validate every
redirect hop with this guard (an allowlisted-looking host can 302 to an internal
target otherwise).
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

import structlog

logger = structlog.get_logger(__name__)


class UnsafeUrlError(ValueError):
    """Raised when a URL is disallowed for a server-side fetch (SSRF guard)."""


def is_blocked_ip(ip: str) -> bool:
    """True for an IP literal in a private/loopback/link-local/metadata range.

    Fails closed: an unparseable value is treated as blocked. Uses the stdlib
    ``ipaddress`` classifiers rather than hand-rolled ranges. IPv4-mapped IPv6
    (``::ffff:a.b.c.d``) is unwrapped and re-checked against the embedded IPv4.
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True

    mapped = getattr(addr, "ipv4_mapped", None)
    if mapped is not None:
        return is_blocked_ip(str(mapped))

    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local  # includes 169.254.169.254 cloud metadata
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


async def _resolve(host: str) -> list[str]:
    """Resolve a hostname to its addresses (patchable seam for tests)."""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, None)
    return [info[4][0] for info in infos]


async def assert_safe_url(url: str) -> None:
    """Raise :class:`UnsafeUrlError` unless ``url`` is a safe public http(s) URL.

    Enforces an http/https scheme and rejects any host that is (or resolves to)
    a private/loopback/link-local/metadata/reserved address. Resolution failure
    fails closed.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeUrlError(f"blocked URL scheme {parsed.scheme!r}: {url!r}")

    host = parsed.hostname
    if not host:
        raise UnsafeUrlError(f"URL has no host: {url!r}")

    # IP literal: check directly (no DNS).
    #
    # Only the parse may raise ValueError here. UnsafeUrlError subclasses
    # ValueError, so raising it inside this try would be swallowed by the
    # `except ValueError` and fall through to name resolution — the literal
    # check would never reject anything. Keep the decision OUTSIDE the try.
    try:
        ipaddress.ip_address(host)
        is_ip_literal = True
    except ValueError:
        is_ip_literal = False  # not an IP literal — resolve the name below

    if is_ip_literal:
        if is_blocked_ip(host):
            raise UnsafeUrlError(f"blocked internal address: {url!r}")
        return

    try:
        addresses = await _resolve(host)
    except socket.gaierror as exc:
        raise UnsafeUrlError(f"DNS resolution failed for {host!r}: {exc}") from exc

    for address in addresses:
        if is_blocked_ip(address):
            raise UnsafeUrlError(
                f"host {host!r} resolves to a blocked internal address ({address}): {url!r}"
            )
