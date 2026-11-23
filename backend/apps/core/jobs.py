"""Background jobs: registry, `start_job`, `@job_task` with `JobContext`, sweeper (E00-S06).

Every long action follows one pattern (ARCHITECTURE.md section 4):

1. the owning app registers its kind once in its `jobs.py` with `register_job_kind`;
2. the API calls `start_job`, which creates a `JobRun`, enqueues the Celery task after commit
   and returns the job for the `202` response;
3. the task body is written with `@job_task(kind)` and reports through `JobContext`.

Public names: `register_job_kind`, `register_job_target`, `register_job_exception`,
`start_job`, `job_task`, `job_step`, `JobContext`, `JobError`, `JobInProgress`, `job_finished`,
`active_job_for`, `cancel_queued_job`, `sweep_stale_jobs`, `prune_jobs`, `job_payload`,
`job_summary`, `timeout_for`, `QUEUES`.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import timedelta

from celery import shared_task
from celery.exceptions import Retry, SoftTimeLimitExceeded
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, connection, transaction
from django.db.models import Exists, OuterRef, Q
from django.dispatch import Signal

from . import clock
from .errors import JobInProgress
from .models import JobRun
from .users import user_ref

logger = logging.getLogger(__name__)

QUEUES = ("default", "render", "publish")
DEFAULT_TIMEOUT_SECONDS = 1800
MAX_PAYLOAD_BYTES = 16 * 1024
MAX_RESULT_BYTES = 16 * 1024
MAX_MESSAGE_CHARS = 120
MAX_DETAIL_CHARS = 500
PROGRESS_MIN_INTERVAL_SECONDS = 1.0
RUNNING_GRACE_SECONDS = 120
QUEUED_STALE_AFTER = timedelta(hours=6)
SWEEP_BATCH = 500
PRUNE_BATCH = 5000
PRUNE_SUCCEEDED_AFTER = timedelta(days=7)
PRUNE_FAILED_AFTER = timedelta(days=30)

# Timeouts owned by later stories (E00-S06 rule 2). A registration without `timeout_seconds`
# uses this table, then DEFAULT_TIMEOUT_SECONDS; SOCIALHUB_JOB_TIMEOUT_OVERRIDES wins over both.
KNOWN_TIMEOUTS = {
    "production.start": 45 * 60,
    "production.render": 30 * 60,
    "qc.run": 15 * 60,
    "qc.revise": 60 * 60,
    "publish.send": 20 * 60,
    "publish.verify": 20 * 60,
}

STALE_RUNNING_DETAIL = "The task stopped responding and was ended."
STALE_QUEUED_DETAIL = "The task never started. A worker may be down."

job_finished = Signal()  # sent after commit with `job` when a job reaches a terminal status


class JobError(Exception):
    """Raised by a job body to fail the job with a story-defined code and a safe detail."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(code, detail)
        self.code = code
        self.detail = detail


# --- registry -------------------------------------------------------------------------------


@dataclass(frozen=True)
class JobKind:
    kind: str
    task: str | None  # None: a parent-only kind whose steps are enqueued by the owning story
    queue: str
    target_type: str
    timeout_seconds: int | None = None
    conflicts_with: frozenset[str] = field(default_factory=frozenset)
    prunable: bool = False


_KINDS: dict[str, JobKind] = {}
_DUPLICATE_KINDS: list[str] = []
_TARGETS: dict[str, type] = {}
_DECORATED: dict[str, str] = {}  # kind -> Celery task name, filled by @job_task
_STEPS: set[str] = set()  # Celery task names decorated with @job_step
_EXCEPTION_MAPPERS: list[tuple[type[BaseException], Callable]] = []


def register_job_kind(kind: str, *, task: str | None, queue: str, target_type: str,
                      timeout_seconds: int | None = None,
                      conflicts_with: Iterable[str] | None = None,
                      prunable: bool = False) -> JobKind:
    """Register a job kind once, from the owning app's `jobs.py` (rule 1).

    A second registration of the same kind is recorded and reported by the system check
    (rule 3) instead of raising at import time. `task=None` registers a parent-only kind:
    `start_job` creates and tracks the job but enqueues nothing; the owning code enqueues its
    `@job_step` tasks itself.
    """
    spec = JobKind(kind=kind, task=task, queue=queue, target_type=target_type,
                   timeout_seconds=timeout_seconds,
                   conflicts_with=frozenset(conflicts_with or ()), prunable=prunable)
    if kind in _KINDS and _KINDS[kind] != spec:
        _DUPLICATE_KINDS.append(kind)
    _KINDS[kind] = spec
    return spec


