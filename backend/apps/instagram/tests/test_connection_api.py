"""E00-S04 connection endpoints: GET, PATCH, DELETE, verify/ and refresh-token/."""

from datetime import timedelta

import pytest
from django.utils import timezone
from freezegun import freeze_time

from apps.accounts.models import AccountConnection
from apps.accounts.tests.factories import make_account
from apps.core.models import JobRun
from apps.instagram.services import REFRESH_KIND, VERIFY_KIND, start_connection_job

from .helpers import connection_of, connection_url

pytestmark = pytest.mark.django_db

EMPTY_CAPABILITIES = {"publish_feed": False, "publish_reel": False, "publish_story": False,
                      "insights": False}


def test_get_disconnected_shape(operator_api):
    account = make_account()
    response = operator_api.get(connection_url(account))
    assert response.status_code == 200
    body = response.json()
    updated_at = body.pop("updated_at")
    assert updated_at.endswith("Z")
    assert body == {
        "account": account.pk, "provider": "fake", "provider_configured": True,
        "allowed_providers": ["fake", "manual", "graph_api"], "status": "disconnected",
        "ig_user_id": None, "username": None, "account_type": None, "has_token": False,
        "token_expires_at": None, "token_refreshed_at": None, "scopes": [],
        "capabilities": EMPTY_CAPABILITIES, "last_verified_at": None,
        "last_error_code": None, "last_error_at": None, "active_job": None,
    }


def test_get_connected_with_active_job(operator_api):
    account = make_account(connected=True)
    job = JobRun.objects.create(kind=REFRESH_KIND, target_type="account_connection",
                                target_id=str(account.pk), account=account,
                                status="running", progress=40,
                                message="Renewing the access token")
    body = operator_api.get(connection_url(account)).json()
    assert body["status"] == "connected" and body["has_token"] is True
    assert body["username"] == account.handle and body["account_type"] == "BUSINESS"
    assert body["token_expires_at"].endswith("Z")
    assert body["active_job"] == {"id": str(job.pk), "kind": REFRESH_KIND, "status": "running",
                                  "progress": 40, "message": "Renewing the access token"}
    assert "access_token_encrypted" not in body


def test_get_unknown_account_is_404(operator_api):
    assert operator_api.get("/api/v1/accounts/99999/connection/").json()["error"]["code"] == (
        "not_found")


# --- PATCH ----------------------------------------------------------------------------------


def test_patch_manual_connects_at_once(admin_api):
    """AC14 (first half)."""
    account = make_account()
    response = admin_api.patch(connection_url(account), {"provider": "manual"}, format="json")
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "manual" and body["status"] == "connected"
    assert body["capabilities"] == EMPTY_CAPABILITIES and body["has_token"] is False
    account.refresh_from_db()
    assert account.publishing_enabled is False


def test_patch_manual_on_connected_account_is_invalid_transition(admin_api):
    """AC14 (second half)."""
    account = make_account(connected=True)
    response = admin_api.patch(connection_url(account), {"provider": "manual"}, format="json")
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "invalid_transition"
    assert error["details"] == {"status": "connected", "reason": "connection_not_disconnected"}


def test_patch_same_provider_changes_nothing(admin_api):
    account = make_account(connected=True)
    before = AccountConnection.objects.values().get(account=account)
    response = admin_api.patch(connection_url(account), {"provider": "fake"}, format="json")
    assert response.status_code == 200
    assert AccountConnection.objects.values().get(account=account) == before


def test_patch_fake_only_stores_the_choice(admin_api):
    account = make_account(connection={"provider": "manual"})
    response = admin_api.patch(connection_url(account), {"provider": "fake"}, format="json")
    assert response.json()["provider"] == "fake"
    assert response.json()["status"] == "disconnected"


def test_manual_default_provider_is_connected_by_choosing_it(admin_api):
    """A disconnected manual connection (hosted default) connects when manual is chosen."""
    account = make_account(connection={"provider": "manual"})
    response = admin_api.patch(connection_url(account), {"provider": "manual"}, format="json")
    assert response.json()["status"] == "connected"


@pytest.mark.parametrize("body, code", [
    ({}, "required"), ({"provider": ""}, "required"), ({"provider": "instagrapi"}, "invalid"),
    ({"provider": 3}, "invalid"),
])
def test_patch_validation(admin_api, body, code):
    account = make_account()
    response = admin_api.patch(connection_url(account), body, format="json")
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["fields"][0]["path"] == "provider" and error["fields"][0]["code"] == code


def test_patch_provider_outside_allowed_list(admin_api, settings):
    settings.SOCIALHUB_IG_ALLOWED_PROVIDERS = ["manual"]
    account = make_account()
    response = admin_api.patch(connection_url(account), {"provider": "fake"}, format="json")
    assert response.status_code == 400


def test_patch_archived_account(admin_api):
    account = make_account(status="archived")
    response = admin_api.patch(connection_url(account), {"provider": "manual"}, format="json")
    assert response.status_code == 409
    assert response.json()["error"]["details"]["reason"] == "account_archived"


