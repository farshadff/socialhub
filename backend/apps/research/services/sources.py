"""Research source values: normalization, validation, labels, limits (E02-S01 rules 2–11)."""

import ipaddress
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from ..models import ResearchSource, SourceKind
from .text import collapse

CREATABLE_KINDS = (SourceKind.WEB_SEARCH.value, SourceKind.RSS.value)
ACTIVE_LIMITS = {SourceKind.WEB_SEARCH.value: 8, SourceKind.RSS.value: 15}
LABEL_MAX = 80


class SourceValueError(ValueError):
    """``code`` is ``invalid``, ``min_length`` or ``max_length``."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def normalize_value(kind: str, raw) -> str:
    value = str(raw or "")
    if kind == SourceKind.WEB_SEARCH:
        return collapse(value)
    value = value.strip()
    if kind == SourceKind.RSS:
        try:
            parts = urlsplit(value)
        except ValueError:
            return value
        netloc = parts.netloc
        if parts.hostname:
            # Lowercase the host only; userinfo and port keep their spelling.
            host = parts.hostname.lower()
            start = netloc.lower().find(host)
            netloc = netloc[:start] + host + netloc[start + len(host) :]
        return urlunsplit((parts.scheme.lower(), netloc, parts.path, parts.query, parts.fragment))
    return value


def validate_value(kind: str, value: str) -> None:
    if kind == SourceKind.WEB_SEARCH:
        if len(value) < 3:
            raise SourceValueError("min_length")
        if len(value) > 200:
            raise SourceValueError("max_length")
        return
    if kind == SourceKind.RSS:
        if len(value) > 500:
            raise SourceValueError("max_length")
        try:
            parts = urlsplit(value)
            parts.port  # noqa: B018 - raises ValueError on an invalid port
        except ValueError as exc:
            raise SourceValueError("invalid") from exc
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise SourceValueError("invalid")
        host = parts.hostname
        if host == "localhost" or host.endswith(".localhost"):
            raise SourceValueError("invalid")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            return
        raise SourceValueError("invalid")
    raise SourceValueError("invalid")


def default_label(kind: str, value: str) -> str:
    if kind == SourceKind.RSS:
        host = urlsplit(value).hostname or value
        return host[:LABEL_MAX]
    if len(value) <= LABEL_MAX:
        return value
    return value[: LABEL_MAX - 1].rstrip() + "…"


def active_count(account_id: int, kind: str, *, exclude_id: int | None = None) -> int:
    queryset = ResearchSource.objects.filter(account_id=account_id, kind=kind, active=True)
    if exclude_id is not None:
        queryset = queryset.exclude(pk=exclude_id)
    return queryset.count()


def limit_reached(account_id: int, kind: str, *, exclude_id: int | None = None) -> bool:
    return active_count(account_id, kind, exclude_id=exclude_id) >= ACTIVE_LIMITS[kind]


@dataclass(frozen=True)
class Availability:
    available: bool
    reason: str | None = None


def availability(kind: str) -> Availability:
    """Whether a run can use this kind right now (E02-S01 rule 11)."""
    if kind == SourceKind.RSS:
        return Availability(True)
    if kind == SourceKind.WEB_SEARCH:
        from apps.ai.gateway import text_provider_configured

        if text_provider_configured():
            return Availability(True)
        return Availability(False, "provider_not_configured")
    return Availability(False, "not_supported")