def register_job_target(target_type: str, model) -> None:
    """Declare that `model` (keyed by `target_id`) carries an `active_job` FK (rule 4)."""
    _TARGETS[target_type] = model


def register_job_exception(exc_type: type[BaseException],
                           mapper: Callable[[BaseException], tuple[str, str]]) -> None:
    """Map a provider exception (AI gateway, Instagram) to `(error_code, error_detail)`."""
    _EXCEPTION_MAPPERS.append((exc_type, mapper))


def get_kind(kind: str) -> JobKind:
    try:
        return _KINDS[kind]
    except KeyError:
        raise LookupError(f"Job kind {kind!r} is not registered.") from None


def registered_kinds() -> dict[str, JobKind]:
    return dict(_KINDS)


def timeout_for(kind: str) -> int:
    overrides = getattr(settings, "SOCIALHUB_JOB_TIMEOUT_OVERRIDES", {}) or {}
    if kind in overrides:
        return int(overrides[kind])
    spec = _KINDS.get(kind)
    if spec is not None and spec.timeout_seconds:
        return int(spec.timeout_seconds)
    return KNOWN_TIMEOUTS.get(kind, DEFAULT_TIMEOUT_SECONDS)


def conflict_set(kind: str) -> set[str]:
    """The kind itself, the kinds it lists and the kinds that list it."""
    kinds = {kind} | set(get_kind(kind).conflicts_with)
    kinds |= {other.kind for other in _KINDS.values() if kind in other.conflicts_with}
    return kinds


# --- shapes ---------------------------------------------------------------------------------


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def job_summary(job: JobRun | None) -> dict | None:
    """`JobSummary`, embedded by other resources as `active_job`."""
    if job is None:
        return None
    return {
        "id": str(job.id),
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
    }


def job_payload(job: JobRun) -> dict:
    """The full job object returned by `202` responses and `GET /jobs/{id}/`."""
    return {
        "id": str(job.id),
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "account": job.account_id,
        "queue": job.queue,
        "target_type": job.target_type,
        "target_id": job.target_id,
        "result": job.result,
        "error_code": job.error_code,
        "error_detail": job.error_detail,
        "created_by": user_ref(job.created_by),
        "request_id": job.request_id,
        "created_at": _ts(job.created_at),
        "started_at": _ts(job.started_at),
        "finished_at": _ts(job.finished_at),
    }


# --- active_job bookkeeping -----------------------------------------------------------------


def _set_active_job(job: JobRun) -> None:
    model = _TARGETS.get(job.target_type)
    if model is not None:
        model.objects.filter(pk=job.target_id).update(active_job=job)


def _clear_active_job(job: JobRun) -> None:
    model = _TARGETS.get(job.target_type)
    if model is not None:
        model.objects.filter(pk=job.target_id, active_job=job).update(active_job=None)


def active_job_for(target_type: str, target_id,
                   kinds: Iterable[str] | None = None) -> JobRun | None:
    """The newest queued or running job on a target, optionally limited to `kinds` (rule 23)."""
    qs = JobRun.objects.filter(target_type=target_type, target_id=str(target_id),
                               status__in=JobRun.ACTIVE_STATUSES)
    if kinds:
        qs = qs.filter(kind__in=list(kinds))
    return qs.order_by("-created_at").first()


# --- starting -------------------------------------------------------------------------------


def _advisory_lock(target_type: str, target_id: str) -> None:
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                           [f"job:{target_type}:{target_id}"])


def _find_conflict(spec: JobKind, target_id: str) -> JobRun | None:
    return (JobRun.objects.select_related("created_by")
            .filter(target_type=spec.target_type, target_id=target_id,
                    kind__in=conflict_set(spec.kind), status__in=JobRun.ACTIVE_STATUSES)
            .order_by("created_at").first())


def _check_json(value, limit: int, what: str) -> None:
    try:
        size = len(json.dumps(value).encode())
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Job {what} must be JSON-serialisable.") from exc
    if size > limit:
        raise ValueError(f"Job {what} is {size} bytes; the limit is {limit}.")


