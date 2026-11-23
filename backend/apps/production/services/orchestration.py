"""Production orchestration and the production workspace actions (E06-S07, with S03-S06 hooks)."""

from __future__ import annotations

import hashlib
import json
import logging

from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import ErrorDetail

from apps.content import formats
from apps.content.models import Asset, ContentEvent, ContentItem, ContentVersion, DocumentStatus
from apps.content.services import assets as asset_service
from apps.content.services import pipeline
from apps.core.errors import DetailedValidationError, InvalidTransition, JobInProgress

from ..rendering.templates import get_template
from . import assembly
from . import copy as copy_service
from . import frames as frame_service
from . import images

logger = logging.getLogger(__name__)

S = ContentItem.Status
V = ContentVersion
START_STATUSES = (S.SCRIPTED, S.IN_PRODUCTION, S.NEEDS_REVISION)
STEP_ORDER = ("prepare", "backgrounds", "frames", "assemble", "copy", "finish")
START_KIND = "production.start"
RENDER_KIND = "production.render"
IMAGE_KIND = "production.generate_image"
COPY_KIND = "copy.generate"
EDITABLE_FRAME_FIELDS = ("template", "headline", "body", "background_asset_id",
                         "duration_seconds", "transition")
SUBMIT_HOLDING = frame_service.HOLDING_WARNINGS


def _now_iso():
    return timezone.now().isoformat().replace("+00:00", "Z")


def _version_conflict(latest: int):
    from apps.content.services.briefs import _version_conflict as conflict

    return conflict({"latest_version": latest})


def approved_script(item: ContentItem):
    from apps.content.services.scripts import approved_script as find

    return find(item)


def latest_version_number(item: ContentItem) -> int:
    return ContentVersion.objects.filter(content_item=item).aggregate(v=Max("version"))["v"] or 0


def check_base_version(item: ContentItem, base_version) -> ContentVersion:
    version = item.current_version
    current = version.version if version else 0
    if base_version is None or int(base_version) != current:
        raise _version_conflict(current)
    return version


def ensure_draft_pipeline(item: ContentItem, *, allow_manual: bool = False) -> ContentVersion:
    if item.status != S.IN_PRODUCTION:
        raise InvalidTransition({"status": item.status, "allowed_statuses": [S.IN_PRODUCTION]})
    version = item.current_version
    if version is None or version.status != V.Status.DRAFT or (
            not allow_manual and version.origin == V.VersionOrigin.MANUAL_UPLOAD):
        raise InvalidTransition({"status": item.status, "allowed_statuses": [S.IN_PRODUCTION]})
    return version


def _set_step(version: ContentVersion, step: str, **values) -> None:
    steps = dict(version.production_steps or {})
    entry = dict(steps.get(step) or {})
    entry.update(values)
    steps[step] = entry
    version.production_steps = steps
    version.save(update_fields=["production_steps", "updated_at"])


# --- Preparing a version (rules 4-5) ------------------------------------------------------

def _frames_from_script(script) -> list[dict]:
    frames = []
    for frame in (script.payload or {}).get("frames") or []:
        frames.append({
            "index": frame["index"], "shot_index": frame.get("shot_index"),
            "template": frame["template"], "headline": frame.get("headline", ""),
            "body": frame.get("body", ""), "visual_prompt": frame.get("visual_prompt", ""),
            "background_asset_id": None, "duration_seconds": frame.get("duration_seconds", 0),
            "transition": frame.get("transition", "cut"),
            "render_options": dict(frame_service.DEFAULT_RENDER_OPTIONS), "asset_id": None,
            "state": "pending", "input_hash": None, "warnings": [], "overridden": [],
        })
    return frames


def prepare_version(item: ContentItem, script, *, actor=None,
                    previous: ContentVersion | None) -> ContentVersion:
    number = latest_version_number(item) + 1
    frames = _frames_from_script(script)
    music, cover_index, clips = None, None, []
    if previous is not None:
        music = previous.music_asset
        old = {f["index"]: f for f in previous.frames or []}
        for frame in frames:
            prior = old.get(frame["index"])
            if prior and prior.get("template") == frame["template"] and (
                    prior.get("background_asset_id")):
                frame["background_asset_id"] = prior["background_asset_id"]
                frame["overridden"] = ["background_asset_id"]
        if previous.cover_frame_index and previous.cover_frame_index in {f["index"]
                                                                         for f in frames}:
            cover_index = previous.cover_frame_index
        footage = {s["index"] for s in (script.payload or {}).get("shots", [])
                   if s.get("type") == "footage"}
        clips = [c for c in previous.clips or [] if c.get("shot_index") in footage]
    version = ContentVersion.objects.create(
        content_item=item, version=number, script=script, frames=frames, clips=clips,
        music_asset=music, cover_frame_index=cover_index, status=V.Status.DRAFT,
        origin=V.VersionOrigin.PIPELINE, render_status=V.RenderStatus.PENDING,
        change_note=f"Produced from script version {script.version}",
        production_steps={"prepare": {"status": "done", "finished_at": _now_iso()}},
        created_by=actor if getattr(actor, "pk", None) else None)
    if clips:
        _validate_clip_list(version, clips, drop_invalid=True)
    item.current_version = version
    item.save(update_fields=["current_version", "updated_at"])
    pipeline.log_event(item, ContentEvent.Type.EDITED, actor=actor,
                       message=f"Version {number} prepared from script version {script.version}",
                       data={"content_version": number, "script_version": script.version})
    return version


def _choose_version(item: ContentItem, script, *, actor, restart: bool) -> ContentVersion:
    current = item.current_version
    if current is None:
        return prepare_version(item, script, actor=actor, previous=None)
    if (current.status == V.Status.DRAFT and current.origin == V.VersionOrigin.PIPELINE
            and current.script_id == script.pk and not restart):
        return current
    return prepare_version(item, script, actor=actor, previous=current)


# --- Starting production (rules 1-6) ------------------------------------------------------

