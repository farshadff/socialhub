from celery import shared_task

from . import jobs


@shared_task(name="core.ping")
def ping() -> str:
    """Small, deterministic broker smoke task; performs no external work."""
    return "pong"


@shared_task(name="core.sweep_stale_jobs")
def sweep_stale_jobs() -> int:
    """Every 5 minutes: fail jobs past their deadline or queued for 6 hours (E00-S06 rule 17)."""
    return jobs.sweep_stale_jobs()


@shared_task(name="core.prune_jobs")
def prune_jobs() -> int:
    """Daily 03:15 UTC: delete old system jobs of prunable kinds (E00-S06 rule 17a)."""
    return jobs.prune_jobs()
