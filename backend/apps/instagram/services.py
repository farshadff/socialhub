"""Connection lifecycle (E00-S04 rules 16, 21, 23-38).

Every status change of `AccountConnection` goes through this module, under a row lock:
choosing a provider, the OAuth callback, verify and refresh outcomes, the daily schedules,
`report_connection_error` and disconnect.
"""

from __future__ import annotations

import logging
import random
import secrets
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import AccountConnection, InstagramAccount, default_capabilities
from apps.core import clock, crypto
from apps.core.errors import InvalidTransition, JobInProgress
from apps.core.jobs import active_job_for, cancel_queued_job, start_job
from apps.core.models import JobRun

from .providers.base import (
    CAPABILITY_KEYS,
    PROFESSIONAL_ACCOUNT_TYPES,
    SCOPE_BASIC,
    SCOPE_INSIGHTS,
    SCOPE_PUBLISH,
    AccountBusy,
    InstagramError,
    PermissionMissing,
    RateLimited,
    TokenGrant,
    TokenInvalid,
    VerifyResult,
)
from .providers.registry import ensure_configured, get_provider, provider_configured

logger = logging.getLogger(__name__)

Status = AccountConnection.Status
Provider = AccountConnection.Provider

VERIFY_KIND = "instagram.verify"
REFRESH_KIND = "instagram.refresh_token"
CONNECTION_KINDS = (VERIFY_KIND, REFRESH_KIND)
TARGET_TYPE = "account_connection"

OAUTH_STATE_TTL_SECONDS = 600
EXPIRING_WINDOW = timedelta(days=7)
REFRESH_MIN_AGE = timedelta(hours=24)
VERIFY_FRESH_SECONDS = 60
DAILY_REFRESH_LIMIT = 500
VERIFY_SPREAD_SECONDS = 30 * 60

# Safe one-line texts for job `error_detail` (rule 40).
ERROR_DETAILS = {
    "token_invalid": "Instagram no longer accepts this account's access token.",
    "permission_missing": "A permission Social Hub needs is missing on Instagram.",
    "account_mismatch": "The connected Instagram account no longer matches the handle.",
    "not_professional": "The Instagram account is not a Business or Creator account.",
    "rate_limited": "Instagram asked us to slow down.",
    "provider_error": "Instagram didn't respond as expected.",
    "provider_not_configured": "The Instagram provider is not configured on the server.",
}


def oauth_state_key(state: str) -> str:
    return f"ig:oauth:{state}"


def job_error_code(error: BaseException) -> str:
    """The connection job `error_code` for a provider error (rule 40)."""
    if isinstance(error, TokenInvalid):
        return "token_invalid"
    if isinstance(error, PermissionMissing):
        return "permission_missing"
    if isinstance(error, (RateLimited, AccountBusy)):
        return "rate_limited"
    if getattr(error, "code", None) == "provider_not_configured":
        return "provider_not_configured"
    return "provider_error"


# --- capabilities ---------------------------------------------------------------------------


def compute_capabilities(provider: str, scopes, account_type) -> dict[str, bool]:
    """Rule 16 / INSTAGRAM-INTEGRATION.md section 10, then `SOCIALHUB_IG_CAPABILITY_OVERRIDES`."""
    if provider == Provider.MANUAL:
        return default_capabilities()
    scopes = set(scopes or ())
    publish = SCOPE_PUBLISH in scopes and account_type in PROFESSIONAL_ACCOUNT_TYPES
    capabilities = {"publish_feed": publish, "publish_reel": publish, "publish_story": publish,
                    "insights": SCOPE_INSIGHTS in scopes}
    # An override can only switch a capability off: Social Hub cannot grant what Instagram
    # did not (for example `{"graph_api": {"publish_story": false}}` after a failed spike row).
    overrides = (settings.SOCIALHUB_IG_CAPABILITY_OVERRIDES or {}).get(provider) or {}
    for key, value in overrides.items():
        if key in CAPABILITY_KEYS:
            capabilities[key] = capabilities[key] and bool(value)
    return capabilities


# --- helpers --------------------------------------------------------------------------------


def _locked(account_id: int) -> AccountConnection:
    return (AccountConnection.objects.select_for_update()
            .select_related("account").get(account_id=account_id))


