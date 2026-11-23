"""E00-S04 token lifecycle: verify and refresh jobs, daily schedules, status transitions."""

from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone
from freezegun import freeze_time

from apps.accounts.models import AccountConnection
from apps.accounts.tests.factories import make_account
from apps.core import crypto, jobs
from apps.core.models import JobRun
from apps.instagram import services, tasks
from apps.instagram.providers.base import PermissionMissing, TokenInvalid, TransientError
from apps.instagram.providers.fake import FakeProvider
from apps.instagram.session import account_session

from .helpers import connection_of

pytestmark = pytest.mark.django_db

NOW = "2026-11-24 02:15:00"


def run_job(kind, account, capture, **kwargs):
    with capture(execute=True):
        job = services.start_connection_job(kind, account, **kwargs)
    job.refresh_from_db()
    return job


def aged(days, publishing_enabled=False, **connection):
    """A connected fake account whose token was obtained `days` ago."""
    now = timezone.now()
    return make_account(connected=True, publishing_enabled=publishing_enabled, connection={
        "token_refreshed_at": now - timedelta(days=days),
        "token_expires_at": now - timedelta(days=days) + timedelta(days=60),
        "last_verified_at": now - timedelta(days=1),
        **connection,
    })


# --- verify -----------------------------------------------------------------------------------


def test_verify_job_succeeds(django_capture_on_commit_callbacks):
    account = aged(2)
    job = run_job(services.VERIFY_KIND, account, django_capture_on_commit_callbacks)
    assert job.status == "succeeded"
    assert job.result == {"connection_status": "connected"}
    assert job.progress == 100
    assert FakeProvider.calls(account) == {"verify": 1}
    assert connection_of(account).last_verified_at > timezone.now() - timedelta(seconds=5)


def test_recently_verified_connection_is_not_called_again(django_capture_on_commit_callbacks):
    account = make_account(connected=True)  # last_verified_at = now
    job = run_job(services.VERIFY_KIND, account, django_capture_on_commit_callbacks)
    assert job.status == "succeeded"
    assert FakeProvider.calls(account) == {}


def test_daily_verification_finds_revoked_token(django_capture_on_commit_callbacks):
    """AC12."""
    account = aged(2, publishing_enabled=True)
    FakeProvider.script(account, ["token_invalid"])
    with django_capture_on_commit_callbacks(execute=True), \
            mock.patch("apps.instagram.services.random.randint", return_value=0):
        assert tasks.verify_all.apply().get() == 1
    connection = connection_of(account)
    assert connection.status == "needs_attention"
    assert connection.last_error_code == "token_invalid"
    account.refresh_from_db()
    assert account.publishing_enabled is True
    job = JobRun.objects.get(kind=services.VERIFY_KIND)
    assert job.status == "failed" and job.error_code == "token_invalid"
    assert job.result == {"connection_status": "needs_attention"}
    assert job.error_detail == "Instagram no longer accepts this account's access token."
    assert job.created_by is None
    assert "fake-token" not in str(JobRun.objects.values().get(pk=job.pk))


def test_verify_all_fans_out_with_a_random_delay():
    targets = [aged(2), aged(2, status="needs_attention", last_error_code="token_invalid")]
    make_account(connection={"provider": "manual", "status": "connected"})
    make_account(connected=True, status="archived")
    make_account()  # no token
    with mock.patch.object(jobs, "_enqueue") as enqueue, \
            mock.patch("apps.instagram.services.random.randint", return_value=1234):
        from django.test import TestCase

        with TestCase.captureOnCommitCallbacks(execute=True):
            assert services.schedule_verifications() == 2
    assert enqueue.call_count == 2
    assert all(call.args[2] == 1234 for call in enqueue.call_args_list)
    assert sorted(JobRun.objects.values_list("target_id", flat=True)) == sorted(
        str(a.pk) for a in targets)


def test_countdown_reaches_celery():
    account = aged(2)
    with mock.patch.object(tasks.verify_connection, "apply_async") as apply_async:
        from django.test import TestCase

        with TestCase.captureOnCommitCallbacks(execute=True):
            job = services.start_connection_job(services.VERIFY_KIND, account, countdown=900)
    assert apply_async.call_args.kwargs["countdown"] == 900
    assert apply_async.call_args.kwargs["task_id"] == str(job.pk)


@pytest.mark.parametrize("profile, problem", [
    ({"username": "renamed.shop", "account_type": "BUSINESS"}, "account_mismatch"),
    ({"username": None, "account_type": "PERSONAL"}, "not_professional"),
    ({"username": None, "account_type": "BUSINESS",
      "scopes": ["instagram_business_content_publish"]}, "permission_missing"),
])
def test_verify_problems_need_attention(django_capture_on_commit_callbacks, profile, problem):
    account = aged(2)
    state = FakeProvider.state(account)
    from apps.instagram.providers import fake

    state["profile"] = {"scopes": None, **profile}
    fake._save(account.pk, state)
    job = run_job(services.VERIFY_KIND, account, django_capture_on_commit_callbacks)
    assert job.status == "failed" and job.error_code == problem
    assert job.result == {"connection_status": "needs_attention"}
    connection = connection_of(account)
    assert connection.status == "needs_attention" and connection.last_error_code == problem
    assert connection.account_type == "BUSINESS"