def start_production(item: ContentItem, *, actor=None, reason: str,
                     submit: str = "autopilot", submit_trigger: str = "submission",
                     restart_from_script: bool = False, request_id=None):
    """The only entry point. Returns the job, or None when nothing needs doing."""
    from apps.core.jobs import start_job

    with transaction.atomic():
        item = pipeline.lock(item)
        if item.status not in START_STATUSES:
            raise InvalidTransition({"status": item.status,
                                     "allowed_statuses": list(START_STATUSES)})
        script = approved_script(item)
        if script is None:
            raise InvalidTransition({"status": item.status, "reason": "script_not_approved"})
        pipeline.ensure_idle(item)
        if item.status in (S.SCRIPTED, S.NEEDS_REVISION):
            pipeline.transition(item, S.IN_PRODUCTION, actor=actor,
                                message="Production started" if reason != "script_reapproved"
                                else "Production restarted from the re-approved script")
        current = item.current_version
        if (reason == "manual" and not restart_from_script and current is not None
                and current.status == V.Status.DRAFT and current.script_id == script.pk
                and current.render_status == V.RenderStatus.READY):
            return None
        version = _choose_version(item, script, actor=actor, restart=restart_from_script)
        job = start_job(START_KIND, target_id=item.pk, account=item.account, user=actor,
                        request_id=request_id,
                        payload={"version_id": version.pk, "submit": submit,
                                 "submit_trigger": submit_trigger, "reason": reason})
        from apps.core.models import JobRun

        JobRun.objects.filter(pk=job.pk).update(progress=5,
                                                message=f"Version {version.version} prepared",
                                                result={"content_version": version.version})
        pipeline.log_event(item, ContentEvent.Type.JOB_STARTED, actor=actor,
                           message="Production started",
                           data={"job_id": str(job.id), "kind": START_KIND, "reason": reason})
    job.refresh_from_db()
    return job


def handle_scripted(item: ContentItem) -> None:
    try:
        start_production(item, reason="script_approved")
    except JobInProgress:
        return


pipeline.register_handler(S.SCRIPTED, handle_scripted)


# --- Steps (rules 7-9) --------------------------------------------------------------------

def load_for_step(job, version_id) -> tuple[ContentItem, ContentVersion] | None:
    """Rule 9: stop quietly when the job is no longer running or the version was replaced."""
    from apps.core.models import JobRun

    job.refresh_from_db()
    if job.status != JobRun.Status.RUNNING:
        return None
    item = ContentItem.objects.select_related("account", "current_version").get(
        pk=int(job.target_id))
    if item.current_version_id != int(version_id):
        return None
    version = ContentVersion.objects.select_related("script", "content_item",
                                                   "content_item__account").get(pk=version_id)
    return item, version


def backgrounds_hash(version: ContentVersion) -> str:
    data = [[f["template"], f.get("visual_prompt"), f.get("background_asset_id")]
            for f in version.frames] + [images.auto_images_enabled()]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def run_backgrounds(version: ContentVersion, *, job_id=None, progress=None) -> str:
    digest = backgrounds_hash(version)
    step = (version.production_steps or {}).get("backgrounds") or {}
    if step.get("status") == "done" and step.get("input_hash") == digest:
        return "skipped"
    generated, missing, warnings = [], [], []
    if images.auto_images_enabled():
        for frame in list(version.frames):
            if not images.needs_auto_image(frame):
                continue
            progress and progress(f"Generating background for frame {frame['index']}")
            try:
                images.generate_frame_background(version, frame["index"], job_id=job_id)
                version.refresh_from_db()
                generated.append(frame["index"])
            except Exception as exc:  # noqa: BLE001 - one frame failing does not stop production
                logger.warning("Background for frame %s failed: %s", frame["index"], exc)
                missing.append(frame["index"])
                warnings.append({"code": "background_missing", "frame_index": frame["index"],
                                 "message": frame_service.WARNING_TEXT["background_missing"]})
    version.refresh_from_db()
    _set_step(version, "backgrounds", status="done", input_hash=backgrounds_hash(version),
              generated=generated, missing=missing, warnings=warnings, finished_at=_now_iso())
    return "done"


def frames_step_hash(version: ContentVersion) -> str:
    hashes = frame_service.frame_hashes(version)
    return hashlib.sha256(json.dumps([hashes.get(f["index"]) for f in version.frames]
                                     ).encode()).hexdigest()


def run_frames(version: ContentVersion, *, indexes=None, force=False, progress=None) -> dict:
    if version.origin == V.VersionOrigin.MANUAL_UPLOAD:
        return {"rendered": [], "reused": [], "waiting": []}
    digest = frames_step_hash(version)
    step = (version.production_steps or {}).get("frames") or {}
    if indexes is None and not force and step.get("status") == "done" and (
            step.get("input_hash") == digest) and frame_service.frames_ready(version):
        return {"rendered": [], "reused": [f["index"] for f in version.frames], "waiting": [],
                "skipped": True}
    version.render_status = V.RenderStatus.RENDERING
    version.save(update_fields=["render_status", "updated_at"])
    _set_step(version, "frames", status="running")

    def frame_progress(n, total, index):
        progress and progress(f"Rendering frame {index} of {len(version.frames)}",
                              n / max(total, 1))

    try:
        result = frame_service.render_frames(version, indexes=indexes, force=force,
                                             progress=frame_progress)
    except frame_service.FrameRenderFailed:
        version.refresh_from_db()
        _set_step(version, "frames", status="failed", error_code="render_failed")
        raise
    version.refresh_from_db()
    status = "waiting" if result["waiting"] else "done"
    _set_step(version, "frames", status=status, input_hash=frames_step_hash(version),
              rendered=result["rendered"], reused=result["reused"], finished_at=_now_iso())
    if version.render_status == V.RenderStatus.RENDERING:
        version.render_status = V.RenderStatus.PENDING
        version.save(update_fields=["render_status", "updated_at"])
    return result


