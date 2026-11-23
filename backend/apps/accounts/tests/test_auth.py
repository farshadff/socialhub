"""E00-S01 API tests: sign-in, CSRF, session, roles, throttle."""

import os
from datetime import timedelta

import pytest
from django.conf import settings
from django.core.cache import cache
from django.test import override_settings
from django.urls import include, path
from freezegun import freeze_time
from rest_framework.response import Response
from rest_framework.test import APIClient
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin, IsAdminOrReadOnly
from conftest import TEST_PASSWORD

pytestmark = pytest.mark.django_db

CSRF_URL = "/api/v1/auth/csrf/"
LOGIN_URL = "/api/v1/auth/login/"
LOGOUT_URL = "/api/v1/auth/logout/"
ME_URL = "/api/v1/auth/me/"


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def csrf_token(client) -> str:
    response = client.get(CSRF_URL)
    assert response.status_code == 200
    return response.json()["csrf_token"]


def login(client, username, password, token=None, **extra):
    token = token or csrf_token(client)
    return client.post(LOGIN_URL, {"username": username, "password": password}, format="json",
                       HTTP_X_CSRFTOKEN=token, **extra)


def without_request_id(body):
    body = dict(body["error"])
    body.pop("request_id")
    return body


# --- csrf -----------------------------------------------------------------------------------


def test_csrf_sets_cookie_and_returns_token(api_client):
    response = api_client.get(CSRF_URL)
    assert response.status_code == 200
    assert response.json()["csrf_token"]
    assert settings.CSRF_COOKIE_NAME in response.cookies
    assert not response.cookies[settings.CSRF_COOKIE_NAME]["httponly"]


# --- login ----------------------------------------------------------------------------------


def test_login_success_returns_user_and_fresh_csrf_and_rotates_session(api_client,
                                                                        operator_user):
    api_client.get(CSRF_URL)
    api_client.session.save()
    old_session = api_client.cookies.get(settings.SESSION_COOKIE_NAME)
    old_token = api_client.cookies[settings.CSRF_COOKIE_NAME].value

    response = api_client.post(LOGIN_URL, {"username": "  OPERATOR ", "password": TEST_PASSWORD},
                               format="json", HTTP_X_CSRFTOKEN=old_token)

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["user"] == {"id": operator_user.pk, "username": "operator",
                            "full_name": "Sara Moradi", "email": "op@example.com",
                            "role": "operator"}
    assert body["csrf_token"]
    new_session = response.cookies[settings.SESSION_COOKIE_NAME]
    assert new_session.value
    assert old_session is None or new_session.value != old_session.value
    assert new_session["httponly"]
    assert new_session["samesite"] == "Lax"
    assert api_client.cookies[settings.CSRF_COOKIE_NAME].value != old_token

    me = api_client.get(ME_URL)
    assert me.status_code == 200
    assert me.json()["user"]["role"] == "operator"


def test_superuser_role_is_admin(api_client, admin_user):
    response = login(api_client, "admin", TEST_PASSWORD)
    assert response.status_code == 200
    assert response.json()["user"] == {"id": admin_user.pk, "username": "admin",
                                       "full_name": "admin", "email": "", "role": "admin"}


def test_is_staff_alone_is_operator(api_client, django_user_model):
    django_user_model.objects.create_user("staffer", password=TEST_PASSWORD, is_staff=True)
    assert login(api_client, "staffer", TEST_PASSWORD).json()["user"]["role"] == "operator"


