"""Topic status rules, manual topics and updates (E02-S04 rules 21-27, E02-S05 rules 2-9)."""

from django.db import transaction
from django.utils import timezone

from apps.core.errors import InvalidTransition

from ..models import TrendTopic
from . import evidence
from .text import normalized_key

S = TrendTopic.Status

# Transitions an operator may make through the API (rule 21). `used` is set only by mark_used.
OPERATOR_TRANSITIONS = {
    S.NEW: {S.SHORTLISTED, S.DISMISSED},
    S.SHORTLISTED: {S.NEW, S.DISMISSED},
    S.DISMISSED: {S.NEW},
    S.USED: set(),
}
CONTENT_FIELDS = ("title", "summary", "why_now", "hooks", "suggested_formats", "keywords")


def allowed_statuses(topic) -> list[str]:
    return sorted(OPERATOR_TRANSITIONS.get(topic.status, set()))


def invalid_transition(topic) -> InvalidTransition:
    return InvalidTransition(details={"status": topic.status,
                                      "allowed_statuses": allowed_statuses(topic)})


def transition(topic, target: str) -> None:
    if target == topic.status:
        return
    if target not in OPERATOR_TRANSITIONS.get(topic.status, set()):
        raise invalid_transition(topic)
    topic.status = target


def mark_used(topic_id: int) -> TrendTopic:
    """Called by E03-S03 when a candidate built from the topic is selected."""
    with transaction.atomic():
        topic = TrendTopic.objects.select_for_update().get(pk=topic_id)
        if topic.status not in (S.NEW, S.SHORTLISTED):
            raise invalid_transition(topic)
        topic.status = S.USED
        topic.save(update_fields=["status", "updated_at"])
    return topic


def title_taken(account, plan, title: str, *, exclude_id: int | None = None) -> bool:
    """Another non-dismissed topic of the same account and plan has this title (rule 26)."""
    key = normalized_key(title)
    qs = TrendTopic.objects.filter(account=account, plan=plan).exclude(status=S.DISMISSED)
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    return any(normalized_key(t) == key for t in qs.values_list("title", flat=True))


@transaction.atomic
def create_manual(*, account, plan, data: dict, signals) -> TrendTopic:
    topic = TrendTopic.objects.create(
        account=account,
        plan=plan,
        run=None,
        origin=TrendTopic.Origin.MANUAL,
        status=S.SHORTLISTED,
        **{field: data.get(field, [] if field in ("hooks", "suggested_formats", "keywords")
                           else "") for field in CONTENT_FIELDS},
    )
    topic.signals.set(signals)
    evidence.score_topic(topic, timezone.now())
    return topic


@transaction.atomic
def update_topic(topic: TrendTopic, data: dict, signals=None) -> TrendTopic:
    """Apply a PATCH (E02-S05 rules 2-9). `signals` is None when `signal_ids` was not sent."""
    topic = TrendTopic.objects.select_for_update().get(pk=topic.pk)
    if topic.status == S.USED:
        raise invalid_transition(topic)

    changed_content = False
    for field in CONTENT_FIELDS:
        if field in data and data[field] != getattr(topic, field):
            setattr(topic, field, data[field])
            changed_content = True
    if "plan" in data:
        topic.plan = data["plan"]

    signals_changed = False
    if signals is not None:
        new_ids = {s.pk for s in signals}
        if new_ids != set(topic.signals.values_list("pk", flat=True)):
            topic.signals.set(signals)
            signals_changed = True

    if "status" in data:
        transition(topic, data["status"])
    elif (changed_content or signals_changed) and topic.status == S.NEW:
        topic.status = S.SHORTLISTED  # editing protects the topic from replacement (rule 5)

    topic.save()
    if signals_changed:
        evidence.score_topic(topic, timezone.now())
    return topic


def attach_signal(topic: TrendTopic, signal) -> None:
    """Manual signal attach (E02-S02 rule 40): link and rescore."""
    topic.signals.add(signal)
    evidence.score_topic(topic, timezone.now())
