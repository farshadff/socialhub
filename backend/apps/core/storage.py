"""Media storage helpers (E00-S06 rules 26-32).

Storage keys are built only here. Files go through Django's default storage, which is a
`FileSystemStorage` (`SOCIALHUB_MEDIA_BACKEND=local`) or `S3Storage` (`s3`); see
`config/media.py` for the settings.

Public names: `asset_key`, `brand_key`, `media_url`, `MediaURLField`, `local_copy`,
`work_dir`, `storage_status`, and re-exported from `apps.core.uploads`: `validate_upload`,
`UploadInfo`, `UploadProfile`, `IMAGE`, `VIDEO`, `AUDIO`.
"""

from __future__ import annotations

import hashlib
import secrets
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from django.conf import settings
from django.core.files.storage import storages
from django.utils.text import slugify
from rest_framework import serializers

from .jobs import JobError
from .uploads import AUDIO, IMAGE, VIDEO, UploadInfo, UploadProfile, validate_upload

COPY_CHUNK = 1024 * 1024
SLUG_MAX = 40

__all__ = [
    "AUDIO", "IMAGE", "VIDEO", "MediaURLField", "UploadInfo", "UploadProfile", "asset_key",
    "brand_key", "local_copy", "media_url", "storage_status", "validate_upload", "work_dir",
]


def _storage():
    return storages["default"]


def _key(file_or_key) -> str:
    return str(getattr(file_or_key, "name", file_or_key))


def _slug(stem: str) -> str:
    slug = slugify(stem)[:SLUG_MAX].strip("-_")
    return slug or "file"


def asset_key(account_id: int, asset_id: int, filename: str, at: datetime,
              ext: str | None = None) -> str:
    """`accounts/{account_id}/{yyyy}/{mm}/{asset_id}-{slug}.{ext}`.

    Pass `ext` from `validate_upload(...).ext`; without it the filename's extension is used,
    lowercased. A stem with no ASCII letters or digits slugs to `file`.
    """
    path = PurePosixPath(filename.replace("\\", "/")).name
    stem, dot, suffix = path.rpartition(".")
    if not dot:
        stem, suffix = suffix, ""
    extension = (ext or suffix).lower().lstrip(".")
    at = at.astimezone(UTC)
    name = f"{asset_id}-{_slug(stem)}" + (f".{extension}" if extension else "")
    return f"accounts/{account_id}/{at:%Y}/{at:%m}/{name}"


def brand_key(account_id: int, variant: str, ext: str) -> str:
    """`accounts/{account_id}/brand/logo-{variant}-{8 hex}.{ext}`."""
    return f"accounts/{account_id}/brand/logo-{variant}-{secrets.token_hex(4)}.{ext.lower()}"


def media_url(file_or_key, *, ttl: int | None = None) -> str | None:
    """A URL the browser (or Meta) can load for a stored file (rule 30)."""
    key = _key(file_or_key)
    if not key:
        return None
    if settings.SOCIALHUB_MEDIA_BACKEND == "local":
        return settings.SOCIALHUB_MEDIA_BASE_URL.rstrip("/") + "/" + quote(key)
    public_base = settings.SOCIALHUB_S3_PUBLIC_BASE_URL
    if public_base:
        return public_base.rstrip("/") + "/" + quote(key)
    return _storage().url(key, expire=ttl or settings.SOCIALHUB_MEDIA_URL_TTL_SECONDS)


class MediaURLField(serializers.Field):
    """Read-only serializer field that renders a `FileField` value or key with `media_url`."""

    def __init__(self, *, ttl: int | None = None, **kwargs):
        self.ttl = ttl
        kwargs["read_only"] = True
        super().__init__(**kwargs)

    def to_representation(self, value):
        return media_url(value, ttl=self.ttl) if value else None


def _local_path(storage, key: str) -> Path | None:
    try:
        return Path(storage.path(key))
    except NotImplementedError:
        return None


@contextmanager
def local_copy(file_or_key, *, expected_sha256: str | None = None) -> Iterator[Path]:
    """Yield a read-only local `Path` for a stored file (rule 31).

    Remote files are streamed into a temporary directory under `SOCIALHUB_WORK_DIR`, checked
    against `expected_sha256` when given, and removed on exit (also on exceptions).
    """
    storage = _storage()
    key = _key(file_or_key)
    path = _local_path(storage, key)
    if path is not None:
        yield path
        return

    tmp = Path(tempfile.mkdtemp(prefix="socialhub-copy-", dir=settings.SOCIALHUB_WORK_DIR))
    try:
        target = tmp / (PurePosixPath(key).name or "file")
        digest = hashlib.sha256()
        with storage.open(key, "rb") as source, target.open("wb") as out:
            while chunk := source.read(COPY_CHUNK):
                digest.update(chunk)
                out.write(chunk)
        if expected_sha256 and digest.hexdigest() != expected_sha256.lower():
            raise JobError("media_checksum_mismatch", "A stored file looks damaged.")
        yield target
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@contextmanager
def work_dir(job_id) -> Iterator[Path]:
    """Yield an empty scratch directory `SOCIALHUB_WORK_DIR/socialhub-{job_id}-{random}`."""
    path = Path(tempfile.mkdtemp(prefix=f"socialhub-{job_id}-", dir=settings.SOCIALHUB_WORK_DIR))
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def storage_status() -> dict:
    """The `storage` block of `GET /system/status/` (filled by E00-S06, served by E00-S05)."""
    if settings.SOCIALHUB_MEDIA_BACKEND == "s3":
        return {"backend": "s3", "bucket": settings.SOCIALHUB_S3_BUCKET,
                "public_base_url": settings.SOCIALHUB_S3_PUBLIC_BASE_URL or None}
    return {"backend": "local", "bucket": None,
            "public_base_url": settings.SOCIALHUB_MEDIA_BASE_URL}
