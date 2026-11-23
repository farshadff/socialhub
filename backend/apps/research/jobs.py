"""Job kinds owned by research (E00-S06 rule 1)."""

from apps.core.jobs import register_job_kind

RESEARCH_RUN = register_job_kind(
    "research.run",
    task="research.run_research",
    target_type="research_run",
    queue="default",
    timeout_seconds=20 * 60,  # soft limit 20 minutes; the hard limit is 60 s later
)
