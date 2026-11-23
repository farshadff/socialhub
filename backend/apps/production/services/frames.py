"""Render the frames of a content version and export the design-mode final image (E06-S02)."""

from __future__ import annotations

import hashlib
import io
import json
import logging
import time
from pathlib import Path

from apps.content import formats
from apps.content.models import Asset, ContentItem, ContentVersion
from apps.content.services import assets as asset_service

from ..rendering import renderer
from ..rendering.brand import BrandContext, build_brand_context
from ..rendering.templates import get_template
from . import rights

logger = logging.getLogger(__name__)

DEFAULT_RENDER_OPTIONS = {"text_backdrop": False, "logo_variant": "auto"}
RETRY_BACKOFF = (10, 30, 90)
HOLDING_WARNINGS = ("text_overflow", "background_required", "rights_not_cleared", "banned_term",
                    "final_needs_normalising")
WARNING_TEXT = {
    "text_overflow": "Text does not fit. Shorten it or choose another template.",
    "logo_not_configured": "No logo in the brand profile.",
    "brand_incomplete": "Brand colours are incomplete; defaults were used.",
    "background_required": "This template needs an image.",
    "background_missing": "No background image was found; the brand background was used.",
    "background_low_resolution": "The background image is low resolution.",
    "rights_not_cleared": "The background image's rights are not cleared.",
}


class FrameRenderFailed(Exception):
    def __init__(self, frame_index: int, detail: str = ""):
        super().__init__(detail or f"Frame {frame_index} could not be rendered")
        self.frame_index = frame_index
        self.code = "render_failed"
        self.detail = f"Frame {frame_index} could not be rendered"


def render_options(frame: dict) -> dict:
    return {**DEFAULT_RENDER_OPTIONS, **(frame.get("render_options") or {})}


def spec_for(item: ContentItem) -> formats.FormatSpec:
    return formats.get_spec(item.format, item.media_kind)


def overlay_frames(version: ContentVersion) -> set[int]:
    """Frames of footage shots render as transparent overlays (E06-S04 rule 5)."""
    item = version.content_item
    if item.production_mode != formats.VIDEO_MODE or version.script is None:
        return set()
    footage = {s["index"] for s in (version.script.payload or {}).get("shots", [])
               if s.get("type") == "footage"}
    return {f["index"] for f in version.frames if f.get("shot_index") in footage}


def background_asset(frame: dict, template) -> Asset | None:
    if template.image_slot == "none" or not frame.get("background_asset_id"):
        return None
    return Asset.objects.filter(pk=frame["background_asset_id"]).select_related("account").first()


def input_hash(frame: dict, *, layout: str, brand: BrandContext, overlay: bool,
               background: Asset | None) -> str:
    template = get_template(frame["template"])
    data = {
        "template": template.key, "template_version": template.version, "layout": layout,
        "headline": frame.get("headline", ""), "body": frame.get("body", ""),
        "background": background.checksum if background else "",
        "render_options": render_options(frame), "brand": brand.fingerprint(),
        "overlay": overlay, "renderer": renderer.RENDERER_VERSION,
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()
                          ).hexdigest()


def frame_hashes(version: ContentVersion, brand: BrandContext | None = None) -> dict[int, str]:
    item = version.content_item
    brand = brand or build_brand_context(item.account)
    layout = spec_for(item).layout
    overlays = overlay_frames(version)
    out = {}
    for frame in version.frames:
        try:
            template = get_template(frame["template"])
        except Exception:  # noqa: BLE001
            continue
        out[frame["index"]] = input_hash(frame, layout=layout, brand=brand,
                                         overlay=frame["index"] in overlays,
                                         background=background_asset(frame, template))
    return out