def test_changed_instagram_user_is_account_mismatch(django_capture_on_commit_callbacks):
    account = aged(2, ig_user_id="17841400000000001")
    job = run_job(services.VERIFY_KIND, account, django_capture_on_commit_callbacks)
    assert job.error_code == "account_mismatch"
    assert connection_of(account).ig_user_id == "17841400000000001"


def test_needs_attention_recovers_on_verify(django_capture_on_commit_callbacks):
    account = aged(2, status="needs_attention", last_error_code="permission_missing")
    job = run_job(services.VERIFY_KIND, account, django_capture_on_commit_callbacks)
    assert job.result == {"connection_status": "connected"}
    connection = connection_of(account)
    assert connection.status == "connected" and connection.last_error_code is None


def test_needs_attention_recovers_to_expiring_near_expiry(django_capture_on_commit_callbacks):
    account = aged(55, status="needs_attention", last_error_code="permission_missing")
    run_job(services.VERIFY_KIND, account, django_capture_on_commit_callbacks)
    assert connection_of(account).status == "expiring"


def test_expiring_stays_expiring_after_verify(django_capture_on_commit_callbacks):
    account = aged(55, status="expiring", last_error_code="rate_limited")
    run_job(services.VERIFY_KIND, account, django_capture_on_commit_callbacks)
    connection = connection_of(account)
    assert connection.status == "expiring" and connection.last_error_code == "rate_limited"


def test_verify_transient_error_retries_then_fails(django_capture_on_commit_callbacks):
    account = aged(2)
    FakeProvider.script(account, [{"name": "fail_n_times", "n": 5}])
    job = run_job(services.VERIFY_KIND, account, django_capture_on_commit_callbacks)
    assert job.status == "running" and job.message == "Retrying (1 of 3)"
    tasks.verify_connection.apply(args=[str(job.pk)], retries=3)
    job.refresh_from_db()
    assert job.status == "failed" and job.error_code == "provider_error"
    assert job.result == {"connection_status": "connected"}
    assert connection_of(account).status == "connected"


def test_verify_retry_succeeds(django_capture_on_commit_callbacks):
    account = aged(2)
    FakeProvider.script(account, ["rate_limited"])
    job = run_job(services.VERIFY_KIND, account, django_capture_on_commit_callbacks)
    assert job.status == "running"
    tasks.verify_connection.apply(args=[str(job.pk)], retries=1)
    job.refresh_from_db()
    assert job.status == "succeeded"


def test_disconnect_wins_over_a_running_verify(django_capture_on_commit_callbacks):
    account = aged(2, publishing_enabled=True)
    original = FakeProvider.verify

    def verify_then_disconnect(self, token):
        result = original(self, token)
        services.disconnect(account)
        return result

    with mock.patch.object(FakeProvider, "verify", verify_then_disconnect):
        job = run_job(services.VERIFY_KIND, account, django_capture_on_commit_callbacks)
    assert job.status == "succeeded" and job.result == {"connection_status": "disconnected"}
    connection = connection_of(account)
    assert connection.status == "disconnected" and connection.username == ""


# --- report_connection_error (rule 21) --------------------------------------------------------


def test_permission_missing_elsewhere_reverifies(django_capture_on_commit_callbacks):
    """AC13."""
    account = aged(2)
    FakeProvider.script(account, ["permission_missing"])
    with pytest.raises(PermissionMissing) as caught:
        with account_session(account) as (provider, token):
            provider.account_stats(token)
    with django_capture_on_commit_callbacks(execute=True):
        services.report_connection_error(account, caught.value)
    job = JobRun.objects.get(kind=services.VERIFY_KIND)
    assert job.status == "succeeded" and job.created_by is None
    connection = connection_of(account)
    assert connection.status == "connected"
    assert connection.capabilities["insights"] is False
    assert connection.capabilities["publish_feed"] is True
    assert "instagram_business_manage_insights" not in connection.scopes


def test_report_sets_needs_attention_only_for_token_and_permission_errors():
    account = aged(2)
    services.report_connection_error(account, TransientError())
    assert connection_of(account).status == "connected"
    services.report_connection_error(account, TokenInvalid())
    connection = connection_of(account)
    assert connection.status == "needs_attention" and connection.last_error_code == "token_invalid"
    assert connection.last_error_at is not None


def test_report_on_disconnected_changes_nothing():
    account = make_account()
    before = AccountConnection.objects.values().get(account=account)
    services.report_connection_error(account, TokenInvalid())
    assert AccountConnection.objects.values().get(account=account) == before


def test_permission_missing_skips_verify_while_a_connection_job_is_active():
    account = aged(2)
    with mock.patch.object(jobs, "_enqueue"):
        active = services.start_connection_job(services.REFRESH_KIND, account)
        services.report_connection_error(account, PermissionMissing())
    assert list(JobRun.objects.values_list("pk", flat=True)) == [active.pk]
    assert connection_of(account).last_error_code == "permission_missing"


