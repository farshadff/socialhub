"""`account_session`: the only way to call Instagram for a brand account (E00-S04 rule 20)."""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from django.core.cache import cache

from apps.accounts.models import AccountConnection
from apps.core import crypto

from .providers.base import AccountBusy, InstagramProvider, TokenInvalid
from .providers.registry import get_provider

LOCK_TTL_SECONDS = 300
POLL_SECONDS = 0.05


def lock_key(account_id: int) -> str:
    return f"ig:lock:{account_id}"


@contextmanager
def account_lock(account_id: int, wait_seconds: float = 60) -> Iterator[None]:
    """Hold `ig:lock:{account_id}` (at most 300 s); `AccountBusy` after `wait_seconds`.

    The lock is a cache key set with `add` (atomic in Redis and in the local-memory cache) and
    released only by its holder.
    """
    key = lock_key(account_id)
    holder = uuid.uuid4().hex
    deadline = time.monotonic() + max(0.0, wait_seconds)
    while not cache.add(key, holder, LOCK_TTL_SECONDS):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AccountBusy()
        time.sleep(min(POLL_SECONDS, remaining))
    try:
        yield
    finally:
        if cache.get(key) == holder:
            cache.delete(key)


@contextmanager
def account_session(account, wait_seconds: float = 60
                    ) -> Iterator[tuple[InstagramProvider, str | None]]:
    """Lock the account, load its connection and yield `(provider, token)`.

    `manual` yields `(provider, None)`. A connection without a token, or with a token no key
    can decrypt (rule 18), raises `TokenInvalid` without calling Instagram.
    """
    account_id = int(getattr(account, "pk", account))
    with account_lock(account_id, wait_seconds):
        connection = AccountConnection.objects.get(account_id=account_id)
        provider = get_provider(connection.provider)
        if connection.provider == AccountConnection.Provider.MANUAL:
            yield provider, None
            return
        if not connection.access_token_encrypted:
            raise TokenInvalid("The connection holds no access token.")
        try:
            token = crypto.decrypt(connection.access_token_encrypted)
        except crypto.DecryptionError:
            raise TokenInvalid("The stored access token cannot be decrypted.") from None
        yield provider, token
