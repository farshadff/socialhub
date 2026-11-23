"""Job kinds owned by research (E00-S06 rule 1)."""

from .services.platform import register_job_kind

register_job_kind(
    "research.run",
    task="research.run_research",
    queue="default",
    target_type="research_run",
    timeout_seconds=20 * 60,
)
