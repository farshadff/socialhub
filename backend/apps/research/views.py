"""/research/* endpoints. Views validate, call a service and return (ARCHITECTURE.md section 2)."""

from __future__ import annotations

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.accounts.models import InstagramAccount
from apps.core import clock
from apps.core.exceptions import InvalidTransition, field_error, field_error_with_details
from apps.core.jobs import JobInProgress
from apps.planning.models import WeeklyPlan

from .models import ResearchRun, ResearchSource, TrendSignal, TrendTopic
from .serializers import (
    ManualSignalSerializer,
    ManualTopicSerializer,
    ResearchRunDetailSerializer,
    ResearchRunSerializer,
    ResearchSourceSerializer,
    RunRequestSerializer,
    TopicUpdateSerializer,
    TrendSignalSerializer,
    TrendTopicDetailSerializer,
    TrendTopicSerializer,
    run_accepted_response,
)
from .services import runs, topics
from .services.fingerprints import InvalidURL, fingerprint
from .services.runs import RunRequest

# --- Helpers ------------------------------------------------------------------------------------


def _csv(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def scoped_account(request) -> InstagramAccount:
    """List endpoints require ``?account=`` (API.md, Account scope)."""
    raw = request.query_params.get("account")
    if not raw:
        raise field_error("account", "required")
    if not raw.isdigit():
        raise field_error("account", "invalid")
    account = InstagramAccount.objects.filter(pk=int(raw)).first()
    if account is None:
        raise NotFound()
    return account


def ensure_writable(account: InstagramAccount) -> None:
    if account.is_archived:
        raise InvalidTransition({"status": account.status, "reason": "account_archived"})


def _ordering(request, allowed: set[str], default: list[str]) -> list[str]:
    raw = request.query_params.get("ordering")
    if not raw:
        return default
    fields = _csv(raw)
    if not fields or any(field not in allowed for field in fields):
        raise field_error("ordering", "invalid_choice")
    return fields


def _int_param(request, name: str) -> int | None:
    raw = request.query_params.get(name)
    if raw in (None, ""):
        return None
    if not raw.isdigit():
        raise field_error(name, "invalid")
    return int(raw)


def _bool_param(request, name: str) -> bool | None:
    raw = request.query_params.get(name)
    if raw in (None, ""):
        return None
    if raw not in ("true", "false"):
        raise field_error(name, "invalid")
    return raw == "true"


# --- Sources ------------------------------------------------------------------------------------


class ResearchSourceViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = ResearchSourceSerializer
    http_method_names = ["get", "post", "patch", "delete"]
    queryset = ResearchSource.objects.select_related("account")

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action != "list":
            return queryset
        account = scoped_account(self.request)
        queryset = queryset.filter(account=account)
        kinds = _csv(self.request.query_params.get("kind"))
        if kinds:
            queryset = queryset.filter(kind__in=kinds)
        active = _bool_param(self.request, "active")
        if active is not None:
            queryset = queryset.filter(active=active)
        ordering = _ordering(self.request, {"kind", "label", "-last_run_at"}, ["kind", "label"])
        return queryset.order_by(*ordering, "id")

    def perform_create(self, serializer):
        ensure_writable(serializer.validated_data["account"])
        serializer.save()

    def perform_update(self, serializer):
        ensure_writable(serializer.instance.account)
        serializer.save()

    def perform_destroy(self, instance):
        ensure_writable(instance.account)
        runs.recover_stale_runs(instance.account_id)
        active = runs.running_run(instance.account_id)
        if active is not None:
            raise JobInProgress(active.job)
        instance.delete()


# --- Runs ---------------------------------------------------------------------------------------


class ResearchRunViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    queryset = ResearchRun.objects.select_related("job", "job__created_by")

    def get_serializer_class(self):
        return ResearchRunDetailSerializer if self.action == "retrieve" else ResearchRunSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action != "list":
            return queryset
        queryset = queryset.filter(account=scoped_account(self.request))
        plan = _int_param(self.request, "plan")
        if plan is not None:
            queryset = queryset.filter(plan_id=plan)
        statuses = _csv(self.request.query_params.get("status"))
        if statuses:
            queryset = queryset.filter(status__in=statuses)
        return queryset.order_by("-started_at", "-id")

    def create(self, request):
        serializer = RunRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        account = data["account"]
        ensure_writable(account)

        if "plan" in request.data:
            plan = None
            if data.get("plan") is not None:
                plan = WeeklyPlan.objects.filter(pk=data["plan"], account=account).first()
                if plan is None or plan.status == WeeklyPlan.Status.CLOSED:
                    raise field_error("plan", "invalid")
        else:
            plan = runs.default_plan(account)

        source_ids = data.get("source_ids")
        if source_ids:
            valid = set(
                ResearchSource.objects.filter(
                    pk__in=source_ids, account=account, active=True
                ).values_list("pk", flat=True)
            )
            for index, source_id in enumerate(source_ids):
                if source_id not in valid:
                    raise field_error(f"source_ids.{index}", "invalid")
            source_ids = list(dict.fromkeys(source_ids))

        if not data["collect"] and not data["synthesize"]:
            raise field_error("", "nothing_to_do")
        if data["collect"]:
            available = ResearchSource.objects.filter(account=account, active=True)
            if source_ids:
                available = available.filter(pk__in=source_ids)
            if not available.exists():
                raise field_error("source_ids", "no_active_sources")

        job = runs.start_run(
            RunRequest(
                account=account,
                plan=plan,
                source_ids=source_ids or None,
                lookback_days=data["lookback_days"],
                collect=data["collect"],
                synthesize=data["synthesize"],
            ),
            user=request.user,
            request_id=getattr(request, "request_id", None),
        )
        return Response(run_accepted_response(job), status=status.HTTP_202_ACCEPTED)


# --- Signals ------------------------------------------------------------------------------------


class TrendSignalViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = TrendSignalSerializer
    queryset = TrendSignal.objects.select_related("source").prefetch_related("topics")

    def get_queryset(self):
        queryset = super().get_queryset().filter(account=scoped_account(self.request))
        params = self.request.query_params
        for name, lookup in (("run", "run_id"), ("source", "source_id"), ("topic", "topics__id")):
            value = _int_param(self.request, name)
            if value is not None:
                queryset = queryset.filter(**{lookup: value})
        kinds = _csv(params.get("kind"))
        if kinds:
            queryset = queryset.filter(kind__in=kinds)
        if _bool_param(self.request, "unassigned"):
            queryset = queryset.filter(topics__isnull=True)
        if params.get("q"):
            term = params["q"]
            queryset = queryset.filter(
                Q(title__icontains=term) | Q(excerpt__icontains=term) | Q(author__icontains=term)
            )
        for name, lookup in (("captured_after", "captured_at__gte"), ("captured_before", "captured_at__lt")):
            if params.get(name):
                moment = parse_datetime(params[name])
                if moment is None:
                    raise field_error(name, "invalid")
                queryset = queryset.filter(**{lookup: moment})
        ordering = _ordering(
            self.request,
            {"-captured_at", "captured_at", "-published_at", "published_at"},
            ["-captured_at"],
        )
        return queryset.distinct().order_by(*ordering, "-id")

    def create(self, request):
        serializer = ManualSignalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not data.get("url") and not (data.get("excerpt") or "").strip():
            raise field_error("", "url_or_excerpt_required")
        account = data["account"]
        ensure_writable(account)
        topic = data.get("topic")
        if topic is not None and topic.status == TrendTopic.Status.USED:
            raise InvalidTransition({"status": topic.status, "allowed_statuses": []})

        url = data.get("url", "")
        excerpt = (data.get("excerpt") or "").strip()
        author = (data.get("author") or "").strip()
        try:
            print_ = fingerprint("manual", url, author, excerpt)
        except InvalidURL as exc:
            raise field_error("url", "invalid") from exc
        existing = TrendSignal.objects.filter(account=account, fingerprint=print_).first()
        if existing is not None:
            raise field_error_with_details(
                "url" if url else "excerpt", "unique", {"signal_id": existing.pk}
            )

        signal = TrendSignal.objects.create(
            account=account,
            run=None,
            source=None,
            kind="manual",
            url=url,
            title=data["title"].strip(),
            excerpt=excerpt,
            author=author,
            published_at=data.get("published_at"),
            captured_at=clock.now(),
            metrics=data.get("metrics") or {},
            fingerprint=print_,
            raw={},
        )
        if topic is not None:
            topics.attach_signal(topic, signal)
        signal = TrendSignal.objects.select_related("source").get(pk=signal.pk)
        return Response(TrendSignalSerializer(signal).data, status=status.HTTP_201_CREATED)


# --- Topics -------------------------------------------------------------------------------------


class TrendTopicViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    queryset = TrendTopic.objects.all()
    http_method_names = ["get", "post", "patch"]

    def get_serializer_class(self):
        return TrendTopicDetailSerializer if self.action == "retrieve" else TrendTopicSerializer

    def get_queryset(self):
        queryset = super().get_queryset().annotate(linked_signals=Count("signals", distinct=True))
        if self.action != "list":
            return queryset
        params = self.request.query_params
        queryset = queryset.filter(account=scoped_account(self.request))
        plan = params.get("plan")
        if plan == "none":
            queryset = queryset.filter(plan__isnull=True)
        elif plan:
            queryset = queryset.filter(plan_id=_int_param(self.request, "plan"))
        run = _int_param(self.request, "run")
        if run is not None:
            queryset = queryset.filter(run_id=run)
        statuses = _csv(params.get("status"))
        if statuses:
            queryset = queryset.filter(status__in=statuses)
        if params.get("origin"):
            queryset = queryset.filter(origin__in=_csv(params["origin"]))
        min_evidence = params.get("min_evidence")
        if min_evidence not in (None, ""):
            if not min_evidence.isdigit():
                raise field_error("min_evidence", "invalid")
            if int(min_evidence) > 100:
                raise field_error("min_evidence", "max_value")
            queryset = queryset.filter(evidence_score__gte=int(min_evidence))
        if params.get("q"):
            term = params["q"]
            queryset = queryset.filter(
                Q(title__icontains=term)
                | Q(summary__icontains=term)
                | Q(keywords__icontains=term)
            )
        ordering = _ordering(
            self.request,
            {"-evidence_score", "evidence_score", "-created_at", "title"},
            ["-evidence_score"],
        )
        return queryset.order_by(*ordering, "-id")

    def create(self, request):
        serializer = ManualTopicSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        account = data.pop("account")
        ensure_writable(account)
        if "plan" in request.data:
            plan = data.pop("plan", None)
        else:
            data.pop("plan", None)
            plan = runs.default_plan(account)
        signals = data.pop("signal_ids", [])
        topic = topics.create_manual(account=account, plan=plan, data=data, signals=signals)
        topic = self.get_queryset().get(pk=topic.pk)
        return Response(TrendTopicSerializer(topic).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        topic = get_object_or_404(TrendTopic.objects.select_related("account"), pk=pk)
        if topic.status == TrendTopic.Status.USED:
            raise InvalidTransition({"status": topic.status, "allowed_statuses": []})
        serializer = TopicUpdateSerializer(data=request.data, topic=topic)
        serializer.is_valid(raise_exception=True)
        changes = dict(serializer.validated_data)
        if "signal_ids" in changes:
            changes["signals"] = changes.pop("signal_ids")
        if changes.get("status") == TrendTopic.Status.USED:
            raise InvalidTransition(
                {"status": topic.status, "allowed_statuses": list(topics.allowed_statuses(topic))}
            )
        topic = topics.update_topic(topic, changes)
        topic = self.get_queryset().get(pk=topic.pk)
        return Response(TrendTopicDetailSerializer(topic).data)

