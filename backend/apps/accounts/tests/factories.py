"""Account factory shared by every epic's tests (E00-S03 test notes).

    from apps.accounts.tests.factories import make_account

    account = make_account()                                  # disconnected, fake provider
    account = make_account(connected=True, publishing_enabled=True)
    # connected=True with the fake provider also stores an encrypted fake token
    # (`fake-token-{id}-0`) and the fake's `ig_user_id`, so E00-S04 verify/refresh work on it.
    account = make_account(handle="greenhome.ir", brand={"tone_of_voice": "Warm."},
                           connection={"provider": "manual"})

Keyword overrides go to `InstagramAccount` fields, except `brand` and `connection`, which are
dicts of `BrandProfile` and `AccountConnection` fields. Saved directly, bypassing the API rules
(for example publishing may be on for a disconnected account if a test asks for it).
"""

from __future__ import annotations

import itertools
from datetime import timedelta

from django.utils import timezone

from apps.accounts.models import AccountConnection, InstagramAccount
from apps.accounts.services import create_account
from apps.core import crypto

_seq = itertools.count(1)

CONNECTED_SCOPES = [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
]


def make_account(connected: bool = False, **overrides) -> InstagramAccount:
    brand_fields = overrides.pop("brand", None) or {}
    connection_fields = overrides.pop("connection", None) or {}
    n = next(_seq)
    fields = {"handle": f"account{n}", "display_name": f"Account {n}"}
    fields.update(overrides)
    account = create_account(**fields)

    if connected:
        from apps.instagram.providers.fake import FakeProvider

        now = timezone.now()
        provider = connection_fields.get("provider", AccountConnection.Provider.FAKE)
        connection_fields = {
            "provider": AccountConnection.Provider.FAKE,
            "status": AccountConnection.Status.CONNECTED,
            "ig_user_id": FakeProvider.ig_user_id(account.pk),
            "access_token_encrypted": (
                crypto.encrypt(FakeProvider.token_for(account.pk))
                if provider == AccountConnection.Provider.FAKE else None),
            "username": account.handle,
            "account_type": AccountConnection.AccountType.BUSINESS,
            "token_expires_at": now + timedelta(days=60),
            "token_refreshed_at": now,
            "scopes": list(CONNECTED_SCOPES),
            "capabilities": {"publish_feed": True, "publish_reel": True,
                             "publish_story": True, "insights": True},
            "last_verified_at": now,
            **connection_fields,
        }
    if connection_fields:
        AccountConnection.objects.filter(account=account).update(**connection_fields)
    if brand_fields:
        brand = account.brand
        for name, value in brand_fields.items():
            setattr(brand, name, value)
        brand.save()
    return InstagramAccount.objects.select_related("brand", "connection").get(pk=account.pk)
