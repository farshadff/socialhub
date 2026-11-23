"""Script packages: generate, validate, edit, approve, regenerate (E05-S01, E05-S02, E05-S03)."""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import timedelta

from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import ErrorDetail

from apps.core.errors import DetailedValidationError, InvalidTransition

from .. import actions, formats
from ..models import Brief, ContentEvent, ContentItem, DocumentStatus, Origin, ScriptVersion
from . import pipeline
from .briefs import ensure_text_provider, _user_ref, _version_conflict

logger = logging.getLogger(__name__)

S = ContentItem.Status
JOB_KIND = "script.generate"
GENERATE_STATUSES = (S.BRIEFED, S.SCRIPTED, S.IN_PRODUCTION, S.NEEDS_REVISION)
HOLD_INVALID = "Script needs fixes before it can be approved"
MAX_PAYLOAD_BYTES = 200 * 1024
FEEDBACK_MAX = 2000
NOTE_MAX = 500

TEXT_LIMITS = {
    "scenario": (20, 1200, True),
    "hook": (5, 140, True),
    "cta": (0, 120, False),
    "music_hint": (0, 120, False),
}
SHOT_LIMITS = {
    "description": (5, 300, True),
    "on_screen_text": (0, 120, False),
    "voiceover": (0, 300, False),
    "asset_hint": (0, 200, False),
}
DESIGN_NOTE_FIELDS = ("mood", "color_usage", "typography", "imagery_style", "layout")
DESIGN_NOTE_REQUIRED = ("mood", "layout")
TEXT_IN_IMAGE_WORDS = (
    "text", "caption", "logo", "watermark", "letters", "lettering", "typography", "words",
    "title", "headline", "متن", "نوشته", "لوگو", "واترمارک", "حروف", "کلمه", "تیتر", "عنوان",
)
_TEXT_WORD_RE = re.compile(r"(?<![\w])(" + "|".join(re.escape(w) for w in TEXT_IN_IMAGE_WORDS)
                           + r")(?![\w])", re.IGNORECASE)


# --- Normalisation (E05-S01 rule 7) -------------------------------------------------------

