"""E01 endpoints: plans, goals (nested), slots, slot template and plan lifecycle."""

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import InstagramAccount
from apps.core.errors import InvalidTransition
from apps.core.pagination import BoundedPageNumberPagination
from apps.core.params import csv_values, required_account

from . import clock, services
from .models import PlanGoal, PlanSlot, SlotTemplate, WeeklyPlan
from .serializers import (
    PlanCreateSerializer,
    PlanUpdateSerializer,
    SlotWriteSerializer,
    TemplateSerializer,
    plan_detail,
    plan_row,
    slot_data,
    template_data,
)

PLAN_FIELDS = {"title", "objective", "audience_summary", "audience_segments", "success_metrics",
               "goals", "notes", "carried_findings_state"}
PLAN_EDITABLE = {
    WeeklyPlan.Status.DRAFT: PLAN_FIELDS,
    WeeklyPlan.Status.ACTIVE: PLAN_FIELDS,
    WeeklyPlan.Status.CLOSED: {"notes"},
}
PLAN_READ_ONLY = ("account", "week_start", "week_end", "status")

SLOT_EDITABLE = {
    PlanSlot.Status.OPEN: {"scheduled_at", "format", "role", "note", "status"},
    PlanSlot.Status.SKIPPED: {"scheduled_at", "format", "role", "note", "status"},
    PlanSlot.Status.RESERVED: {"scheduled_at", "role", "note"},
    PlanSlot.Status.SCHEDULED: {"note"},
    PlanSlot.Status.PUBLISHED: {"note"},
}


def _err(code: str) -> list[ErrorDetail]:
    return [ErrorDetail(code, code=code)]


def _date_param(request, name):
    raw = request.query_params.get(name)
    if not raw:
        return None
    value = parse_date(raw)
    if value is None:
        raise ValidationError({name: _err("invalid")})
    return value


def _plans():
    return (WeeklyPlan.objects.select_related("account", "created_by")
            .prefetch_related("goals", "slots"))


class SlotPagination(BoundedPageNumberPagination):
    page_size = 100


class JsonOnlyNegotiation(DefaultContentNegotiation):
    """The API is JSON only. Ignoring DRF's `?format=` renderer override frees `format` for the
    slot filter the spec defines."""

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


