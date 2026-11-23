"""URL normalization and signal fingerprints (E02-S02 rules 16-17)."""

import hashlib
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .text import collapse

_TRACKING_PARAMS = {"fbclid", "gclid", "igshid", "igsh", "ref", "ref_src", "mc_cid", "mc_eid",
                    "spm"}
_INSTAGRAM_POST = re.compile(r"^/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)")
_DEFAULT_PORTS = {"http": 80, "https": 443}


class InvalidURL(ValueError):
    pass


def normalize_url(raw: str) -> str:
    value = (raw or "").strip()
    try:
        parts = urlsplit(value)
    except ValueError as exc:
        raise InvalidURL(value) from exc
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname:
        raise InvalidURL(value)

    host = parts.hostname.lower()
    for prefix in ("www.", "m."):
        if host.startswith(prefix):
            host = host[len(prefix):]
            break
    try:
        port = parts.port
    except ValueError as exc:
        raise InvalidURL(value) from exc
    netloc = host if port in (None, _DEFAULT_PORTS[scheme]) else f"{host}:{port}"

    path = parts.path or "/"
    if host == "instagram.com" and (match := _INSTAGRAM_POST.match(path)):
        return f"https://instagram.com/p/{match.group(1)}"

    query = sorted(
        (key, val)
        for key, val in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in _TRACKING_PARAMS
    )
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/") or "/"
    return urlunsplit(("https", netloc, path, urlencode(query), ""))


def fingerprint(kind: str, url: str | None, author: str = "", excerpt: str = "") -> str:
    if url:
        basis = normalize_url(url)
    else:
        basis = "|".join([kind, collapse(author).lower(), collapse(excerpt).lower()])
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()
