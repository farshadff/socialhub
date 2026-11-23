"""Production job tasks (E06-S02 to S07).

`production.start` runs as one JobRun across a chain of steps, each on its own queue
(E06-S07 rule 7). Every step re-checks that the job is running and the version is current
(rule 9), records its outcome on the version, and enqueues the next step.
"""

from __future__ import annotations

import logging

from apps.content.models import ContentItem, ContentVersion
from apps.core.jobs import JobContext, JobError, job_step, job_task

from .services import assembly, images, orchestration
from .services import copy as copy_service
from .services import frames as frame_service

logger = logging.getLogger(__name__)

STEP_QUEUES = {
    "production.step_backgrounds": "default",
    "production.step_frames": "render",
    "production.step_assemble": "render",
    "production.step_copy": "default",
    "production.step_finish": "default",
}
CHAIN = list(STEP_QUEUES)


def _next(ctx: JobContext, current: str, kwargs: dict) -> None:
    from celery import current_app

    index = CHAIN.index(current)
    if index + 1 >= len(CHAIN):
        return
    name = CHAIN[index + 1]
    current_app.tasks[name].apply_async(args=[str(ctx.job.id)], kwargs=kwargs,
                                        queue=STEP_QUEUES[name])


def _fail(ctx: JobContext, step: str, code: str, detail: str = ""):
    orchestration.on_step_failed(int(ctx.job.target_id), ctx.job, step, code, detail)
    raise JobError(code, detail[:500] if detail else "")


def _guarded(ctx, step, fn):
    try:
        return fn()
    except frame_service.FrameRenderFailed as exc:
        _fail(ctx, step, "render_failed", exc.detail)
    except assembly.AssemblyError as exc:
        detail = exc.detail if exc.code != "assembly_failed" else "The video could not be assembled"
        logger.warning("Assembly failed for job %s: %s", ctx.job.id, exc.detail)
        _fail(ctx, step, exc.code, detail)
    except copy_service.CopyTooLong as exc:
        _fail(ctx, step, exc.code, exc.detail)
    except JobError:
        raise
    except Exception as exc:
        code = getattr(exc, "code", None)
        if isinstance(code, str) and code in ("provider_error", "provider_not_configured"):
            _fail(ctx, step, code, getattr(exc, "detail", "") or "")
        raise


def _progress(ctx: JobContext, lo: int, hi: int):
    def report(message: str, fraction: float | None = None):
        value = lo if fraction is None else lo + int((hi - lo) * max(0.0, min(1.0, fraction)))
        ctx.progress(value, message)
    return report


# --- production.start chain ---------------------------------------------------------------

@job_step("production.step_backgrounds")
def step_backgrounds(ctx: JobContext, version_id: int, **kwargs):
    loaded = orchestration.load_for_step(ctx.job, version_id)
    if loaded is None:
        return
    _item, version = loaded
    _guarded(ctx, "backgrounds", lambda: orchestration.run_backgrounds(
        version, job_id=ctx.job.id, progress=_progress(ctx, 5, 20)))
    _next(ctx, "production.step_backgrounds", {"version_id": version_id, **kwargs})


@job_step("production.step_frames")
def step_frames(ctx: JobContext, version_id: int, **kwargs):
    loaded = orchestration.load_for_step(ctx.job, version_id)
    if loaded is None:
        return
    _item, version = loaded
    report = _progress(ctx, 20, 60)
    _guarded(ctx, "frames", lambda: orchestration.run_frames(
        version, progress=lambda m, f=None: report(m, f)))
    _next(ctx, "production.step_frames", {"version_id": version_id, **kwargs})


@job_step("production.step_assemble")
def step_assemble(ctx: JobContext, version_id: int, **kwargs):
    loaded = orchestration.load_for_step(ctx.job, version_id)
    if loaded is None:
        return
    _item, version = loaded
    report = _progress(ctx, 60, 85)
    _guarded(ctx, "assemble", lambda: orchestration.run_assemble(
        version, progress=lambda m, f=None: report(m, f)))
    _next(ctx, "production.step_assemble", {"version_id": version_id, **kwargs})


@job_step("production.step_copy")
def step_copy(ctx: JobContext, version_id: int, **kwargs):
    loaded = orchestration.load_for_step(ctx.job, version_id)
    if loaded is None:
        return
    _item, version = loaded
    _guarded(ctx, "copy", lambda: orchestration.run_copy(
        version, job_id=ctx.job.id, progress=_progress(ctx, 85, 98)))
    _next(ctx, "production.step_copy", {"version_id": version_id, **kwargs})


@job_step("production.step_finish")
def step_finish(ctx: JobContext, version_id: int, submit: str = "autopilot",
                submit_trigger: str = "submission", **_):
    loaded = orchestration.load_for_step(ctx.job, version_id)
    if loaded is None:
        return
    _item, version = loaded
    result = orchestration.finish(version, submit=submit, submit_trigger=submit_trigger)
    ctx.progress(100, "Done")
    ctx.succeed(result)


# --- production.render (E06-S02, S03, S04) ------------------------------------------------

