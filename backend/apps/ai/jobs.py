"""AI job kinds and Celery tasks (E00-S05 "Background work").

- `system.ai_test` (job, queue `default`): one `system.ping` text call and one square image;
  each provider's outcome goes into `result`, so the job succeeds whenever it ran (rule 38).
- `ai.prune_payloads` (Beat, daily 02:30 UTC): nulls `AIRun.payload` older than 30 days.

`AIError` is registered with the job runner, so a job body that lets one escape fails with
`error_code = exc.code` and `error_detail = exc.detail` (rule 4).
"""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task

from apps.core import clock
from apps.core.jobs import JobContext, job_task, register_job_exception, register_job_kind

from .errors import AIError

logger = logging.getLogger(__name__)

AI_TEST_KIND = "system.ai_test"
AI_TEST_TARGET = ("system", "ai")
PING_IMAGE_PROMPT = "A plain, evenly lit light grey surface."
PRUNE_AFTER = timedelta(days=30)
PRUNE_BATCH = 1000

register_job_kind(AI_TEST_KIND, task=AI_TEST_KIND, queue="default",
                  target_type=AI_TEST_TARGET[0], timeout_seconds=15 * 60, prunable=True)
register_job_exception(AIError, lambda exc: (exc.code, exc.detail))


def _outcome(kind: str, task: str, job_id, call) -> dict:
    """One provider's line in the job result; provider failures are reported, not raised."""
    from . import gateway
    from .models import AIRun

    status = gateway.provider_status(kind)
    try:
        call()
    except AIError as exc:
        error = exc
    else:
        error = None
    run = AIRun.objects.filter(job_id=job_id, task=task).order_by("-id").first()
    return {
        "ok": error is None,
        "provider": run.provider if run is not None else status["provider"],
        "model": (run.model if run is not None and run.model
                  else status["model"] if status["configured"] else ""),
        "latency_ms": run.latency_ms if run is not None else 0,
        "ai_run_id": run.pk if run is not None else None,
        "error_code": error.code if error is not None else None,
        "error_detail": error.detail if error is not None else None,
    }


@job_task(AI_TEST_KIND)
def ai_test(ctx: JobContext, providers: list[str] | None = None) -> None:
    from . import gateway

    providers = providers or ["text", "image"]
    job_id = ctx.job.pk
    result: dict = {}
    if "text" in providers:
        result["text"] = _outcome("text", "system.ping", job_id, lambda: gateway.run_text(
            "system.ping", variables={}, job_id=job_id))
        ctx.progress(50, "Text provider checked")
    if "image" in providers:
        result["image"] = _outcome(
            "image", "system.ping_image", job_id,
            lambda: gateway.run_image("system.ping_image", prompt=PING_IMAGE_PROMPT,
                                      size="square", job_id=job_id))
        ctx.progress(100, "Image provider checked")
    ctx.succeed(result)


@shared_task(name="ai.prune_payloads")
def prune_payloads() -> int:
    """Null `payload` on `AIRun` rows older than 30 days, in batches of 1,000 (rule 27)."""
    from .models import AIRun

    cutoff = clock.now() - PRUNE_AFTER
    pruned = 0
    while True:
        ids = list(AIRun.objects.filter(created_at__lt=cutoff, payload__isnull=False)
                   .order_by("id").values_list("pk", flat=True)[:PRUNE_BATCH])
        if not ids:
            break
        pruned += AIRun.objects.filter(pk__in=ids).update(payload=None)
    if pruned:
        logger.info("ai_payloads_pruned count=%s", pruned)
    return pruned
