"""Startup checks for the format registry (E04-S01 rules 10-11) and render templates."""

from __future__ import annotations

from django.conf import settings
from django.core import checks

EXPECTED_COMBINATIONS = {("feed_post", "image"), ("story", "image"), ("story", "video"),
                         ("reel", "video")}
LAYOUT_RATIOS = {"4x5": 4 / 5, "9x16": 9 / 16}


def registry_problems(specs=None) -> list[str]:
    from . import formats

    specs = formats.SPECS if specs is None else specs
    problems: list[str] = []
    keys = [(s.format, s.media_kind) for s in specs]
    for missing in EXPECTED_COMBINATIONS - set(keys):
        problems.append(f"{missing[0]}/{missing[1]}: combination missing")
    for extra in set(keys) - EXPECTED_COMBINATIONS:
        problems.append(f"{extra[0]}/{extra[1]}: unexpected combination")
    if len(keys) != len(set(keys)):
        problems.append("duplicate combination in SPECS")
    for info in formats.FORMATS:
        if (info["format"], info["default_media_kind"]) not in keys:
            problems.append(f"{info['format']}: default media kind has no spec")
    for s in specs:
        name = f"{s.format}/{s.media_kind}"
        if s.default_production_mode not in s.production_modes:
            problems.append(f"{name}: default_production_mode not in production_modes")
        ratio = LAYOUT_RATIOS.get(s.layout)
        if ratio is None:
            problems.append(f"{name}: layout {s.layout!r} unknown")
        elif abs((s.width / s.height) - ratio) / ratio > s.aspect_tolerance:
            problems.append(f"{name}: width/height does not match layout")
        video_fields = (s.min_duration_s, s.max_duration_s, s.container, s.video_codec,
                        s.pixel_format, s.fps_min, s.fps_max)
        if s.media_kind == "image" and any(v is not None for v in video_fields):
            problems.append(f"{name}: image spec carries video fields")
        if s.media_kind == "video" and any(v is None for v in video_fields):
            problems.append(f"{name}: video spec lacks video fields")
        if not s.caption_allowed and (s.caption_max_chars != 0 or s.max_hashtags != 0):
            problems.append(f"{name}: caption_max_chars/max_hashtags must be 0 without captions")
        for cp in s.metric_checkpoints + s.evaluation_checkpoints:
            if cp not in formats.CHECKPOINTS:
                problems.append(f"{name}: checkpoint {cp!r} unknown")
        it = iter(s.metric_checkpoints)
        if not all(cp in it for cp in s.evaluation_checkpoints):
            problems.append(f"{name}: evaluation_checkpoints not an ordered subset of "
                            "metric_checkpoints")
        if s.publish_method not in formats.PUBLISH_METHODS:
            problems.append(f"{name}: publish_method {s.publish_method!r} is not a provider "
                            "method")
        if s.capability not in formats.CAPABILITY_KEYS:
            problems.append(f"{name}: capability {s.capability!r} unknown")
        sa = s.safe_area
        if (s.width - sa["left"] - sa["right"] < s.width / 2
                or s.height - sa["top"] - sa["bottom"] < s.height / 2):
            problems.append(f"{name}: safe_area leaves less than half the canvas")
    return problems


@checks.register()
def check_format_registry(app_configs, **kwargs):
    errors = []
    value = getattr(settings, "SOCIALHUB_MAX_HASHTAGS", 5)
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 30:
        errors.append(checks.Error(
            "SOCIALHUB_MAX_HASHTAGS must be an integer from 0 to 30.",
            id="content.E001"))
    for problem in registry_problems():
        errors.append(checks.Error(f"Format registry: {problem}", id="content.E002"))
    return errors