def waiting_for(version: ContentVersion) -> tuple[str | None, str]:
    """(`waiting_for`, hold reason) in the order of rule 11."""
    item = version.content_item
    if version.origin == V.VersionOrigin.MANUAL_UPLOAD:
        return None, ""
    need_images = [f["index"] for f in version.frames
                   if get_template(f["template"]).image_slot == "required"
                   and not f.get("background_asset_id")
                   and f["index"] not in frame_service.overlay_frames(version)]
    if need_images:
        joined = ", ".join(str(i) for i in need_images)
        word = "frame" if len(need_images) == 1 else "frames"
        return "backgrounds", f"Choose an image for {word} {joined}."
    if item.production_mode == formats.VIDEO_MODE:
        missing = assembly.missing_shots(version)
        if missing:
            return "clips", ("Waiting for footage for shot(s) "
                             + ", ".join(str(i) for i in missing) + ".")
    return None, ""


def run_assemble(version: ContentVersion, *, progress=None) -> str:
    item = version.content_item
    if version.origin == V.VersionOrigin.MANUAL_UPLOAD:
        return "skipped"
    wait, _ = waiting_for(version)
    if wait or not frame_service.frames_ready(version):
        _set_step(version, "assemble", status="waiting")
        return "waiting"
    version.render_status = V.RenderStatus.RENDERING
    version.save(update_fields=["render_status", "updated_at"])
    _set_step(version, "assemble", status="running")
    previous_final = version.final_asset_id
    try:
        if item.production_mode == formats.DESIGN:
            final = frame_service.export_final_image(version)
            result = {"final_asset": final, "cover_asset": None, "warnings": []}
        else:
            def video_progress(done, total):
                progress and progress(f"Assembling video ({done:.0f} s of {total:.0f} s)",
                                      done / max(total, 1))

            if item.production_mode == formats.MOTION:
                result = assembly.assemble_motion(version, progress=video_progress)
            else:
                result = assembly.assemble_footage(version, progress=video_progress)
    except assembly.AssemblyError as exc:
        version.refresh_from_db()
        version.render_status = V.RenderStatus.FAILED
        version.final_asset = None  # rule 16: a stale video cannot be submitted
        version.save(update_fields=["render_status", "final_asset", "updated_at"])
        _set_step(version, "assemble", status="failed", error_code=exc.code)
        raise
    version.refresh_from_db()
    version.final_asset = result["final_asset"]
    if result.get("cover_asset") is not None:
        version.cover_asset = result["cover_asset"]
    version.save(update_fields=["final_asset", "cover_asset", "updated_at"])
    _delete_orphan(previous_final, keep=version.final_asset_id)
    _set_step(version, "assemble", status="done", input_hash=version.final_asset.meta.get(
        "input_hash"), warnings=result.get("warnings") or [], finished_at=_now_iso())
    frame_service.rebuild_warnings(version)
    return "done"


def _delete_orphan(asset_id, *, keep):
    """Rule 17: an older final replaced on the same draft is deleted when nothing uses it."""
    if not asset_id or asset_id == keep:
        return
    asset = Asset.objects.filter(pk=asset_id).first()
    if asset is not None and asset.origin == "rendered" and not asset_service.in_use(asset):
        try:
            asset_service.delete(asset)
        except Exception:  # noqa: BLE001
            logger.warning("Could not delete replaced final %s", asset_id)


def run_copy(version: ContentVersion, *, job_id=None, progress=None) -> str:
    item = version.content_item
    spec = formats.get_spec(item.format, item.media_kind)
    if not spec.caption_allowed or (version.caption or "").strip():
        _set_step(version, "copy", status="skipped", finished_at=_now_iso())
        return "skipped"
    _set_step(version, "copy", status="running")
    try:
        copy_service.generate_copy(version, job_id=job_id,
                                   progress=lambda m: progress and progress(m))
    except copy_service.CopyTooLong:
        version.refresh_from_db()
        _set_step(version, "copy", status="failed", error_code="copy_too_long")
        raise
    except Exception as exc:
        version.refresh_from_db()
        code = getattr(exc, "code", None)
        _set_step(version, "copy", status="failed",
                  error_code=code if isinstance(code, str) else "provider_error")
        raise
    version.refresh_from_db()
    _set_step(version, "copy", status="done", finished_at=_now_iso())
    return "done"


def is_ready(version: ContentVersion) -> bool:
    item = version.content_item
    spec = formats.get_spec(item.format, item.media_kind)
    if version.final_asset_id is None:
        return False
    if spec.cover_required and version.cover_asset_id is None:
        return False
    if version.origin == V.VersionOrigin.MANUAL_UPLOAD:
        return True
    return frame_service.frames_ready(version) and (
        (version.production_steps or {}).get("assemble", {}).get("status") == "done")


def finish(version: ContentVersion, *, submit: str, submit_trigger: str) -> dict:
    item = version.content_item
    version.refresh_from_db()
    if is_ready(version):
        version.render_status = V.RenderStatus.READY
    elif version.render_status != V.RenderStatus.FAILED:
        version.render_status = V.RenderStatus.PENDING
    version.save(update_fields=["render_status", "updated_at"])
    warnings = frame_service.rebuild_warnings(version)
    _set_step(version, "finish", status="done", finished_at=_now_iso())
    wait, wait_reason = waiting_for(version)
    auto_submitted = False
    hold = ""
    if wait:
        hold = wait_reason
    elif version.render_status == V.RenderStatus.READY:
        blockers = submit_blockers(item, version)
        holding = holding_warnings(version)
        autopilot = bool((item.account.autopilot or {}).get("script"))
        should = (submit == "always" and not blockers) or (
            submit == "autopilot" and autopilot and not blockers and not holding)
        if should:
            submit_version(item, version, actor=None, trigger=submit_trigger,
                           acknowledge_warnings=True)
            auto_submitted = True
        elif blockers and submit == "always":
            hold = f"Cannot submit: {', '.join(blockers)}"
        elif holding:
            hold = f"Ready to submit — {len(holding)} warning{'s' if len(holding) != 1 else ''} " \
                   "to review"
        elif blockers:
            hold = "Ready to submit" if blockers == [] else _blocker_hold(blockers)
        else:
            hold = "Ready to submit"
    if not auto_submitted:
        pipeline.set_hold_reason(item, hold)
    steps = version.production_steps or {}
    return {
        "content_version": version.version,
        "steps": {k: (steps.get(k) or {}).get("status", "pending")
                  for k in ("backgrounds", "frames", "assemble", "copy")},
        "rendered_frames": (steps.get("frames") or {}).get("rendered", []),
        "reused_frames": (steps.get("frames") or {}).get("reused", []),
        "final_asset": version.final_asset_id,
        "cover_asset": version.cover_asset_id,
        "caption_generated": (steps.get("copy") or {}).get("status") == "done",
        "waiting_for": wait,
        "auto_submitted": auto_submitted,
        "warnings": len(warnings),
    }


