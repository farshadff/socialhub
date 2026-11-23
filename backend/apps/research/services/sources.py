"""Watchlist rules (E02-S01): normalization, validation, labels, limits and availability."""

import ipaddress
from urllib.parse import urlsplit, urlunsplit

from ..models import ResearchSource, SourceKind
from .text import collapse

ACTIVE_LIMITS = {SourceKind.WEB_SEARCH: 8, SourceKind.RSS: 15}
QUERY_MIN, QUERY_MAX = 3, 200
FEED_MAX = 500


class SourceValueError(ValueError):
    """Raised with a field code: `invalid`, `min_length` or `max_length`."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def normalize_value(kind: str, raw: str) -> str:
    if kind == SourceKind.WEB_SEARCH:
        return collapse(raw)
    if kind == SourceKind.RSS:
        value = (raw or "").strip()
        try:
            parts = urlsplit(value)
        except ValueError:
            return value
        if not parts.scheme or not parts.netloc:
            return value
        netloc = parts.netloc
        userinfo, at, hostport = netloc.rpartition("@")
        netloc = f"{userinfo}{at}{hostport.lower()}"
        return urlunsplit((parts.scheme.lower(), netloc, parts.path, parts.query, parts.fragment))
    return (raw or "").strip()


def validate_value(kind: str, value: str) -> None:
    if kind == SourceKind.WEB_SEARCH:
        if len(value) < QUERY_MIN:
            raise SourceValueError("min_length")
        if len(value) > QUERY_MAX:
            raise SourceValueError("max_length")
        return
    if kind == SourceKind.RSS:
        if len(value) > FEED_MAX:
            raise SourceValueError("max_length")
        try:
            parts = urlsplit(value)
        except ValueError:
            raise SourceValueError("invalid") from None
        host = parts.hostname
        if parts.scheme not in ("http", "https") or not host:
            raise SourceValueError("invalid")
        if host == "localhost" or host.endswith(".localhost") or _is_ip_literal(host):
            raise SourceValueError("invalid")
        return
    raise SourceValueError("invalid")


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return True


def default_label(kind: str, value: str) -> str:
    if kind == SourceKind.RSS:
        host = urlsplit(value).hostname or value
        return host[:80]
    return value[:80]


def active_count(account, kind: str, *, exclude_id: int | None = None) -> int:
    qs = ResearchSource.objects.filter(account=account, kind=kind, active=True)
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    return qs.count()


def availability(kind: str) -> tuple[bool, str | None]:
    """Whether a run can use sources of this kind right now (rule 11)."""
    if kind == SourceKind.WEB_SEARCH:
        from .platform import text_provider_configured

        if not text_provider_configured():
            return False, "provider_not_configured"
    return True, None