def test_patch_graph_api_is_rejected_cleanly(admin_api):
    """graph_api is a reserved value until its adapter exists: 503, nothing stored."""
    account = make_account()
    response = admin_api.patch(connection_url(account), {"provider": "graph_api"}, format="json")
    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "provider_not_configured"
    assert error["details"]["provider"] == "graph_api"
    assert connection_of(account).provider == "fake"


# --- DELETE ---------------------------------------------------------------------------------


def test_disconnect_clears_everything_and_cancels_queued_job(admin_api):
    """AC15."""
    account = make_account(connected=True, publishing_enabled=True)
    from unittest import mock

    from apps.core import jobs

    with mock.patch.object(jobs, "_enqueue"):
        job = start_connection_job(VERIFY_KIND, account)
    response = admin_api.delete(connection_url(account))
    assert response.status_code == 204
    connection = connection_of(account)
    assert connection.status == "disconnected"
    assert connection.provider == "fake"  # the choice is kept
    assert connection.access_token_encrypted is None
    assert (connection.ig_user_id, connection.username, connection.account_type) == (None, "",
                                                                                     None)
    assert connection.token_expires_at is None and connection.token_refreshed_at is None
    assert connection.scopes == [] and connection.capabilities == EMPTY_CAPABILITIES
    assert connection.last_verified_at is None and connection.last_error_code is None
    account.refresh_from_db()
    assert account.publishing_enabled is False
    job.refresh_from_db()
    assert job.status == "cancelled"

    before = AccountConnection.objects.values().get(account=account)
    assert admin_api.delete(connection_url(account)).status_code == 204
    assert AccountConnection.objects.values().get(account=account) == before


def test_disconnect_manual(admin_api):
    account = make_account(connection={"provider": "manual", "status": "connected"})
    assert admin_api.delete(connection_url(account)).status_code == 204
    connection = connection_of(account)
    assert (connection.provider, connection.status) == ("manual", "disconnected")


# --- permissions (AC18) ---------------------------------------------------------------------


def test_operator_reads_and_verifies_but_cannot_change(operator_api):
    account = make_account(connected=True, publishing_enabled=True)
    assert operator_api.get(connection_url(account)).status_code == 200
    for method, suffix in (("patch", ""), ("delete", ""), ("post", "connect/"),
                           ("post", "refresh-token/")):
        response = getattr(operator_api, method)(connection_url(account, suffix),
                                                 {"provider": "manual"}, format="json")
        assert response.status_code == 403, (method, suffix)
        assert response.json()["error"]["code"] == "permission_denied"
    from unittest import mock

    from apps.core import jobs

    with mock.patch.object(jobs, "_enqueue"):
        response = operator_api.post(connection_url(account, "verify/"))
    assert response.status_code == 202
    assert connection_of(account).status == "connected"


def test_anonymous_is_refused(api_client):
    account = make_account()
    response = api_client.get(connection_url(account))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "authentication_required"


# --- verify/ and refresh-token/ ---------------------------------------------------------------


def test_verify_endpoint_returns_job(admin_api, admin_user, django_capture_on_commit_callbacks):
    account = make_account(connected=True, connection={
        "token_refreshed_at": timezone.now() - timedelta(days=8)})
    with django_capture_on_commit_callbacks(execute=False):
        response = admin_api.post(connection_url(account, "verify/"))
    assert response.status_code == 202
    job = response.json()["job"]
    assert job["kind"] == VERIFY_KIND and job["status"] == "queued"
    assert job["target_type"] == "account_connection" and job["target_id"] == str(account.pk)
    assert job["account"] == account.pk and job["created_by"]["id"] == admin_user.pk
    second = admin_api.post(connection_url(account, "refresh-token/"))
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "job_in_progress"
    assert second.json()["error"]["details"]["job"]["id"] == job["id"]


@pytest.mark.parametrize("suffix", ["verify/", "refresh-token/"])
def test_job_endpoint_guards(admin_api, suffix):
    disconnected = make_account()
    response = admin_api.post(connection_url(disconnected, suffix))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "instagram_not_connected"

    manual = make_account(connection={"provider": "manual", "status": "connected"})
    response = admin_api.post(connection_url(manual, suffix))
    assert response.json()["error"]["details"]["reason"] == "manual_provider"

    archived = make_account(connected=True, status="archived")
    response = admin_api.post(connection_url(archived, suffix))
    assert response.json()["error"]["details"]["reason"] == "account_archived"


def test_refresh_refused_when_needs_attention(admin_api):
    account = make_account(connected=True, connection={"status": "needs_attention"})
    response = admin_api.post(connection_url(account, "refresh-token/"))
    assert response.json()["error"]["code"] == "instagram_not_connected"


def test_refresh_refused_for_a_token_renewed_recently(admin_api):
    """AC16."""
    with freeze_time("2026-11-24 09:00:00"):
        account = make_account(connected=True, connection={
            "token_refreshed_at": timezone.now() - timedelta(hours=3)})
        response = admin_api.post(connection_url(account, "refresh-token/"))
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "invalid_transition"
    assert error["details"] == {"status": "connected", "reason": "token_refreshed_recently",
                                "retry_after": "2026-11-25T06:00:00Z"}
