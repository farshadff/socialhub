"""Research tables (DATA-MODEL.md section 5, epic E02)."""

from django.db import models

from apps.core.models import TimeStampedModel


class SourceKind(models.TextChoices):
    WEB_SEARCH = "web_search", "Web search"
    RSS = "rss", "RSS feed"
    # Reserved for E02-S03 (Phase 2). Present so the column needs no change; never accepted in Phase 1.
    INSTAGRAM_HASHTAG = "instagram_hashtag", "Instagram hashtag"
    INSTAGRAM_ACCOUNT = "instagram_account", "Instagram account"


class SignalKind(models.TextChoices):
    WEB_SEARCH = "web_search", "Web search"
    RSS = "rss", "RSS feed"
    MANUAL = "manual", "Manual"
    INSTAGRAM_HASHTAG = "instagram_hashtag", "Instagram hashtag"
    INSTAGRAM_ACCOUNT = "instagram_account", "Instagram account"


class ResearchSource(TimeStampedModel):
    account = models.ForeignKey(
        "accounts.InstagramAccount", on_delete=models.CASCADE, related_name="research_sources"
    )
    kind = models.CharField(max_length=24, choices=SourceKind.choices)
    value = models.CharField(max_length=500)
    label = models.CharField(max_length=80, blank=True, default="")
    active = models.BooleanField(default=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    last_status = models.CharField(max_length=40, null=True, blank=True)

    class Meta:
        ordering = ["kind", "label", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "kind", "value"], name="research_source_unique_value"
            ),
        ]
        indexes = [models.Index(fields=["account", "active"], name="research_source_active")]

    def __str__(self) -> str:
        return f"{self.kind}: {self.label or self.value}"


class ResearchRun(TimeStampedModel):
    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    account = models.ForeignKey(
        "accounts.InstagramAccount", on_delete=models.CASCADE, related_name="research_runs"
    )
    plan = models.ForeignKey(
        "planning.WeeklyPlan",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="research_runs",
    )
    job = models.ForeignKey("core.JobRun", on_delete=models.PROTECT, related_name="research_runs")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RUNNING)
    params = models.JSONField(default=dict)
    stats = models.JSONField(default=dict)
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["account"],
                condition=models.Q(status="running"),
                name="research_one_running_run",
            ),
        ]
        indexes = [
            models.Index(fields=["account", "-started_at"], name="research_run_recent"),
        ]

    def __str__(self) -> str:
        return f"Research run {self.pk} ({self.status})"


class TrendSignal(TimeStampedModel):
    account = models.ForeignKey(
        "accounts.InstagramAccount", on_delete=models.CASCADE, related_name="trend_signals"
    )
    run = models.ForeignKey(
        ResearchRun, on_delete=models.SET_NULL, null=True, blank=True, related_name="signals"
    )
    source = models.ForeignKey(
        ResearchSource, on_delete=models.SET_NULL, null=True, blank=True, related_name="signals"
    )
    kind = models.CharField(max_length=24, choices=SignalKind.choices)
    url = models.CharField(max_length=2000, blank=True, default="")
    title = models.CharField(max_length=300)
    excerpt = models.CharField(max_length=1000, blank=True, default="")
    author = models.CharField(max_length=120, blank=True, default="")
    published_at = models.DateTimeField(null=True, blank=True)
    captured_at = models.DateTimeField()
    metrics = models.JSONField(default=dict, blank=True)
    fingerprint = models.CharField(max_length=64)
    raw = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-captured_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "fingerprint"], name="trend_signal_unique_fingerprint"
            ),
        ]
        indexes = [
            models.Index(fields=["account", "-captured_at"], name="trend_signal_recent"),
            models.Index(fields=["run"], name="trend_signal_run"),
        ]

    def __str__(self) -> str:
        return self.title


class TrendTopic(TimeStampedModel):
    class Status(models.TextChoices):
        NEW = "new", "New"
        SHORTLISTED = "shortlisted", "Shortlisted"
        DISMISSED = "dismissed", "Dismissed"
        USED = "used", "Used"

    class Origin(models.TextChoices):
        AI = "ai", "AI"
        MANUAL = "manual", "Manual"

    account = models.ForeignKey(
        "accounts.InstagramAccount", on_delete=models.CASCADE, related_name="trend_topics"
    )
    run = models.ForeignKey(
        ResearchRun, on_delete=models.SET_NULL, null=True, blank=True, related_name="topics"
    )
    plan = models.ForeignKey(
        "planning.WeeklyPlan",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="trend_topics",
    )
    title = models.CharField(max_length=120)
    summary = models.CharField(max_length=600, blank=True, default="")
    why_now = models.CharField(max_length=300, blank=True, default="")
    hooks = models.JSONField(default=list, blank=True)
    suggested_formats = models.JSONField(default=list, blank=True)
    keywords = models.JSONField(default=list, blank=True)
    evidence_score = models.PositiveSmallIntegerField(default=0)
    evidence_breakdown = models.JSONField(default=dict, blank=True)
    signals = models.ManyToManyField(TrendSignal, blank=True, related_name="topics")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.NEW)
    origin = models.CharField(max_length=8, choices=Origin.choices)

    class Meta:
        ordering = ["-evidence_score", "-created_at", "-id"]
        indexes = [
            models.Index(fields=["account", "plan", "status"], name="trend_topic_plan_status"),
            models.Index(fields=["account", "-evidence_score"], name="trend_topic_score"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(evidence_score__gte=0, evidence_score__lte=100),
                name="trend_topic_score_range",
            ),
        ]

    def __str__(self) -> str:
        return self.title
