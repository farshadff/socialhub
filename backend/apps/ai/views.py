"""System status, AI test and AI run log endpoints (E00-S05 "API"). All admin-only."""

from __future__ import annotations

from django.conf import settings
from django.db import connection
from django.db.models import Count, F, Sum
from django.db.models.functions import Coalesce
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.core.jobs import QUEUES, job_payload, start_job
from apps.core.permissions import IsAdmin

from . import gateway
from .jobs import AI_TEST_KIND, AI_TEST_TARGET
from .models import AIRun

AI_TEST_PROVIDERS = ("text", "image")
ORDERINGS = ("-created_at", "created_at", "-cost_usd", "-latency_ms")


def _ts(value) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


# --- GET /system/status/ ---------------------------------------------------------------------


def _database_status() -> str:
    try:
        connection.ensure_connection()
    except Exception:
        return "unavailable"
    return "ok"


def _redis_status() -> str:
    from redis import Redis

    client = Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1)
    try:
        client.ping()
    except Exception:
        return "unavailable"
    finally:
        client.close()
    return "ok"


def _worker_status() -> dict[str, str]:
    """Per queue: `ok` when a worker consumes it, `unavailable` when none answered within one
    second, `unknown` when the broker cannot be asked (rule 37)."""
    unknown = {queue: "unknown" for queue in QUEUES}
    if getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
        return unknown
    from celery import current_app

    try:
        replies = current_app.control.inspect(timeout=1.0).active_queues()
    except Exception:
        return unknown
    consumed = {q.get("name") for queues in (replies or {}).values() for q in (queues or [])}
    return {queue: "ok" if queue in consumed else "unavailable" for queue in QUEUES}


def _instagram_status() -> dict | None:
    """E00-S04 connection settings; null when the instagram app is not installed."""
    from django.apps import apps as django_apps

    if not django_apps.is_installed("apps.instagram"):
        return None
    from apps.instagram.status import instagram_status

    return instagram_status()


def system_status_payload() -> dict:
    from apps.core.storage import storage_status

    return {
        "app": {"version": settings.SOCIALHUB_APP_VERSION,
                "environment": settings.SOCIALHUB_ENVIRONMENT, "debug": settings.DEBUG},
        "dependencies": {"database": _database_status(), "redis": _redis_status()},
        "workers": _worker_status(),
        "ai": {
            "text": gateway.provider_status("text"),
            "image": gateway.provider_status("image"),
            "models_without_price": gateway.models_without_price(),
            "max_calls_per_job": int(settings.SOCIALHUB_AI_MAX_CALLS_PER_JOB),
            "timeout_seconds": int(settings.SOCIALHUB_AI_TIMEOUT_SECONDS),
        },
        "instagram": _instagram_status(),
        "storage": storage_status(),
    }


@api_view(["GET"])
@permission_classes([IsAdmin])
def system_status(request):
    return Response(system_status_payload())


# --- POST /system/ai-test/ -------------------------------------------------------------------


def _providers_from(data) -> list[str]:
    if data in (None, "") or (hasattr(data, "keys") and "providers" not in data):
        return list(AI_TEST_PROVIDERS)
    if not hasattr(data, "get"):
        raise ValidationError({"non_field_errors": [ErrorDetail("invalid", code="invalid")]})
    providers = data.get("providers")
    if hasattr(data, "getlist") and not isinstance(providers, list):
        providers = data.getlist("providers")
    if (not isinstance(providers, list) or not providers
            or any(p not in AI_TEST_PROVIDERS for p in providers)):
        code = "invalid_choice" if isinstance(providers, list) and providers else "invalid"
        raise ValidationError({"providers": [ErrorDetail(code, code=code)]})
    return list(dict.fromkeys(providers))


@api_view(["POST"])
@permission_classes([IsAdmin])
def ai_test(request):
    providers = _providers_from(request.data)
    job = start_job(AI_TEST_KIND, target_id=AI_TEST_TARGET[1], user=request.user,
                    request_id=getattr(request, "request_id", None),
                    payload={"providers": providers})
    job.refresh_from_db()
    return Response({"job": job_payload(job)}, status=status.HTTP_202_ACCEPTED)


# --- GET /ai/runs/ ---------------------------------------------------------------------------


def run_payload(run: AIRun, *, detail: bool = False) -> dict:
    body = {
        "id": run.pk,
        "created_at": _ts(run.created_at),
        "job": str(run.job_id) if run.job_id else None,
        "account": run.account_id,
        "provider": run.provider,
        "model": run.model,
        "task": run.task,
        "prompt_version": run.prompt_version,
        "input_tokens": run.input_tokens,
        "output_tokens": run.output_tokens,
        "units": run.units or {},
        "cost_usd": f"{run.cost_usd:.6f}",
        "latency_ms": run.latency_ms,
        "status": run.status,
        "error_code": run.error_code,
        "provider_request_id": run.provider_request_id,
    }
    if detail:
        body["payload"] = run.payload
    return body


class AIRunQuerySerializer(serializers.Serializer):
    account = serializers.IntegerField(required=False, min_value=1)
    task = serializers.CharField(required=False, max_length=64)
    provider = serializers.ChoiceField(choices=AIRun.Provider.values, required=False)
    status = serializers.ChoiceField(choices=AIRun.Status.values, required=False)
    job = serializers.UUIDField(required=False)
    created_after = serializers.DateTimeField(required=False)
    created_before = serializers.DateTimeField(required=False)
    ordering = serializers.ChoiceField(choices=ORDERINGS, required=False,
                                       default="-created_at")


class AIRunViewSet(ReadOnlyModelViewSet):
    """`GET /ai/runs/` with filters and `totals`, and `GET /ai/runs/{id}/` with `payload`."""

    permission_classes = [IsAdmin]
    queryset = AIRun.objects.all()

    def get_queryset(self):
        params = AIRunQuerySerializer(data=self.request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data
        qs = AIRun.objects.all()
        for name in ("task", "provider", "status"):
            if data.get(name):
                qs = qs.filter(**{name: data[name]})
        if data.get("account") is not None:
            qs = qs.filter(account_id=data["account"])
        if data.get("job") is not None:
            qs = qs.filter(job_id=data["job"])
        if data.get("created_after"):
            qs = qs.filter(created_at__gte=data["created_after"])
        if data.get("created_before"):
            qs = qs.filter(created_at__lt=data["created_before"])
        ordering = data["ordering"]
        name = ordering.lstrip("-")
        if ordering.startswith("-"):
            return qs.order_by(F(name).desc(), "-id")
        return qs.order_by(F(name).asc(), "id")

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        totals = qs.order_by().aggregate(
            calls=Count("id"),
            input_tokens=Coalesce(Sum("input_tokens"), 0),
            output_tokens=Coalesce(Sum("output_tokens"), 0),
            cost_usd=Sum("cost_usd"),
        )
        page = self.paginate_queryset(qs)
        response = self.get_paginated_response([run_payload(run) for run in page])
        body = response.data
        response.data = {
            "count": body["count"],
            "next": body["next"],
            "previous": body["previous"],
            "totals": {
                "calls": totals["calls"],
                "input_tokens": totals["input_tokens"],
                "output_tokens": totals["output_tokens"],
                "cost_usd": f"{totals['cost_usd'] or 0:.6f}",
            },
            "results": body["results"],
        }
        return response

    def retrieve(self, request, *args, **kwargs):
        try:
            run = AIRun.objects.get(pk=int(kwargs["pk"]))
        except (AIRun.DoesNotExist, ValueError, TypeError):
            raise NotFound() from None
        return Response(run_payload(run, detail=True))
