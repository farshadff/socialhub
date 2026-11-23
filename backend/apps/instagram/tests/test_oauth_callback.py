"""E00-S04 connect flow: `connect/` and the public OAuth callback with the fake provider."""

from datetime import timedelta
from unittest import mock

import pytest
from django.core.cache import cache
from freezegun import freeze_time

from apps.accounts.models import AccountConnection
from apps.accounts.tests.factories import make_account
from apps.core import crypto
from apps.instagram.providers.base import PermissionMissing, VerifyResult
from apps.instagram.providers.fake import FakeProvider
from apps.instagram.services import oauth_state_key

from .helpers import (
    callback,
    connection_of,
    connection_url,
    follow_authorize,
    redirect_query,
    start_connect,
)

pytestmark = pytest.mark.django_db

PANEL = "http://localhost:5173"
STATE_INVALID = f"{PANEL}/settings/accounts?connect=error&code=oauth_state_invalid"


@pytest.fixture
def account():
    return make_account(handle="greenhome.ir")


def _snapshot(account):
    return AccountConnection.objects.values().get(account=account)


def test_connect_returns_fake_authorize_url_and_stores_state(admin_api, admin_user, account):
    with freeze_time("2026-11-24 09:15:00"):
        body = start_connect(admin_api, account)
    assert body["expires_at"] == "2026-11-24T09:25:00Z"
    url = body["authorize_url"]
    assert url.startswith(
        "http://localhost:8000/api/v1/instagram/oauth/callback/?code=fake-ok&state=")
    state = url.rsplit("state=", 1)[1]
    assert len(state) >= 43
    assert cache.get(oauth_state_key(state)) == {
        "account_id": account.pk, "user_id": admin_user.pk, "provider": "fake"}


def test_fake_ok_connects_the_account(admin_api, account):
    """AC3: back on the Connection tab with success; status, identity, token and capabilities."""
    with freeze_time("2026-11-24 09:15:00"):
        response = follow_authorize(start_connect(admin_api, account)["authorize_url"])
    path, query = redirect_query(response)
    assert response["Location"] == (
        f"{PANEL}/settings/accounts/{account.pk}?tab=connection&connect=success")
    assert response["Cache-Control"] == "no-store"
    assert response["Referrer-Policy"] == "no-referrer"

    connection = connection_of(account)
    assert connection.status == "connected"
    assert connection.username == "greenhome.ir"
    assert connection.account_type == "BUSINESS"
    assert connection.ig_user_id == FakeProvider.ig_user_id(account.pk)
    assert connection.token_expires_at.isoformat().startswith("2027-01-23T09:15:00")
    assert connection.token_refreshed_at.isoformat().startswith("2026-11-24T09:15:00")
    assert connection.last_verified_at is not None
    assert connection.capabilities == {"publish_feed": True, "publish_reel": True,
                                       "publish_story": True, "insights": True}
    assert len(connection.scopes) == 3
    assert connection.last_error_code is None

    # AC8: the stored token is Fernet ciphertext of the fake token, never the plain value.
    assert connection.access_token_encrypted.startswith("gAAAAA")
    assert crypto.decrypt(connection.access_token_encrypted) == f"fake-token-{account.pk}-1"

    body = admin_api.get(connection_url(account)).json()
    assert body["status"] == "connected" and body["has_token"] is True
    assert "fake-token" not in str(body) and "access_token" not in str(body)


def test_connecting_never_changes_publishing_enabled(admin_api):
    account = make_account(publishing_enabled=False)
    follow_authorize(start_connect(admin_api, account)["authorize_url"])
    account.refresh_from_db()
    assert connection_of(account).status == "connected"
    assert account.publishing_enabled is False


@pytest.mark.parametrize("code, expected", [
    ("fake-denied", "oauth_denied"),
    ("fake-mismatch", "account_mismatch"),
    ("fake-personal", "not_professional"),
])
def test_failure_codes_store_nothing(admin_api, account, code, expected):
    """AC4."""
    FakeProvider.set_oauth_code(account, code)
    before = _snapshot(account)
    response = follow_authorize(start_connect(admin_api, account)["authorize_url"])
    path, query = redirect_query(response)
    assert path == f"/settings/accounts/{account.pk}"
    assert query == {"tab": "connection", "connect": "error", "code": expected}
    assert response["Cache-Control"] == "no-store"
    assert _snapshot(account) == before