def _expires_soon(connection: AccountConnection, now) -> bool:
    return bool(connection.token_expires_at
                and connection.token_expires_at - now <= EXPIRING_WINDOW)


def _clear_identity(connection: AccountConnection) -> None:
    connection.ig_user_id = None
    connection.username = ""
    connection.account_type = None
    connection.access_token_encrypted = None
    connection.token_expires_at = None
    connection.token_refreshed_at = None
    connection.scopes = []
    connection.capabilities = default_capabilities()
    connection.last_verified_at = None
    connection.last_error_code = None
    connection.last_error_at = None


def active_connection_job(account_id: int) -> JobRun | None:
    return active_job_for(TARGET_TYPE, account_id, CONNECTION_KINDS)


def start_connection_job(kind: str, account, *, user=None, request_id: str | None = None,
                         countdown: int | None = None) -> JobRun:
    """Start `instagram.verify` or `instagram.refresh_token`; `JobInProgress` (409) when a
    connection job is already active (rule 39)."""
    account_id = int(getattr(account, "pk", account))
    return start_job(kind, target_id=account_id, account=account_id, user=user,
                     request_id=request_id, countdown=countdown)


# --- error reaction (rule 21) ---------------------------------------------------------------


def report_connection_error(account, error: BaseException) -> None:
    """The only code that changes the connection status in reaction to a provider error.

    `TokenInvalid` and `PermissionMissing` set `needs_attention` with the matching code; a
    `PermissionMissing` also starts `instagram.verify` (skipped while a connection job is
    active). Any other error, and any error on a `disconnected` connection, changes nothing.
    """
    if not isinstance(error, (TokenInvalid, PermissionMissing)):
        return
    account_id = int(getattr(account, "pk", account))
    now = clock.now()
    with transaction.atomic():
        connection = _locked(account_id)
        if connection.status == Status.DISCONNECTED:
            return
        connection.status = Status.NEEDS_ATTENTION
        connection.last_error_code = error.code
        connection.last_error_at = now
        connection.save(update_fields=["status", "last_error_code", "last_error_at",
                                       "updated_at"])
        if isinstance(error, PermissionMissing):
            try:
                start_connection_job(VERIFY_KIND, account_id)
            except JobInProgress:
                pass


# --- provider choice, connect and disconnect (rules 23-24, 38) ------------------------------


def _not_archived(account: InstagramAccount, status: str) -> None:
    if account.is_archived:
        raise InvalidTransition(details={"status": status, "reason": "account_archived"})


def choose_provider(account: InstagramAccount, provider: str) -> AccountConnection:
    """`PATCH …/connection/`: store the provider while `disconnected`; `manual` connects now."""
    with transaction.atomic():
        connection = _locked(account.pk)
        account = connection.account
        reconnect_manual = (provider == Provider.MANUAL
                            and connection.status == Status.DISCONNECTED)
        if provider == connection.provider and not reconnect_manual:
            return connection
        _not_archived(account, connection.status)
        if connection.status != Status.DISCONNECTED:
            raise InvalidTransition(details={"status": connection.status,
                                             "reason": "connection_not_disconnected"})
        ensure_configured(provider)
        _clear_identity(connection)
        connection.provider = provider
        if provider == Provider.MANUAL:
            connection.status = Status.CONNECTED
        connection.save()
    return connection


def start_connect(account: InstagramAccount, user) -> dict:
    """`POST …/connection/connect/`: a single-use state for 10 minutes and the authorize URL."""
    connection = AccountConnection.objects.get(account=account)
    _not_archived(account, connection.status)
    if connection.provider == Provider.MANUAL:
        raise InvalidTransition(details={"status": connection.status,
                                         "reason": "manual_provider"})
    provider = get_provider(connection.provider)  # 503 provider_not_configured for graph_api
    state = secrets.token_urlsafe(32)
    cache.set(oauth_state_key(state),
              {"account_id": account.pk, "user_id": user.pk, "provider": connection.provider},
              OAUTH_STATE_TTL_SECONDS)
    url = provider.authorize_url(state=state, redirect_uri=settings.SOCIALHUB_META_REDIRECT_URI,
                                 account_id=account.pk)
    return {"authorize_url": url,
            "expires_at": clock.now() + timedelta(seconds=OAUTH_STATE_TTL_SECONDS)}


