"""Gateway errors (E00-S05 rule 4, AI-INTEGRATION.md section 2).

Every error is an `AIError` with a `code`, a `detail` and a `retryable` flag. Job tasks need no
handling of their own: `apps.ai.jobs` registers `AIError` with the job runner, so an uncaught
one fails the job with `error_code = exc.code` and `error_detail = exc.detail`.
"""

from __future__ import annotations


class AIError(Exception):
    code = "provider_error"
    default_detail = ""
    retryable = False

    def __init__(self, detail: str | None = None, *, retryable: bool | None = None):
        self.detail = detail or self.default_detail
        if retryable is not None:
            self.retryable = retryable
        super().__init__(self.detail)

    def __repr__(self) -> str:
        return f"{type(self).__name__}(code={self.code!r}, detail={self.detail!r})"


class ProviderNotConfigured(AIError):
    """The key or model setting of the active provider is missing. `detail` names it."""

    code = "provider_not_configured"
    default_detail = "The AI provider is not configured."


class ProviderRefused(AIError):
    """The model declined, and the server-side fallback also declined or was unavailable."""

    default_detail = "refused"

    def __init__(self, detail: str | None = None, **kwargs):
        # The detail is always `refused`; a message passed by a fake is accepted and ignored.
        super().__init__("refused", **kwargs)


class ProviderError(AIError):
    """The provider failed after retries, or rejected the request.

    `detail` is one of `rate_limited`, `timeout`, `unavailable`, `bad_request`,
    `web_search_failed`. `retry_after` carries the provider's hint in seconds, when it sent one.
    """

    RETRYABLE_DETAILS = frozenset({"rate_limited", "timeout", "unavailable"})
    default_detail = "unavailable"

    def __init__(self, detail: str | None = None, *, retryable: bool | None = None,
                 retry_after: float | None = None, message: str = ""):
        detail = detail or self.default_detail
        if retryable is None:
            retryable = detail in self.RETRYABLE_DETAILS
        super().__init__(detail, retryable=retryable)
        self.retry_after = retry_after
        self.message = message  # provider text for logs; never shown to users


class OutputInvalid(AIError):
    """The output failed schema validation or was cut off by the output limit."""

    default_detail = "invalid_output"

    def __init__(self, detail: str | None = None, *, reason: str = "", **kwargs):
        super().__init__("invalid_output", **kwargs)
        self.reason = reason or (detail if detail and detail != "invalid_output" else "")


class CallLimitExceeded(AIError):
    """The job already made `SOCIALHUB_AI_MAX_CALLS_PER_JOB` logical AI calls."""

    default_detail = "call_limit"

    def __init__(self, detail: str | None = None, **kwargs):
        super().__init__("call_limit", **kwargs)


__all__ = ["AIError", "CallLimitExceeded", "OutputInvalid", "ProviderError",
           "ProviderNotConfigured", "ProviderRefused"]