def _clean(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return value


def normalise_package(payload: dict, *, image_format: bool) -> dict:
    data = copy.deepcopy(payload or {})
    for key in ("scenario", "hook", "cta", "music_hint"):
        if key in data:
            data[key] = _clean(data[key])
    for list_key, text_keys in (("shots", ("type", "description", "on_screen_text", "voiceover",
                                           "asset_hint")),
                                ("frames", ("template", "headline", "body", "visual_prompt",
                                            "transition"))):
        items = data.get(list_key)
        if not isinstance(items, list):
            continue
        for entry in items:
            if isinstance(entry, dict):
                for k in text_keys:
                    if k in entry:
                        entry[k] = _clean(entry[k])
        indexes = [e.get("index") for e in items if isinstance(e, dict)]
        if all(isinstance(i, int) for i in indexes) and all(
                a < b for a, b in zip(indexes, indexes[1:])):
            mapping = {}
            for n, entry in enumerate(items, start=1):
                mapping[entry["index"]] = n
                entry["index"] = n
            if list_key == "shots":
                for frame in data.get("frames") or []:
                    if isinstance(frame, dict) and frame.get("shot_index") in mapping:
                        frame["shot_index"] = mapping[frame["shot_index"]]
    notes = data.get("design_notes")
    if isinstance(notes, dict):
        for k in DESIGN_NOTE_FIELDS:
            if k in notes:
                notes[k] = _clean(notes[k])
        for k in ("do", "dont"):
            if isinstance(notes.get(k), list):
                notes[k] = [_clean(v) for v in notes[k]]
    if image_format:
        data["duration_seconds"] = 0
        for entry in data.get("shots") or []:
            if isinstance(entry, dict):
                entry["duration_seconds"] = 0
        for entry in data.get("frames") or []:
            if isinstance(entry, dict):
                entry["duration_seconds"] = 0
    return data


# --- Structural validation (E05-S02 rule 3) -----------------------------------------------

def structure_errors(payload) -> dict:
    """Missing keys, wrong types and unknown enum values. Paths are prefixed with `payload.`."""
    errors: dict = {}

    def err(path, code="invalid"):
        errors.setdefault(f"payload.{path}" if path else "payload", []).append(
            ErrorDetail(code, code=code))

    if not isinstance(payload, dict):
        err("", "invalid")
        return errors
    for key in ("scenario", "hook", "cta", "music_hint"):
        if key not in payload:
            err(key, "required")
        elif not isinstance(payload[key], str):
            err(key, "invalid")
    if not isinstance(payload.get("duration_seconds"), int) or isinstance(
            payload.get("duration_seconds"), bool):
        err("duration_seconds", "required" if "duration_seconds" not in payload else "invalid")
    for list_key, spec in (
            ("shots", {"index": int, "duration_seconds": int, "type": str, "description": str,
                       "on_screen_text": str, "voiceover": str, "asset_hint": str}),
            ("frames", {"index": int, "shot_index": int, "template": str, "headline": str,
                        "body": str, "visual_prompt": str, "duration_seconds": int,
                        "transition": str})):
        items = payload.get(list_key)
        if not isinstance(items, list):
            err(list_key, "required" if list_key not in payload else "invalid")
            continue
        if len(items) > 10:
            err(list_key, "max_length")
        for i, entry in enumerate(items):
            if not isinstance(entry, dict):
                err(f"{list_key}.{i}")
                continue
            for k, typ in spec.items():
                if k not in entry:
                    err(f"{list_key}.{i}.{k}", "required")
                elif not isinstance(entry[k], typ) or (typ is int and isinstance(entry[k], bool)):
                    err(f"{list_key}.{i}.{k}")
            if list_key == "shots" and isinstance(entry.get("type"), str) and (
                    entry["type"] not in formats.SHOT_TYPES):
                err(f"shots.{i}.type", "invalid_choice")
            if list_key == "frames":
                if isinstance(entry.get("template"), str) and (
                        entry["template"] not in formats.FRAME_TEMPLATE_KEYS):
                    err(f"frames.{i}.template", "invalid_choice")
                if isinstance(entry.get("transition"), str) and (
                        entry["transition"] not in formats.TRANSITIONS):
                    err(f"frames.{i}.transition", "invalid_choice")
    notes = payload.get("design_notes")
    if not isinstance(notes, dict):
        err("design_notes", "required" if "design_notes" not in payload else "invalid")
    else:
        for k in DESIGN_NOTE_FIELDS:
            if not isinstance(notes.get(k), str):
                err(f"design_notes.{k}", "required" if k not in notes else "invalid")
        for k in ("do", "dont"):
            if not isinstance(notes.get(k), list) or not all(
                    isinstance(v, str) for v in notes.get(k) or []):
                err(f"design_notes.{k}", "required" if k not in notes else "invalid")
    return errors


# --- Rule validation (E05-S01 rules 16-24) ------------------------------------------------

def _issue(code, path, message, limit=None, actual=None):
    issue = {"code": code, "path": path, "message": message}
    if limit is not None:
        issue["limit"] = limit
    if actual is not None:
        issue["actual"] = actual
    return issue


def _text(path, value, lo, hi, required, label):
    value = value if isinstance(value, str) else ""
    n = len(value.strip())
    if n == 0:
        if required or lo > 0:
            return [_issue("text_required", path, f"{label} is required.")]
        return []
    if n < lo:
        return [_issue("text_too_short", path, f"{label} is {n} characters; at least {lo} are "
                       "needed.", lo, n)]
    if n > hi:
        return [_issue("text_too_long", path, f"{label} is {n} characters; the limit is {hi}.",
                       hi, n)]
    return []


def validate_script_package(payload: dict, *, format: str, media_kind: str, production_mode: str,
                            brief_cta: str = "", role: str | None = None) -> list[dict]:
    if structure_errors(payload):
        return [_issue("text_required", "", "The script package is incomplete.")]
    try:
        rule = formats.script_rules_for(format, media_kind, production_mode)
    except formats.UnknownFormat:
        return [_issue("template_not_allowed", "", "The item's format is not set.")]
    image_format = media_kind == "image"
    issues: list[dict] = []
    shots, frames = payload["shots"], payload["frames"]

    for key, (lo, hi, required) in TEXT_LIMITS.items():
        if key == "music_hint" and image_format and payload["music_hint"]:
            issues.append(_issue("text_too_long", key, "Image formats have no music.", 0,
                                 len(payload["music_hint"])))
            continue
        issues += _text(key, payload[key], lo, hi, required, key.replace("_", " ").capitalize())

    n_shots, n_frames = len(shots), len(frames)
    if not rule["shots"]["min"] <= n_shots <= rule["shots"]["max"]:
        issues.append(_issue("shot_count", "shots",
                             f"{n_shots} shots; this format needs {rule['shots']['min']}–"
                             f"{rule['shots']['max']}.", rule["shots"]["max"], n_shots))
    if not rule["frames"]["min"] <= n_frames <= rule["frames"]["max"]:
        issues.append(_issue("frame_count", "frames",
                             f"{n_frames} frames; this format needs {rule['frames']['min']}–"
                             f"{rule['frames']['max']}.", rule["frames"]["max"], n_frames))

    for list_key, items in (("shots", shots), ("frames", frames)):
        if [e["index"] for e in items] != list(range(1, len(items) + 1)):
            issues.append(_issue("index_sequence", list_key,
                                 f"{list_key.capitalize()} must be numbered 1 to {len(items)} in "
                                 "order."))

    shot_by_index = {s["index"]: s for s in shots}
    last_shot = 0
    for i, frame in enumerate(frames):
        if frame["shot_index"] not in shot_by_index:
            issues.append(_issue("shot_ref_missing", f"frames.{i}.shot_index",
                                 f"Frame {i + 1} points to shot {frame['shot_index']}, which does "
                                 "not exist."))
        elif frame["shot_index"] < last_shot:
            issues.append(_issue("frame_order", f"frames.{i}.shot_index",
                                 "Frames must follow the order of their shots."))
        last_shot = max(last_shot, frame["shot_index"])

    if rule["frame_per_shot_required"]:
        covered = {f["shot_index"] for f in frames}
        for i, shot in enumerate(shots):
            if shot["index"] not in covered:
                issues.append(_issue("frame_count", f"shots.{i}",
                                     f"Shot {shot['index']} has no frame."))

    # Durations (rule 18).
    total = payload["duration_seconds"]
    shot_sum = sum(s["duration_seconds"] for s in shots)
    if not image_format:
        lo, hi = rule["duration_seconds"]["min"], rule["duration_seconds"]["max"]
        if not lo <= total <= hi:
            issues.append(_issue("duration_total", "duration_seconds",
                                 f"Total is {total} s; this format needs {lo}–{hi} s.", hi, total))
    if total != shot_sum:
        issues.append(_issue("duration_mismatch", "duration_seconds",
                             f"Total is {total} s but the shots add up to {shot_sum} s.",
                             shot_sum, total))
    if production_mode == formats.MOTION:
        frame_sum = sum(f["duration_seconds"] for f in frames)
        if frame_sum != total:
            issues.append(_issue("duration_mismatch", "frames",
                                 f"Frames add up to {frame_sum} s; the total is {total} s.",
                                 total, frame_sum))
        for shot in shots:
            per_shot = sum(f["duration_seconds"] for f in frames
                           if f["shot_index"] == shot["index"])
            if frames and per_shot != shot["duration_seconds"]:
                idx = shot["index"] - 1
                issues.append(_issue("duration_mismatch", f"shots.{idx}.duration_seconds",
                                     f"Shot {shot['index']} lasts {shot['duration_seconds']} s but "
                                     f"its frames last {per_shot} s.", per_shot,
                                     shot["duration_seconds"]))
    fd = rule["frame_duration_seconds"]
    for i, frame in enumerate(frames):
        d = frame["duration_seconds"]
        if image_format:
            continue
        hi = fd["max"]
        if production_mode == formats.VIDEO_MODE:
            shot = shot_by_index.get(frame["shot_index"])
            hi = shot["duration_seconds"] if shot else hi
        if d < fd["min"] or (hi is not None and d > hi):
            issues.append(_issue("frame_duration", f"frames.{i}.duration_seconds",
                                 f"Frame {i + 1} lasts {d} s; allowed {fd['min']}–{hi} s.", hi, d))
    if production_mode == formats.VIDEO_MODE:
        for shot in shots:
            per_shot = sum(f["duration_seconds"] for f in frames
                           if f["shot_index"] == shot["index"])
            if per_shot > shot["duration_seconds"]:
                issues.append(_issue("duration_mismatch", f"shots.{shot['index'] - 1}",
                                     f"Frames of shot {shot['index']} last longer than the shot.",
                                     shot["duration_seconds"], per_shot))

    # Shots (rule 19 and field limits).
    for i, shot in enumerate(shots):
        if shot["type"] not in rule["allowed_shot_types"]:
            issues.append(_issue("shot_type_not_allowed", f"shots.{i}.type",
                                 f"Shot type '{shot['type']}' is not allowed in "
                                 f"{production_mode} mode."))
        for key, (lo, hi, required) in SHOT_LIMITS.items():
            if key == "asset_hint" and shot["type"] == "footage":
                lo, required = 5, True
            issues += _text(f"shots.{i}.{key}", shot[key], lo, hi, required,
                            key.replace("_", " ").capitalize())
    if rule.get("footage_required") and not any(s["type"] == "footage" for s in shots):
        issues.append(_issue("footage_shot_required", "shots",
                             "Video mode needs at least one footage shot."))

    # Frames (rules 20-22, templates).
    for i, frame in enumerate(frames):
        template = formats.frame_template(frame["template"])
        if template is None:
            issues.append(_issue("template_not_allowed", f"frames.{i}.template",
                                 f"Template '{frame['template']}' is not allowed."))
            continue
        issues += _text(f"frames.{i}.headline", frame["headline"], template["headline"]["min"],
                        template["headline"]["max"], template["headline"]["min"] > 0,
                        f"Headline ({template['label']})")
        if template["body_lines"]:
            lines_rule = template["body_lines"]
            lines = [ln for ln in frame["body"].split("\n") if ln.strip()]
            if not lines_rule["min"] <= len(lines) <= lines_rule["max"]:
                issues.append(_issue("list_lines", f"frames.{i}.body",
                                     f"A list needs {lines_rule['min']}–{lines_rule['max']} lines; "
                                     f"this one has {len(lines)}.", lines_rule["max"], len(lines)))
            for line in lines:
                if len(line.strip()) > lines_rule["line_max"]:
                    issues.append(_issue("text_too_long", f"frames.{i}.body",
                                         f"A list line is {len(line.strip())} characters; the "
                                         f"limit is {lines_rule['line_max']}.",
                                         lines_rule["line_max"], len(line.strip())))
        else:
            issues += _text(f"frames.{i}.body", frame["body"], template["body"]["min"],
                            template["body"]["max"], template["body"]["min"] > 0,
                            f"Body ({template['label']})")
        vp = template["visual_prompt"]
        prompt = frame["visual_prompt"]
        if vp.get("required"):
            if not prompt:
                issues.append(_issue("visual_prompt_required", f"frames.{i}.visual_prompt",
                                     "This template needs a description of the image."))
            else:
                issues += _text(f"frames.{i}.visual_prompt", prompt, vp.get("min", 0), vp["max"],
                                True, "Visual prompt")
        else:
            issues += _text(f"frames.{i}.visual_prompt", prompt, 0, vp["max"], False,
                            "Visual prompt")
        if prompt and _TEXT_WORD_RE.search(prompt):
            issues.append(_issue("visual_prompt_asks_for_text", f"frames.{i}.visual_prompt",
                                 "Images must not contain text, letters, logos or watermarks; "
                                 "text is added by the template."))
        if frame["transition"] not in formats.TRANSITIONS or (
                image_format and frame["transition"] != "cut"):
            issues.append(_issue("template_not_allowed", f"frames.{i}.transition",
                                 "Image formats use the 'cut' transition."))
    if image_format and n_frames == 1 and frames[0]["template"] == "cta" and role != "convert":
        issues.append(_issue("template_not_allowed", "frames.0.template",
                             "A call-to-action card can be the only frame only for the convert "
                             "role."))

    # Design notes.
    notes = payload["design_notes"]
    for key in DESIGN_NOTE_FIELDS:
        issues += _text(f"design_notes.{key}", notes[key], 1 if key in DESIGN_NOTE_REQUIRED else 0,
                        300, key in DESIGN_NOTE_REQUIRED, key.replace("_", " ").capitalize())
    for key in ("do", "dont"):
        values = notes[key]
        if len(values) > 6:
            issues.append(_issue("text_too_long", f"design_notes.{key}", "At most 6 items.", 6,
                                 len(values)))
        for j, value in enumerate(values):
            issues += _text(f"design_notes.{key}.{j}", value, 1, 120, True, "Item")

    # CTA (rule 21).
    if (brief_cta or "").strip():
        if not payload["cta"]:
            issues.append(_issue("cta_missing", "cta", "The brief has a call to action; the "
                                 "script needs one too."))
        if rule.get("last_frame_cta") and frames and frames[-1]["template"] != "cta":
            issues.append(_issue("cta_missing", f"frames.{n_frames - 1}.template",
                                 "The last frame of a motion reel must use the call-to-action "
                                 "template."))
    return issues


def validate_for_item(payload: dict, item: ContentItem, brief: Brief | None) -> list[dict]:
    return validate_script_package(
        payload, format=item.format, media_kind=item.media_kind,
        production_mode=item.production_mode, brief_cta=brief.cta if brief else "",
        role=item.role)


# --- Lookups and guards -------------------------------------------------------------------

def latest_script(item: ContentItem) -> ScriptVersion | None:
    return ScriptVersion.objects.filter(content_item=item).order_by("-version").first()


def approved_script(item: ContentItem) -> ScriptVersion | None:
    return ScriptVersion.objects.filter(content_item=item, status=DocumentStatus.APPROVED).first()


def latest_version(item: ContentItem) -> int:
    return ScriptVersion.objects.filter(content_item=item).aggregate(v=Max("version"))["v"] or 0


def approved_brief(item: ContentItem) -> Brief | None:
    brief = item.current_brief
    if brief is not None and brief.status == DocumentStatus.APPROVED:
        return brief
    return None


def ensure_can_write(item: ContentItem) -> Brief:
    """E05-S01 rules 1-4 (also used by edits, E05-S02 rule 1)."""
    if item.status not in GENERATE_STATUSES:
        raise InvalidTransition({"status": item.status,
                                 "allowed_statuses": list(GENERATE_STATUSES)})
    brief = approved_brief(item)
    if brief is None:
        raise InvalidTransition({"status": item.status, "reason": "brief_not_approved"})
    pipeline.ensure_idle(item)
    if not formats.is_allowed(item.format, item.media_kind, item.production_mode):
        raise InvalidTransition({"status": item.status, "reason": "format_not_set"})
    return brief


def check_base_version(item: ContentItem, base_version) -> None:
    if base_version is None:
        return
    latest = latest_script(item)
    current = latest.version if latest else 0
    if int(base_version) != current:
        details = {"latest_version": current}
        if latest is not None:
            details["latest_origin"] = latest.origin
            details["latest_created_by"] = _user_ref(latest.created_by)
        raise _version_conflict(details)


def idempotency_key(item: ContentItem, brief: Brief, base_version: int, feedback: str) -> str:
    digest = hashlib.sha256((feedback or "").encode()).hexdigest()[:8]
    return f"{item.pk}:{brief.version}:{base_version}:{digest}"


# --- Generation (E05-S01, E05-S03) --------------------------------------------------------

def generate_script(item: ContentItem, *, feedback: str = "", base_version=None, actor=None,
                    auto_approve=None, source: str = "operator", request_id=None,
                    check_provider: bool = True, start_over: bool = False):
    """Start a `script.generate` job (E05-S03 rule 9)."""
    from apps.core.jobs import start_job

    feedback = (feedback or "").strip()
    if len(feedback) > FEEDBACK_MAX:
        raise DetailedValidationError({"feedback": [ErrorDetail("max_length",
                                                                code="max_length")]})
    if check_provider:
        ensure_text_provider()
    ensure_can_write(item)
    latest = latest_version(item)
    if base_version not in (None, 0) and latest == 0:
        raise DetailedValidationError({"base_version": [ErrorDetail("invalid", code="invalid")]})
    check_base_version(item, base_version)
    payload = {"feedback": feedback, "base_version": latest if base_version is None else
               int(base_version), "auto_approve": auto_approve, "source": source,
               "start_over": bool(start_over)}
    job = start_job(JOB_KIND, target_id=item.pk, account=item.account, user=actor,
                    request_id=request_id, payload=payload)
    pipeline.log_event(item, ContentEvent.Type.JOB_STARTED, actor=actor,
                       message="Script generation started",
                       data={"job_id": str(job.id), "kind": JOB_KIND})
    return job


@dataclass
class ScriptWriteResult:
    script_version: ScriptVersion
    valid: bool
    issues: list
    ai_run_ids: list
    repaired: bool = False
    auto_approved: bool = False


def _variables(item, brief, *, feedback, previous_package, frame_indexes=None):
    rule = formats.script_rules_for(item.format, item.media_kind, item.production_mode)
    return {
        "content_language": item.account.content_language,
        "rules": rule,
        "templates": formats.templates_for(item.format),
        "item": {"title": item.title, "format": item.format, "media_kind": item.media_kind,
                 "production_mode": item.production_mode, "role": item.role},
        "brief": {k: getattr(brief, k) for k in (
            "role", "objective", "key_message", "hook_direction", "audience_note", "cta",
            "must_include", "must_avoid", "references", "format_notes", "success_metric")},
        "feedback": feedback or "",
        "previous_package": previous_package,
        "frame_indexes": frame_indexes,
        "violations": None,
        # Fake provider: one fixture per rule combination (E05-S01, AI section).
        "_fixture": f"{item.format}_{item.media_kind}_{item.production_mode}",
    }


def _schema():
    from .ai_schemas import output_schema

    return output_schema(JOB_KIND)


def _lock_frames(result: dict, base: dict, frame_indexes: list[int]) -> dict:
    """E05-S03 rule 12: keep every frame not listed, and the package fields, from the base."""
    merged = copy.deepcopy(result)
    for key in ("scenario", "hook", "shots", "design_notes", "cta", "music_hint",
                "duration_seconds"):
        merged[key] = copy.deepcopy(base.get(key))
    base_frames = base.get("frames") or []
    new_frames = result.get("frames") or []
    if len(new_frames) != len(base_frames):
        merged["frames"] = new_frames  # invalid by rule 12; validation flags the count
        return merged
    frames = []
    for base_frame, new_frame in zip(base_frames, new_frames):
        frames.append(new_frame if base_frame.get("index") in frame_indexes else
                      copy.deepcopy(base_frame))
    merged["frames"] = frames
    return merged


def _write(item_id: int, *, feedback: str, base_version: int | None, job_id=None,
           frame_indexes=None, approve: bool | None, source: str, created_by=None,
           progress=None, start_over: bool = False) -> ScriptWriteResult:
    from apps.ai.gateway import run_text

    item = ContentItem.objects.select_related("account", "current_brief").get(pk=item_id)
    brief = approved_brief(item)
    if brief is None:
        raise InvalidTransition({"status": item.status, "reason": "brief_not_approved"})
    base = latest_script(item)
    if base_version is not None and (base.version if base else 0) != base_version:
        from apps.core.jobs import JobError

        raise JobError("version_conflict", "A newer script appeared while this one was written.")
    # E05-S03 rules 2 and 4: feedback edits the base version; start over writes fresh.
    use_previous = base is not None and (feedback or frame_indexes) and not start_over
    previous_package = base.payload if use_previous else None
    variables = _variables(item, brief, feedback=feedback, previous_package=previous_package,
                           frame_indexes=frame_indexes)
    image_format = item.media_kind == "image"

    progress and progress(30, "Writing the script")
    result = run_text(JOB_KIND, variables=variables, schema=_schema(), account_id=item.account_id,
                      job_id=job_id)
    ai_runs = [result.ai_run_id]
    package = normalise_package(result.data.model_dump(mode="json"), image_format=image_format)
    if frame_indexes and base is not None:
        package = _lock_frames(package, base.payload, frame_indexes)
    progress and progress(70, "Checking the script against format rules")
    issues = validate_for_item(package, item, brief)
    repaired = False
    if issues:
        progress and progress(85, "Fixing rule problems")
        variables["violations"] = issues
        variables["previous_package"] = package
        result = run_text(JOB_KIND, variables=variables, schema=_schema(),
                          account_id=item.account_id, job_id=job_id)
        ai_runs.append(result.ai_run_id)
        repaired = True
        package = normalise_package(result.data.model_dump(mode="json"), image_format=image_format)
        if frame_indexes and base is not None:
            package = _lock_frames(package, base.payload, frame_indexes)
        issues = validate_for_item(package, item, brief)
    valid = not issues

    with transaction.atomic():
        item = pipeline.lock(item)
        if latest_version(item) != (base.version if base else 0):
            from apps.core.jobs import JobError

            raise JobError("version_conflict",
                           "A newer script appeared while this one was written.")
        version = _store(item, brief, package, origin=Origin.AI, feedback=feedback,
                         ai_run_id=ai_runs[-1], user=created_by, valid=valid, source=source)
        if approve is None:
            approve = bool((item.account.autopilot or {}).get("script"))
        auto = False
        if valid and approve:
            _approve_in_tx(item, version, user=None, auto=True,
                           pipeline_effects=source != "qc_revise")
            auto = True
        elif not valid:
            pipeline.set_hold_reason(item, HOLD_INVALID)
    return ScriptWriteResult(version, valid, issues, ai_runs, repaired, auto)


def run_generation_job(job, *, feedback: str = "", base_version=None, auto_approve=None,
                       source: str = "operator", progress=None, start_over: bool = False) -> dict:
    """Body of the `script.generate` job (E05-S01 rules 5-12, 15)."""
    from apps.core.models import JobRun

    item = ContentItem.objects.select_related("current_brief").get(pk=int(job.target_id))
    brief = approved_brief(item)
    progress and progress(10, "Reading the brief")
    key = idempotency_key(item, brief, base_version or 0,
                          ("start_over:" if start_over else "") + feedback) if brief else None
    if key:
        previous = JobRun.objects.filter(
            kind=JOB_KIND, status=JobRun.Status.SUCCEEDED, target_id=str(item.pk),
            finished_at__gte=timezone.now() - timedelta(hours=24),
            result__idempotency_key=key).order_by("-finished_at").first()
        if previous is not None and ScriptVersion.objects.filter(
                content_item=item, version=previous.result.get("script_version")).exists():
            return dict(previous.result)
    res = _write(item.pk, feedback=feedback, base_version=base_version, job_id=job.id,
                 approve=auto_approve, source=source, created_by=job.created_by,
                 progress=progress, start_over=start_over)
    progress and progress(100, "Script ready")
    return {"script_version": res.script_version.version, "base_version": base_version or 0,
            "valid": res.valid, "issues": len(res.issues), "repaired": res.repaired,
            "auto_approved": res.auto_approved, "source": source, "idempotency_key": key}


def write_script_version(item: ContentItem, *, feedback: str, base_version: int,
                         frame_indexes: list[int] | None = None, approve: bool,
                         source: str = "qc_revise", job_id=None) -> ScriptWriteResult:
    """Synchronous rewrite used inside the revise loop's job (E05-S03 rules 10-13)."""
    return _write(item.pk, feedback=feedback, base_version=base_version, job_id=job_id,
                  frame_indexes=frame_indexes, approve=approve, source=source, created_by=None)


def on_job_failed(item_id: int, error_code: str) -> None:
    item = ContentItem.objects.filter(pk=item_id).first()
    if item is not None:
        pipeline.set_hold_reason(item, f"Script could not be written ({error_code}). Try again.")


# --- Storing, editing, approving ----------------------------------------------------------

def _store(item, brief, payload, *, origin, feedback, ai_run_id, user, valid,
           source: str) -> ScriptVersion:
    version = latest_version(item) + 1
    ScriptVersion.objects.filter(content_item=item, status=DocumentStatus.DRAFT).update(
        status=DocumentStatus.SUPERSEDED)
    script = ScriptVersion.objects.create(
        content_item=item, version=version, brief=brief, payload=payload, feedback=feedback or "",
        status=DocumentStatus.DRAFT, origin=origin, ai_run_id=ai_run_id, created_by=user)
    item.current_script = script
    item.save(update_fields=["current_script", "updated_at"])
    verb = "written" if origin == Origin.AI else "saved"
    pipeline.log_event(item, ContentEvent.Type.EDITED, actor=user,
                       message=f"Script v{version} {verb}",
                       data={"script_version": version, "origin": origin, "valid": valid,
                             "source": source})
    return script


def save_edit(item: ContentItem, *, base_version, payload, note: str = "", user=None
              ) -> tuple[ScriptVersion, bool]:
    if base_version is None:
        raise DetailedValidationError({"base_version": [ErrorDetail("required",
                                                                    code="required")]})
    note = (note or "").strip()
    if len(note) > NOTE_MAX:
        raise DetailedValidationError({"note": [ErrorDetail("max_length", code="max_length")]})
    if len(json.dumps(payload, ensure_ascii=False).encode()) > MAX_PAYLOAD_BYTES:
        from apps.core.errors import PayloadTooLarge

        raise PayloadTooLarge({"max_bytes": MAX_PAYLOAD_BYTES})
    with transaction.atomic():
        item = pipeline.lock(item)
        brief = ensure_can_write(item)
        check_base_version(item, base_version)
        errors = structure_errors(payload)
        if errors:
            raise DetailedValidationError(errors)
        package = normalise_package(payload, image_format=item.media_kind == "image")
        base = latest_script(item)
        if base is not None and base.payload == package:
            return base, True
        issues = validate_for_item(package, item, brief)
        script = _store(item, brief, package, origin=Origin.HUMAN, feedback=note, ai_run_id=None,
                        user=user, valid=not issues, source="operator")
        if not issues and item.hold_reason == HOLD_INVALID:
            pipeline.set_hold_reason(item, "")
    return script, False


def _approve_in_tx(item: ContentItem, script: ScriptVersion, *, user, auto: bool,
                   pipeline_effects: bool = True) -> None:
    ScriptVersion.objects.filter(content_item=item, status=DocumentStatus.APPROVED).exclude(
        pk=script.pk).update(status=DocumentStatus.SUPERSEDED)
    script.status = DocumentStatus.APPROVED
    script.save(update_fields=["status", "updated_at"])
    if item.hold_reason == HOLD_INVALID:
        pipeline.set_hold_reason(item, "")
    message = "Script approved automatically" if auto else f"Script v{script.version} approved"
    pipeline.log_event(item, ContentEvent.Type.EDITED, actor=user, message=message,
                       data={"script_version": script.version, "auto": auto})
    if not pipeline_effects:
        return  # the revise loop owns status and production (E05-S03 rule 11)
    if item.status == S.BRIEFED:
        pipeline.transition(item, S.SCRIPTED, actor=user, message=message)
    elif item.status == S.SCRIPTED:
        item_id = item.pk
        transaction.on_commit(lambda: pipeline.advance(item_id))
    elif item.status in (S.IN_PRODUCTION, S.NEEDS_REVISION):
        item_id = item.pk
        transaction.on_commit(lambda: _restart_production(item_id, user))


def _restart_production(item_id: int, user) -> None:
    try:
        from apps.production.services import orchestration
    except ImportError:
        return
    item = ContentItem.objects.get(pk=item_id)
    try:
        orchestration.start_production(item, actor=user, reason="script_reapproved")
    except Exception:  # noqa: BLE001 - logged and surfaced as a hold reason
        logger.exception("Could not restart production for item %s", item_id)
        pipeline.set_hold_reason(item, "Production could not be restarted. Start it from the "
                                       "Production tab.")


def approve_script(item: ContentItem, version: int, *, user=None) -> ContentItem:
    with transaction.atomic():
        item = pipeline.lock(item)
        if item.status not in GENERATE_STATUSES:
            raise InvalidTransition({"status": item.status,
                                     "allowed_statuses": list(GENERATE_STATUSES)})
        pipeline.ensure_idle(item)
        latest = latest_script(item)
        if latest is None or latest.version != int(version):
            raise _version_conflict({"latest_version": latest.version if latest else 0})
        if latest.status == DocumentStatus.APPROVED:
            return item
        if latest.status != DocumentStatus.DRAFT:
            raise InvalidTransition({"status": item.status, "reason": "script_superseded"})
        brief = item.current_brief
        if brief is None or latest.brief_id != brief.pk or brief.status != DocumentStatus.APPROVED:
            raise InvalidTransition({"status": item.status, "reason": "brief_changed"})
        issues = validate_for_item(latest.payload, item, brief)
        if issues:
            fields: dict = {}
            for issue in issues:
                path = f"payload.{issue['path']}" if issue["path"] else "payload"
                fields.setdefault(path, []).append(ErrorDetail(issue["message"],
                                                               code=issue["code"]))
            raise DetailedValidationError(fields, details={"issues": issues})
        _approve_in_tx(item, latest, user=user, auto=False)
    item.refresh_from_db()
    return item


# --- Read models --------------------------------------------------------------------------

def version_source(script: ScriptVersion) -> str:
    if script.origin == Origin.HUMAN:
        return "operator"
    event = ContentEvent.objects.filter(content_item_id=script.content_item_id,
                                        type=ContentEvent.Type.EDITED,
                                        data__script_version=script.version,
                                        data__origin="ai").first()
    return (event.data.get("source") if event else None) or "operator"


def script_actions(item: ContentItem, script: ScriptVersion | None) -> dict:
    can_write = (item.status in GENERATE_STATUSES and approved_brief(item) is not None
                 and pipeline.active_job(item) is None
                 and formats.is_allowed(item.format, item.media_kind, item.production_mode))
    latest = latest_script(item)
    is_latest = script is not None and latest is not None and script.pk == latest.pk
    brief_current = script is not None and item.current_brief_id == script.brief_id
    can_approve = bool(can_write and is_latest and script.status == DocumentStatus.DRAFT
                       and brief_current
                       and not validate_for_item(script.payload, item, item.current_brief))
    if script is not None and not is_latest:
        return {"can_generate": False, "can_edit": False, "can_approve": False}
    return {"can_generate": can_write, "can_edit": can_write, "can_approve": can_approve}


def script_summary(script: ScriptVersion) -> dict:
    payload = script.payload or {}
    return {"hook": payload.get("hook", ""), "frame_count": len(payload.get("frames") or []),
            "shot_count": len(payload.get("shots") or []),
            "duration_seconds": payload.get("duration_seconds", 0)}


# --- Pipeline handler (E05-S01 rule 14) and actions ---------------------------------------

def handle_briefed(item: ContentItem) -> None:
    if not (item.account.autopilot or {}).get("script"):
        return
    if pipeline.active_job(item) is not None or approved_brief(item) is None:
        return
    latest = latest_script(item)
    if latest is not None and latest.status != DocumentStatus.SUPERSEDED and (
            latest.brief_id == item.current_brief_id):
        return
    generate_script(item, source="autopilot", check_provider=False)


pipeline.register_handler(S.BRIEFED, handle_briefed)


@actions.register
def _script_item_actions(item, user, ctx):
    flags = script_actions(item, latest_script(item))
    names = []
    if flags["can_generate"]:
        names += ["generate_script", "edit_script"]
    if flags["can_approve"]:
        names.append("approve_script")
    return names
