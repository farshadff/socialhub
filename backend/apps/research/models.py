"""Trend research tables (docs/DATA-MODEL.md section 5, epic E02)."""

from django.db import models
from django.db.models import Q

from apps.core.models import TimestampedModel


class SourceKind(models.TextChoices):
    WEB_SEARCH = "web_search", "Web search"
    RSS = "rss", "RSS feed"


class SignalKind(models.TextChoices):
    WEB_SEARCH = "web_search", "Web search"
    RSS = "rss", "RSS feed"
    MANUAL = "manual", "Manual"


class ResearchSource(TimestampedModel):
    account = models.ForeignKey("accounts.InstagramAccount", on_delete=models.CASCADE,
                                related_name="research_sources")
    kind = models.CharField(max_length=32, choices=SourceKind.choices)
    value = models.CharField(max_length=500)
    label = models.CharField(max_length=80, blank=True, default="")
    active = models.BooleanField(default=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    last_status = models.CharField(max_length=64, null=True, blank=True)

    class Meta:
        ordering = ["kind", "label", "id"]
        constraints = [
            models.UniqueConstraint(fields=["account", "kind", "value"],
                                    name="researchsource_unique_value"),
        ]
        indexes = [models.Index(fields=["account", "active"], name="researchsource_acct_active")]

    def __str__(self) -> str:
        return f"{self.kind}: {self.label or self.value}"


class ResearchRun(TimestampedModel):
    class Status(models.TextChoices):
        RUNNING = "running"
        COMPLETED = "completed"
        FAILED = "failed"

    account = models.ForeignKey("accounts.InstagramAccount", on_delete=models.CASCADE,
                                related_name="research_runs")
    plan = models.ForeignKey("planning.WeeklyPlan", null=True, blank=True,
                             on_delete=models.SET_NULL, related_name="research_runs")
    # Null only for the instant between creating the run and starting its job (the job's
    # target is the run's ID); every committed run has a job.
    job = models.ForeignKey("core.JobRun", null=True, blank=True, on_delete=models.PROTECT,
                            related_name="research_runs")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RUNNING)
    params = models.JSONField(default=dict)
    stats = models.JSONField(default=dict)
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)
    started_by = models.ForeignKey("auth.User", null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name="+")

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["account", "-started_at"], name="researchrun_acct_started")]
        constraints = [
            models.UniqueConstraint(fields=["account"], condition=Q(status="running"),
                                    name="researchrun_one_running_per_account"),
        ]

    def __str__(self) -> str:
        return f"Research run {self.pk} ({self.status})"


class TrendSignal(TimestampedModel):
    account = models.ForeignKey("accounts.InstagramAccount", on_delete=models.CASCADE,
                                related_name="trend_signals")
    run = models.ForeignKey(ResearchRun, null=True, blank=True, on_delete=models.SET_NULL,
                            related_name="signals")
    source = models.ForeignKey(ResearchSource, null=True, blank=True, on_delete=models.SET_NULL,
                               related_name="signals")
    kind = models.CharField(max_length=32, choices=SignalKind.choices)
    url = models.CharField(max_length=2000, blank=True, default="")
    title = models.CharField(max_length=300)
    excerpt = models.TextField(blank=True, default="")
    author = models.CharField(max_length=120, blank=True, default="")
    published_at = models.DateTimeField(null=True, blank=True)
    captured_at = models.DateTimeField()
    metrics = models.JSONField(default=dict, blank=True)
    fingerprint = models.CharField(max_length=64)
    raw = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-captured_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["account", "fingerprint"],
                                    name="trendsignal_unique_fingerprint"),
        ]
        indexes = [
            models.Index(fields=["account", "-captured_at"], name="trendsignal_acct_captured"),
            models.Index(fields=["run"], name="trendsignal_run"),
        ]

    def __str__(self) -> str:
        return self.title


class TrendTopic(TimestampedModel):
    class Status(models.TextChoices):
        NEW = "new"
        SHORTLISTED = "shortlisted"
        DISMISSED = "dismissed"
        USED = "used"

    class Origin(models.TextChoices):
        AI = "ai"
        MANUAL = "manual"

    account = models.ForeignKey("accounts.InstagramAccount", on_delete=models.CASCADE,
                                related_name="trend_topics")
    run = models.ForeignKey(ResearchRun, null=True, blank=True, on_delete=models.SET_NULL,
                            related_name="topics")
    plan = models.ForeignKey("planning.WeeklyPlan", null=True, blank=True,
                             on_delete=models.SET_NULL, related_name="trend_topics")
    title = models.CharField(max_length=120)
    summary = models.TextField(blank=True, default="")
    why_now = models.TextField(blank=True, default="")
    hooks = models.JSONField(default=list, blank=True)
    suggested_formats = models.JSONField(default=list, blank=True)
    keywords = models.JSONField(default=list, blank=True)
    evidence_score = models.PositiveSmallIntegerField(default=0)
    evidence_breakdown = models.JSONField(default=dict, blank=True)
    signals = models.ManyToManyField(TrendSignal, blank=True, related_name="topics")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NEW)
    origin = models.CharField(max_length=16, choices=Origin.choices, default=Origin.AI)

    class Meta:
        ordering = ["-evidence_score", "-created_at"]
        indexes = [
            models.Index(fields=["account", "plan", "status"], name="trendtopic_acct_plan_status"),
            models.Index(fields=["account", "-evidence_score"], name="trendtopic_acct_score"),
        ]

    def __str__(self) -> str:
        return self.title
