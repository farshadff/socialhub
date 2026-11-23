"""Content item, format, brief and script endpoints (E03-S04, E04, E05)."""

from __future__ import annotations

from django.db.models import Case, F, IntegerField, Q, Value, When
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.jobs import job_payload
from apps.core.pagination import BoundedPageNumberPagination
from apps.core.params import bool_param, csv_values, datetime_param, required_account

from . import formats, serializers
from .models import Brief, ContentEvent, ContentItem, ScriptVersion
from .services import briefs, item_settings, pipeline, scripts

ORDERINGS = {"slot_time", "-slot_time", "-updated_at", "-created_at", "status"}


def get_item(pk) -> ContentItem:
    return get_object_or_404(
        ContentItem.objects.select_related("account", "plan", "slot", "candidate",
                                           "current_brief", "current_script",
                                           "current_version", "created_by"), pk=pk)


def _request_id(request):
    return getattr(request, "request_id", None)


def _job_response(job):
    return Response({"job": job_payload(job)}, status=status.HTTP_202_ACCEPTED)


class FormatsView(APIView):
    """`GET /formats/` with ETag and `304` (E04-S01 rules 12-13)."""

    def get(self, request):
        etag = f'"{formats.registry_version()}"'
        if request.headers.get("If-None-Match") == etag:
            response = Response(status=status.HTTP_304_NOT_MODIFIED)
        else:
            response = Response(formats.registry_payload())
        response["ETag"] = etag
        response["Cache-Control"] = "private, max-age=3600"
        return response


class ContentItemListView(APIView):
    def get(self, request):
        account = required_account(request)
        qs = ContentItem.objects.filter(account=account).select_related(
            "account", "plan", "slot", "candidate", "current_version",
            "current_version__cover_asset", "current_version__final_asset")
        if plan := request.query_params.get("plan"):
            qs = qs.filter(plan_id=plan)
        for name in ("status", "format", "production_mode"):
            values = csv_values(request, name)
            if values:
                qs = qs.filter(**{f"{name}__in": values})
        roles = csv_values(request, "role")
        if roles:
            cond = Q(role__in=[r for r in roles if r != "none"])
            if "none" in roles:
                cond |= Q(role__isnull=True)
            qs = qs.filter(cond)
        attention = bool_param(request, "needs_attention")
        attention_q = Q(status__in=serializers.NEEDS_ATTENTION_STATUSES) | (
            ~Q(hold_reason="") & (Q(active_job__isnull=True) | Q(
                active_job__status__in=["succeeded", "failed", "cancelled"])))
        if attention is True:
            qs = qs.filter(attention_q)
        elif attention is False:
            qs = qs.exclude(attention_q)
        has_job = bool_param(request, "has_active_job")
        active_q = Q(active_job__status__in=["queued", "running"])
        if has_job is True:
            qs = qs.filter(active_q)
        elif has_job is False:
            qs = qs.exclude(active_q)
        if slot_from := datetime_param(request, "slot_from"):
            qs = qs.filter(slot__scheduled_at__gte=slot_from)
        if slot_to := datetime_param(request, "slot_to"):
            qs = qs.filter(slot__scheduled_at__lte=slot_to)
        if search := request.query_params.get("search"):
            qs = qs.filter(title__icontains=search)
        ordering = request.query_params.get("ordering") or "slot_time"
        if ordering not in ORDERINGS:
            raise ValidationError({"ordering": [ErrorDetail("invalid", code="invalid")]})
        if ordering == "slot_time":
            qs = qs.order_by(F("slot__scheduled_at").asc(nulls_last=True), "pk")
        elif ordering == "-slot_time":
            qs = qs.order_by(F("slot__scheduled_at").desc(nulls_last=True), "-pk")
        elif ordering == "status":
            order = Case(*[When(status=s, then=Value(i))
                           for i, s in enumerate(pipeline.PIPELINE_ORDER)],
                         output_field=IntegerField())
            qs = qs.annotate(_pipeline_order=order).order_by("_pipeline_order", "pk")
        else:
            qs = qs.order_by(ordering, "-pk")
        paginator = BoundedPageNumberPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response([serializers.item_summary(i) for i in page])


class ContentItemDetailView(APIView):
    def get(self, request, pk):
        return Response(serializers.item_detail(get_item(pk), request.user))

    def patch(self, request, pk):
        item = get_item(pk)
        if not isinstance(request.data, dict):
            raise ValidationError({"non_field_errors": [ErrorDetail("invalid", code="invalid")]})
        item, effects = item_settings.update_item_settings(item, dict(request.data),
                                                          actor=request.user)
        data = serializers.item_detail(get_item(item.pk), request.user)
        data["effects"] = effects
        return Response(data)


class ContentItemCancelView(APIView):
    def post(self, request, pk):
        item = get_item(pk)
        reason = (request.data.get("reason") or "").strip()
        if not 3 <= len(reason) <= 500:
            code = "required" if not reason else ("min_length" if len(reason) < 3 else
                                                  "max_length")
            raise ValidationError({"reason": [ErrorDetail(code, code=code)]})
        pipeline.cancel(item, reason=reason,
                        release_candidate=bool(request.data.get("release_candidate")),
                        actor=request.user)
        return Response(serializers.item_detail(get_item(pk), request.user))


