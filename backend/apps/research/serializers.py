from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail

from apps.accounts.models import InstagramAccount
from apps.core.errors import DetailedValidationError

from .models import ResearchRun, ResearchSource, SourceKind, TrendSignal, TrendTopic
from .services import platform, sources as source_rules
from .services.fingerprints import InvalidURL, fingerprint
from .services.plans import usable_plan

FORMAT_CHOICES = ["reel", "story", "feed_post"]
METRIC_KEYS = ("likes", "comments", "views")


def field_error(code: str, message: str | None = None) -> list:
    return [ErrorDetail(message or code, code=code)]


# --- Sources (E02-S01) --------------------------------------------------------------------------


class ResearchSourceSerializer(serializers.ModelSerializer):
    account = serializers.PrimaryKeyRelatedField(queryset=InstagramAccount.objects.all())
    kind = serializers.ChoiceField(choices=SourceKind.choices)
    value = serializers.CharField(trim_whitespace=False, max_length=2000)
    label = serializers.CharField(required=False, allow_blank=True, max_length=80)
    available = serializers.SerializerMethodField()
    unavailable_reason = serializers.SerializerMethodField()

    class Meta:
        model = ResearchSource
        fields = ["id", "account", "kind", "value", "label", "active", "last_run_at",
                  "last_status", "available", "unavailable_reason", "created_at", "updated_at"]
        read_only_fields = ["last_run_at", "last_status", "created_at", "updated_at"]
        validators = []  # uniqueness is checked after normalization in validate()

    def _availability(self, obj):
        cache = self.context.setdefault("_availability", {})
        if obj.kind not in cache:
            cache[obj.kind] = source_rules.availability(obj.kind)
        return cache[obj.kind]

    def get_available(self, obj) -> bool:
        return self._availability(obj)[0]

    def get_unavailable_reason(self, obj) -> str | None:
        return self._availability(obj)[1]

    def validate(self, attrs):
        instance = self.instance
        if instance is not None:
            if "kind" in attrs and attrs["kind"] != instance.kind:
                raise serializers.ValidationError({"kind": field_error("immutable")})
            attrs.pop("account", None)
        account = instance.account if instance else attrs["account"]
        kind = instance.kind if instance else attrs["kind"]

        if "value" in attrs or instance is None:
            value = source_rules.normalize_value(kind, attrs.get("value", ""))
            try:
                source_rules.validate_value(kind, value)
            except source_rules.SourceValueError as exc:
                raise serializers.ValidationError({"value": field_error(exc.code)}) from None
            attrs["value"] = value
        value = attrs.get("value", instance.value if instance else "")

        duplicate = ResearchSource.objects.filter(account=account, kind=kind, value=value)
        if instance:
            duplicate = duplicate.exclude(pk=instance.pk)
        if duplicate.exists():
            raise serializers.ValidationError({"value": field_error("unique")})

        active = attrs.get("active", instance.active if instance else True)
        becoming_active = active and (instance is None or not instance.active)
        if becoming_active:
            limit = source_rules.ACTIVE_LIMITS[kind]
            if source_rules.active_count(account, kind) >= limit:
                raise serializers.ValidationError({"active": field_error(
                    "limit_reached", f"At most {limit} active {kind} sources.")})

        if "label" in attrs or instance is None:
            label = (attrs.get("label") or "").strip()
            attrs["label"] = label or source_rules.default_label(kind, value)
        return attrs


# --- Runs (E02-S02) -----------------------------------------------------------------------------


class StartRunSerializer(serializers.Serializer):
    account = serializers.PrimaryKeyRelatedField(queryset=InstagramAccount.objects.all())
    plan = serializers.IntegerField(required=False, allow_null=True)
    source_ids = serializers.ListField(child=serializers.IntegerField(), required=False,
                                       allow_null=True, max_length=50)
    lookback_days = serializers.IntegerField(required=False, default=7, min_value=1,
                                             max_value=30)
    collect = serializers.BooleanField(required=False, default=True)
    synthesize = serializers.BooleanField(required=False, default=True)

    def validate(self, attrs):
        account = attrs["account"]
        if not attrs["collect"] and not attrs["synthesize"]:
            raise serializers.ValidationError(field_error("nothing_to_do"))

        if attrs.get("plan") is not None:
            plan = usable_plan(account, attrs["plan"])
            if plan is None:
                raise serializers.ValidationError({"plan": field_error("invalid")})
            attrs["plan_obj"] = plan
            attrs["plan_given"] = True
        else:
            attrs["plan_obj"] = None
            attrs["plan_given"] = "plan" in self.initial_data

        source_ids = attrs.get("source_ids")
        active_ids = set(ResearchSource.objects.filter(account=account, active=True)
                         .values_list("pk", flat=True))
        if source_ids:
            bad = {i: field_error("invalid") for i, sid in enumerate(source_ids)
                   if sid not in active_ids}
            if bad:
                raise serializers.ValidationError({"source_ids": bad})
            attrs["source_ids"] = list(dict.fromkeys(source_ids))
        else:
            attrs["source_ids"] = None
        if attrs["collect"] and not (source_ids or active_ids):
            raise serializers.ValidationError({"source_ids": field_error("no_active_sources")})
        return attrs


