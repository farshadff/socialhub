"""E00-S04 provider contract: the fake implements the whole interface; manual and graph_api."""

from datetime import datetime, timedelta, timezone

import pytest
from django.core.cache import cache
from freezegun import freeze_time

from apps.instagram.providers.base import (
    AccountStats,
    AmbiguousResult,
    ContainerSpec,
    InsightsResult,
    InstagramProvider,
    MediaRejected,
    NotFound,
    NotSupported,
    PermissionMissing,
    ProviderNotConfigured,
    Quota,
    QuotaExceeded,
    RateLimited,
    RemoteMedia,
    TokenGrant,
    TokenInvalid,
    TransientError,
)
from apps.instagram.providers.fake import FakeProvider
from apps.instagram.providers.manual import ManualProvider
from apps.instagram.providers.registry import get_provider

pytestmark = pytest.mark.django_db  # `verify` reads the account's handle

ACCOUNT = 41
REDIRECT = "http://localhost:8000/api/v1/instagram/oauth/callback/"
T0 = "2026-11-24 09:00:00"


@pytest.fixture
def fake():
    return get_provider("fake")


@pytest.fixture
def token(fake):
    with freeze_time("2026-11-20 09:00:00"):
        return fake.exchange_code(code="fake-ok", redirect_uri=REDIRECT,
                                  account_id=ACCOUNT).access_token


def feed(caption="Hello"):
    return ContainerSpec(kind="feed_image", media_url="https://cdn.example/a.jpg", caption=caption)


def test_providers_implement_the_interface():
    assert isinstance(get_provider("fake"), InstagramProvider)
    assert isinstance(get_provider("manual"), InstagramProvider)
    assert get_provider("fake") is get_provider("fake")


def test_graph_api_is_reserved_and_not_configured():
    with pytest.raises(ProviderNotConfigured) as caught:
        get_provider("graph_api")
    assert caught.value.provider == "graph_api"
    assert caught.value.reason == "adapter_not_built"
    with pytest.raises(ProviderNotConfigured):
        get_provider("instagrapi")


def test_manual_raises_not_supported():
    manual = ManualProvider()
    for method in ("publishing_quota", "account_stats", "list_active_stories"):
        with pytest.raises(NotSupported):
            getattr(manual, method)(None)


def test_exchange_verify_and_token_shape(fake):
    with freeze_time(T0):
        grant = fake.exchange_code(code="fake-ok", redirect_uri=REDIRECT, account_id=ACCOUNT)
        assert isinstance(grant, TokenGrant)
        assert grant.access_token == f"fake-token-{ACCOUNT}-1"
        assert grant.expires_at == datetime(2027, 1, 23, 9, tzinfo=timezone.utc)
        assert "fake-token" not in repr(grant)
        result = fake.verify(grant.access_token)
    assert result.username == f"account{ACCOUNT}"  # no such account row: a stand-in name
    assert result.account_type == "BUSINESS" and len(result.scopes) == 3
    assert result.ig_user_id == FakeProvider.ig_user_id(ACCOUNT) == grant.user_id


def test_unknown_code_and_malformed_token_are_token_invalid(fake):
    with pytest.raises(TokenInvalid):
        fake.exchange_code(code="AQBx", redirect_uri=REDIRECT, account_id=ACCOUNT)
    with pytest.raises(TokenInvalid):
        fake.verify("not-a-fake-token")


def test_tokens_expire_after_60_days_and_refresh_like_real_ones(fake, token):
    with freeze_time("2026-11-20 20:00:00"), pytest.raises(TransientError):
        fake.refresh_token(token)  # younger than 24 hours
    with freeze_time("2026-11-27 09:00:00"):
        grant = fake.refresh_token(token)
        assert grant.access_token == f"fake-token-{ACCOUNT}-2"
        assert grant.expires_at == datetime(2027, 1, 26, 9, tzinfo=timezone.utc)
    with freeze_time("2027-01-20 09:00:01"), pytest.raises(TokenInvalid):
        fake.verify(token)


