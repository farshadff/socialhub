"""Celery task of a research run (E02-S02 "Background work"). Thin wrapper around the service."""

from apps.core.jobs import JobContext, job_task

from .services.runs import execute_run, mark_failed


@job_task("research.run")
def run_research(ctx: JobContext, **payload):
    run_id = int(ctx.job.target_id)
    try:
        execute_run(run_id, ctx)
    except BaseException:
        # Time limit or crash: signals saved so far are kept, the run must not stay running.
        mark_failed(run_id)
        raise
