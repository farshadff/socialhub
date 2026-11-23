"""Connection jobs and daily schedules (E00-S04 "Background work").

- `instagram.verify` (job): rule 34; transient errors retry three times (30 s, 2 min, 10 min).
- `instagram.refresh_token` (job): rule 32, then the verify in the same job; no retry.
- `instagram.refresh_tokens` (Beat, daily 02:15 UTC): rule 31.
- `instagram.verify_all` (Beat, daily 03:00 UTC): rule 33.

Both jobs end with `result = {"connection_status": …}` (refresh adds `token_expires_at`), also
when they fail. Every write re-reads the connection under a row lock, so a disconnect that
happens meanwhile wins.
"""

from __future__ import annotations

from celery import shared_task

from apps.accounts.models import AccountConnection
from apps.core import clock
from apps.core.jobs import JobContext, job_task
from apps.core.models import JobRun

from . import services
from .providers.base import InstagramError, PermissionMissing, TokenInvalid
from .session import account_session

VERIFY_RETRY_DELAYS = (30, 120, 600)
MAX_VERIFY_RETRIES = len(VERIFY_RETRY_DELAYS)
Status = AccountConnection.Status


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _connection(account_id: int) -> AccountConnection:
    return AccountConnection.objects.get(account_id=account_id)


def _fail(ctx: JobContext, code: str, result: dict) -> None:
    JobRun.objects.filter(pk=ctx.job.pk, status=JobRun.Status.RUNNING).update(result=result)
    ctx.fail(code, services.ERROR_DETAILS.get(code, services.ERROR_DETAILS["provider_error"]))


def _status_result(account_id: int, **extra) -> dict:
    return {"connection_status": _connection(account_id).status, **extra}


def _idle(connection: AccountConnection) -> bool:
    """Nothing to check: disconnected (a disconnect won), manual, or no token."""
    return (connection.status == Status.DISCONNECTED or not connection.has_token
            or connection.provider == AccountConnection.Provider.MANUAL)


@job_task(services.VERIFY_KIND, max_retries=MAX_VERIFY_RETRIES)
def verify_connection(ctx: JobContext, force: bool = False, **payload) -> None:
    account_id = int(ctx.job.target_id)
    connection = _connection(account_id)
    if _idle(connection):
        ctx.succeed({"connection_status": connection.status})
        return
    fresh = (connection.last_verified_at is not None
             and (clock.now() - connection.last_verified_at).total_seconds()
             < services.VERIFY_FRESH_SECONDS)
    if fresh and not force and connection.status != Status.NEEDS_ATTENTION:
        ctx.succeed({"connection_status": connection.status})
        return

    ctx.progress(40, "Checking the account on Instagram")
    try:
        with account_session(account_id) as (provider, token):
            result = provider.verify(token)
    except (TokenInvalid, PermissionMissing) as error:
        services.report_connection_error(account_id, error)
        _fail(ctx, services.job_error_code(error), _status_result(account_id))
        return
    except InstagramError as error:  # TransientError, RateLimited, AccountBusy, ...
        retries = ctx.task.request.retries if ctx.task is not None else MAX_VERIFY_RETRIES
        if retries < MAX_VERIFY_RETRIES and error.code != "provider_not_configured":
            ctx.retry(exc=error, countdown=VERIFY_RETRY_DELAYS[retries])
        _fail(ctx, services.job_error_code(error), _status_result(account_id))
        return

    ctx.progress(80, "Updating capabilities")
    status, problem = services.apply_verify(account_id, result)
    if problem is not None:
        _fail(ctx, problem, {"connection_status": status})
        return
    ctx.succeed({"connection_status": status})


@job_task(services.REFRESH_KIND)
def refresh_connection_token(ctx: JobContext, **payload) -> None:
    account_id = int(ctx.job.target_id)
    connection = _connection(account_id)
    if _idle(connection) or connection.status not in (Status.CONNECTED, Status.EXPIRING):
        ctx.succeed({"connection_status": connection.status})
        return

    ctx.progress(40, "Renewing the access token")
    refreshed = False
    try:
        with account_session(account_id) as (provider, token):
            grant = provider.refresh_token(token)
            status = services.apply_refresh(account_id, grant)
            refreshed = True
            if status == Status.DISCONNECTED:
                ctx.succeed({"connection_status": status})
                return
            ctx.progress(80, "Checking the account on Instagram")
            result = provider.verify(grant.access_token)
    except (TokenInvalid, PermissionMissing) as error:
        services.report_connection_error(account_id, error)
        _fail(ctx, services.job_error_code(error), _refresh_result(account_id))
        return
    except InstagramError as error:
        if not refreshed:  # a verify failure after a good refresh is not a refresh failure
            services.refresh_failed(account_id, error)
        _fail(ctx, services.job_error_code(error), _refresh_result(account_id))
        return

    status, problem = services.apply_verify(account_id, result)
    outcome = _refresh_result(account_id)
    if problem is not None:
        _fail(ctx, problem, outcome)
        return
    ctx.succeed(outcome)


def _refresh_result(account_id: int) -> dict:
    connection = _connection(account_id)
    return {"connection_status": connection.status,
            "token_expires_at": _ts(connection.token_expires_at)}


@shared_task(name="instagram.refresh_tokens")
def refresh_tokens() -> int:
    """Daily 02:15 UTC: rule 31."""
    return services.schedule_refreshes()


@shared_task(name="instagram.verify_all")
def verify_all() -> int:
    """Daily 03:00 UTC: rule 33."""
    return services.schedule_verifications()
