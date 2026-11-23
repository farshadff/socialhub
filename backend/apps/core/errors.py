import math
from collections.abc import Mapping
from uuid import uuid4

from django.http import Http404, JsonResponse
from django.views.csrf import csrf_failure as django_csrf_failure
from rest_framework import status
from rest_framework.exceptions import (
    APIException,
    AuthenticationFailed,
    MethodNotAllowed,
    NotAuthenticated,
    NotFound,
    PermissionDenied,
    Throttled,
    ValidationError,
)
from rest_framework.views import exception_handler

from .middleware import error_payload

_ERROR_MESSAGES = {
    "validation_error": "اطلاعات واردشده معتبر نیست.",
    "authentication_required": "برای ادامه وارد حساب کاربری شوید.",
    "permission_denied": "اجازه دسترسی به این بخش را ندارید.",
    "not_found": "مورد درخواستی پیدا نشد.",
    "method_not_allowed": "این عملیات در این مسیر پشتیبانی نمی‌شود.",
    "rate_limited": "تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
    "state_conflict": "اطلاعات تغییر کرده است. صفحه را تازه‌سازی و دوباره بررسی کنید.",
    "payload_too_large": "حجم اطلاعات ارسالی بیش از حد مجاز است.",
    "service_unavailable": "سرویس موقتاً در دسترس نیست.",
    "service_timeout": "پاسخ سرویس در زمان مجاز دریافت نشد.",
    "upstream_error": "ارتباط با سرویس وابسته برقرار نشد.",
    "server_error": "خطای پیش‌بینی‌نشده‌ای رخ داد. با کد پیگیری با پشتیبانی تماس بگیرید.",
    "request_error": "درخواست قابل پردازش نیست.",
    "csrf_failed": "درخواست منقضی یا نامعتبر است. صفحه را تازه‌سازی کنید.",
    "invalid_transition": "این عملیات در وضعیت فعلی این مورد مجاز نیست.",
    "instagram_not_connected": "حساب به اینستاگرام متصل نیست یا اتصال آن نیاز به بررسی دارد.",
    "instagram_permission_missing": "اتصال اینستاگرام مجوز لازم برای این کار را ندارد.",
    "job_in_progress": "کار دیگری برای این مورد در حال اجراست. کمی بعد دوباره تلاش کنید.",
    "provider_not_configured": "سرویس موردنیاز هنوز پیکربندی نشده است.",
    "provider_error": "سرویس بیرونی با خطا مواجه شد. چند دقیقه بعد دوباره تلاش کنید.",
    "invalid_credentials": "نام کاربری یا گذرواژه نادرست است.",
    "version_conflict": "نسخه تازه‌تری ذخیره شده است. صفحه را تازه‌سازی و دوباره بررسی کنید.",
    "unsupported_media": "نوع یا قالب فایل پشتیبانی نمی‌شود.",
}

_FIELD_MESSAGES = {
    "required": "این مقدار الزامی است.",
    "blank": "این مقدار نمی‌تواند خالی باشد.",
    "invalid": "مقدار واردشده معتبر نیست.",
    "min_value": "مقدار کمتر از حد مجاز است.",
    "max_value": "مقدار بیشتر از حد مجاز است.",
    "min_length": "تعداد نویسه‌ها کمتر از حد مجاز است.",
    "max_length": "تعداد نویسه‌ها بیشتر از حد مجاز است.",
    "does_not_exist": "مورد انتخاب‌شده معتبر نیست.",
    "unique": "این مقدار قبلاً ثبت شده است.",
    "invalid_choice": "گزینه انتخاب‌شده معتبر نیست.",
    "type_not_allowed": "این نوع فایل مجاز نیست.",
    "extension_mismatch": "پسوند فایل با محتوای آن هم‌خوانی ندارد.",
    "empty_file": "فایل خالی است.",
    "invalid_image": "فایل تصویر خراب است یا خوانده نمی‌شود.",
    "dimensions_out_of_range": "ابعاد تصویر خارج از محدوده مجاز است.",
    "invalid_svg": "فایل SVG معتبر نیست.",
    "svg_script": "فایل SVG نباید اسکریپت داشته باشد.",
    "svg_event_handler": "فایل SVG نباید رویداد (on…) داشته باشد.",
    "svg_external_reference": "فایل SVG نباید به منبع بیرونی ارجاع دهد.",
}


