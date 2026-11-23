"""Session authentication that answers CSRF failures with the `csrf_failed` contract code.

DRF only checks CSRF for requests that already carry an authenticated session, and reports a
failure as `permission_denied`. E00-S01 rule 7 requires every unsafe request, including the
anonymous `POST /auth/login/`, to carry `X-CSRFToken`, and a failure to return `403 csrf_failed`.
"""

from django.middleware.csrf import CsrfViewMiddleware
from rest_framework.authentication import SessionAuthentication

_UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


class _CSRFCheck(CsrfViewMiddleware):
    def _reject(self, request, reason):
        return reason


class CsrfSessionAuthentication(SessionAuthentication):
    def authenticate(self, request):
        if request.method in _UNSAFE:
            self.enforce_csrf(request)
        return super().authenticate(request)

    def enforce_csrf(self, request):
        # Already checked once in authenticate(); a second check is cheap and keeps the
        # parent's behaviour for authenticated requests intact.
        def dummy_get_response(_request):  # pragma: no cover - never called
            return None

        check = _CSRFCheck(dummy_get_response)
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            # Imported here: errors.py imports rest_framework.views, which loads this module
            # through DEFAULT_AUTHENTICATION_CLASSES.
            from .errors import CsrfFailed

            raise CsrfFailed()