@pytest.mark.parametrize("body,expected", [
    ({}, {("username", "required"), ("password", "required")}),
    ({"username": "", "password": ""}, {("username", "blank"), ("password", "blank")}),
    ({"username": "   ", "password": "x"}, {("username", "blank")}),
    ({"username": "a" * 151, "password": "x"}, {("username", "max_length")}),
    ({"username": "a", "password": "x" * 129}, {("password", "max_length")}),
])
def test_login_validation_errors(api_client, body, expected):
    token = csrf_token(api_client)
    response = api_client.post(LOGIN_URL, body, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert {(f["path"], f["code"]) for f in error["fields"]} == expected


def test_failures_are_identical_apart_from_request_id(api_client, operator_user,
                                                      django_user_model):
    django_user_model.objects.create_user("inactive", password=TEST_PASSWORD, is_active=False)
    responses = [
        login(api_client, "operator", "wrong password"),
        login(api_client, "nobody", TEST_PASSWORD),
        login(api_client, "inactive", TEST_PASSWORD),
    ]
    bodies = []
    for response in responses:
        assert response.status_code == 400
        assert settings.SESSION_COOKIE_NAME not in response.cookies
        bodies.append(without_request_id(response.json()))
    assert bodies[0] == bodies[1] == bodies[2]
    assert bodies[0] == {"code": "invalid_credentials",
                         "message": "نام کاربری یا گذرواژه نادرست است.",
                         "fields": [], "retryable": False}


def test_password_is_not_trimmed(api_client, django_user_model):
    django_user_model.objects.create_user("spacey", password=" pw ")
    assert login(api_client, "spacey", "pw").status_code == 400
    assert login(api_client, "spacey", " pw ").status_code == 200


@pytest.mark.parametrize("token", [None, "wrong-token-wrong-token-wrong-tok"])
def test_login_without_valid_csrf_is_refused(api_client, operator_user, token):
    api_client.get(CSRF_URL)
    extra = {"HTTP_X_CSRFTOKEN": token} if token else {}
    response = api_client.post(LOGIN_URL, {"username": "operator", "password": TEST_PASSWORD},
                               format="json", **extra)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


def test_authenticated_post_without_csrf_is_csrf_failed(api_client, operator_user):
    assert login(api_client, "operator", TEST_PASSWORD).status_code == 200
    response = api_client.post(LOGOUT_URL)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


# --- throttle -------------------------------------------------------------------------------


def test_throttle_blocks_sixth_attempt_until_window_passes(api_client, operator_user):
    token = csrf_token(api_client)
    with freeze_time("2026-11-23 09:00:00") as frozen:
        for _ in range(5):
            assert login(api_client, "operator", "nope", token).status_code == 400
            frozen.tick(timedelta(minutes=1))

        # 09:05 - the first failure (09:00) leaves the window at 09:15.
        response = login(api_client, "Operator", TEST_PASSWORD, token)
        assert response.status_code == 429
        assert response["Retry-After"] == str(10 * 60)
        error = response.json()["error"]
        assert error["code"] == "rate_limited"
        assert error["retryable"] is True

        frozen.tick(timedelta(minutes=9, seconds=59))
        assert login(api_client, "operator", TEST_PASSWORD, token).status_code == 429

        frozen.tick(timedelta(seconds=1))
        assert login(api_client, "operator", TEST_PASSWORD, token).status_code == 200


def test_throttle_is_per_username_and_ip(api_client, operator_user, admin_user):
    token = csrf_token(api_client)
    with freeze_time("2026-11-23 09:00:00"):
        for _ in range(5):
            login(api_client, "operator", "nope", token)
        assert login(api_client, "operator", "nope", token).status_code == 429
        # Another username from the same IP, and the same username from another IP, still work.
        assert login(api_client, "admin", TEST_PASSWORD, token).status_code == 200
        other = APIClient(enforce_csrf_checks=True)
        assert login(other, "operator", TEST_PASSWORD,
                     REMOTE_ADDR="10.0.0.2").status_code == 200


def test_success_resets_the_counter(api_client, operator_user):
    token = csrf_token(api_client)
    with freeze_time("2026-11-23 09:00:00"):
        for _ in range(4):
            login(api_client, "operator", "nope", token)
        response = login(api_client, "operator", TEST_PASSWORD, token)
        assert response.status_code == 200
        token = response.json()["csrf_token"]
        for _ in range(4):
            assert login(api_client, "operator", "nope", token).status_code == 400
        assert login(api_client, "operator", "nope", token).status_code == 400
        assert login(api_client, "operator", "nope", token).status_code == 429


# --- logout and me --------------------------------------------------------------------------


def test_logout_deletes_session_and_me_then_requires_auth(api_client, operator_user):
    token = login(api_client, "operator", TEST_PASSWORD).json()["csrf_token"]
    response = api_client.post(LOGOUT_URL, HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 204
    assert response.cookies[settings.SESSION_COOKIE_NAME].value == ""
    me = api_client.get(ME_URL)
    assert me.status_code == 403
    assert me.json()["error"]["code"] == "authentication_required"


def test_logout_without_session_is_204(api_client):
    token = csrf_token(api_client)
    assert api_client.post(LOGOUT_URL, HTTP_X_CSRFTOKEN=token).status_code == 204
    assert api_client.post(LOGOUT_URL, HTTP_X_CSRFTOKEN=token).status_code == 204


def test_me_without_session(api_client):
    response = api_client.get(ME_URL)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "authentication_required"


def test_deactivated_user_loses_access_on_next_request(api_client, operator_user):
    assert login(api_client, "operator", TEST_PASSWORD).status_code == 200
    assert api_client.get(ME_URL).status_code == 200
    operator_user.is_active = False
    operator_user.save()
    response = api_client.get(ME_URL)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "authentication_required"


def test_session_settings():
    assert settings.SESSION_COOKIE_AGE == 1209600
    assert settings.SESSION_SAVE_EVERY_REQUEST is True
    assert settings.SESSION_COOKIE_HTTPONLY is True
    assert settings.SESSION_COOKIE_SAMESITE == "Lax"
    assert settings.CSRF_COOKIE_HTTPONLY is False
    # The test runner forces settings.DEBUG off at runtime, so compare against the
    # environment value the settings module read at import time.
    env_debug = os.environ.get("DJANGO_DEBUG", "false").lower() == "true"
    assert settings.SESSION_COOKIE_SECURE is (not env_debug)
    assert settings.CSRF_COOKIE_SECURE is (not env_debug)


# --- permissions ----------------------------------------------------------------------------


class AdminOnlyView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response({"ok": True})


class AdminOrReadView(APIView):
    permission_classes = [IsAdminOrReadOnly]

    def get(self, request):
        return Response({"ok": True})

    def post(self, request):
        return Response({"ok": True})


urlpatterns = [
    path("api/v1/", include("config.urls")),
    path("api/v1/test/admin-only/", AdminOnlyView.as_view()),
    path("api/v1/test/admin-or-read/", AdminOrReadView.as_view()),
]


@override_settings(ROOT_URLCONF=__name__)
def test_operator_gets_permission_denied_on_admin_endpoint(operator_api, admin_api):
    response = operator_api.get("/api/v1/test/admin-only/")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"
    assert admin_api.get("/api/v1/test/admin-only/").status_code == 200


@override_settings(ROOT_URLCONF=__name__)
def test_admin_only_endpoint_without_session(api_client):
    response = api_client.get("/api/v1/test/admin-only/")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "authentication_required"


@override_settings(ROOT_URLCONF=__name__)
def test_admin_or_read_only(operator_api, admin_api):
    assert operator_api.get("/api/v1/test/admin-or-read/").status_code == 200
    response = operator_api.post("/api/v1/test/admin-or-read/")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"
    assert admin_api.post("/api/v1/test/admin-or-read/").status_code == 200


# --- public surface -------------------------------------------------------------------------


def test_demo_endpoint_is_gone(admin_api):
    response = admin_api.get("/api/v1/demo/")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("url", ["/api/v1/", "/api/v1/health/live/", CSRF_URL])
def test_public_endpoints(api_client, url):
    assert api_client.get(url).status_code == 200


def test_jobs_require_a_session(api_client):
    response = api_client.get("/api/v1/jobs/")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "authentication_required"