class ApiError(APIException):
    """An API error with an explicit contract code and optional machine-readable details.

    `fields` uses the shape of `error.fields`; `details` becomes `error.details`.
    """

    def __init__(self, code: str, status_code: int, *, details: dict | None = None,
                 retryable: bool = False, fields: list[dict] | None = None,
                 headers: dict | None = None):
        super().__init__(detail=code, code=code)
        self.status_code = status_code
        self.error_code = code
        self.details = details
        self.retryable = retryable
        self.fields = fields or []
        self.headers = headers or {}


class InvalidCredentials(ApiError):
    """Wrong username or password, or an inactive user (E00-S01)."""

    def __init__(self):
        super().__init__("invalid_credentials", status.HTTP_400_BAD_REQUEST)


class CsrfFailed(ApiError):
    def __init__(self):
        super().__init__("csrf_failed", status.HTTP_403_FORBIDDEN)


class InvalidTransition(ApiError):
    def __init__(self, details: dict | None = None):
        super().__init__("invalid_transition", status.HTTP_409_CONFLICT, details=details)


class InstagramNotConnected(ApiError):
    """409: the account is not connected to Instagram, or its connection needs attention."""

    def __init__(self, details: dict | None = None):
        super().__init__("instagram_not_connected", status.HTTP_409_CONFLICT, details=details)


class VersionConflict(ApiError):
    """`base_version` is not the latest. Extra keys (`latest_origin`, `latest_created_by`)
    are added to `details` when given."""

    def __init__(self, latest_version: int, **extra):
        super().__init__(
            "version_conflict",
            status.HTTP_409_CONFLICT,
            details={"latest_version": latest_version, **extra},
        )


class JobInProgress(ApiError):
    """The target already has an active job of the same or a conflicting kind (E00-S06).

    Raised by `apps.core.jobs.start_job` with the active `JobRun`; `self.job` keeps the row and
    `details.job` carries its full API shape.
    """

    def __init__(self, job):
        from .models import JobRun

        if isinstance(job, JobRun):
            from .jobs import job_payload

            self.job = job
            payload = job_payload(job)
        else:
            self.job = None
            payload = job
        super().__init__(
            "job_in_progress", status.HTTP_409_CONFLICT, details={"job": payload}, retryable=True
        )


class ProviderNotConfiguredError(ApiError):
    def __init__(self, details: dict | None = None):
        super().__init__("provider_not_configured", status.HTTP_503_SERVICE_UNAVAILABLE,
                         details=details)


class InstagramPermissionMissing(ApiError):
    """409: the connection lacks an Instagram permission the action needs (E00-S04)."""

    def __init__(self, details: dict | None = None):
        super().__init__("instagram_permission_missing", status.HTTP_409_CONFLICT,
                         details=details)


class ProviderError(ApiError):
    """502: the AI or Instagram provider failed; `retryable` because trying later may help."""

    def __init__(self, details: dict | None = None):
        super().__init__("provider_error", status.HTTP_502_BAD_GATEWAY, details=details,
                         retryable=True)


class PayloadTooLarge(ApiError):
    def __init__(self, details: dict | None = None):
        super().__init__("payload_too_large", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                         details=details)


class UnsupportedMedia(ApiError):
    """A file failed type rules. `reason`: `type_not_allowed`, `extension_mismatch`,
    `empty_file`, or a format-rule reason defined by the owning story."""

    def __init__(self, field: str, reason: str):
        self.field = field
        self.reason = reason
        super().__init__(
            "unsupported_media",
            status.HTTP_400_BAD_REQUEST,
            fields=[
                {
                    "path": field,
                    "code": reason,
                    "reason": reason,
                    "message": _FIELD_MESSAGES.get(reason, _FIELD_MESSAGES["invalid"]),
                }
            ],
            details={"reasons": [reason]},
        )


class RateLimited(ApiError):
    """429 with `Retry-After` in whole seconds when waiting helps (`retryable` true)."""

    def __init__(self, retry_after: int | None = None, *, retryable: bool = True,
                 details: dict | None = None):
        headers = {}
        if retry_after is not None:
            headers["Retry-After"] = str(max(1, int(math.ceil(retry_after))))
        self.retry_after = retry_after
        super().__init__("rate_limited", status.HTTP_429_TOO_MANY_REQUESTS,
                         details=details, retryable=retryable, headers=headers)


