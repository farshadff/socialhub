"""Weekly plan rules shared by the API, the admin and the daily task (E01-S01, S02, S03)."""

import logging
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.core.exceptions import ObjectDoesNotExist
from django.db import IntegrityError, transaction
from rest_framework.exceptions import ErrorDetail, ValidationError

from apps.core.errors import InvalidTransition

from . import clock
from .models import FEED_FORMATS, Format, PlanGoal, PlanSlot, WeeklyPlan
from .signals import plan_activated, plan_closed

logger = logging.getLogger(__name__)

MAX_WEEKS_AHEAD = 8
MIN_LEAD = timedelta(minutes=30)
MAX_SLOTS = 60
MAX_TEMPLATE_ROWS = 40
AUTO_CLOSE_AFTER_DAYS = 2

DEFAULT_POSTING_RULES = {"min_gap_minutes": 120, "max_feed_per_day": 2,
                         "max_stories_per_day": 5, "max_revisions": 2}

FILLED_STATUSES = (PlanSlot.Status.RESERVED, PlanSlot.Status.SCHEDULED, PlanSlot.Status.PUBLISHED)


# --- errors ---------------------------------------------------------------------------------

def field_error(path: str, code: str) -> ValidationError:
    """A validation error on one field; dot paths become nested so the handler prints them."""
    detail: object = [ErrorDetail(code, code=code)]
    for part in reversed(path.split(".")):
        detail = {part: detail}
    return ValidationError(detail)


# --- time -----------------------------------------------------------------------------------

def account_tz(account) -> ZoneInfo:
    return ZoneInfo(account.timezone)


def local_today(account) -> date:
    return clock.now().astimezone(account_tz(account)).date()


def to_utc(account, local_date: date, local_time: time) -> datetime:
    """Local wall-clock time in the account timezone to UTC, using the timezone database."""
    return datetime.combine(local_date, local_time, tzinfo=account_tz(account)).astimezone(UTC)


def to_local(account, value: datetime) -> datetime:
    return value.astimezone(account_tz(account))


def current_week_start(account) -> date:
    today = local_today(account)
    return today - timedelta(days=(today.weekday() - account.week_start_day) % 7)


def week_ended(plan) -> bool:
    return local_today(plan.account) > plan.week_end


def week_bounds_utc(plan) -> tuple[datetime, datetime]:
    """[start, end) of the plan week in UTC, from 00:00 on week_start to 24:00 on week_end."""
    start = to_utc(plan.account, plan.week_start, time(0, 0))
    end = to_utc(plan.account, plan.week_end + timedelta(days=1), time(0, 0))
    return start, end


def posting_rules(account) -> dict:
    return {**DEFAULT_POSTING_RULES, **(account.posting_rules or {})}


# --- creation -------------------------------------------------------------------------------

def validate_new_week(account, week_start: date) -> None:
    if account.status == "archived":
        raise field_error("account", "account_archived")
    if week_start.weekday() != account.week_start_day:
        raise field_error("week_start", "invalid_week_start")
    first = current_week_start(account)
    if week_start < first or week_start > first + timedelta(weeks=MAX_WEEKS_AHEAD):
        raise field_error("week_start", "out_of_range")
    if WeeklyPlan.objects.filter(account=account, week_start=week_start).exists():
        raise field_error("week_start", "unique")


def _brand_audience(account) -> str:
    try:
        return account.brand.audience_summary
    except ObjectDoesNotExist:  # no brand profile yet
        return ""


def create_plan(account, week_start: date, *, title: str = "", generate: bool = True,
                user=None) -> WeeklyPlan:
    validate_new_week(account, week_start)
    try:
        with transaction.atomic():
            plan = WeeklyPlan.objects.create(
                account=account, week_start=week_start, title=title,
                audience_summary=_brand_audience(account), created_by=user,
            )
            if generate and account.slot_template.filter(active=True).exists():
                generate_slots(plan, replace=False)
    except IntegrityError:
        raise field_error("week_start", "unique") from None
    return plan


# --- readiness and summaries ----------------------------------------------------------------

def readiness(plan) -> dict:
    slots = list(plan.slots.all())
    goals = list(plan.goals.all())
    problems: list[dict] = []
    if not plan.objective.strip():
        problems.append({"code": "objective_missing"})
    if not plan.audience_summary.strip():
        problems.append({"code": "audience_missing"})
    if not any(slot.status != PlanSlot.Status.SKIPPED for slot in slots):
        problems.append({"code": "no_slots"})
    goal_metrics = {goal.metric for goal in goals}
    missing = [metric for metric in plan.success_metrics if metric not in goal_metrics]
    if missing:
        problems.append({"code": "goal_missing", "details": {"metrics": missing}})
    if week_ended(plan):
        problems.append({"code": "week_ended"})
    return {"can_activate": not problems, "problems": problems}


