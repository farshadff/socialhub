"""The content pipeline: the single writer of `ContentItem.status` (E03-S04 rules 1-7, 13-18).

Other apps plug in through `register_handler(status, fn)`, `register_cancel_hook(fn)` and
`content.actions.register`. `advance(item_id)` runs after the transaction that changed the item
commits and never raises to its caller.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from django.db import transaction
from django.utils import timezone

from apps.core.errors import InvalidTransition, JobInProgress
from apps.core.models import JobRun

from ..models import ContentEvent, ContentItem

logger = logging.getLogger(__name__)

S = ContentItem.Status

ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    S.SELECTED: frozenset({S.BRIEFED}),
    S.BRIEFED: frozenset({S.SCRIPTED, S.SELECTED, S.IN_PRODUCTION}),
    S.SCRIPTED: frozenset({S.IN_PRODUCTION, S.BRIEFED, S.SELECTED}),
    S.IN_PRODUCTION: frozenset({S.IN_CHECK}),
    S.IN_CHECK: frozenset({S.APPROVED, S.NEEDS_REVISION, S.IN_REVIEW}),
    S.NEEDS_REVISION: frozenset({S.IN_PRODUCTION}),
    S.IN_REVIEW: frozenset({S.APPROVED, S.NEEDS_REVISION, S.IN_CHECK}),
    S.APPROVED: frozenset({S.SCHEDULED, S.IN_REVIEW}),
    S.SCHEDULED: frozenset({S.PUBLISHING, S.IN_REVIEW, S.FAILED, S.PUBLISHED}),
    S.PUBLISHING: frozenset({S.PUBLISHED, S.SCHEDULED, S.FAILED}),
    S.FAILED: frozenset({S.SCHEDULED, S.PUBLISHED, S.NEEDS_REVISION}),
    S.PUBLISHED: frozenset(),
    S.CANCELLED: frozenset(),
}
NOT_CANCELLABLE = frozenset({S.PUBLISHED, S.CANCELLED, S.PUBLISHING})
for _status in ALLOWED_TRANSITIONS:
    if _status not in NOT_CANCELLABLE:
        ALLOWED_TRANSITIONS[_status] = ALLOWED_TRANSITIONS[_status] | {S.CANCELLED}

PIPELINE_ORDER = (S.SELECTED, S.BRIEFED, S.SCRIPTED, S.IN_PRODUCTION, S.NEEDS_REVISION,
                  S.IN_CHECK, S.IN_REVIEW, S.APPROVED, S.SCHEDULED, S.PUBLISHING, S.FAILED,
                  S.PUBLISHED, S.CANCELLED)

_handlers: dict[str, Callable[[ContentItem], None]] = {}
_cancel_hooks: list[Callable[[ContentItem, object], None]] = []


class HandlerAlreadyRegistered(Exception):
    pass


def register_handler(status: str, fn: Callable[[ContentItem], None]) -> None:
    existing = _handlers.get(status)
    if existing is not None and existing is not fn and (
            existing.__module__, existing.__qualname__) != (fn.__module__, fn.__qualname__):
        raise HandlerAlreadyRegistered(status)
    _handlers[status] = fn


def register_cancel_hook(fn: Callable[[ContentItem, object], None]) -> None:
    if fn not in _cancel_hooks:
        _cancel_hooks.append(fn)


def _job_payload(job: JobRun) -> dict:
    from apps.core.jobs import job_payload

    return job_payload(job)


# --- Events -------------------------------------------------------------------------------

def log_event(item: ContentItem, type: str, *, actor=None, message: str = "",
              data: dict | None = None, from_status: str | None = None,
              to_status: str | None = None) -> ContentEvent:
    return ContentEvent.objects.create(
        content_item=item, type=type, actor=actor if getattr(actor, "pk", None) else None,
        message=message[:2000], data=data or {}, from_status=from_status, to_status=to_status,
    )


# --- Creating and moving items ------------------------------------------------------------

def create_item(*, account, plan, slot, candidate, title, format, media_kind, production_mode,
                role=None, actor=None, message: str = "", data: dict | None = None
                ) -> ContentItem:
    from .. import formats

    if not formats.is_allowed(format, media_kind, production_mode):
        raise ValueError(f"Combination not allowed: {format}/{media_kind}/{production_mode}")
    item = ContentItem.objects.create(
        account=account, plan=plan, slot=slot, candidate=candidate, title=title[:200],
        format=format, media_kind=media_kind, production_mode=production_mode, role=role,
        status=S.SELECTED, created_by=actor if getattr(actor, "pk", None) else None,
    )
    log_event(item, ContentEvent.Type.STATUS_CHANGED, actor=actor, to_status=S.SELECTED,
              message=message or "Selected", data=data or {"candidate_id": candidate.pk})
    return item


def lock(item_or_id) -> ContentItem:
    pk = getattr(item_or_id, "pk", item_or_id)
    return ContentItem.objects.select_for_update().get(pk=pk)


def transition(item: ContentItem, to_status: str, *, actor=None, message: str = "",
               data: dict | None = None, hold_reason: str = "") -> ContentItem:
    """Move an item to `to_status`. Must run inside a transaction (one is opened if not)."""
    with transaction.atomic():
        locked = lock(item)
        from_status = locked.status
        if to_status not in ALLOWED_TRANSITIONS.get(from_status, frozenset()):
            raise InvalidTransition({"status": from_status,
                                     "allowed_statuses": sorted(ALLOWED_TRANSITIONS[from_status])})
        locked.status = to_status
        locked.hold_reason = hold_reason
        locked.save(update_fields=["status", "hold_reason", "updated_at"])
        log_event(locked, ContentEvent.Type.STATUS_CHANGED, actor=actor, message=message,
                  data=data, from_status=from_status, to_status=to_status)
        item_id = locked.pk
        transaction.on_commit(lambda: advance(item_id))
    item.status = locked.status
    item.hold_reason = locked.hold_reason
    item.updated_at = locked.updated_at
    return item


def set_hold_reason(item: ContentItem, text: str) -> None:
    """Change only `hold_reason`: no status change, no event, no advance (rule 5)."""
    ContentItem.objects.filter(pk=item.pk).update(hold_reason=text, updated_at=timezone.now())
    item.hold_reason = text


def advance(item_id: int) -> None:
    """Run the handler registered for the item's status. Never raises (rule 4)."""
    try:
        item = ContentItem.objects.select_related("account").get(pk=item_id)
    except ContentItem.DoesNotExist:
        return
    handler = _handlers.get(item.status)
    if handler is None:
        return
    try:
        handler(item)
    except Exception as exc:  # noqa: BLE001 - a handler error must never propagate
        code = getattr(exc, "error_code", None) or getattr(exc, "code", None)
        code = code if isinstance(code, str) else type(exc).__name__
        logger.exception("Pipeline handler for %s failed on item %s", item.status, item_id)
        try:
            log_event(item, ContentEvent.Type.JOB_FAILED,
                      message=f"Automatic step failed: {code}",
                      data={"job_id": None, "kind": f"advance.{item.status}", "error_code": code})
            set_hold_reason(item, f"Automatic step failed: {code}")
        except Exception:  # noqa: BLE001
            logger.exception("Could not record handler failure for item %s", item_id)


