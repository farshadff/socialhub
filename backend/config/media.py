"""Media storage settings from the environment (E00-S06 rules 26-28).

Kept out of settings.py so the startup rules can be tested without reloading settings.
"""

import tempfile
from collections.abc import Mapping
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BACKENDS = ("local", "s3")


def build_media_settings(env: Mapping[str, str], *, debug: bool, media_root: Path,
                         allow_local_without_debug: bool = False) -> dict:
    """Return the media-related settings, or raise `ImproperlyConfigured` naming the setting."""
    backend = env.get("SOCIALHUB_MEDIA_BACKEND", "local").strip().lower() or "local"
    if backend not in BACKENDS:
        raise ImproperlyConfigured(
            f"SOCIALHUB_MEDIA_BACKEND must be one of {', '.join(BACKENDS)}; got {backend!r}.")
    if backend == "local" and not debug and not allow_local_without_debug:
        raise ImproperlyConfigured(
            "SOCIALHUB_MEDIA_BACKEND=local is only allowed when DJANGO_DEBUG=true, because local "
            "media has no access control. Set SOCIALHUB_MEDIA_BACKEND=s3 and the "
            "SOCIALHUB_S3_* settings.")

    ttl = int(env.get("SOCIALHUB_MEDIA_URL_TTL_SECONDS", "21600"))
    public_base = env.get("SOCIALHUB_S3_PUBLIC_BASE_URL", "").strip()
    values = {
        "SOCIALHUB_MEDIA_BACKEND": backend,
        "SOCIALHUB_MEDIA_URL_TTL_SECONDS": ttl,
        "SOCIALHUB_MEDIA_BASE_URL": env.get("SOCIALHUB_MEDIA_BASE_URL",
                                            "http://localhost:8000/media/"),
        "SOCIALHUB_WORK_DIR": env.get("SOCIALHUB_WORK_DIR", "") or tempfile.gettempdir(),
        "SOCIALHUB_S3_BUCKET": env.get("SOCIALHUB_S3_BUCKET", "").strip() or None,
        "SOCIALHUB_S3_PUBLIC_BASE_URL": public_base or None,
    }
    staticfiles = {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}

    if backend == "local":
        values["STORAGES"] = {
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage",
                        "OPTIONS": {"location": str(media_root)}},
            "staticfiles": staticfiles,
        }
        return values

    for name in ("SOCIALHUB_S3_BUCKET", "SOCIALHUB_S3_ACCESS_KEY_ID",
                 "SOCIALHUB_S3_SECRET_ACCESS_KEY"):
        if not env.get(name, "").strip():
            raise ImproperlyConfigured(f"{name} must be set when SOCIALHUB_MEDIA_BACKEND=s3.")
    addressing = env.get("SOCIALHUB_S3_ADDRESSING_STYLE", "path").strip() or "path"
    if addressing not in ("path", "virtual"):
        raise ImproperlyConfigured("SOCIALHUB_S3_ADDRESSING_STYLE must be path or virtual.")
    values["STORAGES"] = {
        "default": {
            "BACKEND": "storages.backends.s3.S3Storage",
            "OPTIONS": {
                "bucket_name": env["SOCIALHUB_S3_BUCKET"].strip(),
                "endpoint_url": env.get("SOCIALHUB_S3_ENDPOINT_URL", "").strip() or None,
                "region_name": env.get("SOCIALHUB_S3_REGION", "").strip() or "us-east-1",
                "access_key": env["SOCIALHUB_S3_ACCESS_KEY_ID"].strip(),
                "secret_key": env["SOCIALHUB_S3_SECRET_ACCESS_KEY"].strip(),
                "addressing_style": addressing,
                "signature_version": "s3v4",
                "default_acl": None,  # objects stay private
                "querystring_auth": True,
                "querystring_expire": ttl,
                "file_overwrite": False,
            },
        },
        "staticfiles": staticfiles,
    }
    return values
