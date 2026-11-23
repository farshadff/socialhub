"""URL normalization and signal fingerprints (E02-S02 rules 16–17)."""

import hashlib
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .text import collapse

TRACKING_PARAMS = {"fbclid", "gclid", "igshid", "igsh", "ref", "ref_src", "mc_cid", "mc_eid", "spm"}
_INSTAGRAM_POST = re.compile(r"^/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)(?:/.*)?$")
_DEFAULT_PORTS = {"http": 80, "https": 443}


class InvalidURL(ValueError):
    pass


def strip_host_prefix(host: str) -> str:
    for prefix in ("www.", "m."):
        if host.startswith(prefix):
            return host[len(prefix) :]
    return host


def normalize_url(raw: str) -> str:
    value = (raw or "").strip()
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as exc:
        raise InvalidURL(raw) from exc
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname:
        raise InvalidURL(raw)
    host = strip_host_prefix(parts.hostname.lower().rstrip("."))
    netloc = host
    if port is not None and port != _DEFAULT_PORTS[scheme]:
        netloc = f"{host}:{port}"

    path = parts.path or "/"
    if host == "instagram.com":
        match = _INSTAGRAM_POST.match(path)
        if match:
            return f"https://instagram.com/p/{match.group(1)}"

    params = [
        (name, val)
        for name, val in parse_qsl(parts.query, keep_blank_values=True)
        if not name.lower().startswith("utm_") and name.lower() not in TRACKING_PARAMS
    ]
    params.sort(key=lambda item: item[0])
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/") or "/"
    return urlunsplit(("https", netloc, path, urlencode(params), ""))


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def fingerprint(kind: str, url: str | None, author: str = "", excerpt: str = "") -> str:
    if url:
        return _sha256(normalize_url(url))
    return _sha256(f"{kind}|{collapse(author).lower()}|{collapse(excerpt).lower()}")
