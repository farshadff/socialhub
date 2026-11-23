"""Format specification registry (E04-S01) with script rules and frame templates (E05-S01).

The one place that states every format's sizes and limits. Rendering, checks, publishing and
analytics read them through the helpers below; nothing else reads `SPECS` directly.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from django.conf import settings

from apps.planning.models import Format, Role

REGISTRY_VERSION = "1"

MB = 1024 * 1024
IMAGE = "image"
VIDEO = "video"
DESIGN = "design"
MOTION = "motion"
VIDEO_MODE = "video"

MEDIA_KINDS = (IMAGE, VIDEO)
PRODUCTION_MODE_KEYS = (DESIGN, MOTION, VIDEO_MODE)
CHECKPOINTS = ("1h", "6h", "23h", "24h", "72h", "7d", "adhoc")
CAPABILITY_KEYS = ("publish_feed", "publish_reel", "publish_story", "insights")
PUBLISH_METHODS = ("publish_feed_image", "publish_story_image", "publish_story_video",
                   "publish_reel")


class UnknownFormat(Exception):
    pass


@dataclass(frozen=True)
class FormatSpec:
    format: str
    media_kind: str
    label: str
    layout: str
    width: int
    height: int
    aspect_ratio: str
    aspect_tolerance: float
    min_width: int
    production_modes: tuple
    default_production_mode: str
    image_mime: str | None
    upload_mimes: tuple
    max_file_bytes: int
    min_duration_s: float | None
    max_duration_s: float | None
    container: str | None
    video_codec: str | None
    pixel_format: str | None
    audio_codec: str | None
    audio_required: bool
    fps_min: int | None
    fps_max: int | None
    caption_allowed: bool
    caption_max_chars: int
    hashtags_allowed: bool  # internal: max_hashtags comes from the setting when true
    alt_text_expected: bool
    alt_text_max_chars: int
    cover_required: bool
    safe_area: dict = field(hash=False)
    publish_method: str = ""
    capability: str = ""
    daily_limit_group: str = ""
    metric_checkpoints: tuple = ()
    evaluation_checkpoints: tuple = ()

    @property
    def max_hashtags(self) -> int:
        return max_hashtags_setting() if self.hashtags_allowed else 0

    def as_dict(self) -> dict:
        data = asdict(self)
        data.pop("hashtags_allowed")
        data["max_hashtags"] = self.max_hashtags
        for key in ("production_modes", "upload_mimes", "metric_checkpoints",
                    "evaluation_checkpoints"):
            data[key] = list(data[key])
        # Field order as in E04-S01 rule 3: insert max_hashtags after caption_max_chars.
        ordered = {}
        for key, value in data.items():
            if key == "max_hashtags":
                continue
            ordered[key] = value
            if key == "caption_max_chars":
                ordered["max_hashtags"] = data["max_hashtags"]
        return ordered


_IMAGE_COMMON = dict(
    media_kind=IMAGE, width=1080, aspect_tolerance=0.01, min_width=720,
    production_modes=(DESIGN,), default_production_mode=DESIGN, image_mime="image/jpeg",
    upload_mimes=("image/jpeg", "image/png"), max_file_bytes=8 * MB,
    min_duration_s=None, max_duration_s=None, container=None, video_codec=None,
    pixel_format=None, audio_codec=None, audio_required=False, fps_min=None, fps_max=None,
    alt_text_max_chars=100, cover_required=False,
)
_VIDEO_COMMON = dict(
    media_kind=VIDEO, layout="9x16", width=1080, height=1920, aspect_ratio="9:16",
    aspect_tolerance=0.01, min_width=720, production_modes=(MOTION, VIDEO_MODE),
    default_production_mode=MOTION, image_mime=None,
    upload_mimes=("video/mp4", "video/quicktime"), max_file_bytes=100 * MB,
    container="mp4", video_codec="h264", pixel_format="yuv420p", audio_codec="aac",
    fps_min=23, fps_max=60, alt_text_expected=False, alt_text_max_chars=100,
)

SPECS: tuple[FormatSpec, ...] = (
    FormatSpec(
        format="feed_post", label="Feed post", layout="4x5", height=1350, aspect_ratio="4:5",
        caption_allowed=True, caption_max_chars=2200, hashtags_allowed=True,
        alt_text_expected=True, safe_area={"top": 60, "right": 60, "bottom": 60, "left": 60},
        publish_method="publish_feed_image", capability="publish_feed", daily_limit_group="feed",
        metric_checkpoints=("1h", "6h", "24h", "72h", "7d"), evaluation_checkpoints=("24h", "7d"),
        **_IMAGE_COMMON,
    ),
    FormatSpec(
        format="story", label="Image story", layout="9x16", height=1920, aspect_ratio="9:16",
        caption_allowed=False, caption_max_chars=0, hashtags_allowed=False,
        alt_text_expected=False, safe_area={"top": 250, "right": 60, "bottom": 250, "left": 60},
        publish_method="publish_story_image", capability="publish_story",
        daily_limit_group="story", metric_checkpoints=("1h", "6h", "23h"),
        evaluation_checkpoints=("23h",), **_IMAGE_COMMON,
    ),
    FormatSpec(
        format="story", label="Video story", min_duration_s=1, max_duration_s=60,
        audio_required=False, caption_allowed=False, caption_max_chars=0,
        hashtags_allowed=False, cover_required=False,
        safe_area={"top": 250, "right": 60, "bottom": 250, "left": 60},
        publish_method="publish_story_video", capability="publish_story",
        daily_limit_group="story", metric_checkpoints=("1h", "6h", "23h"),
        evaluation_checkpoints=("23h",), **_VIDEO_COMMON,
    ),
    FormatSpec(
        format="reel", label="Reel", min_duration_s=5, max_duration_s=90, audio_required=True,
        caption_allowed=True, caption_max_chars=2200, hashtags_allowed=True,
        cover_required=True, safe_area={"top": 220, "right": 120, "bottom": 420, "left": 60},
        publish_method="publish_reel", capability="publish_reel", daily_limit_group="feed",
        metric_checkpoints=("1h", "6h", "24h", "72h", "7d"), evaluation_checkpoints=("24h", "7d"),
        **_VIDEO_COMMON,
    ),
)

FORMATS = (
    {"format": "feed_post", "label": "Feed post", "media_kinds": [IMAGE],
     "default_media_kind": IMAGE},
    {"format": "story", "label": "Story", "media_kinds": [IMAGE, VIDEO],
     "default_media_kind": IMAGE},
    {"format": "reel", "label": "Reel", "media_kinds": [VIDEO], "default_media_kind": VIDEO},
)

PRODUCTION_MODES = (
    {"key": DESIGN, "label": "Design",
     "description": "A single image rendered from a brand template."},
    {"key": MOTION, "label": "Motion",
     "description": "Rendered frames animated into a video with transitions."},
    {"key": VIDEO_MODE, "label": "Video",
     "description": "Uploaded footage cut to the script, with text overlays."},
)

# --- E05-S01: script rules and frame templates -------------------------------------------

SHOT_TYPES = ("footage", "graphic", "text")
TRANSITIONS = ("cut", "fade", "slide")

SCRIPT_RULES = (
    {"format": "feed_post", "media_kind": IMAGE, "production_mode": DESIGN,
     "shots": {"min": 1, "max": 1}, "frames": {"min": 1, "max": 1},
     "duration_seconds": {"min": 0, "max": 0}, "frame_duration_seconds": {"min": 0, "max": 0},
     "allowed_shot_types": ["graphic"], "frame_per_shot_required": True,
     "last_frame_cta": False, "footage_required": False},
    {"format": "story", "media_kind": IMAGE, "production_mode": DESIGN,
     "shots": {"min": 1, "max": 1}, "frames": {"min": 1, "max": 1},
     "duration_seconds": {"min": 0, "max": 0}, "frame_duration_seconds": {"min": 0, "max": 0},
     "allowed_shot_types": ["graphic"], "frame_per_shot_required": True,
     "last_frame_cta": False, "footage_required": False},
    {"format": "story", "media_kind": VIDEO, "production_mode": MOTION,
     "shots": {"min": 1, "max": 4}, "frames": {"min": 1, "max": 4},
     "duration_seconds": {"min": 5, "max": 60}, "frame_duration_seconds": {"min": 2, "max": 15},
     "allowed_shot_types": ["graphic", "text"], "frame_per_shot_required": True,
     "last_frame_cta": False, "footage_required": False},
    {"format": "story", "media_kind": VIDEO, "production_mode": VIDEO_MODE,
     "shots": {"min": 1, "max": 4}, "frames": {"min": 0, "max": 4},
     "duration_seconds": {"min": 5, "max": 60}, "frame_duration_seconds": {"min": 1, "max": None},
     "allowed_shot_types": ["footage", "graphic", "text"], "frame_per_shot_required": False,
     "last_frame_cta": False, "footage_required": True},
    {"format": "reel", "media_kind": VIDEO, "production_mode": MOTION,
     "shots": {"min": 4, "max": 8}, "frames": {"min": 4, "max": 8},
     "duration_seconds": {"min": 15, "max": 60}, "frame_duration_seconds": {"min": 2, "max": 8},
     "allowed_shot_types": ["graphic", "text"], "frame_per_shot_required": True,
     "last_frame_cta": True, "footage_required": False},
    {"format": "reel", "media_kind": VIDEO, "production_mode": VIDEO_MODE,
     "shots": {"min": 3, "max": 10}, "frames": {"min": 0, "max": 10},
     "duration_seconds": {"min": 15, "max": 90}, "frame_duration_seconds": {"min": 1, "max": None},
     "allowed_shot_types": ["footage", "graphic", "text"], "frame_per_shot_required": False,
     "last_frame_cta": False, "footage_required": True},
)

FRAME_TEMPLATES = (
    {"key": "title", "label": "Title", "purpose": "Opening card",
     "headline": {"min": 1, "max": 60}, "body": {"min": 0, "max": 90},
     "visual_prompt": {"required": False, "max": 400}, "body_lines": None},
    {"key": "statement", "label": "Statement", "purpose": "One strong sentence",
     "headline": {"min": 1, "max": 90}, "body": {"min": 0, "max": 120},
     "visual_prompt": {"required": False, "max": 400}, "body_lines": None},
    {"key": "stat", "label": "Stat", "purpose": "A number and what it means",
     "headline": {"min": 1, "max": 12}, "body": {"min": 1, "max": 80},
     "visual_prompt": {"required": False, "max": 400}, "body_lines": None},
    {"key": "list", "label": "List", "purpose": "Short points",
     "headline": {"min": 1, "max": 50}, "body": {"min": 1, "max": 300},
     "visual_prompt": {"required": False, "max": 400},
     "body_lines": {"min": 2, "max": 5, "line_min": 1, "line_max": 45}},
    {"key": "quote", "label": "Quote", "purpose": "A quotation",
     "headline": {"min": 1, "max": 140}, "body": {"min": 0, "max": 40},
     "visual_prompt": {"required": False, "max": 400}, "body_lines": None},
    {"key": "image_caption", "label": "Image with caption",
     "purpose": "A picture with a line of text",
     "headline": {"min": 1, "max": 60}, "body": {"min": 0, "max": 100},
     "visual_prompt": {"required": True, "min": 10, "max": 400}, "body_lines": None},
    {"key": "cta", "label": "Call to action", "purpose": "Closing call to action",
     "headline": {"min": 1, "max": 40}, "body": {"min": 0, "max": 60},
     "visual_prompt": {"required": False, "max": 400}, "body_lines": None},
)
FRAME_TEMPLATE_KEYS = tuple(t["key"] for t in FRAME_TEMPLATES)


# --- Helpers (rule 8) ---------------------------------------------------------------------

def max_hashtags_setting() -> int:
    return int(getattr(settings, "SOCIALHUB_MAX_HASHTAGS", 5))


def all_specs() -> list[FormatSpec]:
    return list(SPECS)


def get_spec(format: str, media_kind: str) -> FormatSpec:
    for spec in SPECS:
        if spec.format == format and spec.media_kind == media_kind:
            return spec
    raise UnknownFormat(f"{format}/{media_kind}")


def _format_info(format: str) -> dict:
    for info in FORMATS:
        if info["format"] == format:
            return info
    raise UnknownFormat(format)


def media_kinds_for(format: str) -> tuple[str, ...]:
    return tuple(_format_info(format)["media_kinds"])


def default_mode(format: str, media_kind: str) -> str:
    return get_spec(format, media_kind).default_production_mode


def defaults_for(format: str) -> tuple[str, str]:
    media_kind = _format_info(format)["default_media_kind"]
    return media_kind, default_mode(format, media_kind)


def is_allowed(format: str, media_kind: str, production_mode: str) -> bool:
    try:
        return production_mode in get_spec(format, media_kind).production_modes
    except UnknownFormat:
        return False


def format_label(format: str, media_kind: str | None = None) -> str:
    if media_kind:
        try:
            return get_spec(format, media_kind).label
        except UnknownFormat:
            pass
    try:
        return _format_info(format)["label"]
    except UnknownFormat:
        return format


def mode_label(mode: str) -> str:
    for info in PRODUCTION_MODES:
        if info["key"] == mode:
            return info["label"]
    return mode


def registry_version() -> str:
    return f"{REGISTRY_VERSION}+h{max_hashtags_setting()}"


def script_rules_for(format: str, media_kind: str, production_mode: str) -> dict:
    for rule in SCRIPT_RULES:
        if (rule["format"], rule["media_kind"], rule["production_mode"]) == (
                format, media_kind, production_mode):
            return rule
    raise UnknownFormat(f"{format}/{media_kind}/{production_mode}")


def frame_template(key: str) -> dict | None:
    for template in FRAME_TEMPLATES:
        if template["key"] == key:
            return template
    return None


def templates_for(format: str) -> list[dict]:
    """Every template is allowed for every format (E05-S01 table); cta has a script-level rule."""
    return list(FRAME_TEMPLATES)


def registry_payload() -> dict:
    """The body of `GET /formats/`."""
    from . import roles

    return {
        "registry_version": registry_version(),
        "formats": [dict(info) for info in FORMATS],
        "specs": [spec.as_dict() for spec in SPECS],
        "production_modes": [dict(mode) for mode in PRODUCTION_MODES],
        "roles": roles.roles_payload(),
        "script_rules": [dict(rule) for rule in SCRIPT_RULES],
        "frame_templates": [dict(t) for t in FRAME_TEMPLATES],
    }


__all__ = [
    "FormatSpec", "UnknownFormat", "Format", "Role", "SPECS", "FORMATS", "PRODUCTION_MODES",
    "SCRIPT_RULES", "FRAME_TEMPLATES", "REGISTRY_VERSION", "all_specs", "get_spec", "is_allowed",
    "defaults_for", "default_mode", "media_kinds_for", "registry_version", "script_rules_for",
    "frame_template", "templates_for", "format_label", "mode_label", "registry_payload",
]
