"""Connection job kinds (E00-S04 "Background work", rules 39-40).

`instagram.verify` and `instagram.refresh_token` target `account_connection` (target_id is the
account ID), list each other in `conflicts_with` so only one connection job runs per account,
time out after 5 minutes and are prunable. A provider error that escapes a job body fails the
job with the matching connection code.
"""

from apps.core.jobs import register_job_exception, register_job_kind

from .providers.base import InstagramError
from .services import ERROR_DETAILS, REFRESH_KIND, TARGET_TYPE, VERIFY_KIND, job_error_code

CONNECTION_JOB_TIMEOUT_SECONDS = 5 * 60

register_job_kind(VERIFY_KIND, task=VERIFY_KIND, queue="default", target_type=TARGET_TYPE,
                  timeout_seconds=CONNECTION_JOB_TIMEOUT_SECONDS, conflicts_with=[REFRESH_KIND],
                  prunable=True)
register_job_kind(REFRESH_KIND, task=REFRESH_KIND, queue="default", target_type=TARGET_TYPE,
                  timeout_seconds=CONNECTION_JOB_TIMEOUT_SECONDS, conflicts_with=[VERIFY_KIND],
                  prunable=True)


def _map_error(exc: InstagramError) -> tuple[str, str]:
    code = job_error_code(exc)
    return code, ERROR_DETAILS.get(code, ERROR_DETAILS["provider_error"])


register_job_exception(InstagramError, _map_error)
