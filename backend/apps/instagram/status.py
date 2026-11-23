"""The `instagram` block of `GET /system/status/` (E00-S05 owns the endpoint; E00-S04 rule 42).

Never returns the app secret, the proxy URL or the encryption key. The app ID is not secret.
"""

from __future__ import annotations

from django.conf import settings

from .providers.registry import META_SETTINGS, missing_settings


def instagram_status() -> dict:
    missing = missing_settings("graph_api")
    return {
        "default_provider": settings.SOCIALHUB_IG_DEFAULT_PROVIDER,
        "allowed_providers": list(settings.SOCIALHUB_IG_ALLOWED_PROVIDERS),
        "meta_app": {
            "configured": not missing,
            "missing": [name for name in META_SETTINGS if name in missing],
            "app_id": settings.SOCIALHUB_META_APP_ID or None,
            "redirect_uri": settings.SOCIALHUB_META_REDIRECT_URI,
        },
        "api_version": settings.SOCIALHUB_IG_API_VERSION or None,
        "http_proxy": bool(settings.SOCIALHUB_IG_HTTP_PROXY),
        "token_refresh_after_days": int(settings.SOCIALHUB_IG_TOKEN_REFRESH_AFTER_DAYS),
        "media_url_ttl_seconds": int(settings.SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS),
        "encryption_key_configured": bool(settings.SOCIALHUB_ENCRYPTION_KEY),
    }