# --- refresh (rules 30-32) ------------------------------------------------------------------


def test_daily_refresh_selects_by_age(django_capture_on_commit_callbacks):
    """AC10."""
    with freeze_time(NOW):
        old = aged(8)
        recent = aged(3)
        with django_capture_on_commit_callbacks(execute=True):
            assert tasks.refresh_tokens.apply().get() == 1
        job = JobRun.objects.get()
        assert job.target_id == str(old.pk) and job.kind == services.REFRESH_KIND
        assert job.status == "succeeded"
        connection = connection_of(old)
        assert connection.token_expires_at == timezone.now() + timedelta(days=60)
        assert connection.token_refreshed_at == timezone.now()
        assert job.result == {"connection_status": "connected",
                              "token_expires_at": "2027-01-23T02:15:00Z"}
        assert crypto.decrypt(connection.access_token_encrypted) == f"fake-token-{old.pk}-1"
        assert FakeProvider.calls(recent) == {}
        # Safe to run twice: the refreshed token is not due any more.
        with django_capture_on_commit_callbacks(execute=True):
            assert tasks.refresh_tokens.apply().get() == 0


def test_refresh_failure_near_expiry_becomes_expiring_then_recovers(
        django_capture_on_commit_callbacks):
    """AC11 (first half)."""
    with freeze_time(NOW):
        account = aged(54)  # expires in 6 days
        FakeProvider.script(account, ["rate_limited"])
        job = run_job(services.REFRESH_KIND, account, django_capture_on_commit_callbacks)
        assert job.status == "failed" and job.error_code == "rate_limited"
        assert job.result["connection_status"] == "expiring"
        connection = connection_of(account)
        assert connection.status == "expiring" and connection.last_error_code == "rate_limited"

        job = run_job(services.REFRESH_KIND, account, django_capture_on_commit_callbacks)
        assert job.status == "succeeded"
        connection = connection_of(account)
        assert connection.status == "connected" and connection.last_error_code is None
        assert connection.token_expires_at == timezone.now() + timedelta(days=60)


def test_refresh_failure_far_from_expiry_keeps_connected(django_capture_on_commit_callbacks):
    account = aged(10)
    FakeProvider.script(account, [{"name": "fail_n_times", "n": 1}])
    job = run_job(services.REFRESH_KIND, account, django_capture_on_commit_callbacks)
    assert job.error_code == "provider_error"
    connection = connection_of(account)
    assert connection.status == "connected" and connection.last_error_code == "provider_error"


def test_expired_token_needs_attention_without_a_call(django_capture_on_commit_callbacks):
    """AC11 (second half)."""
    account = aged(61)
    with django_capture_on_commit_callbacks(execute=True):
        assert services.schedule_refreshes() == 0
    connection = connection_of(account)
    assert connection.status == "needs_attention" and connection.last_error_code == "token_invalid"
    assert FakeProvider.calls(account) == {}
    assert not JobRun.objects.exists()


def test_refresh_token_invalid_needs_attention(django_capture_on_commit_callbacks):
    account = aged(10)
    FakeProvider.script(account, ["token_invalid"])
    job = run_job(services.REFRESH_KIND, account, django_capture_on_commit_callbacks)
    assert job.error_code == "token_invalid"
    assert job.result["connection_status"] == "needs_attention"
    assert connection_of(account).status == "needs_attention"


def test_daily_refresh_skips_manual_archived_tokenless_and_needs_attention():
    make_account(connection={"provider": "manual", "status": "connected"})
    archived = aged(10)
    archived.status = "archived"
    archived.save()
    aged(10, status="needs_attention")
    aged(10, access_token_encrypted=None)
    with mock.patch.object(jobs, "_enqueue"):
        assert services.schedule_refreshes() == 0
    assert not JobRun.objects.exists()


def test_undecryptable_token_is_token_invalid(django_capture_on_commit_callbacks):
    account = aged(10, access_token_encrypted="gAAAAA-not-decryptable")
    job = run_job(services.REFRESH_KIND, account, django_capture_on_commit_callbacks)
    assert job.error_code == "token_invalid"
    assert connection_of(account).status == "needs_attention"


# --- capabilities ---------------------------------------------------------------------------


def test_capabilities(settings):
    all_scopes = ["instagram_business_basic", "instagram_business_content_publish",
                  "instagram_business_manage_insights"]
    assert services.compute_capabilities("fake", all_scopes, "MEDIA_CREATOR") == {
        "publish_feed": True, "publish_reel": True, "publish_story": True, "insights": True}
    assert services.compute_capabilities("fake", all_scopes, "PERSONAL")["publish_feed"] is False
    assert not any(services.compute_capabilities("manual", all_scopes, "BUSINESS").values())
    settings.SOCIALHUB_IG_CAPABILITY_OVERRIDES = {"fake": {"publish_story": False,
                                                           "insights": True}}
    capabilities = services.compute_capabilities("fake", all_scopes[:2], "BUSINESS")
    assert capabilities["publish_story"] is False and capabilities["publish_reel"] is True
    assert capabilities["insights"] is False  # an override never grants a capability
