"""Request and response shapes for /research/* (E02-S01, S02, S04, S05)."""

from __future__ import annotations

from urllib.parse import urlsplit

from rest_framework import serializers

from apps.accounts.models import InstagramAccount
from apps.core.enums import Format
from apps.core.exceptions import field_error
from apps.core.jobs import serialize_job
from apps.core.serializers import UserRefField
from apps.planning.models import WeeklyPlan

from .models import ResearchRun, ResearchSource, TrendSignal, TrendTopic
from .services import sources as source_rules

METRIC_KEYS = ("likes", "comments", "views")


# --- Sources ----------------------------------------------------------------------------------


class ResearchSourceSerializer(serializers.ModelSerializer):
    account = serializers.PrimaryKeyRelatedField(queryset=InstagramAccount.objects.all())
    kind = serializers.CharField()
    value = serializers.CharField(trim_whitespace=False, max_length=2000)
    label = serializers.CharField(
        required=False, allow_blank=True, max_length=source_rules.LABEL_MAX
    )
    active = serializers.BooleanField(required=False, default=True)
    available = serializers.SerializerMethodField()
    unavailable_reason = serializers.SerializerMethodField()

    class Meta:
        model = ResearchSource
        fields = [
            "id",
            "account",
            "kind",
            "value",
            "label",
            "active",
            "last_run_at",
            "last_status",
            "available",
            "unavailable_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["last_run_at", "last_status", "created_at", "updated_at"]
        validators = []  # uniqueness is checked after normalization, in validate()

    def get_available(self, obj) -> bool:
        return source_rules.availability(obj.kind).available

    def get_unavailable_reason(self, obj):
        return source_rules.availability(obj.kind).reason

    def validate_kind(self, kind):
        if self.instance is not None:
            if kind != self.instance.kind:
                raise serializers.ValidationError("immutable", code="immutable")
            return kind
        if kind not in source_rules.CREATABLE_KINDS:
            raise serializers.ValidationError("invalid_choice", code="invalid_choice")
        return kind

    def validate_account(self, account):
        if self.instance is not None and account.pk != self.instance.account_id:
            raise serializers.ValidationError("immutable", code="immutable")
        return account

    def validate(self, attrs):
        instance = self.instance
        account = attrs.get("account") or instance.account
        kind = attrs.get("kind") or instance.kind
        if "value" in attrs or instance is None:
            value = source_rules.normalize_value(kind, attrs.get("value", ""))
            try:
                source_rules.validate_value(kind, value)
            except source_rules.SourceValueError as exc:
                raise field_error("value", exc.code) from exc
            attrs["value"] = value
        value = attrs.get("value", instance.value if instance else "")
        duplicate = ResearchSource.objects.filter(account=account, kind=kind, value=value)
        if instance is not None:
            duplicate = duplicate.exclude(pk=instance.pk)
        if duplicate.exists():
            raise field_error("value", "unique")
        if "label" in attrs or instance is None:
            label = (attrs.get("label") or "").strip()
            attrs["label"] = label or source_rules.default_label(kind, value)
        active = attrs.get("active", instance.active if instance else True)
        becomes_active = active and (instance is None or not instance.active)
        if becomes_active and source_rules.limit_reached(
            account.pk, kind, exclude_id=instance.pk if instance else None
        ):
            raise field_error("active", "limit_reached")
        return attrs


# --- Runs -------------------------------------------------------------------------------------


class RunRequestSerializer(serializers.Serializer):
    account = serializers.IntegerField()
    plan = serializers.IntegerField(required=False, allow_null=True)
    source_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
    lookback_days = serializers.IntegerField(required=False, default=7, min_value=1, max_value=30)
    collect = serializers.BooleanField(required=False, default=True)
    synthesize = serializers.BooleanField(required=False, default=True)

    def validate_account(self, value):
        account = InstagramAccount.objects.filter(pk=value).first()
        if account is None:
            raise serializers.ValidationError("does_not_exist", code="does_not_exist")
        return account


def _job_brief(job):
    return {
        "id": str(job.id),
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "error_code": job.error_code,
    }


class ResearchRunSerializer(serializers.ModelSerializer):
    job = serializers.SerializerMethodField()
    started_by = serializers.SerializerMethodField()

    class Meta:
        model = ResearchRun
        fields = [
            "id",
            "account",
            "plan",
            "status",
            "params",
            "stats",
            "started_at",
            "finished_at",
            "job",
            "started_by",
        ]

    def get_job(self, obj):
        return _job_brief(obj.job)

    def get_started_by(self, obj):
        return UserRefField().to_representation(obj.job.created_by)


class ResearchRunDetailSerializer(ResearchRunSerializer):
    sources = serializers.SerializerMethodField()

    class Meta(ResearchRunSerializer.Meta):
        fields = ResearchRunSerializer.Meta.fields[:6] + ["sources"] + ResearchRunSerializer.Meta.fields[6:]

    def get_sources(self, obj):
        by_source = (obj.stats or {}).get("by_source", {})
        ids = [int(key) for key in by_source if str(key).isdigit()]
        current = {s.pk: s for s in ResearchSource.objects.filter(pk__in=ids)}
        rows = []
        for key, result in by_source.items():
            source = current.get(int(key)) if str(key).isdigit() else None
            rows.append(
                {
                    "source_id": int(key) if str(key).isdigit() else key,
                    "kind": source.kind if source else None,
                    "label": source.label if source else None,
                    "signals": result.get("signals", 0),
                    "duplicates": result.get("duplicates", 0),
                    "status": result.get("status"),
                }
            )
        return rows


def run_accepted_response(job) -> dict:
    return {"job": serialize_job(job)}


# --- Signals ------------------------------------------------------------------------------------


class TrendSignalSerializer(serializers.ModelSerializer):
    source = serializers.SerializerMethodField()
    topic_ids = serializers.SerializerMethodField()

    class Meta:
        model = TrendSignal
        fields = [
            "id",
            "account",
            "run",
            "source",
            "kind",
            "url",
            "title",
            "excerpt",
            "author",
            "published_at",
            "captured_at",
            "metrics",
            "topic_ids",
        ]

    def get_source(self, obj):
        if obj.source_id is None:
            return None
        return {"id": obj.source_id, "kind": obj.source.kind, "label": obj.source.label}

    def get_topic_ids(self, obj):
        prefetched = getattr(obj, "_prefetched_objects_cache", {}).get("topics")
        if prefetched is not None:
            return sorted(topic.pk for topic in prefetched)
        return sorted(obj.topics.values_list("pk", flat=True))


class ManualSignalSerializer(serializers.Serializer):
    account = serializers.IntegerField()
    url = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    title = serializers.CharField(max_length=300)
    excerpt = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    author = serializers.CharField(required=False, allow_blank=True, max_length=120)
    published_at = serializers.DateTimeField(required=False, allow_null=True)
    metrics = serializers.DictField(required=False)
    topic = serializers.IntegerField(required=False, allow_null=True)

    def validate_account(self, value):
        account = InstagramAccount.objects.filter(pk=value).first()
        if account is None:
            raise serializers.ValidationError("does_not_exist", code="does_not_exist")
        return account

    def validate_url(self, value):
        value = value.strip()
        if not value:
            return ""
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise serializers.ValidationError("invalid", code="invalid")
        return value

    def validate_metrics(self, value):
        errors = {}
        clean = {}
        for key, number in value.items():
            if key not in METRIC_KEYS or isinstance(number, bool) or not isinstance(number, int):
                errors[key] = [serializers.ErrorDetail("invalid", code="invalid")]
            elif number < 0:
                errors[key] = [serializers.ErrorDetail("min_value", code="min_value")]
            else:
                clean[key] = number
        if errors:
            raise serializers.ValidationError(errors)
        return clean

    def validate(self, attrs):
        # ``url_or_excerpt_required`` is checked in the view so its path is "" (non-field),
        # not DRF's "non_field_errors".
        topic_id = attrs.get("topic")
        if topic_id is not None:
            topic = TrendTopic.objects.filter(pk=topic_id, account=attrs["account"]).first()
            if topic is None:
                raise field_error("topic", "invalid")
            attrs["topic"] = topic
        return attrs


# --- Topics -------------------------------------------------------------------------------------


class TrendTopicSerializer(serializers.ModelSerializer):
    signal_count = serializers.SerializerMethodField()

    class Meta:
        model = TrendTopic
        fields = [
            "id",
            "account",
            "plan",
            "run",
            "title",
            "summary",
            "why_now",
            "hooks",
            "suggested_formats",
            "keywords",
            "evidence_score",
            "evidence_breakdown",
            "signal_count",
            "status",
            "origin",
            "created_at",
            "updated_at",
        ]

    def get_signal_count(self, obj):
        annotated = getattr(obj, "linked_signals", None)
        if annotated is not None:
            return annotated
        return obj.signals.count()


class TrendTopicDetailSerializer(TrendTopicSerializer):
    signals = serializers.SerializerMethodField()

    class Meta(TrendTopicSerializer.Meta):
        fields = TrendTopicSerializer.Meta.fields + ["signals"]

    def get_signals(self, obj):
        signals = obj.signals.select_related("source").prefetch_related("topics").order_by(
            "-captured_at", "-id"
        )
        return TrendSignalSerializer(signals, many=True).data


class _TopicContentSerializer(serializers.Serializer):
    """Shared limits of manual topics and edits (E02-S04 rule 24)."""

    title = serializers.CharField(min_length=3, max_length=120)
    summary = serializers.CharField(required=False, allow_blank=True, max_length=600)
    why_now = serializers.CharField(required=False, allow_blank=True, max_length=300)
    hooks = serializers.ListField(
        child=serializers.CharField(max_length=160), required=False, max_length=5
    )
    suggested_formats = serializers.ListField(
        child=serializers.ChoiceField(choices=Format.choices), required=False, max_length=3
    )
    keywords = serializers.ListField(
        child=serializers.CharField(max_length=40), required=False, max_length=8
    )
    signal_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, max_length=20
    )
    plan = serializers.IntegerField(required=False, allow_null=True)

    account_obj: InstagramAccount | None = None

    def _account(self):
        raise NotImplementedError

    def validate_suggested_formats(self, value):
        return list(dict.fromkeys(value))

    def validate_signal_ids(self, value):
        account = self._account()
        found = {
            signal.pk: signal
            for signal in TrendSignal.objects.filter(pk__in=value, account=account)
        }
        errors = {}
        for index, signal_id in enumerate(value):
            if signal_id not in found:
                errors[str(index)] = [
                    serializers.ErrorDetail("does_not_exist", code="does_not_exist")
                ]
        if errors:
            raise serializers.ValidationError(errors)
        return [found[signal_id] for signal_id in dict.fromkeys(value)]

    def validate_plan(self, value):
        if value is None:
            return None
        plan = WeeklyPlan.objects.filter(pk=value, account=self._account()).first()
        if plan is None or plan.status == WeeklyPlan.Status.CLOSED:
            raise serializers.ValidationError("invalid", code="invalid")
        return plan


class ManualTopicSerializer(_TopicContentSerializer):
    account = serializers.IntegerField()

    def _account(self):
        account_id = self.initial_data.get("account")
        if self.account_obj is None and isinstance(account_id, int):
            self.account_obj = InstagramAccount.objects.filter(pk=account_id).first()
        return self.account_obj

    def validate_account(self, value):
        account = InstagramAccount.objects.filter(pk=value).first()
        if account is None:
            raise serializers.ValidationError("does_not_exist", code="does_not_exist")
        return account


class TopicUpdateSerializer(_TopicContentSerializer):
    status = serializers.ChoiceField(
        choices=[TrendTopic.Status.NEW, TrendTopic.Status.SHORTLISTED, TrendTopic.Status.DISMISSED, TrendTopic.Status.USED],
        required=False,
    )

    def __init__(self, *args, topic: TrendTopic, **kwargs):
        self.topic = topic
        super().__init__(*args, partial=True, **kwargs)

    def _account(self):
        return self.topic.account