BLOCKER_TEXT = {
    "caption_missing": "Write the caption before submitting.",
    "cover_missing": "The reel needs a cover.",
    "newer_script": "A newer script is waiting for approval.",
    "brief_not_approved": "The brief is not approved.",
}


def _blocker_hold(blockers: list[str]) -> str:
    return BLOCKER_TEXT.get(blockers[0], "Not ready to submit yet.")


def on_step_failed(item_id: int, job, step: str, code: str, detail: str = "") -> None:
    """Rule 13: hold reason after a failed step."""
    item = ContentItem.objects.filter(pk=item_id).first()
    if item is None:
        return
    pipeline.clear_active_job(item, job, failed=True, error_code=code)
    short = detail.split("\n", 1)[0][:120] if detail and code != "assembly_failed" else {
        "render_failed": "a frame could not be rendered",
        "assembly_failed": "the video could not be assembled",
        "output_invalid": "the video did not meet the format limits",
        "copy_too_long": "the caption does not fit",
        "provider_error": "the AI provider failed",
        "provider_not_configured": "the AI provider is not configured",
    }.get(code, code)
    pipeline.set_hold_reason(item, f"Production stopped at {step}: {short}")


# --- Submitting (rules 27-29) -------------------------------------------------------------

def submit_blockers(item: ContentItem, version: ContentVersion | None) -> list[str]:
    if version is None:
        return ["not_rendered"]
    spec = formats.get_spec(item.format, item.media_kind)
    blockers = []
    if version.pk != item.current_version_id:
        blockers.append("not_current")
    if version.status != V.Status.DRAFT:
        blockers.append("not_draft")
    if version.render_status != V.RenderStatus.READY or not version.final_asset_id:
        blockers.append("not_rendered")
    if version.origin == V.VersionOrigin.PIPELINE:
        wait, _ = waiting_for(version)
        if wait == "backgrounds":
            blockers.append("waiting_for_backgrounds")
        if item.production_mode == formats.VIDEO_MODE and assembly.missing_shots(version):
            blockers.append("waiting_for_clips")
        from apps.content.services.scripts import latest_script

        latest = latest_script(item)
        if latest is not None and version.script_id and latest.pk != version.script_id and (
                latest.version > version.script.version):
            blockers.append("newer_script")
    if spec.caption_allowed and not (version.caption or "").strip():
        blockers.append("caption_missing")
    if spec.cover_required and not version.cover_asset_id:
        blockers.append("cover_missing")
    brief = item.current_brief
    if brief is None or brief.status != DocumentStatus.APPROVED:
        blockers.append("brief_not_approved")
    return blockers


def holding_warnings(version: ContentVersion) -> list[dict]:
    return [w for w in version.render_warnings or [] if w.get("code") in SUBMIT_HOLDING]


def submit_version(item: ContentItem, version: ContentVersion, *, actor=None,
                   trigger: str = "submission", acknowledge_warnings: bool = False) -> None:
    with transaction.atomic():
        item = pipeline.lock(item)
        version = ContentVersion.objects.select_for_update().get(pk=version.pk)
        if item.status != S.IN_PRODUCTION:
            raise InvalidTransition({"status": item.status,
                                     "allowed_statuses": [S.IN_PRODUCTION]})
        blockers = submit_blockers(item, version)
        if blockers:
            raise InvalidTransition({"status": item.status, "reason": "not_ready",
                                     "blockers": blockers})
        holding = holding_warnings(version)
        if holding and not acknowledge_warnings:
            raise InvalidTransition({"status": item.status, "reason": "warnings_not_acknowledged",
                                     "warnings": holding})
        version.status = V.Status.SUBMITTED
        version.submitted_at = timezone.now()
        version.submitted_by = actor if getattr(actor, "pk", None) else None
        version.submit_trigger = trigger
        version.save(update_fields=["status", "submitted_at", "submitted_by", "submit_trigger",
                                    "updated_at"])
        pipeline.transition(item, S.IN_CHECK, actor=actor,
                            message=f"Version {version.version} submitted for checking",
                            data={"content_version": version.version, "trigger": trigger})


# --- Revisions (rules 30-32) --------------------------------------------------------------

def open_revision(item: ContentItem, *, actor=None, change_note: str, source: str
                  ) -> ContentVersion:
    with transaction.atomic():
        item = pipeline.lock(item)
        current = item.current_version
        if current is not None and current.status == V.Status.DRAFT:
            return current
        if current is None:
            raise InvalidTransition({"status": item.status, "reason": "no_version"})
        number = latest_version_number(item) + 1
        version = ContentVersion.objects.create(
            content_item=item, version=number, script=current.script, origin=current.origin,
            frames=current.frames, caption=current.caption, hashtags=current.hashtags,
            alt_text=current.alt_text, final_asset=current.final_asset,
            cover_asset=current.cover_asset, music_asset=current.music_asset,
            cover_frame_index=current.cover_frame_index, clips=current.clips,
            render_status=current.render_status, render_warnings=current.render_warnings,
            production_steps=current.production_steps, status=V.Status.DRAFT,
            change_note=change_note, created_by=actor if getattr(actor, "pk", None) else None)
        item.current_version = version
        item.save(update_fields=["current_version", "updated_at"])
        if item.status == S.NEEDS_REVISION:
            pipeline.transition(item, S.IN_PRODUCTION, actor=actor,
                                message=f"Revision {number} opened")
        pipeline.log_event(item, ContentEvent.Type.EDITED, actor=actor,
                           message=f"Revision {number} opened: {change_note}",
                           data={"content_version": number, "source": source})
    return version


# --- Frame overrides (rules 15-20) --------------------------------------------------------