def start_job(kind: str, *, target_id, account=None, user=None, request_id: str | None = None,
              payload: dict | None = None, countdown: int | None = None) -> JobRun:
    """Create a queued job and enqueue its task after commit (rule 5).

    Raises `JobInProgress` when the target already has an active job of a conflicting kind.
    `account` is an `InstagramAccount`, its ID, or None for system jobs. `countdown` delays the
    task by that many seconds; the job stays `queued` meanwhile (E00-S04 `instagram.verify_all`).
    """
    spec = get_kind(kind)
    payload = payload or {}
    _check_json(payload, MAX_PAYLOAD_BYTES, "payload")
    target_id = str(target_id)
    account_id = getattr(account, "pk", account)
    if user is not None and not getattr(user, "is_authenticated", False):
        user = None

    with transaction.atomic():
        _advisory_lock(spec.target_type, target_id)
        conflict = _find_conflict(spec, target_id)
        if conflict is not None:
            raise JobInProgress(conflict)
        try:
            with transaction.atomic():
                job = JobRun(kind=kind, status=JobRun.Status.QUEUED, account_id=account_id,
                             target_type=spec.target_type, target_id=target_id,
                             queue=spec.queue, request_id=request_id, created_by=user)
                job.celery_task_id = str(job.id)
                job.save(force_insert=True)
        except IntegrityError:
            # Lost a race the advisory lock could not prevent (no PostgreSQL, rule 9).
            conflict = _find_conflict(spec, target_id)
            if conflict is None:
                raise
            raise JobInProgress(conflict) from None
        _set_active_job(job)
        job_id = job.id
        if spec.task is not None:
            transaction.on_commit(lambda: _enqueue(job_id, payload, countdown))
    return job


def _celery_task(name: str):
    from celery import current_app

    try:
        return current_app.tasks[name]
    except KeyError:
        raise LookupError(f"Celery task {name!r} is not registered.") from None


def _enqueue(job_id, payload: dict, countdown: int | None = None) -> None:
    job = JobRun.objects.get(pk=job_id)
    spec = get_kind(job.kind)
    timeout = timeout_for(job.kind)
    try:
        _celery_task(spec.task).apply_async(
            args=[str(job.id)], kwargs=payload, queue=spec.queue, task_id=str(job.id),
            soft_time_limit=timeout, time_limit=timeout + 60,
            **({"countdown": countdown} if countdown else {}),
        )
    except Retry:
        # Only with CELERY_TASK_ALWAYS_EAGER: the body asked for a retry; the job stays running.
        return
    except Exception:
        logger.exception("job_enqueue_failed job_id=%s kind=%s", job.id, job.kind)
        _finish(job.id, JobRun.Status.FAILED, error_code="enqueue_failed",
                error_detail="The task could not be queued.")


# --- terminal updates -----------------------------------------------------------------------


def _finish(job_id, status: str, *, expected=JobRun.ACTIVE_STATUSES, **fields) -> bool:
    """Move a job to a terminal status if it is still active (rule 15).

    Clears `active_job` on the target and sends `job_finished` after commit (rule 16).
    Returns False, and logs `job_late_update`, when the job had already finished.
    """
    now = clock.now()
    with transaction.atomic():
        updated = (JobRun.objects.filter(pk=job_id, status__in=list(expected))
                   .update(status=status, finished_at=now, updated_at=now, **fields))
        if not updated:
            logger.warning("job_late_update job_id=%s status=%s", job_id, status)
            return False
        job = JobRun.objects.select_related("created_by").get(pk=job_id)
        _clear_active_job(job)
        transaction.on_commit(lambda: job_finished.send(sender=JobRun, job=job))
    return True


def _truncate(text: str | None, limit: int) -> str:
    return (text or "")[:limit]


def cancel_queued_job(job: JobRun, reason: str) -> bool:
    """Cancel a job that has not started (rule 18). A running job is left alone (False)."""
    cancelled = _finish(job.pk, JobRun.Status.CANCELLED, expected=(JobRun.Status.QUEUED,),
                        error_detail=_truncate(reason, MAX_DETAIL_CHARS))
    if cancelled:
        task_id = job.celery_task_id or str(job.pk)
        transaction.on_commit(lambda: _revoke(task_id))
        job.refresh_from_db()
    return cancelled


def _revoke(task_id: str) -> None:
    from celery import current_app

    try:
        current_app.control.revoke(task_id)
    except Exception:
        logger.warning("job_revoke_failed task_id=%s", task_id, exc_info=True)


# --- running --------------------------------------------------------------------------------