@pytest.mark.parametrize("scenario, error", [
    ("token_invalid", TokenInvalid), ("permission_missing", PermissionMissing),
    ("rate_limited", RateLimited),
])
def test_one_shot_scenarios(fake, token, scenario, error):
    FakeProvider.script(ACCOUNT, [scenario])
    with pytest.raises(error) as caught:
        fake.account_stats(token)
    if scenario == "rate_limited":
        assert caught.value.retry_after_seconds == 60
    assert isinstance(fake.account_stats(token), AccountStats)  # consumed
    if scenario == "permission_missing":
        assert "instagram_business_manage_insights" not in fake.verify(token).scopes
    assert FakeProvider.calls(ACCOUNT)["account_stats"] == 2


def test_fail_n_times(fake, token):
    FakeProvider.script(ACCOUNT, [{"name": "fail_n_times", "n": 2}])
    for _ in range(2):
        with pytest.raises(TransientError):
            fake.publishing_quota(token)
    assert fake.publishing_quota(token).usage == 0


def test_unknown_scenario_is_refused():
    with pytest.raises(ValueError):
        FakeProvider.script(ACCOUNT, ["explode"])


def test_publish_feed_image_exactly_once(fake, token):
    with freeze_time(T0):
        container = fake.create_container(token, feed("Caption #one"))
        assert fake.container_status(token, container).status_code == "FINISHED"
        media_id = fake.publish_container(token, container)
        assert fake.container_status(token, container).status_code == "PUBLISHED"
        with pytest.raises(MediaRejected):
            fake.publish_container(token, container)
        media = fake.get_media(token, media_id)
        assert isinstance(media, RemoteMedia)
        assert (media.product_type, media.media_kind, media.caption) == ("feed", "image",
                                                                         "Caption #one")
        assert media.permalink == f"https://www.instagram.com/p/{media.shortcode}/"
        listed = fake.list_recent_media(token, since=datetime(2026, 11, 24, tzinfo=timezone.utc))
        assert [m.id for m in listed] == [media_id]
        quota = fake.publishing_quota(token)
        assert isinstance(quota, Quota) and quota.usage == 1 and quota.total == 100
    assert FakeProvider.calls(ACCOUNT)["publish_container"] == 2
    assert len(FakeProvider.state(ACCOUNT)["media"]) == 1


def test_stories_and_reels(fake, token):
    with freeze_time(T0) as frozen:
        story = fake.create_container(token, ContainerSpec(
            kind="story_video", media_url="https://cdn.example/s.mp4", caption="ignored"))
        story_id = fake.publish_container(token, story)
        reel = fake.publish_container(token, fake.create_container(token, ContainerSpec(
            kind="reel", media_url="https://cdn.example/r.mp4", caption="Reel",
            cover_url="https://cdn.example/c.jpg")))
        stories = fake.list_active_stories(token)
        assert [s.id for s in stories] == [story_id] and stories[0].caption is None
        assert fake.get_media(token, reel).product_type == "reels"
        frozen.tick(timedelta(hours=24))
        assert fake.list_active_stories(token) == []


def test_quota_exceeded(fake, token):
    FakeProvider.script(ACCOUNT, ["quota_exceeded"])
    assert fake.publishing_quota(token).usage == 100
    container = fake.create_container(token, feed())
    with pytest.raises(QuotaExceeded):
        fake.publish_container(token, container)


def test_media_rejected_and_expired_containers(fake, token):
    FakeProvider.script(ACCOUNT, ["media_rejected"])
    container = fake.create_container(token, feed())
    assert fake.container_status(token, container).status_code == "ERROR"
    with pytest.raises(MediaRejected):
        fake.publish_container(token, container)
    FakeProvider.script(ACCOUNT, ["container_expired"])
    assert fake.container_status(token, fake.create_container(token, feed())).status_code == (
        "EXPIRED")
    FakeProvider.script(ACCOUNT, [])
    with freeze_time(T0) as frozen:
        container = fake.create_container(token, feed())
        frozen.tick(timedelta(hours=24))
        assert fake.container_status(token, container).status_code == "EXPIRED"
    with pytest.raises(NotFound):
        fake.container_status(token, "fake-container-0-0")


