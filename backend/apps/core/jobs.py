"""Background jobs (E00-S06): registry, start, run, finish, cancel, sweep.

Every long action creates a ``JobRun`` through ``start_job`` and runs its body through
a ``job_task``. The ``JobRun`` row, not Celery's result backend, is the source of truth
the panel polls.
"""

from __future__ import annotations

import functools
import logging
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from celery import current_app, shared_task
from celery.exceptions import Retry, SoftTimeLimitExceeded
from django.conf import settings
from django.db import connection, transaction
from django.dispatch import Signal
from rest_framework import status

from . import clock
from .exceptions import CodedAPIException
from .models import JobRun

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 1800
MAX_PAYLOAD_BYTES = 16 * 1024
MAX_RESULT_BYTES = 16 * 1024
STALE_GRACE = timedelta(seconds=120)
STALE_QUEUED_AFTER = timedelta(hours=6)
SWEEP_BATCH = 500
QUEUES = ("default", "render")

# Sent after commit when a job reaches a terminal status. Argument: ``job``.
job_finished = Signal()


# --- Registry ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class JobKind:
    kind: str
    task: str
    queue: str
    timeout_seconds: int
    target_type: str
    conflicts_with: frozenset[str] = field(default_factory=frozenset)
    prunable: bool = False

    @property
    def timeout(self) -> int:
        overrides = getattr(settings, "SOCIALHUB_JOB_TIMEOUT_OVERRIDES", {}) or {}
        return int(overrides.get(self.kind, self.timeout_seconds))

    @property
    def conflict_set(self) -> frozenset[str]:
        return self.conflicts_with | {self.kind}


_KINDS: dict[str, JobKind] = {}
_TARGETS: dict[str, type] = {}
_BODIES: dict[str, Callable[..., Any]] = {}


def register_job_kind(
    kind: str,
    *,
    task: str,
    target_type: str,
    queue: str = "default",
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    conflicts_with: Iterable[str] = (),
    prunable: bool = False,
) -> JobKind:
    if queue not in QUEUES:
        raise ValueError(f"Unknown queue {queue!r} for job kind {kind!r}")
    spec = JobKind(
        kind=kind,
        task=task,
        queue=queue,
        timeout_seconds=timeout_seconds,
        target_type=target_type,
        conflicts_with=frozenset(conflicts_with),
        prunable=prunable,
    )
    existing = _KINDS.get(kind)
    if existing is not None and existing != spec:
        raise ValueError(f"Job kind {kind!r} is registered twice with different options")
    _KINDS[kind] = spec
    return spec


def register_job_target(target_type: str, model: type) -> None:
    """Targets whose model has an ``active_job`` FK (``on_delete=SET_NULL``)."""
    _TARGETS[target_type] = model


def get_kind(kind: str) -> JobKind:
    try:
        return _KINDS[kind]
    except KeyError as exc:
        raise LookupError(f"Job kind {kind!r} is not registered") from exc


def registered_kinds() -> dict[str, JobKind]:
    return dict(_KINDS)


def registered_bodies() -> dict[str, Callable[..., Any]]:
    return dict(_BODIES)


# --- Errors -------------------------------------------------------------------------------------


