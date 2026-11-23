"""Public media URLs handed to Meta (E00-S04 rule 22)."""

from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from apps.core.storage import media_url


def public_url(asset) -> str:
    """A presigned HTTPS URL of `asset.file` that Meta's servers can download, valid for
    `SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS`. The `local` backend cannot serve Meta, so a URL that
    is not `https://` raises `ImproperlyConfigured`."""
    file = getattr(asset, "file", asset)
    url = media_url(file, ttl=settings.SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS)
    if not url or not url.startswith("https://"):
        raise ImproperlyConfigured(
            "Instagram needs media at a public https:// URL; use SOCIALHUB_MEDIA_BACKEND=s3 "
            "with a bucket reachable from the internet.")
    return url
