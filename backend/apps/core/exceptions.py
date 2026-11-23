"""API exceptions that carry a story-defined error code and optional `details` (API.md, Errors)."""

from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError


class CodedAPIException(APIException):
    """An API error with a fixed machine code and an optional `details` object."""

    error_code = "request_error"

    def __init__(self, details: dict | None = None):
        super().__init__()
        self.details = details or {}


class InvalidTransition(CodedAPIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "invalid_transition"
    default_code = "invalid_transition"
    error_code = "invalid_transition"


def field_error(path: str, code: str) -> ValidationError:
    """A validation error on one field path, for example `field_error("week_start", "unique")`.

    Dotted paths (`goals.1.target_value`) are expanded into nested dicts so the shared
    error handler flattens them back to the same path.
    """
    detail: dict | list = [code]
    for part in reversed(path.split(".")) if path else []:
        detail = {part: detail}
    return ValidationError(detail, code=code)


class ProviderNotConfiguredError(CodedAPIException):
    """A user action needs an AI provider whose key or model setting is missing (API.md)."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "provider_not_configured"
    default_code = "provider_not_configured"
    error_code = "provider_not_configured"


def field_error_with_details(path: str, code: str, details: dict) -> ValidationError:
    """A field validation error that also carries ``error.details`` (for example ``signal_id``)."""
    exc = field_error(path, code)
    exc.details = details
    return exc
