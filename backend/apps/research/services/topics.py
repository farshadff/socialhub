"""Trend topic rules: manual creation, transitions, edits (E02-S04 rules 21–27, E02-S05 rules 2–9).

``mark_used`` and ``release`` are the entry points E03 calls when a candidate built from a
topic is selected or its item is cancelled.
"""

from __future__ import annotations

from django.db import transaction

from apps.core.exceptions import InvalidTransition, field_error

from ..models import TrendTopic
from . import evidence
from .synthesis import normalize_title

Status = TrendTopic.Status

OPERATOR_TRANSITIONS: dict[str, tuple[str, ...]] = {
    Status.NEW: (Status.SHORTLISTED, Status.DISMISSED),
    Status.SHORTLISTED: (Status.NEW, Status.DISMISSED),
    Status.DISMISSED: (Status.NEW,),
    Status.USED: (),
}
CONTENT_FIELDS = ("title", "summary", "why_now", "hooks", "suggested_formats", "keywords")


def _invalid(topic: TrendTopic, allowed=()) -> InvalidTransition:
    return InvalidTransition(
        {"status": topic.status, "allowed_statuses": [str(value) for value in allowed]}
    )


def allowed_statuses(topic: TrendTopic) -> tuple[str, ...]:
    return OPERATOR_TRANSITIONS.get(topic.status, ())


def ensure_unique_title(account_id: int, plan_id, title: str, *, exclude_id: int | None = None):
    """A title must be unique among the non-dismissed topics of the account and plan."""
    queryset = TrendTopic.objects.filter(account_id=account_id).exclude(status=Status.DISMISSED)
    queryset = queryset.filter(plan_id=plan_id) if plan_id else queryset.filter(plan__isnull=True)
    if exclude_id is not None:
        queryset = queryset.exclude(pk=exclude_id)
    wanted = normalize_title(title)
    if any(normalize_title(other) == wanted for other in queryset.values_list("title", flat=True)):
        raise field_error("title", "unique")


@transaction.atomic
def create_manual(*, account, plan, data: dict, signals: list) -> TrendTopic:
    ensure_unique_title(account.pk, plan.pk if plan else None, data["title"])
    topic = TrendTopic.objects.create(
        account=account,
        plan=plan,
        run=None,
        origin=TrendTopic.Origin.MANUAL,
        status=Status.SHORTLISTED,
        title=data["title"],
        summary=data.get("summary", ""),
        why_now=data.get("why_now", ""),
        hooks=data.get("hooks", []),
        suggested_formats=data.get("suggested_formats", []),
        keywords=data.get("keywords", []),
    )
    topic.signals.set(signals)
    evidence.rescore(topic)
    return topic


def transition(topic: TrendTopic, new_status: str) -> TrendTopic:
    """An operator status change following the table in E02-S04 rule 21."""
    if new_status == topic.status:
        return topic
    allowed = allowed_statuses(topic)
    if new_status not in allowed:
        raise _invalid(topic, allowed)
    topic.status = new_status
    topic.save(update_fields=["status", "updated_at"])
    return topic


@transaction.atomic
def mark_used(topic_id: int) -> TrendTopic:
    topic = TrendTopic.objects.select_for_update().get(pk=topic_id)
    if topic.status not in (Status.NEW, Status.SHORTLISTED):
        raise _invalid(topic)
    topic.status = Status.USED
    topic.save(update_fields=["status", "updated_at"])
    return topic


@transaction.atomic
def release(topic_id: int) -> TrendTopic:
    """Undo ``mark_used`` when the selected item is cancelled with release (E03)."""
    topic = TrendTopic.objects.select_for_update().get(pk=topic_id)
    if topic.status == Status.USED:
        topic.status = Status.SHORTLISTED
        topic.save(update_fields=["status", "updated_at"])
    return topic


@transaction.atomic
def update_topic(topic: TrendTopic, changes: dict) -> TrendTopic:
    """Apply a PATCH (E02-S05 rules 2–9). ``changes`` holds validated values only."""
    topic = TrendTopic.objects.select_for_update().get(pk=topic.pk)
    if topic.status == Status.USED:
        raise _invalid(topic)

    new_status = changes.get("status")
    if new_status is not None and new_status != topic.status:
        allowed = allowed_statuses(topic)
        if new_status not in allowed:
            raise _invalid(topic, allowed)

    plan_changed = "plan" in changes
    plan = changes["plan"] if plan_changed else topic.plan
    title = changes.get("title", topic.title)
    if "title" in changes or plan_changed:
        ensure_unique_title(topic.account_id, plan.pk if plan else None, title, exclude_id=topic.pk)

    content_changed = False
    for name in CONTENT_FIELDS:
        if name in changes and changes[name] != getattr(topic, name):
            setattr(topic, name, changes[name])
            content_changed = True
    signals_changed = False
    if "signals" in changes:
        new_ids = sorted(signal.pk for signal in changes["signals"])
        if new_ids != sorted(topic.signals.values_list("pk", flat=True)):
            signals_changed = True
            content_changed = True
    if plan_changed:
        topic.plan = plan

    if new_status is not None:
        topic.status = new_status
    elif content_changed and topic.status == Status.NEW:
        # A hand-edited topic is protected from replacement by the next run (rule 5).
        topic.status = Status.SHORTLISTED
    topic.save()

    if signals_changed:
        topic.signals.set(changes["signals"])
        evidence.rescore(topic)
    return topic


@transaction.atomic
def attach_signal(topic: TrendTopic, signal) -> TrendTopic:
    """Manual signal entry with ``topic`` (E02-S02 rule 40)."""
    if topic.status == Status.USED:
        raise _invalid(topic)
    topic.signals.add(signal)
    evidence.rescore(topic)
    return topic