def script_frame(version: ContentVersion, index: int) -> dict | None:
    if version.script is None:
        return None
    return next((f for f in (version.script.payload or {}).get("frames", [])
                 if f.get("index") == index), None)


def compute_overridden(frame: dict, original: dict | None) -> list[str]:
    fields = []
    for name in ("template", "headline", "body", "duration_seconds", "transition"):
        if original is not None and frame.get(name) != original.get(name):
            fields.append(name)
    if frame.get("background_asset_id"):
        fields.append("background_asset_id")
    return fields


def _err(path, code, message=None):
    return DetailedValidationError({path: [ErrorDetail(message or code, code=code)]})


def _validate_frame_text(template, headline: str, body: str) -> None:
    fields = template.fields
    h, b = fields["headline"], fields["body"]
    if h.get("required") and not headline.strip():
        raise _err("headline", "required")
    if len(headline.strip()) > h["max_chars"]:
        raise _err("headline", "max_length", f"Up to {h['max_chars']} characters for this "
                                            "template.")
    if b.get("required") and not body.strip():
        raise _err("body", "required")
    if len(body.strip()) > b["max_chars"]:
        raise _err("body", "max_length", f"Up to {b['max_chars']} characters for this template.")
    items = b.get("items")
    if items:
        lines = [ln for ln in body.split("\n") if ln.strip()]
        if not items["min"] <= len(lines) <= items["max"] or any(
                len(ln.strip()) > items["max_chars"] for ln in lines):
            raise _err("body", "invalid_items",
                       f"{items['min']}–{items['max']} lines of up to {items['max_chars']} "
                       "characters.")


def update_frame(item: ContentItem, index: int, data: dict, *, user=None) -> ContentVersion:
    from rest_framework.exceptions import NotFound

    unknown = [k for k in data if k not in EDITABLE_FRAME_FIELDS + ("base_version",)]
    if unknown:
        raise DetailedValidationError({k: [ErrorDetail("read_only", code="read_only")]
                                       for k in unknown})
    with transaction.atomic():
        item = pipeline.lock(item)
        pipeline.ensure_idle(item)
        version = ensure_draft_pipeline(item)
        check_base_version(item, data.get("base_version"))
        version = ContentVersion.objects.select_for_update().get(pk=version.pk)
        frames = [dict(f) for f in version.frames]
        frame = next((f for f in frames if f["index"] == index), None)
        if frame is None:
            raise NotFound()
        spec = formats.get_spec(item.format, item.media_kind)
        before_hash = frame_service.frame_hashes(version).get(index)
        new = dict(frame)
        if "template" in data:
            try:
                template = get_template(data["template"])
            except Exception:  # noqa: BLE001
                raise _err("template", "invalid_choice") from None
            if spec.layout not in template.layouts:
                raise _err("template", "invalid_choice")
            new["template"] = template.key
        template = get_template(new["template"])
        for name in ("headline", "body"):
            if name in data:
                new[name] = (data[name] or "").strip()
        _validate_frame_text(template, new.get("headline", ""), new.get("body", ""))
        if "background_asset_id" in data:
            asset_id = data["background_asset_id"]
            if asset_id is None:
                new["background_asset_id"] = None
            else:
                asset = Asset.objects.filter(pk=asset_id, account_id=item.account_id,
                                             kind="image").first()
                if asset is None:
                    raise _err("background_asset_id", "does_not_exist")
                if template.image_slot == "none":
                    raise _err("background_asset_id", "not_allowed_for_template")
                new["background_asset_id"] = asset.pk
        elif template.image_slot == "none":
            new["background_asset_id"] = None
        if "duration_seconds" in data:
            if item.production_mode == formats.DESIGN:
                raise _err("duration_seconds", "not_allowed_for_mode")
            try:
                d = float(data["duration_seconds"])
            except (TypeError, ValueError):
                raise _err("duration_seconds", "invalid") from None
            if d < 1.5:
                raise _err("duration_seconds", "min_value")
            if d > 10:
                raise _err("duration_seconds", "max_value")
            if item.production_mode == formats.VIDEO_MODE:
                shot = next((s for s in assembly.shots_of(version)
                             if s["index"] == frame.get("shot_index")), None)
                if shot and d > shot["duration_seconds"]:
                    raise _err("duration_seconds", "max_value")
            new["duration_seconds"] = int(d) if float(d).is_integer() else d
            if item.production_mode == formats.MOTION:
                total = sum(float(f["duration_seconds"]) for f in frames
                            if f["index"] != index) + d
                if not spec.min_duration_s <= total <= spec.max_duration_s:
                    raise _err("duration_seconds", "duration_out_of_range")
        if "transition" in data:
            if item.production_mode == formats.DESIGN:
                raise _err("transition", "not_allowed")
            if data["transition"] not in formats.TRANSITIONS:
                raise _err("transition", "invalid_choice")
            if index == min(f["index"] for f in frames):
                raise _err("transition", "not_allowed")
            new["transition"] = data["transition"]
        changed = [k for k in EDITABLE_FRAME_FIELDS if new.get(k) != frame.get(k)]
        new["overridden"] = compute_overridden(new, script_frame(version, index))
        frames[frames.index(frame)] = new
        version.frames = frames
        after_hash = frame_service.frame_hashes(version).get(index)
        if after_hash != before_hash and new.get("state") == "rendered":
            new["state"] = "stale"
        if changed:
            version.render_status = V.RenderStatus.PENDING
        version.frames = frames
        version.save(update_fields=["frames", "render_status", "updated_at"])
        if changed:
            pipeline.log_event(item, ContentEvent.Type.EDITED, actor=user,
                               message=f"Frame {index} edited",
                               data={"frame_index": index, "fields": changed})
    return version


# --- Version settings: music and cover (E06-S03 rules 18-19) ------------------------------