def _render_and_assemble(ctx, version, frames, reassemble, lo=0, hi=100):
    report = _progress(ctx, lo, lo + (hi - lo) * 6 // 10)
    result = _guarded(ctx, "frames", lambda: orchestration.run_frames(
        version, indexes=frames, force=frames is not None,
        progress=lambda m, f=None: report(m, f)))
    version.refresh_from_db()
    if reassemble:
        report2 = _progress(ctx, lo + (hi - lo) * 6 // 10, hi)
        _guarded(ctx, "assemble", lambda: orchestration.run_assemble(
            version, progress=lambda m, f=None: report2(m, f)))
        version.refresh_from_db()
    return result


def _settle(version: ContentVersion) -> None:
    version.refresh_from_db()
    if orchestration.is_ready(version):
        version.render_status = ContentVersion.RenderStatus.READY
    elif version.render_status != ContentVersion.RenderStatus.FAILED:
        version.render_status = ContentVersion.RenderStatus.PENDING
    version.save(update_fields=["render_status", "updated_at"])
    frame_service.rebuild_warnings(version)
    item = version.content_item
    wait, reason = orchestration.waiting_for(version)
    from apps.content.services import pipeline

    if wait:
        pipeline.set_hold_reason(item, reason)
    elif version.render_status == ContentVersion.RenderStatus.READY:
        holding = orchestration.holding_warnings(version)
        pipeline.set_hold_reason(item, "Ready to submit" if not holding else
                                 f"Ready to submit — {len(holding)} warnings to review")


@job_task("production.render")
def render(ctx: JobContext, version_id: int, frames=None, reassemble: bool = True, **_):
    loaded = orchestration.load_for_step(ctx.job, version_id)
    if loaded is None:
        return
    _item, version = loaded
    result = _render_and_assemble(ctx, version, frames, reassemble)
    _settle(version)
    version.refresh_from_db()
    ctx.succeed({"content_version": version.version,
                 "rendered_frames": result.get("rendered", []),
                 "reused_frames": result.get("reused", []),
                 "final_asset": version.final_asset_id, "cover_asset": version.cover_asset_id,
                 "duration_ms": version.final_asset.duration_ms if version.final_asset else None,
                 "bytes": version.final_asset.bytes if version.final_asset else None,
                 "warnings": len(version.render_warnings or [])})


# --- production.generate_image (E06-S05) --------------------------------------------------

@job_step("production.generate_frame_image")
def generate_frame_image(ctx: JobContext, version_id: int, frame_index: int, subject=None,
                         attach: bool = True, rerender: bool = True, **_):
    loaded = orchestration.load_for_step(ctx.job, version_id)
    if loaded is None:
        return
    _item, version = loaded
    partial = ctx.job.result or {}
    asset_id = partial.get("asset")
    ctx.progress(5, "Generating image")
    if asset_id is None:
        try:
            asset = images.generate_frame_background(version, frame_index, subject=subject,
                                                     attach=attach, job_id=ctx.job.id)
        except images.ImageCapReached:
            _fail(ctx, "backgrounds", "rate_limited", "The image limit for this item is reached.")
        except Exception as exc:
            code = getattr(exc, "code", None)
            if isinstance(code, str):
                _fail(ctx, "backgrounds", code, getattr(exc, "detail", "") or "")
            raise
        asset_id = asset.pk
        from apps.core.models import JobRun

        JobRun.objects.filter(pk=ctx.job.pk).update(result={
            "content_version": version.version, "frame_index": frame_index, "asset": asset_id,
            "attached": attach, "ai_run": (asset.meta or {}).get("ai_run_id")})
    ctx.progress(60, "Image ready")
    if rerender and attach:
        from celery import current_app

        current_app.tasks["production.rerender_after_image"].apply_async(
            args=[str(ctx.job.id)], kwargs={"version_id": version_id, "frame_index": frame_index},
            queue="render")
        return
    ctx.job.refresh_from_db()
    ctx.succeed({**(ctx.job.result or {}), "rendered_frames": [], "final_asset": None})


@job_step("production.rerender_after_image")
def rerender_after_image(ctx: JobContext, version_id: int, frame_index: int, **_):
    loaded = orchestration.load_for_step(ctx.job, version_id)
    if loaded is None:
        return
    _item, version = loaded
    result = _render_and_assemble(ctx, version, [frame_index], True, lo=60, hi=100)
    _settle(version)
    version.refresh_from_db()
    ctx.job.refresh_from_db()
    ctx.succeed({**(ctx.job.result or {}), "rendered_frames": result.get("rendered", []),
                 "final_asset": version.final_asset_id})


# --- copy.generate (E06-S06) --------------------------------------------------------------

@job_task("copy.generate")
def generate_copy(ctx: JobContext, version_id: int, feedback: str = "",
                  keep_hashtags: bool = False, **_):
    item = ContentItem.objects.get(pk=int(ctx.job.target_id))
    version = ContentVersion.objects.select_related("script", "content_item").get(pk=version_id)
    if item.current_version_id != version.pk or version.status != ContentVersion.Status.DRAFT:
        ctx.fail("version_conflict", "The version changed while the caption was written.")
        return
    try:
        result = copy_service.generate_copy(version, feedback=feedback,
                                            keep_hashtags=keep_hashtags, job_id=ctx.job.id,
                                            progress=lambda m: ctx.progress(50, m))
    except copy_service.CopyTooLong as exc:
        raise JobError(exc.code, exc.detail) from None
    ctx.succeed(result)