def slot_summary(plan) -> dict:
    """Counts for list rows. `total` and `by_format` leave out skipped slots."""
    by_format: dict[str, int] = defaultdict(int)
    by_status: dict[str, int] = defaultdict(int)
    total = filled = 0
    for slot in plan.slots.all():
        by_status[slot.status] += 1
        if slot.status == PlanSlot.Status.SKIPPED:
            continue
        total += 1
        by_format[slot.format] += 1
        if slot.status in FILLED_STATUSES:
            filled += 1
    return {"total": total, "filled": filled, "by_format": dict(by_format),
            "by_status": dict(by_status)}


# --- posting rules --------------------------------------------------------------------------

def rule_violations(items: list[tuple[object, int, str]], rules: dict) -> dict[int, str]:
    """Check (day, minute-of-day, format) items in order against the account's posting rules.

    Returns {index: code} for the items that break a rule. The item that pushes a day over its
    limit, or that sits too close to an earlier reel or feed post that day, carries the error.
    Stories are exempt from the gap rule.
    """
    errors: dict[int, str] = {}
    feed_count: dict[object, int] = defaultdict(int)
    story_count: dict[object, int] = defaultdict(int)
    feed_minutes: dict[object, list[int]] = defaultdict(list)
    for index, (day, minutes, fmt) in enumerate(items):
        if fmt in FEED_FORMATS:
            feed_count[day] += 1
            if feed_count[day] > rules["max_feed_per_day"]:
                errors[index] = "exceeds_daily_limit"
                continue
            if any(abs(other - minutes) < rules["min_gap_minutes"] for other in feed_minutes[day]):
                errors[index] = "gap_too_small"
                continue
            feed_minutes[day].append(minutes)
        elif fmt == Format.STORY:
            story_count[day] += 1
            if story_count[day] > rules["max_stories_per_day"]:
                errors[index] = "exceeds_daily_limit"
    return errors


def _minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def check_slot_rules(plan, scheduled_at: datetime, fmt: str, *, exclude_id=None) -> str | None:
    """The posting-rule error for placing one slot, given the plan's other non-skipped slots."""
    account = plan.account
    local = to_local(account, scheduled_at)
    others = plan.slots.exclude(status=PlanSlot.Status.SKIPPED)
    if exclude_id is not None:
        others = others.exclude(pk=exclude_id)
    same_day = []
    for slot in others:
        slot_local = to_local(account, slot.scheduled_at)
        if slot_local.date() == local.date():
            same_day.append((local.date(), _minutes(slot_local.time()), slot.format))
    same_day.sort(key=lambda item: item[1])
    items = [*same_day, (local.date(), _minutes(local.time()), fmt)]
    return rule_violations(items, posting_rules(account)).get(len(items) - 1)


def template_violations(rows: list[dict], rules: dict) -> dict[int, str]:
    indexed = [(index, row) for index, row in enumerate(rows) if row.get("active", True)]
    items = [(row["weekday"], _minutes(row["local_time"]), row["format"]) for _, row in indexed]
    return {indexed[i][0]: code for i, code in rule_violations(items, rules).items()}


# --- slots ----------------------------------------------------------------------------------

def ensure_plan_open(plan) -> None:
    if plan.status == WeeklyPlan.Status.CLOSED:
        raise InvalidTransition({"status": plan.status})


def generate_slots(plan, *, replace: bool = False) -> dict:
    """Create one open slot per active template row for the plan week (E01-S02 rules 5–9)."""
    ensure_plan_open(plan)
    account = plan.account
    rows = list(account.slot_template.filter(active=True))
    if not rows:
        raise field_error("non_field_errors", "no_template")
    earliest = clock.now() + MIN_LEAD
    with transaction.atomic():
        deleted = 0
        if replace:
            open_slots = PlanSlot.objects.filter(plan=plan, status=PlanSlot.Status.OPEN)
            deleted = open_slots.count()
            open_slots.delete()
        # Query afresh: `plan.slots.all()` may be a prefetched list from before the delete.
        existing = {(slot.scheduled_at, slot.format)
                    for slot in PlanSlot.objects.filter(plan=plan)}
        to_create: list[PlanSlot] = []
        skipped = 0
        for row in rows:
            offset = (row.weekday - plan.week_start.weekday()) % 7
            at = to_utc(account, plan.week_start + timedelta(days=offset), row.local_time)
            if (at, row.format) in existing or at < earliest:
                skipped += 1
                continue
            existing.add((at, row.format))
            to_create.append(PlanSlot(plan=plan, scheduled_at=at, format=row.format,
                                      role=row.default_role))
        if len(existing) > MAX_SLOTS:
            raise field_error("non_field_errors", "max_slots")
        PlanSlot.objects.bulk_create(to_create)
    return {"created": len(to_create), "skipped": skipped, "deleted": deleted}


def reserve_slot(slot) -> PlanSlot:
    """open → reserved when selection assigns an item (E01-S02 rule 13, used by E03/E04)."""
    if slot.status != PlanSlot.Status.OPEN or slot.plan.status == WeeklyPlan.Status.CLOSED:
        raise InvalidTransition({"status": slot.status})
    slot.status = PlanSlot.Status.RESERVED
    slot.save(update_fields=["status", "updated_at"])
    return slot