def test_denied_url_carries_instagrams_decline_instead_of_a_code(admin_api, account):
    FakeProvider.set_oauth_code(account, "fake-denied")
    url = start_connect(admin_api, account)["authorize_url"]
    assert "error=access_denied" in url and "error_reason=user_denied" in url
    assert "code=" not in url


def test_used_state_is_refused(admin_api, account):
    """AC5: single use."""
    url = start_connect(admin_api, account)["authorize_url"]
    assert redirect_query(follow_authorize(url))[1]["connect"] == "success"
    before = _snapshot(account)
    response = follow_authorize(url)
    assert response["Location"] == STATE_INVALID
    assert _snapshot(account) == before


def test_expired_state_is_refused(admin_api, account):
    """AC5: older than 10 minutes."""
    with freeze_time("2026-11-24 09:00:00") as frozen:
        url = start_connect(admin_api, account)["authorize_url"]
        frozen.tick(timedelta(minutes=10, seconds=1))
        response = follow_authorize(url)
    assert response["Location"] == STATE_INVALID
    assert connection_of(account).status == "disconnected"


@pytest.mark.parametrize("params", [{}, {"state": "unknown", "code": "fake-ok"}])
def test_missing_or_unknown_state(params):
    response = callback(params)
    assert response.status_code == 302
    assert response["Location"] == STATE_INVALID
    assert response["Referrer-Policy"] == "no-referrer"


def test_provider_changed_after_start(admin_api, account):
    url = start_connect(admin_api, account)["authorize_url"]
    AccountConnection.objects.filter(account=account).update(provider="manual")
    path, query = redirect_query(follow_authorize(url))
    assert path == f"/settings/accounts/{account.pk}"
    assert query["code"] == "oauth_state_invalid"


def test_demoted_user_and_archived_account(admin_api, admin_user, account):
    url = start_connect(admin_api, account)["authorize_url"]
    admin_user.is_superuser = False
    admin_user.save()
    assert redirect_query(follow_authorize(url))[1]["code"] == "oauth_state_invalid"

    admin_user.is_superuser = True
    admin_user.save()
    url = start_connect(admin_api, account)["authorize_url"]
    account.status = "archived"
    account.save()
    assert redirect_query(follow_authorize(url))[1]["code"] == "oauth_state_invalid"
    assert connection_of(account).status == "disconnected"


def test_missing_or_rejected_code_is_exchange_failure(admin_api, account):
    url = start_connect(admin_api, account)["authorize_url"]
    state = url.rsplit("state=", 1)[1]
    assert redirect_query(callback({"state": state}))[1]["code"] == "oauth_exchange_failed"
    url = start_connect(admin_api, account)["authorize_url"]
    state = url.rsplit("state=", 1)[1]
    response = callback({"state": state, "code": "AQB-not-a-fake-code"})
    assert redirect_query(response)[1]["code"] == "oauth_exchange_failed"
    assert connection_of(account).has_token is False


def test_another_account_holds_the_same_instagram_user(admin_api, account):
    """AC6."""
    other = make_account(connected=True)
    AccountConnection.objects.filter(account=other).update(
        ig_user_id=FakeProvider.ig_user_id(account.pk))
    response = follow_authorize(start_connect(admin_api, account)["authorize_url"])
    assert redirect_query(response)[1]["code"] == "account_mismatch"
    assert connection_of(account).status == "disconnected"


def test_partial_permissions_still_connect(admin_api, account):
    """AC7: no insights permission: connected, `insights` false."""
    FakeProvider.set_oauth_code(account, "fake-no-insights")
    response = follow_authorize(start_connect(admin_api, account)["authorize_url"])
    assert redirect_query(response)[1]["connect"] == "success"
    body = admin_api.get(connection_url(account)).json()
    assert body["status"] == "connected"
    assert body["scopes"] == ["instagram_business_basic", "instagram_business_content_publish"]
    assert body["capabilities"] == {"publish_feed": True, "publish_reel": True,
                                    "publish_story": True, "insights": False}