class PlanViewSet(viewsets.ViewSet):
    content_negotiation_class = JsonOnlyNegotiation

    def get_plan(self, pk) -> WeeklyPlan:
        return get_object_or_404(_plans(), pk=pk)

    def detail_response(self, pk, status_code=status.HTTP_200_OK):
        return Response(plan_detail(self.get_plan(pk)), status=status_code)

    # --- E01-S01 --------------------------------------------------------------------------

    def list(self, request):
        account = required_account(request)
        plans = _plans().filter(account=account)
        if statuses := csv_values(request, "status"):
            plans = plans.filter(status__in=statuses)
        if after := _date_param(request, "week_start_after"):
            plans = plans.filter(week_start__gte=after)
        if before := _date_param(request, "week_start_before"):
            plans = plans.filter(week_start__lte=before)
        ordering = request.query_params.get("ordering", "-week_start")
        if ordering not in ("week_start", "-week_start"):
            ordering = "-week_start"
        paginator = BoundedPageNumberPagination()
        page = paginator.paginate_queryset(plans.order_by(ordering), request, view=self)
        return paginator.get_paginated_response([plan_row(plan) for plan in page])

    def create(self, request):
        serializer = PlanCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        account = InstagramAccount.objects.filter(pk=data["account"]).first()
        if account is None:
            raise ValidationError({"account": _err("does_not_exist")})
        plan = services.create_plan(account, data["week_start"], title=data["title"].strip(),
                                    generate=data["generate_slots"], user=request.user)
        return self.detail_response(plan.pk, status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        return self.detail_response(pk)

    def partial_update(self, request, pk=None):
        plan = self.get_plan(pk)
        body = request.data
        read_only = {key: _err("read_only") for key in PLAN_READ_ONLY if key in body}
        if read_only:
            raise ValidationError(read_only)
        blocked = sorted(key for key in body if key in PLAN_FIELDS
                         and key not in PLAN_EDITABLE[plan.status])
        if blocked:
            raise InvalidTransition({"status": plan.status, "fields": blocked})
        serializer = PlanUpdateSerializer(data=body, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            plan = WeeklyPlan.objects.select_for_update().get(pk=plan.pk)
            if "goals" in data:
                _replace_goals(plan, data.pop("goals"))
            if "carried_findings_state" in data:
                plan.carried_findings = _apply_finding_states(
                    plan.carried_findings, data.pop("carried_findings_state"))
            for field, value in data.items():
                setattr(plan, field, value)
            plan.save()
        return self.detail_response(plan.pk)

    def destroy(self, request, pk=None):
        plan = self.get_plan(pk)
        if plan.status != WeeklyPlan.Status.DRAFT:
            raise InvalidTransition({"status": plan.status})
        plan.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"])
    def current(self, request):
        account = required_account(request)
        today = services.local_today(account)
        active = _plans().filter(account=account, status=WeeklyPlan.Status.ACTIVE)
        plan = (active.filter(week_start__lte=today, week_end__gte=today).first()
                or active.filter(week_start__gt=today).order_by("week_start").first())
        if plan is None:
            raise NotFound()
        return Response(plan_detail(plan))

    # --- E01-S03 --------------------------------------------------------------------------

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        plan = services.activate(self.get_plan(pk))
        return self.detail_response(plan.pk)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        force = request.data.get("force", False)
        if not isinstance(force, bool):
            raise ValidationError({"force": _err("invalid")})
        result = services.close(self.get_plan(pk), force=force)
        return Response({"plan": plan_detail(self.get_plan(pk)),
                         "slots_skipped": result["slots_skipped"],
                         "unfinished_items": result["unfinished_items"]})

    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        week_start = None
        if raw := request.data.get("week_start"):
            week_start = parse_date(str(raw)) if isinstance(raw, str) else None
            if week_start is None:
                raise ValidationError({"week_start": _err("invalid")})
        copy_slots = request.data.get("copy_slots", True)
        if not isinstance(copy_slots, bool):
            raise ValidationError({"copy_slots": _err("invalid")})
        copy = services.duplicate(self.get_plan(pk), week_start=week_start,
                                  copy_slots=copy_slots, user=request.user)
        return self.detail_response(copy.pk, status.HTTP_201_CREATED)

    # --- E01-S02 --------------------------------------------------------------------------

    @action(detail=True, methods=["get", "post"], url_path="slots")
    def slots(self, request, pk=None):
        plan = self.get_plan(pk)
        if request.method == "POST":
            return _create_slot(plan, request)
        slots = plan.slots.all()
        if statuses := csv_values(request, "status"):
            slots = slots.filter(status__in=statuses)
        if formats := csv_values(request, "format"):
            slots = slots.filter(format__in=formats)
        paginator = SlotPagination()
        page = paginator.paginate_queryset(slots.order_by("scheduled_at", "id"), request, view=self)
        return paginator.get_paginated_response([slot_data(slot, plan.account) for slot in page])

    @action(detail=True, methods=["post"], url_path="slots/generate")
    def generate(self, request, pk=None):
        plan = self.get_plan(pk)
        replace = request.data.get("replace", False)
        if not isinstance(replace, bool):
            raise ValidationError({"replace": _err("invalid")})
        result = services.generate_slots(plan, replace=replace)
        slots = PlanSlot.objects.filter(plan=plan).order_by("scheduled_at", "id")
        return Response({**result, "slots": [slot_data(slot, plan.account) for slot in slots]})


class SlotViewSet(viewsets.ViewSet):
    content_negotiation_class = JsonOnlyNegotiation

    def get_slot(self, pk) -> PlanSlot:
        return get_object_or_404(PlanSlot.objects.select_related("plan__account"), pk=pk)

    def retrieve(self, request, pk=None):
        slot = self.get_slot(pk)
        return Response(slot_data(slot, slot.plan.account))

    def partial_update(self, request, pk=None):
        slot = self.get_slot(pk)
        plan = slot.plan
        services.ensure_plan_open(plan)
        serializer = SlotWriteSerializer(data=request.data, partial=True,
                                         context={"account": plan.account})
        serializer.is_valid(raise_exception=True)
        changes = {key: value for key, value in serializer.validated_data.items()
                   if getattr(slot, key) != value}
        blocked = sorted(set(changes) - SLOT_EDITABLE[slot.status])
        if blocked:
            raise InvalidTransition({"status": slot.status, "fields": blocked})
        scheduled_at = changes.get("scheduled_at", slot.scheduled_at)
        fmt = changes.get("format", slot.format)
        new_status = changes.get("status", slot.status)
        if "scheduled_at" in changes:
            _check_time(plan, scheduled_at)
        if ("scheduled_at" in changes or "format" in changes) and _taken(plan, scheduled_at, fmt,
                                                                          exclude_id=slot.pk):
            raise ValidationError({"scheduled_at": _err("unique")})
        placement_changed = bool({"scheduled_at", "format", "status"} & set(changes))
        if new_status != PlanSlot.Status.SKIPPED and placement_changed and (
            code := services.check_slot_rules(plan, scheduled_at, fmt, exclude_id=slot.pk)
        ):
            raise ValidationError({"scheduled_at": _err(code)})
        for field, value in changes.items():
            setattr(slot, field, value)
        slot.save()
        return Response(slot_data(slot, plan.account))

    def destroy(self, request, pk=None):
        slot = self.get_slot(pk)
        services.ensure_plan_open(slot.plan)
        if slot.status not in (PlanSlot.Status.OPEN, PlanSlot.Status.SKIPPED):
            raise InvalidTransition({"status": slot.status})
        slot.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SlotTemplateView(APIView):
    def get(self, request, account_id):
        account = get_object_or_404(InstagramAccount, pk=account_id)
        return Response(template_data(account))

    def put(self, request, account_id):
        account = get_object_or_404(InstagramAccount, pk=account_id)
        serializer = TemplateSerializer(data=request.data, context={"account": account})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            account.slot_template.all().delete()
            SlotTemplate.objects.bulk_create(
                SlotTemplate(account=account, **row) for row in serializer.validated_data["rows"])
        return Response(template_data(account))


# --- helpers ------------------------------------------------------------------------------

def _check_time(plan, scheduled_at) -> None:
    start, end = services.week_bounds_utc(plan)
    if not start <= scheduled_at < end:
        raise ValidationError({"scheduled_at": _err("outside_week")})
    if scheduled_at < clock.now() + services.MIN_LEAD:
        raise ValidationError({"scheduled_at": _err("too_soon")})


def _taken(plan, scheduled_at, fmt, exclude_id=None) -> bool:
    others = plan.slots.filter(scheduled_at=scheduled_at, format=fmt)
    if exclude_id is not None:
        others = others.exclude(pk=exclude_id)
    return others.exists()


def _create_slot(plan, request):
    services.ensure_plan_open(plan)
    serializer = SlotWriteSerializer(data=request.data, context={"account": plan.account})
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    if plan.slots.count() >= services.MAX_SLOTS:
        raise ValidationError({"non_field_errors": _err("max_slots")})
    _check_time(plan, data["scheduled_at"])
    if _taken(plan, data["scheduled_at"], data["format"]):
        raise ValidationError({"scheduled_at": _err("unique")})
    if code := services.check_slot_rules(plan, data["scheduled_at"], data["format"]):
        raise ValidationError({"scheduled_at": _err(code)})
    slot = PlanSlot.objects.create(plan=plan, scheduled_at=data["scheduled_at"],
                                   format=data["format"], role=data.get("role"),
                                   note=data.get("note", ""))
    return Response(slot_data(slot, plan.account), status=status.HTTP_201_CREATED)


def _replace_goals(plan, goals: list[dict]) -> None:
    existing = set(plan.goals.values_list("id", flat=True))
    unknown = {index: {"id": _err("does_not_exist")} for index, goal in enumerate(goals)
               if "id" in goal and goal["id"] not in existing}
    if unknown:
        raise ValidationError({"goals": unknown})
    updates = [goal for goal in goals if "id" in goal]
    plan.goals.exclude(id__in=[goal["id"] for goal in updates]).delete()
    # Free each kept goal's unique tuple first, so swapping values between rows cannot collide.
    for goal in updates:
        PlanGoal.objects.filter(pk=goal["id"]).update(metric=f"_{goal['id']}")
    for goal in updates:
        PlanGoal.objects.filter(pk=goal["id"]).update(
            metric=goal["metric"], scope=goal["scope"], format=goal.get("format"),
            target_value=goal["target_value"])
    PlanGoal.objects.bulk_create(
        PlanGoal(plan=plan, metric=goal["metric"], scope=goal["scope"], format=goal.get("format"),
                 target_value=goal["target_value"])
        for goal in goals if "id" not in goal)


def _apply_finding_states(findings: list[dict], states: list[dict]) -> list[dict]:
    findings = [dict(finding) for finding in findings]
    by_id = {str(finding.get("id")): finding for finding in findings}
    unknown = {index: {"id": _err("does_not_exist")} for index, item in enumerate(states)
               if item["id"] not in by_id}
    if unknown:
        raise ValidationError({"carried_findings_state": unknown})
    for item in states:
        by_id[item["id"]]["state"] = item["state"]
    return findings
