"""Upload validation shared by every endpoint that accepts files (E00-S06 rules 33-35)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import PurePath

import filetype

from .errors import PayloadTooLarge, UnsupportedMedia

MB = 1024 * 1024
_SNIFF_BYTES = 8192
_HASH_CHUNK = MB


@dataclass(frozen=True)
class MediaType:
    mime: str
    ext: str  # canonical extension stored in keys
    extensions: frozenset[str]  # extensions accepted on the uploaded name


@dataclass(frozen=True)
class UploadProfile:
    name: str
    types: tuple[MediaType, ...]
    max_bytes: int

    def type_for(self, mime: str) -> MediaType | None:
        return next((t for t in self.types if t.mime == mime), None)


@dataclass(frozen=True)
class UploadInfo:
    mime: str
    ext: str
    bytes: int
    sha256: str


JPEG = MediaType("image/jpeg", "jpg", frozenset({"jpg", "jpeg"}))
PNG = MediaType("image/png", "png", frozenset({"png"}))
WEBP = MediaType("image/webp", "webp", frozenset({"webp"}))
MP4 = MediaType("video/mp4", "mp4", frozenset({"mp4"}))
MOV = MediaType("video/quicktime", "mov", frozenset({"mov"}))
MP3 = MediaType("audio/mpeg", "mp3", frozenset({"mp3"}))
M4A = MediaType("audio/mp4", "m4a", frozenset({"m4a"}))
WAV = MediaType("audio/x-wav", "wav", frozenset({"wav"}))

IMAGE = UploadProfile("image", (JPEG, PNG, WEBP), 20 * MB)
VIDEO = UploadProfile("video", (MP4, MOV), 500 * MB)
AUDIO = UploadProfile("audio", (MP3, M4A, WAV), 50 * MB)

# filetype's MIME names that differ from ours.
_MIME_ALIASES = {"audio/m4a": "audio/mp4", "audio/wav": "audio/x-wav", "audio/x-m4a": "audio/mp4"}


def _sniff(head: bytes) -> str | None:
    kind = filetype.guess(head)
    if kind is None:
        return None
    return _MIME_ALIASES.get(kind.mime, kind.mime)


def _extension(name: str | None) -> str:
    return PurePath(name or "").suffix.lstrip(".").lower()


def validate_upload(uploaded_file, profile: UploadProfile, *, field: str = "file") -> UploadInfo:
    """Check size, sniffed type and extension; return type, size and SHA-256.

    Raises `PayloadTooLarge` (413) before reading an oversized file and `UnsupportedMedia`
    (400, reason `empty_file`, `type_not_allowed` or `extension_mismatch`) otherwise. The
    browser's `Content-Type` is ignored.
    """
    size = getattr(uploaded_file, "size", None)
    if size is not None and size > profile.max_bytes:
        raise PayloadTooLarge(details={"max_bytes": profile.max_bytes})
    if not size:
        raise UnsupportedMedia(field, "empty_file")

    uploaded_file.seek(0)
    head = uploaded_file.read(_SNIFF_BYTES)
    uploaded_file.seek(0)
    if not head:
        raise UnsupportedMedia(field, "empty_file")
    media_type = profile.type_for(_sniff(head) or "")
    if media_type is None:
        raise UnsupportedMedia(field, "type_not_allowed")
    if _extension(getattr(uploaded_file, "name", "")) not in media_type.extensions:
        raise UnsupportedMedia(field, "extension_mismatch")

    digest = hashlib.sha256()
    total = 0
    for chunk in uploaded_file.chunks(_HASH_CHUNK):
        digest.update(chunk)
        total += len(chunk)
    uploaded_file.seek(0)
    if total > profile.max_bytes:
        raise PayloadTooLarge(details={"max_bytes": profile.max_bytes})
    return UploadInfo(mime=media_type.mime, ext=media_type.ext, bytes=total,
                      sha256=digest.hexdigest())
