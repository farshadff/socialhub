from collections.abc import Mapping
from uuid import uuid4

from django.http import JsonResponse
from django.views.csrf import csrf_failure as django_csrf_failure
from rest_framework import status
from rest_framework.exceptions import (
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
}


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
    if isinstance(exc, ValidationError):
        return "validation_error"
    if isinstance(exc, (AuthenticationFailed, NotAuthenticated)):
        return "authentication_required"
    if isinstance(exc, PermissionDenied):
        return "permission_denied"
    if isinstance(exc, NotFound):
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
    response = exception_handler(exc, context)
    if response is None:
        return None

    request = context.get("request")
    request_id = getattr(request, "request_id", str(uuid4()))
    code = _error_code(exc, response.status_code)
    fields = _flatten_validation(exc.detail) if isinstance(exc, ValidationError) else []
    response.data = {
        "error": {
            "code": code,
            "message": _ERROR_MESSAGES[code],
            "fields": fields,
            "request_id": request_id,
            "retryable": isinstance(exc, Throttled),
        }
    }
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
