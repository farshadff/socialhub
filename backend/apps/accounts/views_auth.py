"""Sign-in endpoints (E00-S01): `/auth/csrf/`, `/auth/login/`, `/auth/logout/`, `/auth/me/`.

CSRF is enforced for every unsafe request, including the anonymous login, by
`apps.core.authentication.CsrfSessionAuthentication`; a failure is `403 csrf_failed`.
"""

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.core.errors import InvalidCredentials, RateLimited

from .serializers_auth import LoginSerializer, UserSerializer
from .throttles import LoginThrottle


@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def csrf(request):
    return Response({"csrf_token": get_token(request)})


def _resolve_username(raw: str) -> str:
    """Match case-insensitively; prefer the exact spelling when two users differ by case."""
    User = get_user_model()
    matches = list(User.objects.filter(username__iexact=raw).values_list("username", flat=True))
    if raw in matches:
        return raw
    return matches[0] if len(matches) == 1 else raw


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    username = serializer.validated_data["username"]
    password = serializer.validated_data["password"]

    throttle = LoginThrottle()
    wait = throttle.wait_seconds(request, username)
    if wait is not None:
        raise RateLimited(wait)

    # ModelBackend runs the password hasher for unknown users too and refuses inactive ones,
    # so every failure takes the same path and returns the same response.
    user = authenticate(request._request, username=_resolve_username(username),
                        password=password)
    if user is None:
        throttle.record_failure(request, username)
        raise InvalidCredentials()

    throttle.reset(request, username)
    login(request._request, user)  # rotates the session key and the CSRF token
    return Response({"user": UserSerializer(user).data, "csrf_token": get_token(request)})


@api_view(["POST"])
@permission_classes([AllowAny])
def logout_view(request):
    logout(request._request)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def me(request):
    return Response({"user": UserSerializer(request.user).data})
