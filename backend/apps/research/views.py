"""Research API (E02-S01, S02, S04, S05). Both roles may use every endpoint."""

from django.db.models import Count, Q, TextField
from django.db.models.functions import Cast
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import GenericAPIView
from rest_framework.response import Response

from apps.accounts.models import InstagramAccount
from apps.core.errors import InvalidTransition, ProviderNotConfiguredError
from apps.core.params import (
    bool_param,
    csv_values,
    datetime_param,
    int_param,
    required_account,
)

from .models import ResearchRun, ResearchSource, TrendSignal, TrendTopic
from .serializers import (
    ManualSignalSerializer,
    ResearchRunDetailSerializer,
    ResearchRunSerializer,
    ResearchSourceSerializer,
    StartRunSerializer,
    TopicCreateSerializer,
    TopicUpdateSerializer,
    TrendSignalSerializer,
    TrendTopicDetailSerializer,
    TrendTopicSerializer,
    field_error,
)
from .services import platform, runs, topics as topic_service
from .services.plans import default_plan


def ensure_not_archived(account: InstagramAccount) -> None:
    if account.status == InstagramAccount.Status.ARCHIVED:
        raise InvalidTransition(details={"status": account.status})


def resolve_account_from_body(request) -> InstagramAccount:
    raw = request.data.get("account") if hasattr(request.data, "get") else None
    if raw in (None, ""):
        raise ValidationError({"account": field_error("required")})
    try:
        return InstagramAccount.objects.get(pk=int(raw))
    except (InstagramAccount.DoesNotExist, TypeError, ValueError):
        raise ValidationError({"account": field_error("does_not_exist")}) from None


def ordering_param(request, allowed: tuple[str, ...], default: str) -> list[str]:
    raw = request.query_params.get("ordering", default)
    fields = [f.strip() for f in raw.split(",") if f.strip()]
    if not fields or any(f not in allowed for f in fields):
        fields = [f.strip() for f in default.split(",")]
    return fields


class AccountScopedList(GenericAPIView):
    def paginated(self, queryset, serializer_class, **context):
        page = self.paginate_queryset(queryset)
        ctx = {**self.get_serializer_context(), **context}
        return self.get_paginated_response(serializer_class(page, many=True, context=ctx).data)


# --- Sources ------------------------------------------------------------------------------------


def running_run(account_id: int) -> ResearchRun | None:
    return (ResearchRun.objects.select_related("job")
            .filter(account_id=account_id, status=ResearchRun.Status.RUNNING).first())


class SourceListView(AccountScopedList):
    serializer_class = ResearchSourceSerializer

    def get(self, request):
        account = required_account(request)
        qs = ResearchSource.objects.filter(account=account)
        if kinds := csv_values(request, "kind"):
            qs = qs.filter(kind__in=kinds)
        if (active := bool_param(request, "active")) is not None:
            qs = qs.filter(active=active)
        ordering = ordering_param(request, ("kind", "label", "-last_run_at"), "kind,label")
        return self.paginated(qs.order_by(*ordering, "id"), ResearchSourceSerializer)

    def post(self, request):
        serializer = ResearchSourceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ensure_not_archived(serializer.validated_data["account"])
        source = serializer.save()
        return Response(ResearchSourceSerializer(source).data, status=status.HTTP_201_CREATED)


