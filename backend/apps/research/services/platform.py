"""The one place research touches E00's job and AI interfaces.

E00-S05 (AI gateway) and E00-S06 (jobs) are built by the E00 owner. Everything research needs
from them goes through this module, so a rename there is a change here only.
"""

from django.conf import settings

# --- AI gateway (E00-S05, docs/AI-INTEGRATION.md section 2) -----------------------------------
# Imported lazily so the backend starts even before apps.ai exists.

_AI_ERROR_NAMES = ("AIError", "OutputInvalid", "ProviderError", "ProviderNotConfigured",
                   "ProviderRefused")


def __getattr__(name):
    if name in _AI_ERROR_NAMES:
        from apps.ai import errors

        return getattr(errors, name)
    if name == "WebSearchOptions":
        from apps.ai import gateway

        return gateway.WebSearchOptions
    raise AttributeError(name)


def run_text(task: str, **kwargs):
    from apps.ai import gateway

    return gateway.run_text(task, **kwargs)


def text_provider_configured() -> bool:
    """True when the text AI provider can be called (`fake` counts)."""
    try:
        from apps.ai import gateway
    except ImportError:
        return False
    return gateway.is_configured("text")


def blocked_domains() -> list[str]:
    return list(settings.SOCIALHUB_RESEARCH_BLOCKED_DOMAINS)


def is_refusal(exc: Exception) -> bool:
    return getattr(exc, "detail", None) == "refused" or type(exc).__name__ == "ProviderRefused"


# --- Jobs (E00-S06) ---------------------------------------------------------------------------

from apps.core import jobs as _jobs  # noqa: E402
from apps.core.errors import JobInProgress  # noqa: E402,F401
from apps.core.models import JobRun  # noqa: E402,F401

job_task = _jobs.job_task
JobContext = _jobs.JobContext
JobError = _jobs.JobError
register_job_kind = _jobs.register_job_kind


def start_job(kind: str, **kwargs) -> JobRun:
    return _jobs.start_job(kind, **kwargs)


def job_payload(job: JobRun) -> dict:
    """The full job object of docs/API.md 'Long actions'."""
    return _jobs.job_payload(job)


def user_ref(user) -> dict | None:
    from apps.core.users import user_ref as _user_ref

    return _user_ref(user)
