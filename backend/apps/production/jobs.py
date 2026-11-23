"""Job kinds owned by the production app (E00-S06 rule 1)."""

from apps.core.jobs import register_job_kind

PRODUCTION_KINDS = ["production.start", "production.render", "production.generate_image",
                    "copy.generate"]

register_job_kind("production.start", task="production.step_backgrounds", queue="default",
                  timeout_seconds=45 * 60, target_type="content_item",
                  conflicts_with=PRODUCTION_KINDS + ["brief.generate", "script.generate"])
register_job_kind("production.render", task="production.render", queue="render",
                  timeout_seconds=30 * 60, target_type="content_item",
                  conflicts_with=PRODUCTION_KINDS)
register_job_kind("production.generate_image", task="production.generate_frame_image",
                  queue="default", timeout_seconds=30 * 60, target_type="content_item",
                  conflicts_with=PRODUCTION_KINDS)
register_job_kind("copy.generate", task="copy.generate", queue="default",
                  timeout_seconds=30 * 60, target_type="content_item",
                  conflicts_with=PRODUCTION_KINDS)