def update_settings(item: ContentItem, data: dict, *, user=None) -> ContentVersion:
    with transaction.atomic():
        item = pipeline.lock(item)
        pipeline.ensure_idle(item)
        version = ensure_draft_pipeline(item, allow_manual=False)
        check_base_version(item, data.get("base_version"))
        version = ContentVersion.objects.select_for_update().get(pk=version.pk)
        spec = formats.get_spec(item.format, item.media_kind)
        changed = []
        if "music_asset_id" in data:
            asset_id = data["music_asset_id"]
            if item.production_mode == formats.DESIGN:
                raise _err("music_asset_id", "not_allowed_for_mode")
            if asset_id is None:
                version.music_asset = None
            else:
                asset = Asset.objects.filter(pk=asset_id, account_id=item.account_id,
                                             kind="audio", role="music").first()
                if asset is None:
                    raise _err("music_asset_id", "invalid")
                version.music_asset = asset
            changed.append("music_asset")
        if "cover_frame_index" in data:
            value = data["cover_frame_index"]
            if not spec.cover_required:
                raise _err("cover_frame_index", "not_allowed")
            if value is not None and value not in {f["index"] for f in version.frames}:
                raise _err("cover_frame_index", "invalid")
            version.cover_frame_index = value
            changed.append("cover_frame_index")
        if changed:
            version.render_status = V.RenderStatus.PENDING
            version.save()
            pipeline.log_event(item, ContentEvent.Type.EDITED, actor=user,
                               message="Production settings changed", data={"fields": changed})
    return version


# --- Clips (E06-S04 rules 6-12) -----------------------------------------------------------

def _validate_clip_list(version: ContentVersion, clips: list, *, drop_invalid=False) -> list:
    item = version.content_item
    shots = {s["index"]: s for s in assembly.shots_of(version)}
    errors, seen, cleaned = {}, set(), []
    for i, entry in enumerate(clips):
        if not isinstance(entry, dict):
            errors[f"clips.{i}"] = [ErrorDetail("invalid", code="invalid")]
            continue
        shot = shots.get(entry.get("shot_index"))
        if shot is None or shot.get("type") != "footage":
            errors[f"clips.{i}.shot_index"] = [ErrorDetail("invalid", code="invalid")]
            continue
        if shot["index"] in seen:
            errors[f"clips.{i}.shot_index"] = [ErrorDetail("unique", code="unique")]
            continue
        asset = Asset.objects.filter(pk=entry.get("asset_id"), account_id=item.account_id,
                                     kind="video").first()
        if asset is None:
            errors[f"clips.{i}.asset_id"] = [ErrorDetail("invalid", code="invalid")]
            continue
        try:
            start_ms = int(entry.get("start_ms") or 0)
        except (TypeError, ValueError):
            start_ms = -1
        if start_ms < 0 or start_ms >= (asset.duration_ms or 0):
            errors[f"clips.{i}.start_ms"] = [ErrorDetail("invalid", code="invalid")]
            continue
        state, usable = assembly.clip_state(asset, start_ms, int(shot["duration_seconds"] * 1000))
        if state == "too_short":
            errors[f"clips.{i}.start_ms"] = [ErrorDetail(
                f"Clip is {usable / 1000:.1f} s from this in-point; the shot needs "
                f"{shot['duration_seconds']} s.", code="clip_too_short")]
            continue
        seen.add(shot["index"])
        cleaned.append({"shot_index": shot["index"], "asset_id": asset.pk, "start_ms": start_ms})
    if errors and not drop_invalid:
        raise DetailedValidationError(errors)
    if drop_invalid:
        version.clips = cleaned
        version.save(update_fields=["clips", "updated_at"])
    return cleaned


def set_clips(item: ContentItem, data: dict, *, user=None) -> ContentVersion:
    with transaction.atomic():
        item = pipeline.lock(item)
        pipeline.ensure_idle(item)
        version = ensure_draft_pipeline(item)
        if item.production_mode != formats.VIDEO_MODE:
            raise InvalidTransition({"status": item.status, "reason": "not_video_mode"})
        check_base_version(item, data.get("base_version"))
        clips = data.get("clips")
        if not isinstance(clips, list):
            raise _err("clips", "required")
        version = ContentVersion.objects.select_for_update().get(pk=version.pk)
        cleaned = _validate_clip_list(version, clips)
        for entry in cleaned:
            Asset.objects.filter(pk=entry["asset_id"]).exclude(role="clip").update(role="clip")
        version.clips = cleaned
        version.render_status = V.RenderStatus.PENDING
        version.save(update_fields=["clips", "render_status", "updated_at"])
        missing = assembly.missing_shots(version)
        pipeline.set_hold_reason(item, "" if not missing else (
            "Waiting for footage for shot(s) " + ", ".join(str(i) for i in missing) + "."))
        pipeline.log_event(item, ContentEvent.Type.EDITED, actor=user, message="Clips mapped",
                           data={"clips": cleaned})
    return version


# --- Using your own file (rules 21-26) ----------------------------------------------------

FINAL_ALLOWED = (S.BRIEFED, S.SCRIPTED, S.IN_PRODUCTION)


def _final_checks(asset: Asset, spec) -> tuple[list[str], list[str]]:
    """(hard reasons, normalising differences) against the registry (rule 23)."""
    hard, soft = [], []
    if asset.kind != spec.media_kind:
        hard.append(f"wrong_media_kind: {asset.kind}, expected {spec.media_kind}")
        return hard, soft
    if asset.width and asset.height:
        ratio, target = asset.width / asset.height, spec.width / spec.height
        if abs(ratio - target) / target > spec.aspect_tolerance:
            hard.append(f"wrong_aspect_ratio: {asset.width}:{asset.height}, expected "
                        f"{spec.aspect_ratio}")
        if asset.width < spec.min_width:
            hard.append(f"resolution_too_low: {asset.width} px wide, min {spec.min_width} px")
        if (asset.width, asset.height) != (spec.width, spec.height):
            soft.append(f"{asset.width} × {asset.height} instead of {spec.width} × "
                        f"{spec.height}")
    else:
        hard.append("unreadable_media: the file could not be read")
    if asset.bytes > spec.max_file_bytes:
        soft.append(f"{asset.bytes // (1024 * 1024)} MB, limit "
                    f"{spec.max_file_bytes // (1024 * 1024)} MB")
    if spec.media_kind == "image":
        if spec.image_mime and asset.mime != spec.image_mime:
            soft.append(f"{asset.mime.split('/')[-1].upper()} instead of JPEG")
    else:
        seconds = (asset.duration_ms or 0) / 1000
        if not spec.min_duration_s <= seconds <= spec.max_duration_s:
            hard.append(f"duration_out_of_range: {seconds:.0f} s, allowed "
                        f"{spec.min_duration_s:g}–{spec.max_duration_s:g} s")
        probe = (asset.meta or {}).get("probe") or {}
        if asset.mime != "video/mp4":
            soft.append("MOV instead of MP4")
        if probe.get("video_codec") and probe["video_codec"] != spec.video_codec:
            soft.append(f"{probe['video_codec'].upper()} instead of H.264")
        if probe.get("pix_fmt") and probe["pix_fmt"] != spec.pixel_format:
            soft.append(f"{probe['pix_fmt']} instead of {spec.pixel_format}")
        if not probe.get("has_audio"):
            soft.append("no audio track")
        elif probe.get("audio_codec") and probe["audio_codec"] != spec.audio_codec:
            soft.append(f"{probe['audio_codec'].upper()} audio instead of AAC")
        fps = probe.get("fps")
        if fps and not spec.fps_min <= round(fps) <= spec.fps_max:
            soft.append(f"{fps:g} fps")
    return hard, soft