class JobContext:
    """Handed to a `@job_task` body: progress reporting and explicit finishing."""

    def __init__(self, job: JobRun, task=None):
        self.job = job
        self.task = task
        self.finished = False
        self._progress = job.progress
        self._message = job.message
        self._last_write = None
        self._dirty = False

    def progress(self, percent: int, message: str | None = None) -> None:
        """Store progress (0-100, never lower) and a short message (rule 12)."""
        self._progress = max(self._progress, max(0, min(100, int(percent))))
        if message is not None:
            self._message = _truncate(message, MAX_MESSAGE_CHARS)
        self._dirty = True
        now = clock.now()
        if (self._last_write is None
                or (now - self._last_write).total_seconds() >= PROGRESS_MIN_INTERVAL_SECONDS):
            self._flush(now)

    def _flush(self, now=None) -> None:
        if not self._dirty:
            return
        now = now or clock.now()
        JobRun.objects.filter(pk=self.job.pk, status=JobRun.Status.RUNNING).update(
            progress=self._progress, message=self._message, updated_at=now)
        self.job.progress, self.job.message = self._progress, self._message
        self._last_write = now
        self._dirty = False

    def succeed(self, result: dict | None = None, message: str = "Done") -> bool:
        """Finish successfully with a small JSON `result` (rule 13)."""
        if result is not None:
            _check_json(result, MAX_RESULT_BYTES, "result")
        self.finished = True
        done = _finish(self.job.pk, JobRun.Status.SUCCEEDED, progress=100,
                       message=_truncate(message, MAX_MESSAGE_CHARS), result=result)
        self.job.refresh_from_db()
        return done

    def fail(self, code: str, detail: str = "") -> bool:
        """Finish with a machine code and a safe, short detail (rule 14)."""
        self.finished = True
        done = _finish(self.job.pk, JobRun.Status.FAILED, progress=self._progress,
                       message=self._message, error_code=code,
                       error_detail=_truncate(detail, MAX_DETAIL_CHARS))
        self.job.refresh_from_db()
        return done

    def retry(self, *, exc: BaseException | None = None, countdown: int | None = None,
              max_retries: int | None = None):
        """Retry through Celery; the job stays `running` with "Retrying (n of max)"."""
        if self.task is None:
            raise RuntimeError("retry() needs the Celery task.")
        limit = max_retries if max_retries is not None else self.task.max_retries
        attempt = self.task.request.retries + 1
        self._message = _truncate(f"Retrying ({attempt} of {limit})", MAX_MESSAGE_CHARS)
        self._dirty = True
        self._flush()
        return self.task.retry(exc=exc, countdown=countdown, max_retries=limit)


def _begin(job_id: str) -> JobRun | None:
    """Move queued -> running; skip terminal jobs (rule 11). A running job is returned as is."""
    try:
        job = JobRun.objects.get(pk=job_id)
    except (JobRun.DoesNotExist, ValueError, DjangoValidationError):
        logger.warning("job_missing job_id=%s", job_id)
        return None
    now = clock.now()
    deadline = now + timedelta(seconds=timeout_for(job.kind))
    started = JobRun.objects.filter(pk=job.pk, status=JobRun.Status.QUEUED).update(
        status=JobRun.Status.RUNNING, started_at=now, deadline_at=deadline, updated_at=now)
    job.refresh_from_db()
    if not started and job.is_terminal:
        logger.info("job_skip_terminal job_id=%s status=%s", job.pk, job.status)
        return None
    return job


def _map_exception(exc: BaseException, job: JobRun) -> tuple[str, str]:
    if isinstance(exc, JobError):
        return exc.code, exc.detail
    if isinstance(exc, SoftTimeLimitExceeded):
        minutes = max(1, round(timeout_for(job.kind) / 60))
        return "timeout", f"The task took longer than {minutes} minutes."
    for exc_type, mapper in _EXCEPTION_MAPPERS:
        if isinstance(exc, exc_type):
            return mapper(exc)
    return "server_error", f"Unexpected error. Reference: {job.pk}."


def _build_task(fn: Callable, task_name: str, *, auto_succeed: bool, options: dict):
    # No functools.wraps: Celery checks call arguments against this signature
    # (job_id, then any positional args and the payload), not the body's.
    def run(self, job_id: str, *args, **payload):
        job = _begin(job_id)
        if job is None:
            return None
        ctx = JobContext(job, task=self)
        try:
            outcome = fn(ctx, *args, **payload)
        except Retry:
            raise
        except Exception as exc:
            code, detail = _map_exception(exc, job)
            if code == "server_error":
                logger.exception("job_server_error job_id=%s kind=%s", job.pk, job.kind)
            else:
                logger.warning("job_failed job_id=%s kind=%s code=%s", job.pk, job.kind, code)
            if not ctx.finished:
                ctx.fail(code, detail)
            return None
        ctx._flush()
        if auto_succeed and not ctx.finished:
            ctx.succeed(None)
        return None if auto_succeed else outcome

    run.__doc__ = fn.__doc__
    run.__name__ = run.__qualname__ = fn.__name__
    run.__module__ = fn.__module__
    return shared_task(name=task_name, bind=True, acks_late=True, **options)(run)


