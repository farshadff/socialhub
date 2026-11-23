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

from .exceptions import CodedAPIException
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
    "invalid_transition": "این عملیات در وضعیت فعلی مجاز نیست.",
    "job_in_progress": "این کار در حال انجام است. تا پایان آن صبر کنید.",
    "provider_not_configured": "سرویس هوش مصنوعی پیکربندی نشده است.",
    "provider_error": "سرویس هوش مصنوعی پاسخ نداد. کمی بعد دوباره تلاش کنید.",
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
    "immutable": "این مقدار پس از ایجاد قابل تغییر نیست.",
    "limit_reached": "به سقف مجاز رسیده‌اید.",
    "no_active_sources": "هیچ منبع فعالی انتخاب نشده است.",
    "nothing_to_do": "دست‌کم یکی از گردآوری یا دسته‌بندی باید فعال باشد.",
    "url_or_excerpt_required": "نشانی یا خلاصه را وارد کنید.",
    "invalid_choice": "گزینهٔ انتخاب‌شده معتبر نیست.",
    "null": "این مقدار نمی‌تواند خالی باشد.",
    "not_a_list": "این مقدار باید فهرست باشد.",
    "empty": "این فهرست نمی‌تواند خالی باشد.",
    "read_only": "این مقدار قابل تغییر نیست.",
    "duplicate": "این مورد تکراری است.",
    "invalid_combination": "این ترکیب مقادیر مجاز نیست.",
    "invalid_week_start": "این تاریخ روز شروع هفتهٔ حساب نیست.",
    "out_of_range": "این هفته خارج از بازهٔ مجاز است.",
    "account_archived": "این حساب بایگانی شده است.",
    "outside_week": "این زمان خارج از هفتهٔ برنامه است.",
    "too_soon": "این زمان باید دست‌کم ۳۰ دقیقه بعد از اکنون باشد.",
    "exceeds_daily_limit": "تعداد انتشار در این روز از سقف مجاز حساب بیشتر می‌شود.",
    "gap_too_small": "فاصلهٔ این انتشار با انتشار دیگرِ همان روز کمتر از حد مجاز است.",
    "max_slots": "تعداد اسلات‌های برنامه به سقف مجاز رسیده است.",
    "no_template": "برای این حساب الگوی هفتگی فعالی تعریف نشده است.",
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
    if isinstance(exc, CodedAPIException):
        return exc.error_code
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
        # Django's Http404 / PermissionDenied reach here unconverted (DRF converts a copy).
        status.HTTP_403_FORBIDDEN: "permission_denied",
        status.HTTP_404_NOT_FOUND: "not_found",
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
    error = {
        "code": code,
        "message": _ERROR_MESSAGES[code],
        "fields": fields,
        "request_id": request_id,
        "retryable": isinstance(exc, Throttled) or bool(getattr(exc, "retryable", False)),
    }
    details = getattr(exc, "details", None)
    if details is not None:
        error["details"] = details
    response.data = {"error": error}
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