class ContentItemEventsView(APIView):
    def get(self, request, pk):
        item = get_item(pk)
        qs = ContentEvent.objects.filter(content_item=item).select_related("actor")
        types = csv_values(request, "type")
        if types:
            qs = qs.filter(type__in=types)
        paginator = BoundedPageNumberPagination()
        page = paginator.paginate_queryset(qs.order_by("-created_at", "-id"), request, view=self)
        return paginator.get_paginated_response([serializers.event_payload(e) for e in page])


# --- Briefs (E04-S03) ---------------------------------------------------------------------

def _version_param(request):
    raw = request.query_params.get("version")
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValidationError({"version": [ErrorDetail("invalid", code="invalid")]}) from None


class BriefView(APIView):
    def get(self, request, pk):
        item = get_item(pk)
        version = _version_param(request)
        brief = None
        if version is not None:
            brief = Brief.objects.filter(content_item=item, version=version).first()
            if brief is None:
                raise NotFound()
        return Response(serializers.brief_document(item, brief))

    def put(self, request, pk):
        item = get_item(pk)
        briefs.save_edit(item, dict(request.data), user=request.user)
        return Response(serializers.brief_document(get_item(pk), None))


class BriefGenerateView(APIView):
    def post(self, request, pk):
        item = get_item(pk)
        feedback = (request.data.get("feedback") or "").strip()
        if len(feedback) > 1000:
            raise ValidationError({"feedback": [ErrorDetail("max_length", code="max_length")]})
        job = briefs.start_generate_job(item, user=request.user, request_id=_request_id(request),
                                        feedback=feedback,
                                        base_version=request.data.get("base_version"))
        return _job_response(job)


class BriefVersionsView(APIView):
    def get(self, request, pk):
        item = get_item(pk)
        qs = Brief.objects.filter(content_item=item).select_related("created_by").order_by(
            "-version")
        paginator = BoundedPageNumberPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response([serializers.brief_payload(b) for b in page])


class BriefApproveView(APIView):
    def post(self, request, pk):
        item = get_item(pk)
        version = request.data.get("version")
        if not isinstance(version, int) or isinstance(version, bool):
            raise ValidationError({"version": [ErrorDetail("required", code="required")]})
        item = briefs.approve(item, version, user=request.user)
        item = get_item(pk)
        data = serializers.brief_document(item, None)
        data["item_status"] = item.status
        return Response(data)


class PlanBriefsGenerateView(APIView):
    def post(self, request, pk):
        from apps.planning.models import WeeklyPlan

        plan = get_object_or_404(WeeklyPlan, pk=pk)
        content_items = request.data.get("content_items")
        if content_items is not None and (not isinstance(content_items, list) or not all(
                isinstance(v, int) for v in content_items)):
            raise ValidationError({"content_items": [ErrorDetail("invalid", code="invalid")]})
        job = briefs.start_batch(plan, content_items=content_items,
                                 regenerate_drafts=bool(request.data.get("regenerate_drafts")),
                                 user=request.user, request_id=_request_id(request))
        return _job_response(job)


# --- Scripts (E05) ------------------------------------------------------------------------

class ScriptView(APIView):
    def get(self, request, pk):
        item = get_item(pk)
        script = scripts.latest_script(item)
        if script is None:
            from apps.core.errors import ApiError

            raise ApiError("not_found", 404, details={"reason": "no_script"})
        return Response(serializers.script_document(item, script))

    def put(self, request, pk):
        item = get_item(pk)
        script, unchanged = scripts.save_edit(
            item, base_version=request.data.get("base_version"),
            payload=request.data.get("payload"), note=request.data.get("note") or "",
            user=request.user)
        data = serializers.script_document(get_item(pk), script)
        data["unchanged"] = unchanged
        return Response(data)


class ScriptGenerateView(APIView):
    def post(self, request, pk):
        item = get_item(pk)
        job = scripts.generate_script(item, feedback=request.data.get("feedback") or "",
                                      base_version=request.data.get("base_version"),
                                      actor=request.user, request_id=_request_id(request),
                                      start_over=bool(request.data.get("start_over")))
        return _job_response(job)


class ScriptVersionsView(APIView):
    def get(self, request, pk):
        item = get_item(pk)
        qs = ScriptVersion.objects.filter(content_item=item).select_related(
            "brief", "created_by").order_by("-version")
        latest = qs.first()
        paginator = BoundedPageNumberPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(
            [serializers.script_version_row(item, s, latest.pk if latest else None)
             for s in page])


class ScriptVersionDetailView(APIView):
    def get(self, request, pk, version):
        item = get_item(pk)
        script = ScriptVersion.objects.filter(content_item=item, version=version).first()
        if script is None:
            raise NotFound()
        return Response(serializers.script_document(item, script))


class ScriptApproveView(APIView):
    def post(self, request, pk):
        item = get_item(pk)
        version = request.data.get("version")
        if not isinstance(version, int) or isinstance(version, bool):
            raise ValidationError({"version": [ErrorDetail("required", code="required")]})
        scripts.approve_script(item, version, user=request.user)
        item = get_item(pk)
        script = ScriptVersion.objects.get(content_item=item, version=version)
        return Response({
            "script": serializers.script_document(item, script),
            "content_item": {"id": item.pk, "status": item.status,
                             "active_job": serializers._active_job(item)},
        })