def disconnect(account: InstagramAccount) -> bool:
    """Rule 38. Returns False (and changes nothing) when already `disconnected`."""
    with transaction.atomic():
        connection = _locked(account.pk)
        if connection.status == Status.DISCONNECTED:
            return False
        _clear_identity(connection)
        connection.status = Status.DISCONNECTED
        connection.save()
        InstagramAccount.objects.filter(pk=account.pk).update(publishing_enabled=False,
                                                              updated_at=timezone.now())
        for job in JobRun.objects.filter(target_type=TARGET_TYPE, target_id=str(account.pk),
                                         kind__in=CONNECTION_KINDS,
                                         status=JobRun.Status.QUEUED):
            cancel_queued_job(job, "The account was disconnected.")
    return True


# --- OAuth callback (rules 25-29) -----------------------------------------------------------


@dataclass
class CallbackOutcome:
    account_id: int | None
    code: str | None  # None on success

    @property
    def redirect_url(self) -> str:
        panel = settings.SOCIALHUB_PANEL_URL.rstrip("/")
        if self.account_id is None:
            return f"{panel}/settings/accounts?{urlencode({'connect': 'error', 'code': self.code})}"
        query = {"tab": "connection", "connect": "success" if self.code is None else "error"}
        if self.code is not None:
            query["code"] = self.code
        return f"{panel}/settings/accounts/{self.account_id}?{urlencode(query)}"


class _CallbackFailure(Exception):
    def __init__(self, code: str, fbtrace_id: str | None = None):
        super().__init__(code)
        self.code = code
        self.fbtrace_id = fbtrace_id


def _pop_state(state: str) -> dict | None:
    if not state:
        return None
    key = oauth_state_key(state)
    data = cache.get(key)
    if data is None or not cache.delete(key):  # single use: only one caller deletes it
        return None
    return data if isinstance(data, dict) else None


def _provider_failure(error: InstagramError, step_code: str) -> _CallbackFailure:
    if isinstance(error, RateLimited):
        return _CallbackFailure("rate_limited", error.fbtrace_id)
    if isinstance(error, TokenInvalid):
        return _CallbackFailure("oauth_exchange_failed", error.fbtrace_id)
    if isinstance(error, PermissionMissing):
        return _CallbackFailure(step_code, error.fbtrace_id)
    return _CallbackFailure("provider_error", error.fbtrace_id)


def complete_oauth(params) -> CallbackOutcome:
    """Run the callback steps of rule 25 in order; the first failing step decides the code."""
    data = _pop_state(params.get("state", ""))
    if data is None:
        logger.info("instagram_connect_failed account_id=- code=oauth_state_invalid")
        return CallbackOutcome(None, "oauth_state_invalid")
    account_id = data.get("account_id")
    account = InstagramAccount.objects.filter(pk=account_id).select_related("connection").first()
    if account is None:
        logger.info("instagram_connect_failed account_id=- code=oauth_state_invalid")
        return CallbackOutcome(None, "oauth_state_invalid")
    try:
        _complete(account, data, params)
    except _CallbackFailure as failure:
        logger.info("instagram_connect_failed account_id=%s code=%s fbtrace_id=%s",
                    account.pk, failure.code, failure.fbtrace_id or "-")
        return CallbackOutcome(account.pk, failure.code)
    except Exception:  # anything unexpected is provider_error, and nothing is stored
        logger.exception("instagram_connect_failed account_id=%s code=provider_error",
                         account.pk)
        return CallbackOutcome(account.pk, "provider_error")
    logger.info("instagram_connected account_id=%s", account.pk)
    return CallbackOutcome(account.pk, None)


def _check_state(account: InstagramAccount, data: dict) -> AccountConnection:
    connection = AccountConnection.objects.get(account=account)
    user_ok = get_user_model().objects.filter(pk=data.get("user_id"), is_active=True,
                                              is_superuser=True).exists()
    if (account.is_archived or not user_ok or connection.provider != data.get("provider")
            or connection.provider == Provider.MANUAL):
        raise _CallbackFailure("oauth_state_invalid")
    return connection