class ResearchRunSerializer(serializers.ModelSerializer):
    job = serializers.SerializerMethodField()
    started_by = serializers.SerializerMethodField()

    class Meta:
        model = ResearchRun
        fields = ["id", "account", "plan", "status", "params", "stats", "started_at",
                  "finished_at", "job", "started_by"]

    def get_job(self, run) -> dict | None:
        job = run.job
        if job is None:
            return None
        return {"id": str(job.id), "status": job.status, "progress": job.progress,
                "message": job.message, "error_code": job.error_code}

    def get_started_by(self, run) -> dict | None:
        return platform.user_ref(run.started_by)


class ResearchRunDetailSerializer(ResearchRunSerializer):
    sources = serializers.SerializerMethodField()

    class Meta(ResearchRunSerializer.Meta):
        fields = [*ResearchRunSerializer.Meta.fields[:6], "sources",
                  *ResearchRunSerializer.Meta.fields[6:]]

    def get_sources(self, run) -> list[dict]:
        by_source = (run.stats or {}).get("by_source", {})
        ids = [int(k) for k in by_source]
        known = {s.pk: s for s in ResearchSource.objects.filter(pk__in=ids)}
        rows = []
        for key, value in by_source.items():
            source = known.get(int(key))
            rows.append({"source_id": int(key), "kind": source.kind if source else None,
                         "label": source.label if source else None,
                         "signals": value.get("signals", 0),
                         "duplicates": value.get("duplicates", 0),
                         "status": value.get("status")})
        return rows


# --- Signals (E02-S02) --------------------------------------------------------------------------


class TrendSignalSerializer(serializers.ModelSerializer):
    source = serializers.SerializerMethodField()
    topic_ids = serializers.SerializerMethodField()

    class Meta:
        model = TrendSignal
        fields = ["id", "account", "run", "source", "kind", "url", "title", "excerpt", "author",
                  "published_at", "captured_at", "metrics", "topic_ids"]

    def get_source(self, signal) -> dict | None:
        source = signal.source
        if source is None:
            return None
        return {"id": source.pk, "kind": source.kind, "label": source.label}

    def get_topic_ids(self, signal) -> list[int]:
        return sorted(t.pk for t in signal.topics.all())


class ManualSignalSerializer(serializers.Serializer):
    account = serializers.PrimaryKeyRelatedField(queryset=InstagramAccount.objects.all())
    url = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    title = serializers.CharField(max_length=300)
    excerpt = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    author = serializers.CharField(required=False, allow_blank=True, max_length=120)
    published_at = serializers.DateTimeField(required=False, allow_null=True)
    metrics = serializers.DictField(required=False)
    topic = serializers.IntegerField(required=False, allow_null=True)

    def validate_url(self, value):
        value = value.strip()
        if not value:
            return ""
        try:
            from .services.fingerprints import normalize_url

            normalize_url(value)
        except InvalidURL:
            raise serializers.ValidationError(field_error("invalid")) from None
        return value

    def validate_metrics(self, value):
        errors, clean = {}, {}
        for key, number in (value or {}).items():
            if key not in METRIC_KEYS or isinstance(number, bool) or not isinstance(number, int):
                errors[key] = field_error("invalid")
            elif number < 0:
                errors[key] = field_error("min_value")
            else:
                clean[key] = number
        if errors:
            raise serializers.ValidationError(errors)
        return clean

    def validate(self, attrs):
        account = attrs["account"]
        url, excerpt = attrs.get("url", ""), attrs.get("excerpt", "")
        if not url and not excerpt.strip():
            raise serializers.ValidationError(field_error("url_or_excerpt_required"))

        topic_id = attrs.get("topic")
        attrs["topic_obj"] = None
        if topic_id is not None:
            topic = TrendTopic.objects.filter(pk=topic_id, account=account).first()
            if topic is None:
                raise serializers.ValidationError({"topic": field_error("invalid")})
            attrs["topic_obj"] = topic

        attrs["fingerprint"] = fingerprint("manual", url or None, attrs.get("author", ""),
                                           excerpt)
        return attrs

    def raise_if_duplicate(self):
        """Rule 38. Raised outside `is_valid()`, which would drop `error.details`."""
        data = self.validated_data
        existing = TrendSignal.objects.filter(account=data["account"],
                                              fingerprint=data["fingerprint"]).first()
        if existing is not None:
            field = "url" if data.get("url") else "excerpt"
            raise DetailedValidationError({field: field_error("unique")},
                                          details={"signal_id": existing.pk})