def test_container_slow(fake, token):
    FakeProvider.script(ACCOUNT, [{"name": "container_slow", "delay_seconds": 30}])
    with freeze_time(T0) as frozen:
        container = fake.create_container(token, feed())
        assert fake.container_status(token, container).status_code == "IN_PROGRESS"
        with pytest.raises(TransientError):
            fake.publish_container(token, container)
        frozen.tick(timedelta(seconds=30))
        assert fake.container_status(token, container).status_code == "FINISHED"


def test_timeout_after_and_before_publish(fake, token):
    FakeProvider.script(ACCOUNT, ["timeout_after_publish"])
    container = fake.create_container(token, feed())
    with pytest.raises(AmbiguousResult):
        fake.publish_container(token, container)
    assert fake.container_status(token, container).status_code == "PUBLISHED"
    assert len(FakeProvider.state(ACCOUNT)["media"]) == 1

    FakeProvider.script(ACCOUNT, ["timeout_before_publish"])
    container = fake.create_container(token, feed())
    with pytest.raises(AmbiguousResult):
        fake.publish_container(token, container)
    assert fake.container_status(token, container).status_code == "FINISHED"
    assert len(FakeProvider.state(ACCOUNT)["media"]) == 1
    fake.publish_container(token, container)  # consumed: the retry posts once
    assert len(FakeProvider.state(ACCOUNT)["media"]) == 2


def test_story_timeout_only_applies_to_stories(fake, token):
    FakeProvider.script(ACCOUNT, ["story_timeout_after_publish"])
    fake.publish_container(token, fake.create_container(token, feed()))
    story = fake.create_container(token, ContainerSpec(kind="story_image",
                                                       media_url="https://cdn.example/s.jpg"))
    with pytest.raises(AmbiguousResult):
        fake.publish_container(token, story)
    assert fake.container_status(token, story).status_code == "PUBLISHED"


def test_appears_late(fake, token):
    FakeProvider.script(ACCOUNT, [{"name": "appears_late", "delay_seconds": 120}])
    with freeze_time(T0) as frozen:
        fake.publish_container(token, fake.create_container(token, feed()))
        since = datetime(2026, 11, 24, tzinfo=timezone.utc)
        assert fake.list_recent_media(token, since=since) == []
        frozen.tick(timedelta(seconds=120))
        assert len(fake.list_recent_media(token, since=since)) == 1


def test_values_for_insights_and_stats(fake, token):
    media_id = fake.publish_container(token, fake.create_container(token, feed()))
    result = fake.media_insights(token, media_id, "feed_post")
    assert isinstance(result, InsightsResult) and result.metrics["reach"] == 1200
    FakeProvider.script(ACCOUNT, [{"name": "values", "insights": {"reach": 7},
                                   "account_stats": {"followers": 5}}])
    assert fake.media_insights(token, media_id, "feed_post").metrics["reach"] == 7
    assert fake.account_stats(token).followers == 5
    with pytest.raises(NotFound):
        fake.media_insights(token, "fake-media-0-0", "reel")


def test_testing_hooks_keep_state_in_the_cache(fake, settings):
    settings.SOCIALHUB_TESTING_HOOKS = True
    try:
        FakeProvider.set_oauth_code(ACCOUNT, "fake-personal")
        assert cache.get(f"fake:ig:{ACCOUNT}") is not None
        url = fake.authorize_url(state="s", redirect_uri=REDIRECT, account_id=ACCOUNT)
        assert "code=fake-personal" in url
    finally:
        FakeProvider.reset(ACCOUNT)
        settings.SOCIALHUB_TESTING_HOOKS = False
    assert cache.get(f"fake:ig:{ACCOUNT}") is None