def _complete(account: InstagramAccount, data: dict, params) -> None:
    connection = _check_state(account, data)  # step 1
    if params.get("error"):  # step 2
        raise _CallbackFailure("oauth_denied")
    code = params.get("code", "")
    if not code:
        raise _CallbackFailure("oauth_exchange_failed")
    try:
        provider = get_provider(connection.provider)
    except InstagramError:
        raise _CallbackFailure("provider_error") from None
    redirect_uri = settings.SOCIALHUB_META_REDIRECT_URI
    try:  # step 3
        grant = provider.exchange_code(code=code, redirect_uri=redirect_uri,
                                       account_id=account.pk)
    except InstagramError as error:
        raise _provider_failure(error, "oauth_exchange_failed") from None
    try:  # step 4
        result = provider.verify(grant.access_token)
    except InstagramError as error:
        raise _provider_failure(error, "permission_missing") from None
    # step 5
    if (result.username or "").lower() != account.handle.lower():
        raise _CallbackFailure("account_mismatch")
    taken = (AccountConnection.objects.filter(ig_user_id=result.ig_user_id)
             .exclude(account=account).exists())
    if taken:
        raise _CallbackFailure("account_mismatch")
    if result.account_type not in PROFESSIONAL_ACCOUNT_TYPES:  # step 6
        raise _CallbackFailure("not_professional")
    scopes = list(result.scopes if result.scopes is not None else (grant.scopes or []))
    if SCOPE_BASIC not in scopes:  # step 7
        raise _CallbackFailure("permission_missing")
    _store_connection(account, data["provider"], grant, result, scopes)


def _store_connection(account: InstagramAccount, provider: str, grant: TokenGrant,
                      result: VerifyResult, scopes: list[str]) -> None:
    """Rule 26: everything at once under a row lock; `publishing_enabled` is never touched."""
    now = clock.now()
    with transaction.atomic():
        connection = _locked(account.pk)
        if connection.account.is_archived or connection.provider != provider:
            raise _CallbackFailure("oauth_state_invalid")
        connection.status = Status.CONNECTED
        connection.ig_user_id = result.ig_user_id
        connection.username = result.username
        connection.account_type = result.account_type
        connection.access_token_encrypted = crypto.encrypt(grant.access_token)
        connection.token_expires_at = grant.expires_at
        connection.token_refreshed_at = now
        connection.scopes = scopes
        connection.capabilities = compute_capabilities(provider, scopes, result.account_type)
        connection.last_verified_at = now
        connection.last_error_code = None
        connection.last_error_at = None
        connection.save()


# --- verify and refresh outcomes (rules 30-35) ----------------------------------------------


def apply_verify(account_id: int, result: VerifyResult) -> tuple[str, str | None]:
    """Rule 34. Returns `(status, problem)`; `problem` is the job error code or None.

    A connection that was disconnected meanwhile is left alone (rule 38).
    """
    now = clock.now()
    with transaction.atomic():
        connection = _locked(account_id)
        if connection.status == Status.DISCONNECTED or not connection.has_token:
            return connection.status, None
        handle = connection.account.handle
        problem = None
        if connection.ig_user_id and result.ig_user_id != connection.ig_user_id:
            problem = "account_mismatch"
        elif (result.username or "").lower() != handle.lower():
            problem = "account_mismatch"
        elif result.account_type not in PROFESSIONAL_ACCOUNT_TYPES:
            problem = "not_professional"
        scopes = list(result.scopes) if result.scopes is not None else list(connection.scopes)
        if problem is None and SCOPE_BASIC not in scopes:
            problem = "permission_missing"

        if not connection.ig_user_id:
            connection.ig_user_id = result.ig_user_id
        connection.username = result.username or ""
        if result.account_type in PROFESSIONAL_ACCOUNT_TYPES:
            connection.account_type = result.account_type
        connection.scopes = scopes
        connection.capabilities = compute_capabilities(connection.provider, scopes,
                                                       result.account_type)
        connection.last_verified_at = now
        if problem is not None:
            connection.status = Status.NEEDS_ATTENTION
            connection.last_error_code = problem
            connection.last_error_at = now
        elif connection.status == Status.NEEDS_ATTENTION:
            connection.status = Status.EXPIRING if _expires_soon(connection, now) \
                else Status.CONNECTED
        elif connection.status != Status.EXPIRING:  # expiring waits for a successful refresh
            connection.status = Status.CONNECTED
        if problem is None and connection.status == Status.CONNECTED:
            connection.last_error_code = None
            connection.last_error_at = None
        connection.save()
        return connection.status, problem


