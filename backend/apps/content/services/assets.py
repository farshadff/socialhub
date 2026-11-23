"""Asset library: upload, probe, thumbnails, rights (E06-S01).

Storage keys, URLs and local copies go through `apps.core.storage` (E00-S06). Library upload
limits are owned here (E00-S06 rule 34 leaves the final values to this story).
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

from django.core.files.base import ContentFile, File
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ErrorDetail

from apps.core.errors import ApiError, DetailedValidationError

from ..models import Asset, ContentVersion

logger = logging.getLogger(__name__)

MB = 1024 * 1024
KIND_RULES = {
    "image": {"mimes": {"image/jpeg": ("jpg", "jpeg"), "image/png": ("png",),
                        "image/webp": ("webp",)}, "max_bytes": 20 * MB},
    "video": {"mimes": {"video/mp4": ("mp4", "m4v"), "video/quicktime": ("mov",)},
              "max_bytes": 500 * MB},
    "audio": {"mimes": {"audio/mpeg": ("mp3",), "audio/mp4": ("m4a", "mp4"),
                        "audio/x-m4a": ("m4a",), "audio/wav": ("wav",),
                        "audio/x-wav": ("wav",)}, "max_bytes": 30 * MB},
    "document": {"mimes": {"application/pdf": ("pdf",)}, "max_bytes": 20 * MB},
}
CANONICAL_MIME = {"audio/x-m4a": "audio/mp4", "audio/x-wav": "audio/wav"}
UPLOAD_ROLES = ("source", "background", "clip", "music", "final")
ROLE_KINDS = {"music": ("audio",), "clip": ("video",), "background": ("image",),
              "final": ("image", "video"), "source": ("image", "video", "audio", "document")}
USER_ORIGINS = ("uploaded", "licensed")
SYSTEM_ORIGINS = ("ai_generated", "rendered")
RIGHTS_ORDER = {"cleared": 0, "unknown": 1, "restricted": 2, "expired": 3}
THUMB_WIDTH = 480
EDITABLE_FIELDS = ("role", "rights_status", "license_note", "source_url", "rights_expires_at",
                   "content_item")


class UnsupportedMediaError(ApiError):
    def __init__(self, reasons: list[str], field_name: str = "file"):
        super().__init__("unsupported_media", 400, details={"reasons": reasons})
        self.field_name = field_name


@dataclass
class Probe:
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    meta: dict = field(default_factory=dict)


# --- Detection and probing ----------------------------------------------------------------

def detect(head: bytes) -> str | None:
    import filetype

    kind = filetype.guess(head)
    if kind is None:
        return None
    return kind.mime


def kind_for_mime(mime: str) -> str | None:
    for kind, rules in KIND_RULES.items():
        if mime in rules["mimes"]:
            return kind
    return None


def ffprobe(path: Path) -> dict:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
             str(path)], capture_output=True, timeout=60, check=True)
    except FileNotFoundError:
        raise UnsupportedMediaError(["probe_unavailable: ffprobe is not installed"]) from None
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise UnsupportedMediaError(["unreadable: the file could not be read"]) from None
    return json.loads(out.stdout or b"{}")


def probe_av(path: Path, kind: str) -> Probe:
    data = ffprobe(path)
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    try:
        duration = float((data.get("format") or {}).get("duration") or 0)
    except ValueError:
        duration = 0
    fps = None
    if video and video.get("avg_frame_rate") and video["avg_frame_rate"] != "0/0":
        num, _, den = video["avg_frame_rate"].partition("/")
        try:
            fps = round(float(num) / float(den or 1), 3)
        except (ValueError, ZeroDivisionError):
            fps = None
    probe = Probe(duration_ms=int(round(duration * 1000)) if duration else None,
                  meta={"probe": {"video_codec": video.get("codec_name") if video else None,
                                  "audio_codec": audio.get("codec_name") if audio else None,
                                  "fps": fps, "has_audio": audio is not None}})
    if video:
        width, height = video.get("width"), video.get("height")
        rotation = 0
        for side in video.get("side_data_list") or []:
            if "rotation" in side:
                rotation = abs(int(side["rotation"]))
        if rotation in (90, 270):
            width, height = height, width
        probe.width, probe.height = width, height
        probe.meta["probe"]["pix_fmt"] = video.get("pix_fmt")
    if kind == "video" and video is None:
        raise UnsupportedMediaError(["no_video_stream: the file has no video stream"])
    return probe


def probe_image(path: Path) -> Probe:
    from PIL import Image, ImageOps

    try:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            return Probe(width=img.width, height=img.height)
    except Exception:  # noqa: BLE001
        raise UnsupportedMediaError(["unreadable: the image could not be read"]) from None


def check_limits(kind: str, probe: Probe) -> list[str]:
    reasons = []
    if kind == "image" and probe.width and probe.height:
        short, long_ = min(probe.width, probe.height), max(probe.width, probe.height)
        if short < 320:
            reasons.append(f"image_too_small: shortest side {short} px, min 320 px")
        if long_ > 8000:
            reasons.append(f"image_too_large: longest side {long_} px, max 8000 px")
    if kind in ("video", "audio"):
        seconds = (probe.duration_ms or 0) / 1000
        if seconds < 1:
            reasons.append(f"duration_too_short: {seconds:.1f} s, min 1 s")
        if seconds > 600:
            reasons.append(f"duration_too_long: {round(seconds)} s, max 600 s")
    return reasons


# --- Thumbnails ---------------------------------------------------------------------------

def image_thumbnail(source) -> bytes:
    from PIL import Image, ImageOps

    with Image.open(source) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        if img.width > THUMB_WIDTH:
            img = img.resize((THUMB_WIDTH, max(1, round(img.height * THUMB_WIDTH / img.width))),
                             Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, "JPEG", quality=85, optimize=True)
        return out.getvalue()


def video_poster(path: Path, duration_ms: int | None) -> bytes | None:
    at = "1" if (duration_ms or 0) >= 1000 else "0"
    with tempfile.TemporaryDirectory(prefix="socialhub-poster-") as tmp:
        target = Path(tmp) / "poster.jpg"
        try:
            subprocess.run(["ffmpeg", "-v", "error", "-ss", at, "-i", str(path), "-frames:v", "1",
                            "-vf", f"scale={THUMB_WIDTH}:-2", "-q:v", "3", "-y", str(target)],
                           capture_output=True, timeout=60, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return None
        return target.read_bytes() if target.exists() else None


# --- Keys and URLs ------------------------------------------------------------------------

def _slug(filename: str) -> str:
    stem = Path(filename).stem.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")[:60].strip("-")
    return slug or "file"


def asset_key(account_id: int, asset_id: int, filename: str, ext: str) -> str:
    try:
        from apps.core.storage import asset_key as core_asset_key

        return core_asset_key(account_id, asset_id, f"{Path(filename).stem}.{ext}", timezone.now())
    except ImportError:
        now = timezone.now()
        return f"accounts/{account_id}/{now:%Y}/{now:%m}/{asset_id}-{_slug(filename)}.{ext}"


def thumb_key(key: str) -> str:
    base, _, _ext = key.rpartition(".")
    return f"{base or key}-thumb.jpg"


# --- Rights -------------------------------------------------------------------------------

def effective_rights(asset: Asset) -> str:
    if asset.rights_status == "cleared" and asset.rights_expires_at:
        today = timezone.now().astimezone(ZoneInfo(asset.account.timezone)).date()
        if asset.rights_expires_at < today:
            return "expired"
    return asset.rights_status


def worst_rights(statuses) -> str:
    statuses = list(statuses) or ["cleared"]
    return max(statuses, key=lambda s: RIGHTS_ORDER.get(s, 1))


def _validate_rights(origin: str, rights_status: str, license_note: str,
                     rights_expires_at: date | None, account) -> None:
    errors = {}
    if rights_status not in RIGHTS_ORDER:
        errors["rights_status"] = [ErrorDetail("invalid_choice", code="invalid_choice")]
    if rights_status == "cleared" and len((license_note or "").strip()) < 3:
        errors["license_note"] = [ErrorDetail("required", code="required")]
    if rights_status == "cleared" and rights_expires_at:
        today = timezone.now().astimezone(ZoneInfo(account.timezone)).date()
        if rights_expires_at < today:
            errors["rights_expires_at"] = [ErrorDetail("in_past", code="in_past")]
    if errors:
        raise DetailedValidationError(errors)


# --- Usage --------------------------------------------------------------------------------

def usage_index(account_id: int) -> dict[int, list[dict]]:
    """Every asset reference of the account's content versions (rule 12), keyed by asset ID.

    Built in Python from the versions' JSON so it works on every database backend; list views
    build it once per request instead of querying per asset.
    """
    index: dict[int, list[dict]] = {}

    def add(asset_id, version, as_):
        if asset_id:
            index.setdefault(asset_id, []).append(_use(version, as_))

    qs = ContentVersion.objects.filter(content_item__account_id=account_id).select_related(
        "content_item").only("version", "frames", "clips", "final_asset_id", "cover_asset_id",
                             "music_asset_id", "content_item__title")
    for version in qs:
        for attr in ("final_asset", "cover_asset", "music_asset"):
            add(getattr(version, f"{attr}_id"), version, attr)
        for frame in version.frames or []:
            add(frame.get("asset_id"), version, f"frame {frame.get('index')}")
            add(frame.get("background_asset_id"), version,
                f"background of frame {frame.get('index')}")
        for clip in version.clips or []:
            add(clip.get("asset_id"), version, f"clip for shot {clip.get('shot_index')}")
    return index


def used_by(asset: Asset, index: dict | None = None) -> list[dict]:
    index = usage_index(asset.account_id) if index is None else index
    return index.get(asset.pk, [])


def _use(version, as_):
    return {"content_item": version.content_item_id, "title": version.content_item.title,
            "version": version.version, "as": as_}


def in_use(asset: Asset) -> bool:
    return bool(used_by(asset))


# --- Upload -------------------------------------------------------------------------------

def _uploaded_path(uploaded) -> tuple[Path, tempfile.TemporaryDirectory | None]:
    path = getattr(uploaded, "temporary_file_path", None)
    if callable(path):
        return Path(path()), None
    tmp = tempfile.TemporaryDirectory(prefix="socialhub-upload-")
    target = Path(tmp.name) / "upload"
    with open(target, "wb") as out:
        for chunk in uploaded.chunks():
            out.write(chunk)
    return target, tmp


def upload(*, account, uploaded, user=None, content_item=None, role: str = "source",
           origin: str = "uploaded", rights_status: str | None = None, license_note: str = "",
           source_url: str = "", rights_expires_at: date | None = None,
           allowed_kinds: tuple[str, ...] | None = None) -> tuple[Asset, bool]:
    """Validate, probe and store one uploaded file. Returns (asset, duplicate)."""
    errors = {}
    if role not in UPLOAD_ROLES:
        errors["role"] = [ErrorDetail("invalid_choice", code="invalid_choice")]
    if origin not in USER_ORIGINS:
        errors["origin"] = [ErrorDetail("invalid_choice", code="invalid_choice")]
    if content_item is not None and content_item.account_id != account.pk:
        errors["content_item"] = [ErrorDetail("invalid", code="invalid")]
    if errors:
        raise DetailedValidationError(errors)

    if uploaded.size == 0:
        raise UnsupportedMediaError(["empty_file: the file is empty"])
    head = uploaded.read(8192)
    uploaded.seek(0)
    mime = detect(head)
    kind = kind_for_mime(mime) if mime else None
    if kind is None:
        raise UnsupportedMediaError(["type_not_allowed: this file type is not accepted"])
    ext = Path(uploaded.name or "").suffix.lower().lstrip(".")
    if ext not in KIND_RULES[kind]["mimes"][mime]:
        raise UnsupportedMediaError([f"extension_mismatch: .{ext or '?'} does not match {mime}"])
    if uploaded.size > KIND_RULES[kind]["max_bytes"]:
        from apps.core.errors import PayloadTooLarge

        raise PayloadTooLarge({"max_bytes": KIND_RULES[kind]["max_bytes"]})
    if allowed_kinds and kind not in allowed_kinds:
        raise UnsupportedMediaError([f"wrong_kind: {kind} is not accepted here"])
    if kind not in ROLE_KINDS[role]:
        raise DetailedValidationError({"role": [ErrorDetail("role_kind_mismatch",
                                                            code="role_kind_mismatch")]})
    mime = CANONICAL_MIME.get(mime, mime)

    if rights_status is None:
        rights_status = "cleared" if origin == "licensed" else "unknown"
    _validate_rights(origin, rights_status, license_note, rights_expires_at, account)

    path, tmp = _uploaded_path(uploaded)
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(MB), b""):
                digest.update(chunk)
        checksum = digest.hexdigest()
        existing = Asset.objects.filter(account=account, checksum=checksum,
                                        content_item=content_item, role=role).first()
        if existing is not None:
            return existing, True

        if kind == "image":
            probe = probe_image(path)
        elif kind in ("video", "audio"):
            probe = probe_av(path, kind)
        else:
            probe = Probe()
        reasons = check_limits(kind, probe)
        if reasons:
            raise UnsupportedMediaError(reasons)

        thumb = None
        if kind == "image":
            thumb = image_thumbnail(path)
        elif kind == "video":
            thumb = video_poster(path, probe.duration_ms)

        with transaction.atomic():
            asset = Asset.objects.create(
                account=account, content_item=content_item, kind=kind, role=role,
                file="pending", original_filename=(uploaded.name or "")[:255], mime=mime,
                bytes=uploaded.size, width=probe.width, height=probe.height,
                duration_ms=probe.duration_ms, checksum=checksum, origin=origin,
                rights_status=rights_status, license_note=license_note or "",
                source_url=source_url or "", rights_expires_at=rights_expires_at,
                meta=probe.meta, created_by=user if getattr(user, "pk", None) else None)
            key = asset_key(account.pk, asset.pk, uploaded.name or "file", ext)
            with open(path, "rb") as fh:
                asset.file.name = default_storage.save(key, File(fh))
            if thumb:
                asset.thumbnail.name = default_storage.save(thumb_key(key), ContentFile(thumb))
            asset.save(update_fields=["file", "thumbnail", "updated_at"])
        return asset, False
    finally:
        if tmp is not None:
            tmp.cleanup()


def store_generated(*, account, content_item, kind: str, role: str, data: bytes, mime: str,
                    ext: str, filename: str, origin: str, rights_status: str = "cleared",
                    rights_expires_at=None, license_note: str = "", meta: dict | None = None,
                    width=None, height=None, duration_ms=None, make_thumbnail: bool = True,
                    user=None) -> Asset:
    """Store a file the system produced (rendered frames, finals, AI images)."""
    checksum = hashlib.sha256(data).hexdigest()
    with transaction.atomic():
        asset = Asset.objects.create(
            account=account, content_item=content_item, kind=kind, role=role, file="pending",
            original_filename=filename[:255], mime=mime, bytes=len(data), width=width,
            height=height, duration_ms=duration_ms, checksum=checksum, origin=origin,
            rights_status=rights_status, rights_expires_at=rights_expires_at,
            license_note=license_note, meta=meta or {},
            created_by=user if getattr(user, "pk", None) else None)
        key = asset_key(account.pk, asset.pk, filename, ext)
        asset.file.name = default_storage.save(key, ContentFile(data))
        if make_thumbnail and kind == "image":
            try:
                asset.thumbnail.name = default_storage.save(thumb_key(key),
                                                            ContentFile(image_thumbnail(
                                                                io.BytesIO(data))))
            except Exception:  # noqa: BLE001 - thumbnails are a convenience
                logger.warning("Thumbnail failed for asset %s", asset.pk)
        asset.save(update_fields=["file", "thumbnail", "updated_at"])
    return asset


def store_generated_file(*, path: Path, **kwargs) -> Asset:
    """Like `store_generated` for large files (videos) without reading them into memory."""
    checksum = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(MB), b""):
            checksum.update(chunk)
    make_thumbnail = kwargs.pop("make_thumbnail", True)
    with transaction.atomic():
        asset = Asset.objects.create(
            account=kwargs["account"], content_item=kwargs.get("content_item"),
            kind=kwargs["kind"], role=kwargs["role"], file="pending",
            original_filename=kwargs["filename"][:255], mime=kwargs["mime"],
            bytes=path.stat().st_size, width=kwargs.get("width"), height=kwargs.get("height"),
            duration_ms=kwargs.get("duration_ms"), checksum=checksum.hexdigest(),
            origin=kwargs["origin"], rights_status=kwargs.get("rights_status", "cleared"),
            rights_expires_at=kwargs.get("rights_expires_at"),
            license_note=kwargs.get("license_note", ""), meta=kwargs.get("meta") or {})
        key = asset_key(kwargs["account"].pk, asset.pk, kwargs["filename"], kwargs["ext"])
        with open(path, "rb") as fh:
            asset.file.name = default_storage.save(key, File(fh))
        if make_thumbnail and kwargs["kind"] == "video":
            poster = video_poster(path, kwargs.get("duration_ms"))
            if poster:
                asset.thumbnail.name = default_storage.save(thumb_key(key), ContentFile(poster))
        asset.save(update_fields=["file", "thumbnail", "updated_at"])
    return asset


# --- Edit and delete ----------------------------------------------------------------------

def update(asset: Asset, data: dict) -> Asset:
    unknown = [k for k in data if k not in EDITABLE_FIELDS]
    errors = {k: [ErrorDetail("read_only", code="read_only")] for k in unknown}
    if asset.origin in SYSTEM_ORIGINS:
        errors.update({k: [ErrorDetail("read_only", code="read_only")]
                       for k in data if k != "license_note" and k not in errors})
    if errors:
        raise DetailedValidationError(errors)
    if "role" in data:
        role = data["role"]
        if role not in UPLOAD_ROLES:
            raise DetailedValidationError({"role": [ErrorDetail("invalid_choice",
                                                                code="invalid_choice")]})
        if asset.kind not in ROLE_KINDS[role]:
            raise DetailedValidationError({"role": [ErrorDetail("role_kind_mismatch",
                                                                code="role_kind_mismatch")]})
        asset.role = role
    if "content_item" in data:
        from ..models import ContentItem

        target = data["content_item"]
        if target is None:
            asset.content_item = None
        else:
            item = ContentItem.objects.filter(pk=target, account_id=asset.account_id).first()
            if item is None:
                raise DetailedValidationError({"content_item": [ErrorDetail("invalid",
                                                                            code="invalid")]})
            asset.content_item = item
    for name in ("license_note", "source_url"):
        if name in data:
            setattr(asset, name, data[name] or "")
    if "rights_status" in data:
        asset.rights_status = data["rights_status"]
    if "rights_expires_at" in data:
        value = data["rights_expires_at"]
        if isinstance(value, str) and value:
            try:
                value = date.fromisoformat(value)
            except ValueError:
                raise DetailedValidationError({"rights_expires_at": [ErrorDetail(
                    "invalid", code="invalid")]}) from None
        asset.rights_expires_at = value or None
    if asset.origin not in SYSTEM_ORIGINS:
        _validate_rights(asset.origin, asset.rights_status, asset.license_note,
                         asset.rights_expires_at, asset.account)
    asset.save()
    return asset


def delete(asset: Asset) -> None:
    uses = used_by(asset)
    if uses:
        raise ApiError("state_conflict", 409, details={
            "used_by": [{"content_item": u["content_item"], "version": u["version"],
                         "as": u["as"]} for u in uses]})
    files = [f.name for f in (asset.file, asset.thumbnail) if f]
    asset.delete()
    for name in files:
        try:
            default_storage.delete(name)
        except Exception:  # noqa: BLE001
            logger.warning("Could not delete %s", name)


def local_path(asset: Asset):
    """Context manager yielding a local path for an asset's file (E00-S06 `local_copy`)."""
    try:
        from apps.core.storage import local_copy

        return local_copy(asset.file, expected_sha256=asset.checksum)
    except ImportError:
        return _fallback_local_copy(asset)


class _fallback_local_copy:
    def __init__(self, asset):
        self.asset = asset
        self.tmp = None

    def __enter__(self) -> Path:
        try:
            return Path(self.asset.file.path)
        except NotImplementedError:
            self.tmp = tempfile.mkdtemp(prefix="socialhub-asset-")
            target = Path(self.tmp) / Path(self.asset.file.name).name
            with self.asset.file.open("rb") as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
            return target

    def __exit__(self, *exc):
        if self.tmp:
            shutil.rmtree(self.tmp, ignore_errors=True)
        return False