class SourceDetailView(GenericAPIView):
    serializer_class = ResearchSourceSerializer

    def get_object(self):
        try:
            return ResearchSource.objects.select_related("account").get(pk=self.kwargs["pk"])
        except ResearchSource.DoesNotExist:
            raise NotFound() from None

    def get(self, request, pk):
        return Response(ResearchSourceSerializer(self.get_object()).data)

    def patch(self, request, pk):
        source = self.get_object()
        ensure_not_archived(source.account)
        serializer = ResearchSourceSerializer(source, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        source = serializer.save()
        return Response(ResearchSourceSerializer(source).data)

    def delete(self, request, pk):
        source = self.get_object()
        ensure_not_archived(source.account)
        if (run := running_run(source.account_id)) is not None and run.job is not None:
            raise platform.JobInProgress(run.job)
        source.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Runs ---------------------------------------------------------------------------------------


class RunListView(AccountScopedList):
    def get(self, request):
        account = required_account(request)
        qs = ResearchRun.objects.filter(account=account).select_related("job", "started_by")
        if (plan := int_param(request, "plan")) is not None:
            qs = qs.filter(plan_id=plan)
        if statuses := csv_values(request, "status"):
            qs = qs.filter(status__in=statuses)
        return self.paginated(qs.order_by("-started_at", "-id"), ResearchRunSerializer)

    def post(self, request):
        serializer = StartRunSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        account = data["account"]
        ensure_not_archived(account)
        if data["synthesize"] and not platform.text_provider_configured():
            raise ProviderNotConfiguredError()
        plan = data["plan_obj"] if data["plan_given"] else default_plan(account)
        params = {"lookback_days": data["lookback_days"], "source_ids": data["source_ids"],
                  "collect": data["collect"], "synthesize": data["synthesize"]}
        run = runs.start_run(account, plan=plan, params=params, user=request.user,
                             request_id=getattr(request, "request_id", None))
        return Response({"job": platform.job_payload(run.job)}, status=status.HTTP_202_ACCEPTED)


class RunDetailView(GenericAPIView):
    def get(self, request, pk):
        run = (ResearchRun.objects.select_related("job", "started_by").filter(pk=pk).first())
        if run is None:
            raise NotFound()
        return Response(ResearchRunDetailSerializer(run).data)


# --- Signals ------------------------------------------------------------------------------------


class SignalListView(AccountScopedList):
    def get(self, request):
        account = required_account(request)
        qs = (TrendSignal.objects.filter(account=account)
              .select_related("source").prefetch_related("topics"))
        if (signal_id := int_param(request, "id")) is not None:
            qs = qs.filter(pk=signal_id)  # the panel's "Show it" after a duplicate (S05)
        if (run := int_param(request, "run")) is not None:
            qs = qs.filter(run_id=run)
        if (source := int_param(request, "source")) is not None:
            qs = qs.filter(source_id=source)
        if kinds := csv_values(request, "kind"):
            qs = qs.filter(kind__in=kinds)
        if (topic := int_param(request, "topic")) is not None:
            qs = qs.filter(topics__id=topic)
        if bool_param(request, "unassigned"):
            qs = qs.filter(topics__isnull=True)
        if q := request.query_params.get("q", "").strip():
            qs = qs.filter(Q(title__icontains=q) | Q(excerpt__icontains=q)
                           | Q(author__icontains=q))
        if after := datetime_param(request, "captured_after"):
            qs = qs.filter(captured_at__gte=after)
        if before := datetime_param(request, "captured_before"):
            qs = qs.filter(captured_at__lte=before)
        ordering = ordering_param(
            request, ("-captured_at", "captured_at", "-published_at", "published_at"),
            "-captured_at")
        return self.paginated(qs.distinct().order_by(*ordering, "-id"), TrendSignalSerializer)

    def post(self, request):
        serializer = ManualSignalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.raise_if_duplicate()
        data = serializer.validated_data
        account = data["account"]
        ensure_not_archived(account)
        topic = data["topic_obj"]
        if topic is not None and topic.status == TrendTopic.Status.USED:
            raise topic_service.invalid_transition(topic)
        from django.utils import timezone

        signal = TrendSignal.objects.create(
            account=account, run=None, source=None, kind="manual", url=data.get("url", ""),
            title=data["title"], excerpt=data.get("excerpt", ""), author=data.get("author", ""),
            published_at=data.get("published_at"), captured_at=timezone.now(),
            metrics=data.get("metrics") or {}, fingerprint=data["fingerprint"], raw={},
        )
        if topic is not None:
            topic_service.attach_signal(topic, signal)
        return Response(TrendSignalSerializer(signal).data, status=status.HTTP_201_CREATED)


# --- Topics -------------------------------------------------------------------------------------


class TopicListView(AccountScopedList):
    def get(self, request):
        account = required_account(request)
        qs = TrendTopic.objects.filter(account=account).annotate(
            linked_signals=Count("signals", distinct=True))
        plan_raw = request.query_params.get("plan")
        if plan_raw == "none":
            qs = qs.filter(plan__isnull=True)
        elif plan_raw:
            qs = qs.filter(plan_id=int_param(request, "plan"))
        if (run := int_param(request, "run")) is not None:
            qs = qs.filter(run_id=run)
        if statuses := csv_values(request, "status"):
            qs = qs.filter(status__in=statuses)
        if origins := csv_values(request, "origin"):
            qs = qs.filter(origin__in=origins)
        if (min_evidence := int_param(request, "min_evidence")) is not None:
            if not 0 <= min_evidence <= 100:
                code = "min_value" if min_evidence < 0 else "max_value"
                raise ValidationError({"min_evidence": field_error(code)})
            qs = qs.filter(evidence_score__gte=min_evidence)
        if q := request.query_params.get("q", "").strip():
            qs = qs.annotate(keywords_text=Cast("keywords", TextField())).filter(
                Q(title__icontains=q) | Q(summary__icontains=q) | Q(keywords_text__icontains=q))
        ordering = ordering_param(
            request, ("-evidence_score", "evidence_score", "-created_at", "title"),
            "-evidence_score")
        return self.paginated(qs.order_by(*ordering, "-id"), TrendTopicSerializer)

    def post(self, request):
        account = resolve_account_from_body(request)
        serializer = TopicCreateSerializer(data=request.data, context={"account": account})
        serializer.is_valid(raise_exception=True)
        ensure_not_archived(account)
        data = dict(serializer.validated_data)
        plan = data["plan"] if "plan" in data else default_plan(account)
        if topic_service.title_taken(account, plan, data["title"]):
            raise ValidationError({"title": field_error("unique")})
        topic = topic_service.create_manual(account=account, plan=plan, data=data,
                                            signals=data.get("signals", []))
        return Response(TrendTopicDetailSerializer(topic).data, status=status.HTTP_201_CREATED)


class TopicDetailView(GenericAPIView):
    def get_object(self):
        topic = TrendTopic.objects.select_related("account").filter(pk=self.kwargs["pk"]).first()
        if topic is None:
            raise NotFound()
        return topic

    def get(self, request, pk):
        return Response(TrendTopicDetailSerializer(self.get_object()).data)

    def patch(self, request, pk):
        topic = self.get_object()
        if topic.status == TrendTopic.Status.USED:
            raise topic_service.invalid_transition(topic)
        ensure_not_archived(topic.account)
        serializer = TopicUpdateSerializer(data=request.data, partial=True,
                                           context={"account": topic.account})
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        signals = data.pop("signals", None)
        data.pop("signal_ids", None)
        if data.get("status") == TrendTopic.Status.USED:
            raise topic_service.invalid_transition(topic)
        if "title" in data:
            plan = data["plan"] if "plan" in data else topic.plan
            if topic_service.title_taken(topic.account, plan, data["title"], exclude_id=topic.pk):
                raise ValidationError({"title": field_error("unique")})
        topic = topic_service.update_topic(topic, data, signals)
        return Response(TrendTopicDetailSerializer(topic).data)