# --- Topics (E02-S04, E02-S05) ------------------------------------------------------------------


class TrendTopicSerializer(serializers.ModelSerializer):
    signal_count = serializers.SerializerMethodField()

    class Meta:
        model = TrendTopic
        fields = ["id", "account", "plan", "run", "title", "summary", "why_now", "hooks",
                  "suggested_formats", "keywords", "evidence_score", "evidence_breakdown",
                  "signal_count", "status", "origin", "created_at", "updated_at"]

    def get_signal_count(self, topic) -> int:
        annotated = getattr(topic, "linked_signals", None)
        return annotated if annotated is not None else topic.signals.count()


class TrendTopicDetailSerializer(TrendTopicSerializer):
    signals = serializers.SerializerMethodField()

    class Meta(TrendTopicSerializer.Meta):
        fields = [*TrendTopicSerializer.Meta.fields, "signals"]

    def get_signals(self, topic) -> list[dict]:
        signals = (topic.signals.select_related("source").prefetch_related("topics")
                   .order_by("-captured_at", "-id"))
        return TrendSignalSerializer(signals, many=True).data


class TopicContentSerializer(serializers.Serializer):
    """Fields and limits shared by manual creation and PATCH (E02-S04 rule 24)."""

    title = serializers.CharField(min_length=3, max_length=120)
    summary = serializers.CharField(required=False, allow_blank=True, max_length=600)
    why_now = serializers.CharField(required=False, allow_blank=True, max_length=300)
    hooks = serializers.ListField(child=serializers.CharField(max_length=160), required=False,
                                  max_length=5)
    suggested_formats = serializers.ListField(
        child=serializers.ChoiceField(choices=FORMAT_CHOICES), required=False, max_length=3)
    keywords = serializers.ListField(child=serializers.CharField(max_length=40), required=False,
                                     max_length=8)
    signal_ids = serializers.ListField(child=serializers.IntegerField(), required=False,
                                       max_length=20)
    plan = serializers.IntegerField(required=False, allow_null=True)

    def validate_suggested_formats(self, value):
        return list(dict.fromkeys(value))

    def validate_signal_ids(self, value):
        ids = list(dict.fromkeys(value))
        found = {s.pk: s for s in
                 TrendSignal.objects.filter(account=self.context["account"], pk__in=ids)}
        bad = {i: field_error("does_not_exist") for i, sid in enumerate(ids) if sid not in found}
        if bad:
            raise serializers.ValidationError(bad)
        self._signals = [found[i] for i in ids]
        return ids

    def validate_plan(self, value):
        if value is None:
            return None
        plan = usable_plan(self.context["account"], value)
        if plan is None:
            raise serializers.ValidationError(field_error("invalid"))
        return plan

    def validate(self, attrs):
        if "signal_ids" in attrs:
            attrs["signals"] = self._signals
        return attrs


class TopicCreateSerializer(TopicContentSerializer):
    """`context["account"]` is resolved by the view from the body's `account`."""

    account = serializers.IntegerField()


class TopicUpdateSerializer(TopicContentSerializer):
    """`context["account"]` is the topic's account. Every field is optional."""

    status = serializers.ChoiceField(choices=TrendTopic.Status.choices, required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            field.required = False

    def validate_title(self, value):
        if not value.strip():
            raise serializers.ValidationError(field_error("blank"))
        return value