def _render_one(item, frame, *, spec, brand, overlay, background, debug=False):
    template = get_template(frame["template"])
    options = render_options(frame)
    with (asset_service.local_path(background) if background else _nullcontext()) as bg_path:
        request = renderer.RenderRequest(
            template_key=template.key, layout=spec.layout, width=spec.width, height=spec.height,
            safe_area=dict(spec.safe_area), headline=frame.get("headline", ""),
            body=frame.get("body", ""), brand=brand, lang=item.account.content_language,
            background_path=Path(bg_path) if bg_path else None,
            logo_variant=options["logo_variant"], text_backdrop=bool(options["text_backdrop"]),
            overlay=overlay, debug_boxes=debug)
        return renderer.render(request)


class _nullcontext:
    def __enter__(self):
        return None

    def __exit__(self, *exc):
        return False


def render_frames(version: ContentVersion, *, indexes=None, force: bool = False,
                  progress=None, sleep=time.sleep) -> dict:
    """Render frames of a draft version (rules 17-19, 24). Saves the version.

    `indexes=None` renders every frame not `rendered` with a matching hash; a list forces those.
    Frames whose template needs an image and has none stay `pending` with `background_required`.
    Raises `FrameRenderFailed` after retries.
    """
    item = version.content_item
    spec = spec_for(item)
    brand = build_brand_context(item.account)
    overlays = overlay_frames(version)
    frames = [dict(f) for f in version.frames]
    targets = [f["index"] for f in frames] if indexes is None else list(indexes)
    rendered, reused, waiting = [], [], []
    total = len(targets) or 1
    for n, frame in enumerate(frames):
        if frame["index"] not in targets:
            continue
        template = get_template(frame["template"])
        background = background_asset(frame, template)
        overlay = frame["index"] in overlays
        warnings = []
        if template.image_slot == "required" and background is None and not overlay:
            frame.update(state="pending", asset_id=None,
                         warnings=[{"code": "background_required",
                                    "message": WARNING_TEXT["background_required"]}])
            waiting.append(frame["index"])
            continue
        if frame.get("background_asset_id") and background is None and (
                template.image_slot != "none"):
            warnings.append({"code": "background_missing",
                             "message": WARNING_TEXT["background_missing"]})
        digest = input_hash(frame, layout=spec.layout, brand=brand, overlay=overlay,
                            background=background)
        explicit = indexes is not None
        if not force and not explicit and frame.get("state") == "rendered" and (
                frame.get("input_hash") == digest and frame.get("asset_id")):
            reused.append(frame["index"])
            continue
        existing = Asset.objects.filter(content_item=item, role="frame",
                                        meta__input_hash=digest).order_by("-pk").first()
        if existing is not None and not force:
            frame.update(asset_id=existing.pk, state="rendered", input_hash=digest,
                         warnings=list(existing.meta.get("warnings") or []))
            reused.append(frame["index"])
            continue
        progress and progress(n, total, frame["index"])
        result = None
        for attempt in range(len(RETRY_BACKOFF) + 1):
            try:
                result = _render_one(item, frame, spec=spec, brand=brand, overlay=overlay,
                                     background=background)
                break
            except renderer.RenderError as exc:
                logger.warning("Frame %s of item %s failed (attempt %s): %s", frame["index"],
                               item.pk, attempt + 1, exc)
                if attempt == len(RETRY_BACKOFF):
                    frame.update(state="failed")
                    version.frames = frames
                    version.render_status = ContentVersion.RenderStatus.FAILED
                    version.save(update_fields=["frames", "render_status", "updated_at"])
                    raise FrameRenderFailed(frame["index"]) from exc
                sleep(RETRY_BACKOFF[attempt])
        warnings = brand.warnings + warnings + result.warnings
        if background is not None and asset_service.effective_rights(background) != "cleared":
            warnings.append({"code": "rights_not_cleared",
                             "message": WARNING_TEXT["rights_not_cleared"],
                             "asset_id": background.pk})
        if background is not None and min(background.width or 0, background.height or 0) < 1000 \
                and background.origin == "ai_generated":
            warnings.append({"code": "background_low_resolution",
                             "message": WARNING_TEXT["background_low_resolution"],
                             "asset_id": background.pk})
        inputs = [background.pk] if background else []
        status, expiry = rights.inherited_rights(inputs)
        asset = asset_service.store_generated(
            account=item.account, content_item=item, kind="image", role="frame",
            data=result.png, mime="image/png", ext="png",
            filename=f"item-{item.pk}-v{version.version}-frame-{frame['index']}",
            origin="rendered", rights_status=status, rights_expires_at=expiry,
            width=spec.width, height=spec.height,
            meta={"template": template.key, "template_version": template.version,
                  "layout": spec.layout, "frame_index": frame["index"], "input_hash": digest,
                  "inputs": inputs, "warnings": warnings, "fit": result.fit,
                  "overlay": overlay})
        frame.update(asset_id=asset.pk, state="rendered", input_hash=digest, warnings=warnings)
        rendered.append(frame["index"])
    version.frames = frames
    version.save(update_fields=["frames", "updated_at"])
    rebuild_warnings(version)
    return {"rendered": rendered, "reused": reused, "waiting": waiting}


