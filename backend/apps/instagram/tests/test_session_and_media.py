"""E00-S04 `account_session` lock (rule 20) and `media.public_url` (rule 22)."""

import threading
import time

import pytest
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured

from apps.accounts.tests.factories import make_account
from apps.core.tests.test_storage import s3  # noqa: F401  (moto S3 fixture)
from apps.instagram import media
from apps.instagram.providers.base import AccountBusy, NotSupported, TokenInvalid
from apps.instagram.providers.fake import FakeProvider
from apps.instagram.providers.manual import ManualProvider
from apps.instagram.session import account_lock, account_session, lock_key


def test_two_holders_never_overlap():
    """AC19 (first half), on the lock itself: threads cannot share the test database."""
    active, overlaps, done = [], [], []

    def worker():
        with account_lock(7, wait_seconds=5):
            active.append(1)
            if len(active) > 1:
                overlaps.append(1)
            time.sleep(0.02)
            active.pop()
            done.append(1)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(done) == 4 and overlaps == []
    assert cache.get(lock_key(7)) is None


def test_busy_after_wait_seconds():
    """AC19 (second half)."""
    cache.add(lock_key(8), "someone-else", 300)
    started = time.monotonic()
    with pytest.raises(AccountBusy):
        with account_lock(8, wait_seconds=0.1):
            pass
    assert time.monotonic() - started < 1
    assert cache.get(lock_key(8)) == "someone-else"  # not released by the waiter
    cache.delete(lock_key(8))


@pytest.mark.django_db
def test_session_yields_provider_and_token_and_releases_on_error():
    account = make_account(connected=True)
    with pytest.raises(RuntimeError):
        with account_session(account) as (provider, token):
            assert isinstance(provider, FakeProvider)
            assert token == f"fake-token-{account.pk}-0"
            assert cache.get(lock_key(account.pk)) is not None
            raise RuntimeError("boom")
    assert cache.get(lock_key(account.pk)) is None


@pytest.mark.django_db
def test_session_without_token_raises_token_invalid_without_calling():
    account = make_account(connection={"status": "needs_attention"})
    with pytest.raises(TokenInvalid):
        with account_session(account):
            pass
    assert FakeProvider.calls(account) == {}


@pytest.mark.django_db
def test_manual_session_has_no_token_and_refuses_everything():
    account = make_account(connection={"provider": "manual", "status": "connected"})
    with account_session(account) as (provider, token):
        assert isinstance(provider, ManualProvider) and token is None
        with pytest.raises(NotSupported):
            provider.account_stats(token)
        with pytest.raises(NotSupported):
            provider.verify("anything")


@pytest.mark.django_db
def test_public_url_refuses_local_backend():
    with pytest.raises(ImproperlyConfigured):
        media.public_url(type("Asset", (), {"file": "accounts/1/2026/11/a.jpg"})())


def test_public_url_is_presigned_https(s3, settings):  # noqa: F811
    from django.core.files.base import ContentFile

    settings.SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS = 7200
    key = s3.save("accounts/3/2026/11/1-a.jpg", ContentFile(b"\xff\xd8\xff\xe0jpeg"))
    url = media.public_url(type("Asset", (), {"file": key})())
    assert url.startswith("https://") and "X-Amz-Expires=7200" in url


def test_system_status_block_hides_secrets(settings):
    from apps.instagram.status import instagram_status

    settings.SOCIALHUB_META_APP_SECRET = "app-secret-value"
    settings.SOCIALHUB_META_APP_ID = "1234567890"
    settings.SOCIALHUB_IG_API_VERSION = ""
    settings.SOCIALHUB_IG_HTTP_PROXY = "http://user:pass@proxy:3128"
    block = instagram_status()
    assert block["meta_app"] == {
        "configured": False, "missing": ["SOCIALHUB_IG_API_VERSION"], "app_id": "1234567890",
        "redirect_uri": "http://localhost:8000/api/v1/instagram/oauth/callback/"}
    assert block["http_proxy"] is True and block["encryption_key_configured"] is True
    assert "app-secret-value" not in str(block) and "pass@proxy" not in str(block)
