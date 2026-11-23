"""AI background images for frames (E06-S05)."""

from __future__ import annotations

import io
import json
from pathlib import Path

from django.conf import settings
from django.db import transaction

from apps.content.models import Asset, ContentVersion
from apps.content.services import assets as asset_service

from ..rendering.templates import get_template

PROMPT_DIR = Path(__file__).resolve().parents[2] / "ai" / "prompts" / "image.generate"
SUBJECT_MAX = 600

# 24 colour names for the palette hint (rule 5).
PALETTE = {
    "black": (0, 0, 0), "charcoal": (54, 69, 79), "grey": (128, 128, 128),
    "silver": (192, 192, 192), "white": (255, 255, 255), "warm white": (250, 244, 230),
    "cream": (255, 253, 208), "beige": (222, 203, 164), "brown": (121, 85, 61),
    "terracotta": (204, 78, 54), "red": (200, 30, 45), "coral": (255, 127, 80),
    "orange": (245, 130, 32), "amber": (255, 191, 0), "yellow": (250, 220, 50),
    "olive": (128, 128, 0), "green": (46, 139, 87), "mint": (152, 222, 186),
    "teal": (0, 128, 128), "turquoise": (64, 224, 208), "sky blue": (135, 206, 235),
    "blue": (30, 90, 200), "navy": (20, 33, 80), "purple": (110, 60, 160),
}


class ImageCapReached(Exception):
    pass


def colour_name(hex_color: str) -> str:
    hex_color = (hex_color or "#FFFFFF").lstrip("#")
    try:
        rgb = tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return "neutral"
    return min(PALETTE, key=lambda n: sum((a - b) ** 2 for a, b in zip(PALETTE[n], rgb)))


def _constraints() -> str:
    return (PROMPT_DIR / "constraints.txt").read_text(encoding="utf-8").strip()


def _placement(template_key: str) -> str:
    return json.loads((PROMPT_DIR / "placement.json").read_text(encoding="utf-8")).get(
        template_key, "")


def build_prompt(version: ContentVersion, frame: dict, *, subject: str | None,
                 extra_constraints=()) -> tuple[str, str]:
    subject = " ".join((subject or frame.get("visual_prompt") or "").split())[:SUBJECT_MAX]
    notes = ((version.script.payload or {}).get("design_notes") or {}) if version.script else {}
    parts = [subject.rstrip(".") + "."]
    style = []
    if notes.get("imagery_style"):
        style.append(f"Style: {notes['imagery_style'].strip().rstrip('.')}.")
    if notes.get("mood"):
        style.append(f"Mood: {notes['mood'].strip().rstrip('.')}.")
    if style:
        parts.append(" ".join(style))
    brand = getattr(version.content_item.account, "brand", None)
    colors = getattr(brand, "colors", None) or {}
    parts.append(f"Palette leaning toward {colour_name(colors.get('primary'))} and "
                 f"{colour_name(colors.get('background'))}.")
    constraints = [_constraints()]
    if placement := _placement(frame.get("template", "")):
        constraints.append(placement)
    constraints += [c for c in extra_constraints if c]
    parts.append(" ".join(constraints))
    return subject, " ".join(parts)


def generated_count(item) -> int:
    return Asset.objects.filter(content_item=item, origin="ai_generated").count()


def max_images() -> int:
    return int(getattr(settings, "SOCIALHUB_AI_MAX_IMAGES_PER_ITEM", 12))


def check_frame(version: ContentVersion, frame_index: int, subject: str | None) -> dict:
    """Request validation for one frame (API rule table). Returns the frame."""
    from rest_framework.exceptions import ErrorDetail

    from apps.core.errors import DetailedValidationError

    frame = next((f for f in version.frames if f["index"] == frame_index), None)
    if frame is None:
        raise DetailedValidationError({"frame_index": [ErrorDetail("does_not_exist",
                                                                   code="does_not_exist")]})
    if get_template(frame["template"]).image_slot == "none":
        raise DetailedValidationError({"frame_index": [ErrorDetail(
            "not_allowed_for_template", code="not_allowed_for_template")]})
    if subject is not None and len(subject) > SUBJECT_MAX:
        raise DetailedValidationError({"prompt": [ErrorDetail("max_length", code="max_length")]})
    if not (subject or frame.get("visual_prompt")):
        raise DetailedValidationError({"prompt": [ErrorDetail("required", code="required")]})
    return frame


def generate_frame_background(version: ContentVersion, frame_index: int, *,
                              subject: str | None = None, extra_constraints=(),
                              attach: bool = True, job_id=None) -> Asset:
    """Rule 12a: build the prompt, enforce the cap, call the gateway, store and attach."""
    from apps.ai.gateway import run_image
    from PIL import Image

    item = version.content_item
    frame = next(f for f in version.frames if f["index"] == frame_index)
    if generated_count(item) >= max_images():
        raise ImageCapReached()
    subject_text, prompt = build_prompt(version, frame, subject=subject,
                                        extra_constraints=extra_constraints)
    result = run_image("image.generate", prompt=prompt, size="portrait",
                       account_id=item.account_id, job_id=job_id)
    with Image.open(io.BytesIO(result.content)) as img:
        width, height = img.size
    model = _image_model()
    ext = "png" if result.mime == "image/png" else ("webp" if result.mime == "image/webp"
                                                     else "jpg")
    asset = asset_service.store_generated(
        account=item.account, content_item=item, kind="image", role="background",
        data=result.content, mime=result.mime, ext=ext,
        filename=f"item-{item.pk}-frame-{frame_index}-background", origin="ai_generated",
        rights_status="cleared", license_note=f"Generated with {model}", width=width,
        height=height, meta={"prompt": prompt, "subject": subject_text, "model": model,
                             "size": "portrait", "frame_index": frame_index,
                             "ai_run_id": result.ai_run_id})
    if attach:
        attach_background(version, frame_index, asset)
    return asset


def _image_model() -> str:
    return getattr(settings, "SOCIALHUB_AI_IMAGE_MODEL", "") or (
        "fake" if getattr(settings, "SOCIALHUB_AI_IMAGE_PROVIDER", "fake") == "fake" else "image")


def attach_background(version: ContentVersion, frame_index: int, asset: Asset | None) -> None:
    with transaction.atomic():
        version = ContentVersion.objects.select_for_update().get(pk=version.pk)
        frames = [dict(f) for f in version.frames]
        for frame in frames:
            if frame["index"] == frame_index:
                frame["background_asset_id"] = asset.pk if asset else None
                frame["state"] = "stale" if frame.get("state") != "pending" else "pending"
                overridden = set(frame.get("overridden") or [])
                if asset:
                    overridden.add("background_asset_id")
                else:
                    overridden.discard("background_asset_id")
                frame["overridden"] = sorted(overridden)
        version.frames = frames
        version.render_status = ContentVersion.RenderStatus.PENDING
        version.save(update_fields=["frames", "render_status", "updated_at"])


def auto_images_enabled() -> bool:
    return bool(getattr(settings, "SOCIALHUB_PRODUCTION_AUTO_IMAGES", False))


def needs_auto_image(frame: dict) -> bool:
    template = get_template(frame["template"])
    return (template.image_slot in ("optional", "required")
            and not frame.get("background_asset_id") and bool(frame.get("visual_prompt")))