def release_slot(slot) -> PlanSlot:
    """Free a slot whose item was cancelled, rejected or moved: open if its time is still in the
    future, otherwise skipped (E01-S02 rule 13)."""
    if slot.status == PlanSlot.Status.PUBLISHED:
        raise InvalidTransition({"status": slot.status})
    future = slot.scheduled_at > clock.now() and slot.plan.status != WeeklyPlan.Status.CLOSED
    slot.status = PlanSlot.Status.OPEN if future else PlanSlot.Status.SKIPPED
    slot.save(update_fields=["status", "updated_at"])
    return slot


# --- lifecycle ------------------------------------------------------------------------------

def _send_after_commit(signal, **kwargs) -> None:
    def send():
        for receiver, result in signal.send_robust(sender=WeeklyPlan, **kwargs):
            if isinstance(result, Exception):
                logger.error("Signal receiver %r failed for plan %s: %r", receiver,
                             kwargs["plan"].pk, result)

    transaction.on_commit(send)


def activate(plan) -> WeeklyPlan:
    with transaction.atomic():
        plan = WeeklyPlan.objects.select_for_update().select_related("account").get(pk=plan.pk)
        if plan.status != WeeklyPlan.Status.DRAFT:
            raise InvalidTransition({"status": plan.status})
        ready = readiness(plan)
        if not ready["can_activate"]:
            raise InvalidTransition({"status": plan.status, "problems": ready["problems"]})
        plan.status = WeeklyPlan.Status.ACTIVE
        plan.activated_at = clock.now()
        plan.save(update_fields=["status", "activated_at", "updated_at"])
        _send_after_commit(plan_activated, plan=plan)
    return plan


def unfinished_item_count(plan) -> int:
    """Content items of the plan still in the pipeline. Content items arrive with E03."""
    return 0


def close(plan, *, force: bool = False, automatic: bool = False) -> dict:
    with transaction.atomic():
        plan = WeeklyPlan.objects.select_for_update().select_related("account").get(pk=plan.pk)
        if plan.status != WeeklyPlan.Status.ACTIVE:
            raise InvalidTransition({"status": plan.status})
        ended = week_ended(plan)
        if not ended and not force:
            raise InvalidTransition({"status": plan.status, "reason": "week_not_ended",
                                     "week_end": plan.week_end.isoformat()})
        plan.status = WeeklyPlan.Status.CLOSED
        plan.closed_at = clock.now()
        plan.save(update_fields=["status", "closed_at", "updated_at"])
        slots_skipped = plan.slots.filter(status=PlanSlot.Status.OPEN).update(
            status=PlanSlot.Status.SKIPPED, updated_at=clock.now())
        _send_after_commit(plan_closed, plan=plan, forced=not ended, automatic=automatic)
    return {"plan": plan, "slots_skipped": slots_skipped,
            "unfinished_items": unfinished_item_count(plan)}


def duplicate(plan, *, week_start: date | None = None, copy_slots: bool = True,
              user=None) -> WeeklyPlan:
    account = plan.account
    target = week_start or plan.week_start + timedelta(days=7)
    validate_new_week(account, target)
    offset = target - plan.week_start
    earliest = clock.now() + MIN_LEAD
    try:
        with transaction.atomic():
            copy = WeeklyPlan.objects.create(
                account=account, week_start=target, objective=plan.objective,
                audience_summary=plan.audience_summary,
                audience_segments=plan.audience_segments,
                success_metrics=plan.success_metrics, created_by=user,
            )
            PlanGoal.objects.bulk_create([
                PlanGoal(plan=copy, metric=goal.metric, scope=goal.scope, format=goal.format,
                         target_value=goal.target_value)
                for goal in plan.goals.all()
            ])
            if copy_slots:
                seen = set()
                new_slots = []
                for slot in plan.slots.exclude(status=PlanSlot.Status.SKIPPED):
                    local = to_local(account, slot.scheduled_at)
                    at = to_utc(account, local.date() + offset, local.time().replace(tzinfo=None))
                    if at < earliest or (at, slot.format) in seen:
                        continue
                    seen.add((at, slot.format))
                    new_slots.append(PlanSlot(plan=copy, scheduled_at=at, format=slot.format,
                                              role=slot.role))
                PlanSlot.objects.bulk_create(new_slots)
    except IntegrityError:
        raise field_error("week_start", "unique") from None
    return copy


def close_finished_plans() -> dict:
    """Close every active plan whose week ended at least two full days ago (account timezone)."""
    closed = failed = 0
    candidates = (WeeklyPlan.objects.filter(status=WeeklyPlan.Status.ACTIVE)
                  .exclude(account__status="archived").select_related("account"))
    for plan in candidates:
        try:
            if local_today(plan.account) <= plan.week_end + timedelta(days=AUTO_CLOSE_AFTER_DAYS):
                continue
            close(plan, force=False, automatic=True)
            closed += 1
        except InvalidTransition:
            continue  # closed by someone else in the meantime
        except Exception:
            failed += 1
            logger.exception("Automatic close failed for plan %s", plan.pk)
    return {"closed": closed, "failed": failed}