# --- Active jobs --------------------------------------------------------------------------

def set_active_job(item: ContentItem, job: JobRun, *, message: str = "") -> None:
    ContentItem.objects.filter(pk=item.pk).update(active_job=job, updated_at=timezone.now())
    item.active_job = job
    log_event(item, ContentEvent.Type.JOB_STARTED, message=message or f"Started {job.kind}",
              data={"job_id": str(job.id), "kind": job.kind})


def clear_active_job(item: ContentItem, job: JobRun, *, failed: bool = False,
                     error_code: str = "") -> None:
    updated = ContentItem.objects.filter(pk=item.pk, active_job_id=job.pk).update(
        active_job=None, updated_at=timezone.now())
    if updated:
        item.active_job = None
    if failed:
        log_event(item, ContentEvent.Type.JOB_FAILED, message=f"{job.kind} failed: {error_code}",
                  data={"job_id": str(job.id), "kind": job.kind, "error_code": error_code})


def active_job(item: ContentItem) -> JobRun | None:
    """The item's active job if it is still queued or running; a stale pointer is cleared."""
    if not item.active_job_id:
        return None
    job = JobRun.objects.filter(pk=item.active_job_id).first()
    if job is None or job.status not in JobRun.ACTIVE_STATUSES:
        ContentItem.objects.filter(pk=item.pk, active_job_id=item.active_job_id).update(
            active_job=None)
        item.active_job = None
        return None
    return job


