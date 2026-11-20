import logging
from uuid import uuid4

from django.core.exceptions import RequestDataTooBig, SuspiciousOperation
from django.http import JsonResponse

logger = logging.getLogger(__name__)

_BOUNDARY_ERRORS = {
    400: ("validation_error", "اطلاعات واردشده معتبر نیست."),
    401: ("authentication_required", "برای ادامه وارد حساب کاربری شوید."),
    403: ("permission_denied", "اجازه دسترسی به این بخش را ندارید."),
    404: ("not_found", "مورد درخواستی پیدا نشد."),
    405: ("method_not_allowed", "این عملیات در این مسیر پشتیبانی نمی‌شود."),
    409: ("state_conflict", "اطلاعات تغییر کرده است. صفحه را تازه‌سازی و دوباره بررسی کنید."),
    413: ("payload_too_large", "حجم اطلاعات ارسالی بیش از حد مجاز است."),
    429: ("rate_limited", "تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید."),
    502: ("upstream_error", "ارتباط با سرویس وابسته برقرار نشد."),
    503: ("service_unavailable", "سرویس موقتاً در دسترس نیست."),
    504: ("service_timeout", "پاسخ سرویس در زمان مجاز دریافت نشد."),
}


def error_payload(code: str, message: str, request_id: str, *, retryable: bool = False) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "fields": [],
            "request_id": request_id,
            "retryable": retryable,
        }
    }


class RequestIDMiddleware:
    """Attach one server-generated correlation ID to every response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = str(uuid4())
        response = self.get_response(request)
        if request.path.startswith("/api/") and response.status_code >= 400:
            content_type = response.get("Content-Type", "")
            if "application/json" not in content_type:
                code, message = _BOUNDARY_ERRORS.get(
                    response.status_code,
                    (
                        "server_error" if response.status_code >= 500 else "request_error",
                        "خطای پیش‌بینی‌نشده‌ای رخ داد. با کد پیگیری با پشتیبانی تماس بگیرید.",
                    ),
                )
                safe_response = JsonResponse(
                    error_payload(
                        code,
                        message,
                        request.request_id,
                        retryable=response.status_code == 429,
                    ),
                    status=response.status_code,
                )
                for header in ("Retry-After", "Allow"):
                    if header in response:
                        safe_response[header] = response[header]
                response = safe_response
        response["X-Request-ID"] = request.request_id
        return response

    def process_exception(self, request, exception):
        if not request.path.startswith("/api/"):
            return None

        if isinstance(exception, RequestDataTooBig):
            code, message = _BOUNDARY_ERRORS[413]
            return JsonResponse(
                error_payload(code, message, request.request_id),
                status=413,
            )
        if isinstance(exception, SuspiciousOperation):
            code, message = _BOUNDARY_ERRORS[400]
            return JsonResponse(
                error_payload(code, message, request.request_id),
                status=400,
            )

        logger.error(
            "Unhandled API exception type=%s request_id=%s",
            type(exception).__name__,
            request.request_id,
        )
        return JsonResponse(
            error_payload(
                "server_error",
                "خطای پیش‌بینی‌نشده‌ای رخ داد. با کد پیگیری با پشتیبانی تماس بگیرید.",
                request.request_id,
            ),
            status=500,
        )