class JobError(Exception):
    """An expected failure inside a job body. The job fails with ``code`` and ``detail``."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


class JobInProgress(CodedAPIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "job_in_progress"
    default_code = "job_in_progress"
    error_code = "job_in_progress"
    retryable = True

    def __init__(self, job: JobRun):
        self.job = job
        super().__init__({"job": serialize_job(job)})


# --- Serialization --------------------------------------------------------------------------------


def _iso(value):
    if value is None:
        return None
    return value.isoformat().replace("+00:00", "Z")


def _user_ref(user):
    if user is None:
        return None
    return {"id": user.pk, "name": user.get_full_name().strip() or user.get_username()}


def serialize_job(job: JobRun) -> dict:
    """The full job shape of API.md "Long actions"."""
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
        "created_by": _user_ref(job.created_by) if job.created_by_id else None,
        "request_id": job.request_id,
        "created_at": _iso(job.created_at),
        "started_at": _iso(job.started_at),
        "finished_at": _iso(job.finished_at),
    }


def job_summary(job: JobRun | None) -> dict | None:
    if job is None:
        return None
    return {
        "id": str(job.id),
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
    }


def active_job_for(target_type: str, target_id, kinds: Iterable[str]) -> JobRun | None:
    return (
        JobRun.objects.filter(
            target_type=target_type,
            target_id=str(target_id),
            kind__in=list(kinds),
            status__in=JobRun.ACTIVE_STATUSES,
        )
        .order_by("-created_at")
        .first()
    )


# --- Starting -------------------------------------------------------------------------------------


def _advisory_lock(target_type: str, target_id: str) -> None:
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [f"{target_type}:{target_id}"])


def _set_target_active_job(target_type: str, target_id: str, job: JobRun | None, *, only_if=None):
    model = _TARGETS.get(target_type)
    if model is None:
        return
    queryset = model.objects.filter(pk=target_id)
    if only_if is not None:
        queryset = queryset.filter(active_job=only_if)
    queryset.update(active_job=job)


def _enqueue(job_id, spec: JobKind, payload: dict) -> None:
    try:
        task = current_app.tasks.get(spec.task)
        options = {
            "args": [str(job_id)],
            "kwargs": payload,
            "queue": spec.queue,
            "task_id": str(job_id),
            "soft_time_limit": spec.timeout,
            "time_limit": spec.timeout + 60,
        }
        if task is not None:
            task.apply_async(**options)
        else:
            current_app.send_task(spec.task, **options)
    except Exception:  # broker down or misconfigured; the panel sees it on the first poll
        logger.exception("job_enqueue_failed job_id=%s kind=%s", job_id, spec.kind)
        job = JobRun.objects.filter(pk=job_id).first()
        if job is not None:
            _finish(job, JobRun.Status.FAILED, error_code="enqueue_failed", error_detail="")


def start_job(
    kind: str,
    *,
    target_id,
    account=None,
    user=None,
    request_id: str | None = None,
    payload: dict | None = None,
    job_id=None,
) -> JobRun:
    """Create a queued job and enqueue it after commit. Raises ``JobInProgress`` on conflict.

    ``job_id`` lets a caller pre-allocate the UUID when its target row must reference the job
    in the same transaction (for example ``ResearchRun.job``).
    """
    import json

    spec = get_kind(kind)
    payload = payload or {}
    if len(json.dumps(payload).encode()) > MAX_PAYLOAD_BYTES:
        raise ValueError("Job payload exceeds 16 KB")
    target_id = str(target_id)
    with transaction.atomic():
        _advisory_lock(spec.target_type, target_id)
        conflict = (
            JobRun.objects.select_related("created_by")
            .filter(
                target_type=spec.target_type,
                target_id=target_id,
                kind__in=spec.conflict_set,
                status__in=JobRun.ACTIVE_STATUSES,
            )
            .order_by("created_at")
            .first()
        )
        if conflict is not None:
            raise JobInProgress(conflict)
        extra = {"id": job_id} if job_id is not None else {}
        job = JobRun.objects.create(
            **extra,
            kind=kind,
            status=JobRun.Status.QUEUED,
            account=account,
            target_type=spec.target_type,
            target_id=target_id,
            queue=spec.queue,
            request_id=request_id,
            created_by=user if getattr(user, "is_authenticated", False) else None,
        )
        job.celery_task_id = str(job.id)
        job.save(update_fields=["celery_task_id", "updated_at"])
        _set_target_active_job(spec.target_type, target_id, job)
        transaction.on_commit(lambda: _enqueue(job.id, spec, payload))
    return job


# --- Running --------------------------------------------------------------------------------------


def _finish(job: JobRun, new_status: str, **fields) -> bool:
    """Conditional terminal update. Returns False (and logs) when the job was already terminal."""
    now = clock.now()
    values = {"status": new_status, "finished_at": now, "updated_at": now, **fields}
    if new_status == JobRun.Status.SUCCEEDED:
        values["progress"] = 100
    updated = JobRun.objects.filter(pk=job.pk, status__in=JobRun.ACTIVE_STATUSES).update(**values)
    if not updated:
        logger.warning("job_late_update job_id=%s status=%s", job.pk, new_status)
        return False
    for key, value in values.items():
        setattr(job, key, value)
    _set_target_active_job(job.target_type, job.target_id, None, only_if=job.pk)
    transaction.on_commit(lambda: job_finished.send(sender=JobRun, job=job))
    return True


class JobContext:
    def __init__(self, job: JobRun):
        self.job = job
        self._last_write = 0.0

    def progress(self, percent: int, message: str = "", *, force: bool = False) -> None:
        percent = max(self.job.progress, min(100, int(percent)))
        message = (message or "")[:120]
        self.job.progress = percent
        self.job.message = message
        now = time.monotonic()
        if not force and now - self._last_write < 1.0:
            return
        self._last_write = now
        JobRun.objects.filter(pk=self.job.pk, status=JobRun.Status.RUNNING).update(
            progress=percent, message=message, updated_at=clock.now()
        )

    def succeed(self, result: dict | None = None) -> bool:
        import json

        if result is not None and len(json.dumps(result).encode()) > MAX_RESULT_BYTES:
            raise ValueError("Job result exceeds 16 KB")
        return _finish(self.job, JobRun.Status.SUCCEEDED, result=result, message=self.job.message)

    def fail(self, code: str, detail: str = "") -> bool:
        return _finish(
            self.job,
            JobRun.Status.FAILED,
            error_code=code,
            error_detail=(detail or "")[:500],
            progress=self.job.progress,
            message=self.job.message,
        )

    @property
    def finished(self) -> bool:
        return self.job.status in JobRun.TERMINAL_STATUSES


def _claim(job_id) -> JobRun | None:
    """Move queued → running. Returns None when the body must not run (already terminal)."""
    job = JobRun.objects.select_related("account").filter(pk=job_id).first()
    if job is None:
        logger.warning("job_missing job_id=%s", job_id)
        return None
    if job.status in JobRun.TERMINAL_STATUSES:
        return None
    spec = get_kind(job.kind)
    now = clock.now()
    if job.status == JobRun.Status.QUEUED:
        claimed = JobRun.objects.filter(pk=job.pk, status=JobRun.Status.QUEUED).update(
            status=JobRun.Status.RUNNING,
            started_at=now,
            deadline_at=now + timedelta(seconds=spec.timeout),
            updated_at=now,
        )
        if not claimed:
            job.refresh_from_db()
            if job.status != JobRun.Status.RUNNING:
                return None
        else:
            job.status = JobRun.Status.RUNNING
            job.started_at = now
            job.deadline_at = now + timedelta(seconds=spec.timeout)
    # A job found running is a redelivery: the body runs again and must be idempotent.
    return job


def run_job(job_id, **payload) -> JobRun | None:
    """Run a job body synchronously. Used by the Celery task and directly by tests."""
    job = _claim(job_id)
    if job is None:
        return None
    body = _BODIES[job.kind]
    ctx = JobContext(job)
    try:
        body(ctx, **payload)
    except Retry:
        ctx.progress(ctx.job.progress, "Retrying", force=True)
        raise
    except SoftTimeLimitExceeded:
        minutes = max(1, get_kind(job.kind).timeout // 60)
        ctx.fail("timeout", f"The task took longer than {minutes} minutes.")
    except JobError as exc:  # includes ai.errors.AIError
        ctx.fail(exc.code, exc.detail)
    except Exception:
        logger.exception("job_server_error job_id=%s kind=%s", job.pk, job.kind)
        ctx.fail("server_error", f"Unexpected error. Reference: {job.pk}.")
    else:
        if not ctx.finished:
            ctx.succeed(None)
    return ctx.job


def job_task(kind: str):
    """Decorate a job body ``fn(ctx, **payload)``; registers the Celery task of the kind."""
    spec = get_kind(kind)

    def decorator(fn):
        _BODIES[kind] = fn

        @shared_task(name=spec.task, bind=True, ignore_result=True)
        @functools.wraps(fn)
        def task(self, job_id, **payload):
            run_job(job_id, **payload)

        task.body = fn
        return task

    return decorator


# --- Cancelling and sweeping ------------------------------------------------------------------------


def _revoke(job: JobRun) -> None:
    try:
        current_app.control.revoke(job.celery_task_id or str(job.pk))
    except Exception:  # best effort; the job row is already cancelled
        logger.warning("job_revoke_failed job_id=%s", job.pk)


def cancel_job(job: JobRun, reason: str = "") -> bool:
    """Cancel a queued or running job. Late updates from a still-running body are ignored."""
    cancelled = _finish(job, JobRun.Status.CANCELLED, error_detail=(reason or "")[:500])
    if cancelled:
        _revoke(job)
    return cancelled


def fail_job(job: JobRun, code: str, detail: str = "") -> bool:
    """Fail an active job from outside its body (stale-run recovery, sweepers)."""
    return _finish(job, JobRun.Status.FAILED, error_code=code, error_detail=(detail or "")[:500])


def cancel_queued_job(job: JobRun, reason: str = "") -> bool:
    if job.status != JobRun.Status.QUEUED:
        return False
    return cancel_job(job, reason)


@shared_task(name="core.sweep_stale_jobs", ignore_result=True)
def sweep_stale_jobs() -> int:
    now = clock.now()
    swept = 0
    running = JobRun.objects.filter(
        status=JobRun.Status.RUNNING, deadline_at__lt=now - STALE_GRACE
    )[:SWEEP_BATCH]
    for job in running:
        swept += _finish(job, JobRun.Status.FAILED, error_code="stale_job", error_detail="")
    queued = JobRun.objects.filter(
        status=JobRun.Status.QUEUED, created_at__lt=now - STALE_QUEUED_AFTER
    )[:SWEEP_BATCH]
    for job in queued:
        swept += _finish(
            job,
            JobRun.Status.FAILED,
            error_code="stale_job",
            error_detail="The task never started. A worker may be down.",
        )
    return swept
