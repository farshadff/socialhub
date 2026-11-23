"""Fetching URLs supplied by operators without reaching private networks (E02-S02 rule 31).

`safe_fetch` resolves the host before connecting, and again after every redirect, and refuses
loopback, private, link-local, multicast, reserved and unspecified addresses. It caps redirects
and the body size. Owned by E02; E03-S01 (feed sources) reuses it.
"""

import ipaddress
import socket
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import httpx2 as httpx
from django.conf import settings

DEFAULT_TIMEOUT = 10.0
DEFAULT_MAX_BYTES = 2 * 1024 * 1024
DEFAULT_MAX_REDIRECTS = 3

Resolver = Callable[[str], list[str]]


class FetchError(Exception):
    """Base error; `code` is a research source status code without the `error:` prefix."""

    code = "fetch_error"

    def __init__(self, detail: str = ""):
        super().__init__(detail or self.code)


class BlockedURL(FetchError):
    code = "blocked_url"


class FetchTimeout(FetchError):
    """A timeout or a connection error."""

    code = "timeout"


class FetchHTTPError(FetchError):
    def __init__(self, status_code: int):
        super().__init__(f"HTTP {status_code}")
        self.status_code = status_code
        self.code = f"http_{status_code}"


@dataclass
class FetchResult:
    url: str
    status_code: int
    content: bytes
    headers: dict = field(default_factory=dict)
    truncated: bool = False


def system_resolver(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise FetchTimeout(f"Cannot resolve {host}") from exc
    return sorted({info[4][0] for info in infos})


def _allowed_private_hosts() -> set[str]:
    hosts = getattr(settings, "SOCIALHUB_FETCH_ALLOW_HOSTS", []) or []
    if isinstance(hosts, str):
        hosts = [h.strip() for h in hosts.split(",")]
    honoured = settings.DEBUG or getattr(settings, "SOCIALHUB_TEST_HOOKS", False)
    return {h.lower() for h in hosts if h} if honoured else set()


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not (ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_multicast
                or ip.is_reserved or ip.is_unspecified)


def check_url(url: str, resolver: Resolver = system_resolver) -> None:
    """Raise `BlockedURL` unless `url` is http(s) and every address of its host is public."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme not in ("http", "https") or not host:
        raise BlockedURL("Only http and https addresses can be fetched.")
    if host in _allowed_private_hosts():
        return
    addresses = [host.strip("[]")] if _is_ip(host) else resolver(host)
    if not addresses or not all(_is_public(a) for a in addresses):
        raise BlockedURL(f"{host} resolves to a non-public address.")


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return True


def safe_fetch(url: str, *, timeout: float = DEFAULT_TIMEOUT, max_bytes: int = DEFAULT_MAX_BYTES,
               max_redirects: int = DEFAULT_MAX_REDIRECTS,
               transport: httpx.BaseTransport | None = None,
               resolver: Resolver = system_resolver) -> FetchResult:
    """GET `url` safely. Raises `BlockedURL`, `FetchTimeout` or `FetchHTTPError` (status >= 400)."""
    headers = {"User-Agent": settings.SOCIALHUB_HTTP_USER_AGENT, "Accept": "*/*"}
    current = url
    with httpx.Client(transport=transport, timeout=timeout, follow_redirects=False,
                      headers=headers, trust_env=False) as client:
        for hop in range(max_redirects + 1):
            check_url(current, resolver)
            try:
                with client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchHTTPError(response.status_code)
                        if hop == max_redirects:
                            raise FetchHTTPError(response.status_code)
                        current = urljoin(current, location)
                        continue
                    if response.status_code >= 400:
                        raise FetchHTTPError(response.status_code)
                    body = bytearray()
                    truncated = False
                    for chunk in response.iter_bytes():
                        room = max_bytes - len(body)
                        if len(chunk) > room:
                            body.extend(chunk[:room])
                            truncated = True
                            break
                        body.extend(chunk)
                    return FetchResult(url=current, status_code=response.status_code,
                                       content=bytes(body), headers=dict(response.headers),
                                       truncated=truncated)
            except httpx.TimeoutException as exc:
                raise FetchTimeout("The request timed out.") from exc
            except httpx.TransportError as exc:
                raise FetchTimeout("The connection failed.") from exc
    raise FetchHTTPError(310)  # unreachable: the loop returns or raises
