"""Gateway errors (AI-INTEGRATION.md section 2). All carry ``code``, ``detail`` and ``retryable``.

``AIError`` subclasses ``core.jobs.JobError`` so a job body that lets one escape fails its
job with ``error_code = exc.code`` and ``error_detail = exc.detail``.
"""

from apps.core.jobs import JobError


class AIError(JobError):
    code = "provider_error"

    def __init__(self, detail: str = "", *, retryable: bool = False, retry_after: float | None = None):
        super().__init__(self.code, detail)
        self.retryable = retryable
        self.retry_after = retry_after


class ProviderNotConfigured(AIError):
    code = "provider_not_configured"


class ProviderRefused(AIError):
    def __init__(self, detail: str = "refused", **kwargs):
        super().__init__("refused", **kwargs)


class ProviderError(AIError):
    """``detail`` is ``rate_limited``, ``timeout``, ``unavailable``, ``bad_request`` or
    ``web_search_failed``."""


class OutputInvalid(AIError):
    def __init__(self, detail: str = "invalid_output", **kwargs):
        super().__init__("invalid_output", **kwargs)


class CallLimitExceeded(AIError):
    def __init__(self, detail: str = "call_limit", **kwargs):
        super().__init__("call_limit", **kwargs)