def job_task(kind: str, *, name: str | None = None, **celery_options):
    """Decorate a job body `fn(ctx: JobContext, **payload)` as a Celery task (rules 10-16).

    The Celery task name is `name`, else the name registered for `kind`, else `kind` itself.
    A body that returns without `ctx.succeed`/`ctx.fail` succeeds with no result.
    """

    def decorator(fn: Callable):
        registered = _KINDS[kind].task if kind in _KINDS else None
        task_name = name or registered or kind
        _DECORATED[kind] = task_name
        # Extra options become attributes of the task class (`task.job_kind`).
        return _build_task(fn, task_name, auto_succeed=True,
                           options={"job_kind": kind, **celery_options})

    return decorator


def job_step(task_name: str, **celery_options):
    """Decorate one step of a multi-task job: `fn(ctx: JobContext, *args, **payload)`.

    Called with the job ID as the first argument, like `@job_task`, and with the same entry
    and failure rules (queued -> running with the kind's deadline; exceptions fail the job,
    clear `active_job` and send `job_finished`). Differences:

    - returning without `ctx.succeed()`/`ctx.fail()` leaves the job `running` so a later step
      can continue it; the body's return value is the task's return value;
    - a job that is already terminal (cancelled, swept, failed, succeeded) skips the body;
    - a job that is already `running` (started by an earlier step) is allowed on entry.

    Steps are enqueued by the owning code (for example a Celery chain of immutable
    signatures); the kind is usually registered with `task=None`.
    """

    def decorator(fn: Callable):
        _STEPS.add(task_name)
        return _build_task(fn, task_name, auto_succeed=False,
                           options={"job_step": True, **celery_options})

    return decorator


# --- sweeper and pruning --------------------------------------------------------------------


def sweep_stale_jobs(limit: int = SWEEP_BATCH) -> int:
    """Fail running jobs past their deadline and long-queued jobs with `stale_job` (rule 17)."""
    now = clock.now()
    running = list(JobRun.objects.filter(
        status=JobRun.Status.RUNNING,
        deadline_at__lt=now - timedelta(seconds=RUNNING_GRACE_SECONDS),
    ).order_by("deadline_at").values_list("pk", flat=True)[:limit])
    queued = list(JobRun.objects.filter(
        status=JobRun.Status.QUEUED, created_at__lt=now - QUEUED_STALE_AFTER,
    ).order_by("created_at").values_list("pk", flat=True)[:max(0, limit - len(running))])
    swept = 0
    for job_id in running:
        swept += _finish(job_id, JobRun.Status.FAILED, expected=(JobRun.Status.RUNNING,),
                         error_code="stale_job", error_detail=STALE_RUNNING_DETAIL)
    for job_id in queued:
        swept += _finish(job_id, JobRun.Status.FAILED, expected=(JobRun.Status.QUEUED,),
                         error_code="stale_job", error_detail=STALE_QUEUED_DETAIL)
    if swept:
        logger.info("jobs_swept count=%s", swept)
    return swept


def _unreferenced(qs):
    """Exclude jobs that another row points at (AIRun.job, active_job FKs, ...)."""
    # include_hidden: `active_job` FKs usually use related_name="+".
    for rel in JobRun._meta.get_fields(include_hidden=True):
        if not (rel.auto_created and not rel.concrete and (rel.one_to_many or rel.one_to_one)):
            continue
        related = rel.related_model._base_manager.filter(**{rel.field.name: OuterRef("pk")})
        qs = qs.exclude(Exists(related))
    return qs


def prune_jobs(limit: int = PRUNE_BATCH) -> int:
    """Delete old system jobs of prunable kinds (rule 17a)."""
    kinds = [spec.kind for spec in _KINDS.values() if spec.prunable]
    if not kinds:
        return 0
    now = clock.now()
    qs = JobRun.objects.filter(created_by__isnull=True, kind__in=kinds).filter(
        Q(status=JobRun.Status.SUCCEEDED, finished_at__lt=now - PRUNE_SUCCEEDED_AFTER)
        | Q(status__in=[JobRun.Status.FAILED, JobRun.Status.CANCELLED],
            finished_at__lt=now - PRUNE_FAILED_AFTER)
    )
    ids = list(_unreferenced(qs).values_list("pk", flat=True)[:limit])
    if not ids:
        return 0
    deleted, _ = JobRun.objects.filter(pk__in=ids).delete()
    logger.info("jobs_pruned count=%s", deleted)
    return len(ids)