def use_final_asset(item: ContentItem, *, user=None, uploaded=None, asset_id=None,
                    base_version=None, cover_uploaded=None, cover_asset_id=None,
                    rights: dict | None = None, request_id=None):
    if (uploaded is None) == (asset_id is None):
        raise _err("file", "required" if uploaded is None else "invalid")
    spec = formats.get_spec(item.format, item.media_kind)
    with transaction.atomic():
        item = pipeline.lock(item)
        if item.status not in FINAL_ALLOWED:
            raise InvalidTransition({"status": item.status, "allowed_statuses":
                                     list(FINAL_ALLOWED)})
        pipeline.ensure_idle(item)
        current = item.current_version
        if current is not None and item.status == S.IN_PRODUCTION:
            check_base_version(item, base_version)
        if item.status == S.BRIEFED:
            brief = item.current_brief
            if brief is None or brief.status != DocumentStatus.APPROVED:
                raise InvalidTransition({"status": item.status, "reason": "brief_not_approved"})
        rights = rights or {}
        if uploaded is not None:
            asset, _dup = asset_service.upload(
                account=item.account, uploaded=uploaded, user=user, content_item=item,
                role="final", origin=rights.get("origin") or "uploaded",
                rights_status=rights.get("rights_status") or None,
                license_note=rights.get("license_note") or "",
                source_url=rights.get("source_url") or "",
                rights_expires_at=rights.get("rights_expires_at"),
                allowed_kinds=("image", "video"))
        else:
            asset = Asset.objects.filter(pk=asset_id, account_id=item.account_id,
                                         kind__in=["image", "video"]).first()
            if asset is None:
                raise _err("asset_id", "does_not_exist")
        hard, soft = _final_checks(asset, spec)
        if hard:
            raise asset_service.UnsupportedMediaError(hard)
        cover = None
        if cover_uploaded is not None or cover_asset_id is not None:
            if not spec.cover_required:
                raise _err("cover", "not_allowed")
            if cover_uploaded is not None:
                cover, _ = asset_service.upload(account=item.account, uploaded=cover_uploaded,
                                                user=user, content_item=item, role="source",
                                                allowed_kinds=("image",))
                Asset.objects.filter(pk=cover.pk).update(role="cover")
                cover.refresh_from_db()
            else:
                cover = Asset.objects.filter(pk=cover_asset_id, account_id=item.account_id,
                                             kind="image").first()
            if cover is None or not cover.width or abs(
                    cover.width / cover.height - spec.width / spec.height) / (
                    spec.width / spec.height) > spec.aspect_tolerance:
                raise _err("cover", "invalid")
        name = (getattr(user, "get_full_name", lambda: "")() or getattr(user, "username", "")
                or "an operator")
        warnings = [{"code": "final_needs_normalising", "message": "; ".join(soft),
                     "asset_id": asset.pk}] if soft else []
        if current is not None and item.status == S.IN_PRODUCTION and (
                current.status == V.Status.DRAFT):
            version = ContentVersion.objects.select_for_update().get(pk=current.pk)
        else:
            script = approved_script(item) if item.status != S.BRIEFED else None
            if current is not None and item.status == S.IN_PRODUCTION:
                script = current.script
            version = ContentVersion.objects.create(
                content_item=item, version=latest_version_number(item) + 1, script=script,
                frames=[], status=V.Status.DRAFT,
                caption=current.caption if current else "",
                hashtags=current.hashtags if current else [],
                alt_text=current.alt_text if current else "",
                created_by=user if getattr(user, "pk", None) else None)
            item.current_version = version
            item.save(update_fields=["current_version", "updated_at"])
        version.origin = V.VersionOrigin.MANUAL_UPLOAD
        version.final_asset = asset
        version.render_status = V.RenderStatus.READY
        version.change_note = f"Final file uploaded by {name}"
        steps = dict(version.production_steps or {})
        steps["final"] = {"status": "done", "warnings": warnings, "finished_at": _now_iso()}
        version.production_steps = steps
        version.cover_asset = cover
        version.save()
        if item.status in (S.BRIEFED, S.SCRIPTED):
            pipeline.transition(item, S.IN_PRODUCTION, actor=user,
                                message="Finished file uploaded")
        pipeline.log_event(item, ContentEvent.Type.EDITED, actor=user,
                           message=f"Final file uploaded for version {version.version}",
                           data={"content_version": version.version, "asset_id": asset.pk})
    version.refresh_from_db()
    if spec.cover_required and version.cover_asset is None and asset.kind == "video":
        version.cover_asset = assembly.store_cover_from_video(version, asset, 1.0)
        version.save(update_fields=["cover_asset", "updated_at"])
    frame_service.rebuild_warnings(version)
    copy_job = None
    if spec.caption_allowed and not (version.caption or "").strip():
        copy_job = start_copy_job(item, user=user, request_id=request_id,
                                  base_version=version.version, check_provider=False)
    return version, copy_job