def frames_ready(version: ContentVersion) -> bool:
    if not version.frames:
        return False
    current = frame_hashes(version)
    return all(f.get("state") == "rendered" and f.get("asset_id")
               and f.get("input_hash") == current.get(f["index"]) for f in version.frames)


def export_final_image(version: ContentVersion) -> Asset:
    """Design mode: JPEG q92, sRGB, no alpha, no metadata, exact canvas size (rule 23)."""
    from PIL import Image

    item = version.content_item
    spec = spec_for(item)
    frame = version.frames[0]
    frame_asset = Asset.objects.get(pk=frame["asset_id"])
    key = hashlib.sha256(f"final:{frame_asset.checksum}:{spec.width}x{spec.height}".encode()
                         ).hexdigest()
    existing = Asset.objects.filter(content_item=item, role="final",
                                    meta__input_hash=key).order_by("-pk").first()
    if existing is not None:
        return _attach_final(version, existing)
    with frame_asset.file.open("rb") as fh:
        image = Image.open(io.BytesIO(fh.read()))
        image.load()
    if image.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", image.size, (255, 255, 255))
        rgba = image.convert("RGBA")
        background.paste(rgba, mask=rgba.split()[-1])
        image = background
    else:
        image = image.convert("RGB")
    if image.size != (spec.width, spec.height):
        image = image.resize((spec.width, spec.height), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=92, optimize=True)
    status, expiry = rights.inherited_rights([frame_asset.pk])
    asset = asset_service.store_generated(
        account=item.account, content_item=item, kind="image", role="final", data=out.getvalue(),
        mime="image/jpeg", ext="jpg", filename=f"item-{item.pk}-v{version.version}-final",
        origin="rendered", rights_status=status, rights_expires_at=expiry, width=spec.width,
        height=spec.height, meta={"input_hash": key, "inputs": [frame_asset.pk],
                                  "profile": f"{spec.layout}_jpeg_q92"})
    return _attach_final(version, asset)


def _attach_final(version: ContentVersion, asset: Asset) -> Asset:
    version.final_asset = asset
    version.save(update_fields=["final_asset", "updated_at"])
    return asset


def rebuild_warnings(version: ContentVersion) -> list[dict]:
    """The single list of production warnings (E06-S02 Data)."""
    warnings: list[dict] = []
    seen = set()

    def add(warning: dict):
        key = json.dumps(warning, sort_keys=True, ensure_ascii=False)
        if key not in seen:
            seen.add(key)
            warnings.append(warning)

    if version.origin != ContentVersion.VersionOrigin.MANUAL_UPLOAD:
        for frame in version.frames or []:
            for w in frame.get("warnings") or []:
                add({**w, "frame_index": frame["index"]} if "asset_id" not in w and
                    "field" not in w else {**w, "frame_index": frame["index"]})
    steps = version.production_steps or {}
    for step in ("backgrounds", "assemble", "copy", "final"):
        for w in (steps.get(step) or {}).get("warnings") or []:
            add(w)
    version.render_warnings = warnings
    version.save(update_fields=["render_warnings", "updated_at"])
    return warnings