@pytest.mark.parametrize("scenario, expected", [
    ("rate_limited", "rate_limited"),
    ({"name": "fail_n_times", "n": 1}, "provider_error"),
    ("token_invalid", "oauth_exchange_failed"),
])
def test_provider_errors_during_exchange(admin_api, account, scenario, expected):
    url = start_connect(admin_api, account)["authorize_url"]
    FakeProvider.script(account, [scenario])
    assert redirect_query(follow_authorize(url))[1]["code"] == expected
    assert connection_of(account).has_token is False


def test_permission_missing_on_verify(admin_api, account):
    url = start_connect(admin_api, account)["authorize_url"]
    with mock.patch.object(FakeProvider, "verify", side_effect=PermissionMissing()):
        response = follow_authorize(url)
    assert redirect_query(response)[1]["code"] == "permission_missing"
    assert connection_of(account).has_token is False


def test_missing_basic_scope_is_permission_missing(admin_api, account):
    url = start_connect(admin_api, account)["authorize_url"]
    result = VerifyResult(ig_user_id=FakeProvider.ig_user_id(account.pk),
                          username="greenhome.ir", account_type="BUSINESS",
                          scopes=["instagram_business_content_publish"])
    with mock.patch.object(FakeProvider, "verify", return_value=result):
        response = follow_authorize(url)
    assert redirect_query(response)[1]["code"] == "permission_missing"


def test_unexpected_exception_is_provider_error(admin_api, account):
    url = start_connect(admin_api, account)["authorize_url"]
    with mock.patch.object(FakeProvider, "verify", side_effect=KeyError("boom")):
        response = follow_authorize(url)
    assert redirect_query(response)[1]["code"] == "provider_error"
    assert connection_of(account).has_token is False


def test_connecting_again_replaces_the_token(admin_api):
    account = make_account(connected=True, publishing_enabled=True)
    AccountConnection.objects.filter(account=account).update(
        status="needs_attention", last_error_code="token_invalid")
    response = follow_authorize(start_connect(admin_api, account)["authorize_url"])
    assert redirect_query(response)[1]["connect"] == "success"
    connection = connection_of(account)
    account.refresh_from_db()
    assert connection.status == "connected" and connection.last_error_code is None
    assert crypto.decrypt(connection.access_token_encrypted) == f"fake-token-{account.pk}-1"
    assert account.publishing_enabled is True


def test_callback_logs_never_contain_code_or_token(admin_api, account, caplog):
    caplog.set_level("DEBUG")
    url = start_connect(admin_api, account)["authorize_url"]
    follow_authorize(url)
    FakeProvider.set_oauth_code(account, "fake-mismatch")
    follow_authorize(start_connect(admin_api, account)["authorize_url"])
    text = caplog.text
    assert "fake-token" not in text and "fake-ok" not in text and "fake-mismatch" not in text


def test_connect_errors(admin_api, operator_api, account):
    assert operator_api.post(connection_url(account, "connect/")).json()["error"]["code"] == (
        "permission_denied")
    AccountConnection.objects.filter(account=account).update(provider="manual")
    response = admin_api.post(connection_url(account, "connect/"))
    assert response.status_code == 409
    assert response.json()["error"]["details"]["reason"] == "manual_provider"
    AccountConnection.objects.filter(account=account).update(provider="fake")
    account.status = "archived"
    account.save()
    response = admin_api.post(connection_url(account, "connect/"))
    assert response.status_code == 409
    assert response.json()["error"]["details"]["reason"] == "account_archived"
    assert admin_api.post("/api/v1/accounts/99999/connection/connect/").status_code == 404


def test_connect_with_graph_api_is_provider_not_configured(admin_api, account, settings):
    """graph_api is reserved: no adapter yet, so connect is 503 with the missing settings."""
    settings.SOCIALHUB_META_APP_ID = "1234567890"
    settings.SOCIALHUB_META_APP_SECRET = ""
    settings.SOCIALHUB_IG_API_VERSION = ""
    AccountConnection.objects.filter(account=account).update(provider="graph_api")
    response = admin_api.post(connection_url(account, "connect/"))
    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "provider_not_configured"
    assert error["details"]["provider"] == "graph_api"
    assert error["details"]["missing"] == ["SOCIALHUB_META_APP_SECRET",
                                           "SOCIALHUB_IG_API_VERSION"]
    assert error["details"]["reason"] == "adapter_not_built"
    assert admin_api.get(connection_url(account)).json()["provider_configured"] is False
