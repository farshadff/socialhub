"""Outbound HTTP for fetching third-party content (feeds, pages).

``safe_fetch`` is the only way domain code reaches arbitrary URLs. It refuses hosts that
resolve to loopback, private, link-local, multicast or reserved addresses, checks again
after every redirect, caps the body size and the redirect count, and retries a timeout or
connection error once. Used by research RSS collection (E02-S02) and feed reading (E03-S01).
"""

from __future__ import annotations

import ipaddress
import logging
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import httpx2 as httpx
from django.conf import settings

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 10.0
DEFAULT_MAX_BYTES = 2 * 1024 * 1024
DEFAULT_MAX_REDIRECTS = 3
RETRY_DELAY_SECONDS = 2.0
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}

# Indirection so tests can stub DNS and sleeping without touching the network or the clock.
Resolver = Callable[[str], list[str]]


def _system_resolver(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    return sorted({info[4][0] for info in infos})


resolve_host: Resolver = _system_resolver
_sleep = time.sleep


class FetchError(Exception):
    """An expected fetch failure.

    ``code`` is ``timeout`` (timeout, connection error or unresolvable host), ``http_<status>``,
    ``blocked_url``, or ``too_large`` (only when the caller asked for ``on_too_large="error"``).
    """

    def __init__(self, code: str, detail: str = "", *, cause: str | None = None):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail
        # Finer reason for ``code == "timeout"``: ``timeout``, ``connect``, ``dns`` or ``protocol``.
        self.cause = cause


@dataclass
class FetchResult:
    url: str
    status: int
    content: bytes
    headers: dict[str, str] = field(default_factory=dict)
    truncated: bool = False


def _csv_setting(name: str) -> set[str]:
    raw = getattr(settings, name, "") or ""
    if isinstance(raw, (list, tuple, set)):
        values = raw
    else:
        values = raw.split(",")
    return {value.strip().lower() for value in values if value.strip()}


def _allow_hosts() -> set[str]:
    # Private hosts (a local fixture server) may be reached only in development or under test hooks.
    if settings.DEBUG or getattr(settings, "SOCIALHUB_TESTING_HOOKS", False):
        return _csv_setting("SOCIALHUB_FETCH_ALLOW_HOSTS")
    return set()


def _is_public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _domain_blocked(host: str, blocked: set[str]) -> bool:
    return any(host == domain or host.endswith("." + domain) for domain in blocked)


def check_url(url: str) -> str:
    """Validate one hop. Returns the lowercased host or raises ``FetchError("blocked_url")``."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise FetchError("blocked_url", "unsupported URL")
    host = parts.hostname.lower().rstrip(".")
    if host in _allow_hosts():
        return host
    if host == "localhost" or host.endswith(".localhost"):
        raise FetchError("blocked_url", "localhost")
    if _domain_blocked(host, _csv_setting("SOCIALHUB_RESEARCH_BLOCKED_DOMAINS")):
        raise FetchError("blocked_url", "domain is blocked")
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        addresses = [str(literal)]
    else:
        try:
            addresses = resolve_host(host)
        except (OSError, UnicodeError) as exc:
            # An unresolvable host behaves like a connection failure, not a policy refusal.
            raise FetchError("timeout", "host could not be resolved", cause="dns") from exc
    if not addresses or not all(_is_public_address(address) for address in addresses):
        raise FetchError("blocked_url", "address is not public")
    return host


def _cause(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, httpx.ConnectError):
        return "connect"
    return "protocol"


def _user_agent() -> str:
    return getattr(settings, "SOCIALHUB_HTTP_USER_AGENT", "") or "SocialHubBot/1.0"


def _read_capped(response: httpx.Response, max_bytes: int) -> tuple[bytes, bool]:
    chunks: list[bytes] = []
    size = 0
    for chunk in response.iter_bytes():
        remaining = max_bytes - size
        if len(chunk) > remaining:
            chunks.append(chunk[:remaining])
            return b"".join(chunks), True
        chunks.append(chunk)
        size += len(chunk)
    return b"".join(chunks), False


def _fetch_once(
    client: httpx.Client, url: str, *, max_bytes: int, max_redirects: int, on_too_large: str
) -> FetchResult:
    current = url
    for _hop in range(max_redirects + 1):
        check_url(current)
        with client.stream("GET", current) as response:
            if response.status_code in _REDIRECT_STATUSES and "location" in response.headers:
                current = urljoin(current, response.headers["location"])
                continue
            if response.status_code >= 400:
                raise FetchError(f"http_{response.status_code}")
            content, truncated = _read_capped(response, max_bytes)
            if truncated and on_too_large == "error":
                raise FetchError("too_large", f"body exceeds {max_bytes} bytes")
            return FetchResult(
                url=current,
                status=response.status_code,
                content=content,
                headers={key.lower(): value for key, value in response.headers.items()},
                truncated=truncated,
            )
    raise FetchError("blocked_url", "too many redirects")


def safe_fetch(
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    headers: dict[str, str] | None = None,
    on_too_large: str = "truncate",
    transport: httpx.BaseTransport | None = None,
) -> FetchResult:
    """GET ``url`` safely. Raises ``FetchError`` for every expected failure.

    ``on_too_large``: ``"truncate"`` (default) cuts the body at ``max_bytes`` and sets
    ``truncated``; ``"error"`` raises ``FetchError("too_large")`` instead.
    ``transport`` lets tests inject an ``httpx2.MockTransport``; DNS is stubbed by
    patching ``apps.core.http.resolve_host``.
    """
    if on_too_large not in ("truncate", "error"):
        raise ValueError("on_too_large must be 'truncate' or 'error'")
    client_kwargs = {
        "timeout": timeout,
        "follow_redirects": False,
        "headers": {**(headers or {}), "User-Agent": _user_agent()},
    }
    if transport is not None:
        client_kwargs["transport"] = transport
    with httpx.Client(**client_kwargs) as client:
        for attempt in (1, 2):
            try:
                return _fetch_once(
                    client,
                    url,
                    max_bytes=max_bytes,
                    max_redirects=max_redirects,
                    on_too_large=on_too_large,
                )
            except FetchError as exc:
                if exc.cause != "dns" or attempt == 2:
                    raise
                _sleep(RETRY_DELAY_SECONDS)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt == 2:
                    raise FetchError("timeout", type(exc).__name__, cause=_cause(exc)) from exc
                logger.info("safe_fetch retry url_host=%s", urlsplit(url).hostname)
                _sleep(RETRY_DELAY_SECONDS)
    raise FetchError("timeout")  # pragma: no cover - the loop always returns or raises
