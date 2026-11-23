"""E00-S03-BE1: models, defaults, create service and JSON validators."""

import pytest
from django.core.exceptions import ValidationError
from django.test import override_settings

from apps.accounts.models import (
    AccountConnection,
    BrandProfile,
    InstagramAccount,
    normalize_handle,
)
from apps.accounts.services import create_account

from .factories import make_account

pytestmark = pytest.mark.django_db


def test_create_account_creates_brand_and_disconnected_connection():
    account = create_account(handle="greenhome.ir", display_name="Green Home")
    brand = BrandProfile.objects.get(account=account)
    connection = AccountConnection.objects.get(account=account)

    assert account.timezone == "Asia/Tehran"
    assert account.content_language == "fa"
    assert account.week_start_day == 5
    assert account.status == "active"
    assert account.publishing_enabled is False
    assert account.autopilot == {"selection": False, "brief": False, "script": False}
    assert account.posting_rules == {"min_gap_minutes": 120, "max_feed_per_day": 2,
                                     "max_stories_per_day": 5, "max_revisions": 2}

    assert brand.colors == {"primary": "#111111", "secondary": "#666666", "accent": "#1677FF",
                            "background": "#FFFFFF", "text": "#111111"}
    assert brand.fonts == {"heading": "vazirmatn", "body": "vazirmatn"}
    assert brand.handle_display == "@greenhome.ir"
    assert brand.ai_disclosure == "generated_only"
    assert brand.content_pillars == brand.default_hashtags == brand.banned_terms == []
    assert brand.cta_examples == []
    assert brand.tone_of_voice == brand.audience_summary == ""
    assert not brand.logo_light and not brand.logo_dark
    assert brand.complete is False

    assert connection.provider == "fake"
    assert connection.status == "disconnected"
    assert connection.capabilities == {"publish_feed": False, "publish_reel": False,
                                       "publish_story": False, "insights": False}
    assert connection.has_token is False


@override_settings(SOCIALHUB_IG_DEFAULT_PROVIDER="manual")
def test_connection_provider_comes_from_setting():
    account = create_account(handle="manualshop", display_name="Manual")
    assert account.connection.provider == "manual"
    assert account.connection.status == "disconnected"


def test_plain_objects_create_also_creates_related_rows():
    account = InstagramAccount.objects.create(handle="direct", display_name="Direct")
    assert account.brand.handle_display == "@direct"
    assert account.connection.status == "disconnected"


def test_archiving_forces_publishing_off():
    account = make_account(connected=True, publishing_enabled=True)
    account.status = InstagramAccount.Status.ARCHIVED
    account.save()
    account.refresh_from_db()
    assert account.publishing_enabled is False


@pytest.mark.parametrize("raw, expected", [
    ("@GreenHome.ir", "greenhome.ir"),
    ("  @green_home  ", "green_home"),
    ("PLAIN", "plain"),
    ("@ spaced", "spaced"),
])
def test_normalize_handle(raw, expected):
    assert normalize_handle(raw) == expected


@pytest.mark.parametrize("field, value", [
    ("autopilot", {"selection": False, "brief": False}),
    ("autopilot", {"selection": False, "brief": False, "script": False, "publish": True}),
    ("autopilot", {"selection": "yes", "brief": False, "script": False}),
    ("posting_rules", {"min_gap_minutes": 5, "max_feed_per_day": 2, "max_stories_per_day": 5,
                       "max_revisions": 2}),
    ("timezone", "Mars/Olympus"),
])
def test_account_json_validators(field, value):
    account = make_account()
    setattr(account, field, value)
    with pytest.raises(ValidationError) as exc:
        account.full_clean()
    assert field in exc.value.message_dict


@pytest.mark.parametrize("field, value", [
    ("colors", {"primary": "#111", "secondary": "#666666", "accent": "#1677FF",
                "background": "#FFFFFF", "text": "#111111"}),
    ("fonts", {"heading": "comic-sans", "body": "vazirmatn"}),
])
def test_brand_json_validators(field, value):
    brand = make_account().brand
    setattr(brand, field, value)
    with pytest.raises(ValidationError) as exc:
        brand.full_clean()
    assert field in exc.value.message_dict


def test_factory_connected_and_overrides():
    account = make_account(connected=True, brand={"tone_of_voice": "Warm."},
                           display_name="Shop")
    assert account.connection.status == "connected"
    assert account.connection.username == account.handle
    assert account.connection.can_publish is True
    assert account.brand.tone_of_voice == "Warm."
    assert account.display_name == "Shop"
    other = make_account(connection={"provider": "manual", "status": "connected"})
    assert other.connection.provider == "manual"
