"""Account services (E00-S03)."""

from __future__ import annotations

from django.db import transaction

from .models import InstagramAccount


def create_account(**fields) -> InstagramAccount:
    """Create an account with its `BrandProfile` (rule 14 defaults) and its `AccountConnection`
    (`provider` from `SOCIALHUB_IG_DEFAULT_PROVIDER`, `status = disconnected`) in one transaction.

    `fields` are model fields; `handle` must already be normalised.
    """
    with transaction.atomic():
        return InstagramAccount.objects.create(**fields)
