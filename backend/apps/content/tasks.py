"""Celery job tasks of the content app (E04-S03, E05-S01).

Thin wrappers: load the item, call the service, report progress. Job state, the active-job
pointer and `job_finished` are handled by `core.jobs.job_task` (E00-S06).
"""

from apps.core.jobs import JobContext, job_task

from .models import ContentItem
from .services import briefs, pipeline, scripts


def _fail_hook(ctx: JobContext, error_code: str, on_failed) -> None:
    item = ContentItem.objects.filter(pk=int(ctx.job.target_id)).first()
    if item is not None:
        pipeline.clear_active_job(item, ctx.job, failed=True, error_code=error_code)
        on_failed(item.pk, error_code)


@job_task("brief.generate")
def generate_brief(ctx: JobContext, feedback: str = "", base_version=None, parent_job=None,
                   **_):
    try:
        result = briefs.generate(int(ctx.job.target_id), job=ctx.job, feedback=feedback,
                                 base_version=base_version, progress=ctx.progress)
    except Exception as exc:
        code = getattr(exc, "code", None) or getattr(exc, "error_code", None) or "server_error"
        _fail_hook(ctx, code if isinstance(code, str) else "server_error",
                   lambda item_id, c: briefs.on_job_failed(item_id, ctx.job, c))
        raise
    if parent_job:
        result["parent_job"] = parent_job
    ctx.succeed(result)


@job_task("script.generate")
def generate_script(ctx: JobContext, feedback: str = "", base_version=None, auto_approve=None,
                    source: str = "operator", start_over: bool = False, **_):
    try:
        result = scripts.run_generation_job(ctx.job, feedback=feedback,
                                            base_version=base_version,
                                            auto_approve=auto_approve, source=source,
                                            progress=ctx.progress, start_over=start_over)
    except Exception as exc:
        code = getattr(exc, "code", None) or getattr(exc, "error_code", None) or "server_error"
        _fail_hook(ctx, code if isinstance(code, str) else "server_error",
                   scripts.on_job_failed)
        raise
    ctx.succeed(result)