# --- deprecated helpers ---------------------------------------------------------------------
# Kept so code written before E00-S06 keeps working. New code uses start_job / @job_task.


def create_job(*, kind: str, target_type: str, target_id, account=None, created_by=None,
               request_id: str | None = None, queue: str = "default") -> JobRun:
    """Deprecated: use `start_job`. Creates a queued row without conflict checks."""
    return JobRun.objects.create(kind=kind, target_type=target_type, target_id=str(target_id),
                                 account_id=getattr(account, "pk", account),
                                 created_by=created_by, request_id=request_id, queue=queue)


def enqueue(job: JobRun, task, *args) -> None:
    """Deprecated: use `start_job`. Sends `task` after commit; a broker error fails the job."""

    def _send():
        try:
            async_result = task.apply_async(args=args, queue=job.queue)
        except Exception:
            logger.exception("job_enqueue_failed job_id=%s", job.id)
            fail(job, "enqueue_failed", "The task could not be queued.")
            on_enqueue_failed = getattr(task, "on_enqueue_failed", None)
            if callable(on_enqueue_failed):
                on_enqueue_failed(*args)
            return
        JobRun.objects.filter(pk=job.pk, celery_task_id__isnull=True).update(
            celery_task_id=async_result.id)

    transaction.on_commit(_send)


def start(job: JobRun, *, timeout_seconds: int | None = None) -> JobRun:
    """Deprecated: `@job_task` does this. Marks the job running with a deadline."""
    now = clock.now()
    JobRun.objects.filter(pk=job.pk, status=JobRun.Status.QUEUED).update(
        status=JobRun.Status.RUNNING, started_at=now,
        deadline_at=now + timedelta(seconds=timeout_seconds or timeout_for(job.kind)),
        updated_at=now)
    job.refresh_from_db()
    return job


def progress(job: JobRun, value: int, message: str | None = None) -> None:
    """Deprecated: use `JobContext.progress`."""
    job.progress = max(job.progress, max(0, min(100, int(value))))
    if message is not None:
        job.message = _truncate(message, MAX_MESSAGE_CHARS)
    JobRun.objects.filter(pk=job.pk, status=JobRun.Status.RUNNING).update(
        progress=job.progress, message=job.message, updated_at=clock.now())


def succeed(job: JobRun, result: dict | None = None, message: str = "Done") -> None:
    """Deprecated: use `JobContext.succeed`."""
    _finish(job.pk, JobRun.Status.SUCCEEDED, progress=100,
            message=_truncate(message, MAX_MESSAGE_CHARS), result=result)
    job.refresh_from_db()


def fail(job: JobRun, code: str, detail: str | None = None, message: str | None = None) -> None:
    """Deprecated: use `JobContext.fail` or raise `JobError`."""
    fields = {"error_code": code, "error_detail": _truncate(detail, MAX_DETAIL_CHARS) or None}
    if message is not None:
        fields["message"] = _truncate(message, MAX_MESSAGE_CHARS)
    _finish(job.pk, JobRun.Status.FAILED, **fields)
    job.refresh_from_db()


def run_in_boundary(job: JobRun, body: Callable[[], None]) -> None:
    """Deprecated: `@job_task` does this. An unexpected exception fails with `server_error`."""
    try:
        body()
    except Exception:
        logger.exception("job_server_error job_id=%s", job.id)
        job.refresh_from_db()
        if not job.is_terminal:
            fail(job, "server_error", f"Unexpected error. Reference: {job.pk}.")
        raise


__all__ = [
    "QUEUES", "JobContext", "JobError", "JobInProgress", "JobKind", "active_job_for",
    "cancel_queued_job", "conflict_set", "get_kind", "job_finished", "job_payload",
    "job_step", "job_summary", "job_task", "prune_jobs", "register_job_exception",
    "register_job_kind", "register_job_target", "registered_kinds", "start_job",
    "sweep_stale_jobs", "timeout_for",
    # deprecated
    "create_job", "enqueue", "fail", "progress", "run_in_boundary", "start", "succeed",
]
