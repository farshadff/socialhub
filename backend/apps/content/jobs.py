"""Job kinds owned by the content app (E00-S06 rule 1)."""

from apps.core.jobs import register_job_kind

register_job_kind("brief.generate", task="brief.generate", queue="default",
                  timeout_seconds=1800, target_type="content_item",
                  conflicts_with=["script.generate"])
register_job_kind("brief.generate_batch", task=None, queue="default", timeout_seconds=3600,
                  target_type="plan")
register_job_kind("script.generate", task="script.generate", queue="default",
                  timeout_seconds=1800, target_type="content_item",
                  conflicts_with=["brief.generate"])
