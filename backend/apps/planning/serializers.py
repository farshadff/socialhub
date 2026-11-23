from collections import defaultdict

from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail, ValidationError

from apps.core.users import user_ref

from . import services
from .models import Format, Metric, PlanGoal, PlanSlot, Role, WeeklyPlan


def _err(code: str) -> list[ErrorDetail]:
    return [ErrorDetail(code, code=code)]


# --- output ---------------------------------------------------------------------------------

_dt = serializers.DateTimeField()


def _ts(value):
    return _dt.to_representation(value) if value else None


def goal_data(goal: PlanGoal) -> dict:
    return {"id": goal.id, "metric": goal.metric, "scope": goal.scope, "format": goal.format,
            "target_value": goal.target_value}


def plan_row(plan: WeeklyPlan) -> dict:
    """List-row shape: no long texts, goals or findings."""
    return {
        "id": plan.id,
        "account": plan.account_id,
        "week_start": plan.week_start.isoformat(),
        "week_end": plan.week_end.isoformat(),
        "status": plan.status,
        "title": plan.title,
        "success_metrics": plan.success_metrics,
        "slot_summary": services.slot_summary(plan),
        "readiness": services.readiness(plan),
        "activated_at": _ts(plan.activated_at),
        "closed_at": _ts(plan.closed_at),
        "updated_at": _ts(plan.updated_at),
    }


def plan_detail(plan: WeeklyPlan) -> dict:
    return {
        **plan_row(plan),
        "objective": plan.objective,
        "audience_summary": plan.audience_summary,
        "audience_segments": plan.audience_segments,
        "goals": [goal_data(goal) for goal in plan.goals.all()],
        "notes": plan.notes,
        "carried_findings": plan.carried_findings,
        "source_report": None,  # WeeklyReport arrives with E10-S02
        "created_by": user_ref(plan.created_by),
        "created_at": _ts(plan.created_at),
    }


def slot_data(slot: PlanSlot, account) -> dict:
    local = services.to_local(account, slot.scheduled_at)
    return {
        "id": slot.id,
        "plan": slot.plan_id,
        "scheduled_at": _ts(slot.scheduled_at),
        "local_date": local.date().isoformat(),
        "local_time": local.strftime("%H:%M"),
        "weekday": local.weekday(),
        "format": slot.format,
        "role": slot.role,
        "status": slot.status,
        "note": slot.note,
        "content_item": None,  # ContentItem.slot arrives with E03-S03
    }


# --- plans ----------------------------------------------------------------------------------

class PlanCreateSerializer(serializers.Serializer):
    account = serializers.IntegerField()
    week_start = serializers.DateField()
    title = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    generate_slots = serializers.BooleanField(required=False, default=True)


class SegmentSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=1, max_length=60)
    description = serializers.CharField(max_length=300, allow_blank=True, required=False,
                                        default="")


class GoalSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False)
    metric = serializers.ChoiceField(choices=Metric.choices)
    scope = serializers.ChoiceField(choices=PlanGoal.Scope.choices)
    format = serializers.ChoiceField(choices=Format.choices, allow_null=True, required=False,
                                     default=None)
    target_value = serializers.IntegerField(min_value=1, max_value=100_000_000)

    def validate(self, attrs):
        metric, scope, fmt = attrs["metric"], attrs["scope"], attrs.get("format")
        if metric == Metric.FOLLOWER_GROWTH:
            if scope != PlanGoal.Scope.WEEK_TOTAL:
                raise ValidationError({"scope": _err("invalid_combination")})
            if fmt is not None:
                raise ValidationError({"format": _err("invalid_combination")})
        if metric == Metric.REPLIES and fmt not in (None, Format.STORY):
            raise ValidationError({"format": _err("invalid_combination")})
        return attrs


class FindingStateSerializer(serializers.Serializer):
    id = serializers.CharField()
    state = serializers.ChoiceField(choices=["pending", "applied", "ignored"])


class PlanUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(min_length=1, max_length=120)
    objective = serializers.CharField(max_length=1000, allow_blank=True, trim_whitespace=False)
    audience_summary = serializers.CharField(max_length=2000, allow_blank=True,
                                             trim_whitespace=False)
    audience_segments = serializers.ListField(child=SegmentSerializer(), max_length=5)
    success_metrics = serializers.ListField(child=serializers.ChoiceField(choices=Metric.choices),
                                            min_length=1, max_length=4)
    goals = serializers.ListField(child=GoalSerializer())
    notes = serializers.CharField(max_length=5000, allow_blank=True, trim_whitespace=False)
    carried_findings_state = serializers.ListField(child=FindingStateSerializer())

    def validate_audience_segments(self, value):
        errors = {}
        seen = set()
        for index, segment in enumerate(value):
            key = segment["name"].strip().casefold()
            if key in seen:
                errors[index] = {"name": _err("unique")}
            seen.add(key)
        if errors:
            raise ValidationError(errors)
        return value

    def validate_success_metrics(self, value):
        if len(set(value)) != len(value):
            raise ValidationError(_err("duplicate"))
        return value

    def validate_goals(self, value):
        if len(value) > 20:
            raise ValidationError(_err("max_length"))
        errors = {}
        seen = set()
        for index, goal in enumerate(value):
            key = (goal["metric"], goal["scope"], goal.get("format"))
            if key in seen:
                errors[index] = {"metric": _err("duplicate")}
            seen.add(key)
        if errors:
            raise ValidationError(errors)
        return value


# --- slots ----------------------------------------------------------------------------------

class SlotWriteSerializer(serializers.Serializer):
    scheduled_at = serializers.DateTimeField(required=False)
    local_date = serializers.DateField(required=False)
    local_time = serializers.TimeField(required=False, input_formats=["%H:%M", "%H:%M:%S"])
    format = serializers.ChoiceField(choices=Format.choices)
    role = serializers.ChoiceField(choices=Role.choices, allow_null=True, required=False)
    note = serializers.CharField(max_length=500, allow_blank=True, required=False,
                                 trim_whitespace=False)
    status = serializers.ChoiceField(choices=[PlanSlot.Status.OPEN, PlanSlot.Status.SKIPPED],
                                     required=False)

    def validate(self, attrs):
        has_date, has_time = "local_date" in attrs, "local_time" in attrs
        if has_date != has_time:
            missing = "local_time" if has_date else "local_date"
            raise ValidationError({missing: _err("required")})
        if has_date:
            account = self.context["account"]
            attrs["scheduled_at"] = services.to_utc(
                account, attrs.pop("local_date"), attrs.pop("local_time").replace(second=0))
        elif not self.partial and "scheduled_at" not in attrs:
            raise ValidationError({"scheduled_at": _err("required")})
        return attrs


# --- slot template --------------------------------------------------------------------------

class TemplateRowSerializer(serializers.Serializer):
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    local_time = serializers.TimeField(input_formats=["%H:%M", "%H:%M:%S"])
    format = serializers.ChoiceField(choices=Format.choices)
    default_role = serializers.ChoiceField(choices=Role.choices, allow_null=True, required=False,
                                           default=None)
    active = serializers.BooleanField(required=False, default=True)

    def validate_local_time(self, value):
        if value.minute % 5 or value.second:
            raise ValidationError(_err("invalid_step"))
        return value


class TemplateSerializer(serializers.Serializer):
    rows = serializers.ListField(child=TemplateRowSerializer(), max_length=40)

    def validate_rows(self, rows):
        errors: dict[int, dict] = defaultdict(dict)
        seen = set()
        for index, row in enumerate(rows):
            key = (row["weekday"], row["local_time"], row["format"])
            if key in seen:
                errors[index]["local_time"] = _err("unique")
            seen.add(key)
        rules = services.posting_rules(self.context["account"])
        for index, code in services.template_violations(rows, rules).items():
            field = "format" if code == "exceeds_daily_limit" else "local_time"
            errors[index].setdefault(field, _err(code))
        if errors:
            raise ValidationError(dict(errors))
        return rows


def template_data(account) -> dict:
    return {
        "account": account.id,
        "timezone": account.timezone,
        "rows": [
            {"id": row.id, "weekday": row.weekday, "local_time": row.local_time.strftime("%H:%M"),
             "format": row.format, "default_role": row.default_role, "active": row.active}
            for row in account.slot_template.all()
        ],
    }