class DetailedValidationError(ValidationError):
    """A validation error that also carries `error.details` (for example an existing ID)."""

    def __init__(self, detail, *, details: dict | None = None):
        super().__init__(detail)
        self.details = details


def _field_code(value) -> str:
    code = getattr(value, "code", "invalid")
    return code if isinstance(code, str) else "invalid"


def _flatten_validation(detail, path: str = "") -> list[dict[str, str]]:
    fields: list[dict[str, str]] = []
    if isinstance(detail, Mapping):
        for key, value in detail.items():
            child_path = f"{path}.{key}" if path else str(key)
            fields.extend(_flatten_validation(value, child_path))
        return fields

    if isinstance(detail, (list, tuple)):
        for index, value in enumerate(detail):
            if isinstance(value, (Mapping, list, tuple)):
                child_path = f"{path}.{index}" if path else str(index)
                fields.extend(_flatten_validation(value, child_path))
            else:
                code = _field_code(value)
                fields.append(
                    {
                        "path": path,
                        "code": code,
                        "message": _FIELD_MESSAGES.get(code, "مقدار واردشده معتبر نیست."),
                    }
                )
        return fields

    code = _field_code(detail)
    fields.append(
        {
            "path": path,
            "code": code,
            "message": _FIELD_MESSAGES.get(code, "مقدار واردشده معتبر نیست."),
        }
    )
    return fields


def _error_code(exc, http_status: int) -> str:
    if isinstance(exc, ApiError):
        return exc.error_code
    if isinstance(exc, ValidationError):
        return "validation_error"
    if isinstance(exc, (AuthenticationFailed, NotAuthenticated)):
        return "authentication_required"
    if isinstance(exc, PermissionDenied):
        return "permission_denied"
    if isinstance(exc, (NotFound, Http404)):  # get_object_or_404 raises Http404
        return "not_found"
    if isinstance(exc, MethodNotAllowed):
        return "method_not_allowed"
    if isinstance(exc, Throttled):
        return "rate_limited"
    return {
        status.HTTP_409_CONFLICT: "state_conflict",
        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: "payload_too_large",
        status.HTTP_502_BAD_GATEWAY: "upstream_error",
        status.HTTP_503_SERVICE_UNAVAILABLE: "service_unavailable",
        status.HTTP_504_GATEWAY_TIMEOUT: "service_timeout",
    }.get(http_status, "server_error" if http_status >= 500 else "request_error")


def api_exception_handler(exc, context):
    # Provider exceptions (Instagram, E00-S04) translate themselves into an `ApiError`.
    as_api_error = getattr(exc, "as_api_error", None)
    if callable(as_api_error):
        exc = as_api_error()
    response = exception_handler(exc, context)
    if response is None:
        return None

    request = context.get("request")
    request_id = getattr(request, "request_id", str(uuid4()))
    code = _error_code(exc, response.status_code)
    if isinstance(exc, ValidationError):
        fields = _flatten_validation(exc.detail)
    else:
        fields = list(getattr(exc, "fields", None) or [])
    error = {
        "code": code,
        "message": _ERROR_MESSAGES.get(code, _ERROR_MESSAGES["request_error"]),
        "fields": fields,
    }
    details = getattr(exc, "details", None)
    if details is not None:
        error["details"] = details
    error["request_id"] = request_id
    error["retryable"] = isinstance(exc, Throttled) or getattr(exc, "retryable", False)
    response.data = {"error": error}
    for header, value in (getattr(exc, "headers", None) or {}).items():
        response[header] = value
    response["X-Request-ID"] = request_id
    return response


def csrf_failure(request, reason=""):
    if not request.path.startswith("/api/"):
        return django_csrf_failure(request, reason=reason)

    request_id = getattr(request, "request_id", str(uuid4()))
    return JsonResponse(
        error_payload("csrf_failed", _ERROR_MESSAGES["csrf_failed"], request_id),
        status=403,
        headers={"X-Request-ID": request_id},
    )