def ensure_idle(item: ContentItem) -> None:
    job = active_job(item)
    if job is not None:
        raise JobInProgress(job)


# --- Cancelling ---------------------------------------------------------------------------

def release_slot(slot) -> str | None:
    """Release a reserved slot: open if still in the future, otherwise skipped."""
    if slot is None:
        return None
    try:
        from apps.planning import services as planning_services
    except ImportError:  # pragma: no cover
        planning_services = None
    if planning_services is not None and hasattr(planning_services, "release_slot"):
        from apps.planning.models import PlanSlot

        locked = PlanSlot.objects.select_for_update().get(pk=slot.pk)
        planning_services.release_slot(locked)
        return locked.status
    status = "open" if slot.scheduled_at > timezone.now() else "skipped"
    slot.status = status
    slot.save(update_fields=["status", "updated_at"])
    return status


def cancel(item: ContentItem, *, reason: str, release_candidate: bool = False,
           actor=None) -> ContentItem:
    with transaction.atomic():
        locked = lock(item)
        if locked.status in NOT_CANCELLABLE:
            details = {"status": locked.status, "allowed_statuses": []}
            if locked.status == S.PUBLISHING:
                details["reason"] = "publishing_in_progress"
            raise InvalidTransition(details)
        job = JobRun.objects.filter(pk=locked.active_job_id).first() if (
            locked.active_job_id) else None
        if job is not None and job.status in JobRun.ACTIVE_STATUSES:
            JobRun.objects.filter(pk=job.pk, status__in=JobRun.ACTIVE_STATUSES).update(
                status=JobRun.Status.CANCELLED, finished_at=timezone.now(),
                error_detail="Item cancelled")
            task_id = job.celery_task_id or str(job.id)
            transaction.on_commit(lambda: _revoke(task_id))
        from_status = locked.status
        released_slot_id = locked.slot_id
        released_status = None
        if locked.slot_id:
            released_status = release_slot(locked.slot)
        locked.slot = None
        locked.active_job = None
        locked.status = S.CANCELLED
        locked.cancelled_reason = reason
        locked.hold_reason = ""
        locked.save()
        if release_candidate:
            candidate = locked.candidate
            candidate.status = "candidate"
            candidate.rank = None
            candidate.save(update_fields=["status", "rank", "updated_at"])
        for hook in list(_cancel_hooks):
            hook(locked, actor)
        log_event(locked, ContentEvent.Type.STATUS_CHANGED, actor=actor, message=reason,
                  from_status=from_status, to_status=S.CANCELLED,
                  data={"released_slot": released_slot_id, "released_slot_status": released_status,
                        "release_candidate": release_candidate})
    return locked


def _revoke(task_id: str) -> None:
    try:
        from config.celery import app

        app.control.revoke(task_id)
    except Exception:  # noqa: BLE001 - best effort
        logger.warning("Could not revoke task %s", task_id)