def apply_refresh(account_id: int, grant: TokenGrant) -> str:
    """Rule 32 success: store the new token; `expiring` becomes `connected`."""
    now = clock.now()
    with transaction.atomic():
        connection = _locked(account_id)
        if connection.status == Status.DISCONNECTED or not connection.has_token:
            return connection.status
        connection.access_token_encrypted = crypto.encrypt(grant.access_token)
        connection.token_expires_at = grant.expires_at
        connection.token_refreshed_at = now
        if connection.status == Status.EXPIRING:
            connection.status = Status.CONNECTED
        connection.save()
        return connection.status


def refresh_failed(account_id: int, error: BaseException) -> str:
    """Rule 32 failure other than `TokenInvalid`: keep the status, record the error, and
    move `connected` to `expiring` when the token expires within 7 days."""
    now = clock.now()
    with transaction.atomic():
        connection = _locked(account_id)
        if connection.status == Status.DISCONNECTED:
            return connection.status
        connection.last_error_code = job_error_code(error)
        connection.last_error_at = now
        if connection.status == Status.CONNECTED and _expires_soon(connection, now):
            connection.status = Status.EXPIRING
        connection.save()
        return connection.status


def refresh_blocked_until(connection: AccountConnection):
    """When a token refreshed less than 24 hours ago may be refreshed again, else None."""
    if connection.token_refreshed_at is None:
        return None
    allowed_at = connection.token_refreshed_at + REFRESH_MIN_AGE
    return allowed_at if allowed_at > clock.now() else None


# --- daily schedules (rules 31, 33) ---------------------------------------------------------


def _scheduled_providers() -> list[str]:
    return [name for name in (Provider.GRAPH_API, Provider.FAKE) if provider_configured(name)]


def _with_token(qs):
    return qs.filter(access_token_encrypted__isnull=False).exclude(access_token_encrypted="")


def schedule_refreshes() -> int:
    """`instagram.refresh_tokens`: expire overdue tokens and start refresh jobs (at most 500).
    Safe to run twice: an active job blocks a second one, a refreshed token is not due."""
    now = clock.now()
    cutoff = now - timedelta(days=settings.SOCIALHUB_IG_TOKEN_REFRESH_AFTER_DAYS)
    qs = _with_token(AccountConnection.objects.filter(
        account__status=InstagramAccount.Status.ACTIVE,
        status__in=[Status.CONNECTED, Status.EXPIRING],
        provider__in=_scheduled_providers(),
    )).order_by("token_refreshed_at", "pk")
    started = 0
    for connection in qs.iterator():
        if connection.token_expires_at and connection.token_expires_at <= now:
            report_connection_error(connection.account_id,
                                    TokenInvalid("The access token expired."))
            continue
        if connection.token_refreshed_at is not None and connection.token_refreshed_at > cutoff:
            continue
        if started >= DAILY_REFRESH_LIMIT:
            break
        try:
            start_connection_job(REFRESH_KIND, connection.account_id)
        except JobInProgress:
            continue
        started += 1
    return started


def schedule_verifications() -> int:
    """`instagram.verify_all`: one `instagram.verify` per active, non-manual account holding a
    token, each delayed by a random countdown of up to 30 minutes."""
    qs = _with_token(AccountConnection.objects.filter(
        account__status=InstagramAccount.Status.ACTIVE,
        provider__in=_scheduled_providers(),
    )).order_by("pk")
    started = 0
    for connection in qs.iterator():
        try:
            start_connection_job(VERIFY_KIND, connection.account_id,
                                 countdown=random.randint(0, VERIFY_SPREAD_SECONDS))
        except JobInProgress:
            continue
        started += 1
    return started