# --- Job starters for the workspace endpoints ---------------------------------------------

def start_render_job(item: ContentItem, *, base_version, frames=None, reassemble=True,
                     user=None, request_id=None):
    from apps.core.jobs import start_job

    with transaction.atomic():
        item = pipeline.lock(item)
        if item.status != S.IN_PRODUCTION:
            raise InvalidTransition({"status": item.status,
                                     "allowed_statuses": [S.IN_PRODUCTION]})
        version = item.current_version
        if version is None or version.status != V.Status.DRAFT or (
                version.origin == V.VersionOrigin.MANUAL_UPLOAD):
            raise InvalidTransition({"status": item.status, "reason": "no_draft"})
        check_base_version(item, base_version)
        pipeline.ensure_idle(item)
        indexes = {f["index"] for f in version.frames}
        if frames is not None:
            if not isinstance(frames, list) or any(f not in indexes for f in frames):
                raise _err("frames", "invalid")
        job = start_job(RENDER_KIND, target_id=item.pk, account=item.account, user=user,
                        request_id=request_id,
                        payload={"version_id": version.pk, "frames": frames,
                                 "reassemble": bool(reassemble)})
        pipeline.log_event(item, ContentEvent.Type.JOB_STARTED, actor=user,
                           message="Re-render started",
                           data={"job_id": str(job.id), "kind": RENDER_KIND})
    return job


def start_image_job(item: ContentItem, *, base_version, frame_index, prompt=None, attach=True,
                    rerender=True, user=None, request_id=None):
    from apps.core.jobs import start_job

    if not _provider_ready("image"):
        from apps.core.errors import ProviderNotConfiguredError

        raise ProviderNotConfiguredError()
    with transaction.atomic():
        item = pipeline.lock(item)
        version = ensure_draft_pipeline(item)
        check_base_version(item, base_version)
        pipeline.ensure_idle(item)
        images.check_frame(version, frame_index, prompt)
        if images.generated_count(item) >= images.max_images():
            from apps.core.errors import RateLimited

            raise RateLimited(retryable=False, details={"limit": images.max_images()})
        job = start_job(IMAGE_KIND, target_id=item.pk, account=item.account, user=user,
                        request_id=request_id,
                        payload={"version_id": version.pk, "frame_index": frame_index,
                                 "subject": prompt, "attach": bool(attach),
                                 "rerender": bool(rerender)})
        pipeline.log_event(item, ContentEvent.Type.JOB_STARTED, actor=user,
                           message=f"Generating an image for frame {frame_index}",
                           data={"job_id": str(job.id), "kind": IMAGE_KIND,
                                 "frame_index": frame_index})
    return job


def start_copy_job(item: ContentItem, *, base_version, feedback="", keep_hashtags=False,
                   user=None, request_id=None, check_provider=True):
    from apps.core.jobs import start_job

    if check_provider and not _provider_ready("text"):
        from apps.core.errors import ProviderNotConfiguredError

        raise ProviderNotConfiguredError()
    if len(feedback or "") > copy_service.FEEDBACK_MAX:
        raise _err("feedback", "max_length")
    with transaction.atomic():
        item = pipeline.lock(item)
        if item.status != S.IN_PRODUCTION or item.current_version is None or (
                item.current_version.status != V.Status.DRAFT):
            raise InvalidTransition({"status": item.status,
                                     "allowed_statuses": [S.IN_PRODUCTION]})
        if not formats.get_spec(item.format, item.media_kind).caption_allowed:
            raise InvalidTransition({"status": item.status, "reason": "format_has_no_caption"})
        brief = item.current_brief
        if brief is None or brief.status != DocumentStatus.APPROVED:
            raise InvalidTransition({"status": item.status, "reason": "brief_required"})
        check_base_version(item, base_version)
        pipeline.ensure_idle(item)
        job = start_job(COPY_KIND, target_id=item.pk, account=item.account, user=user,
                        request_id=request_id,
                        payload={"version_id": item.current_version_id,
                                 "feedback": feedback or "", "keep_hashtags": keep_hashtags})
        pipeline.log_event(item, ContentEvent.Type.JOB_STARTED, actor=user,
                           message="Caption drafting started",
                           data={"job_id": str(job.id), "kind": COPY_KIND})
    return job


def _provider_ready(kind: str) -> bool:
    try:
        from apps.ai import gateway
    except ImportError:
        return True
    fn = getattr(gateway, "is_configured", None)
    return bool(fn(kind)) if callable(fn) else True


# --- Allowed actions ----------------------------------------------------------------------

def production_actions(item: ContentItem, version: ContentVersion | None, user=None) -> dict:
    idle = pipeline.active_job(item) is None
    is_current = version is not None and version.pk == item.current_version_id
    draft = is_current and version.status == V.Status.DRAFT
    pipeline_draft = draft and version.origin == V.VersionOrigin.PIPELINE
    in_prod = item.status == S.IN_PRODUCTION
    spec = formats.get_spec(item.format, item.media_kind)
    can_start = idle and item.status in START_STATUSES and approved_script(item) is not None
    blockers = submit_blockers(item, version) if version is not None else ["not_rendered"]
    return {
        "can_start": bool(can_start),
        "can_render": bool(idle and in_prod and pipeline_draft),
        "can_edit_frames": bool(idle and in_prod and pipeline_draft),
        "can_edit_copy": bool(idle and in_prod and draft and spec.caption_allowed),
        "can_upload_final": bool(idle and item.status in FINAL_ALLOWED and (
            item.status != S.IN_PRODUCTION or version is None or draft)),
        "can_submit": bool(idle and in_prod and draft and not blockers),
        "submit_blockers": blockers,
        "holding_warnings": sorted({w["code"] for w in holding_warnings(version)})
        if version is not None else [],
    }


from apps.content import actions as _content_actions  # noqa: E402


@_content_actions.register
def _production_item_actions(item, user, ctx):
    names = []
    flags = production_actions(item, item.current_version, user)
    for flag, name in (("can_start", "start_production"), ("can_render", "render"),
                       ("can_upload_final", "upload_final"), ("can_submit", "submit")):
        if flags[flag]:
            names.append(name)
    return names
