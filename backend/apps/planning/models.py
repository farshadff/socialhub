"""Weekly planning tables (DATA-MODEL.md section 4, epic E01)."""

from datetime import timedelta

from django.conf import settings
from django.db import models

from apps.core.enums import Format, Metric, Role
from apps.core.models import TimeStampedModel

DEFAULT_SUCCESS_METRICS = ["reach", "saves", "shares"]

MAX_GOALS_PER_PLAN = 20
MAX_SLOTS_PER_PLAN = 60
MAX_TEMPLATE_ROWS = 40
MAX_TARGET_VALUE = 100_000_000


def default_success_metrics() -> list[str]:
    return list(DEFAULT_SUCCESS_METRICS)


class WeeklyPlan(TimeStampedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"

    account = models.ForeignKey(
        "accounts.InstagramAccount", on_delete=models.PROTECT, related_name="plans"
    )
    week_start = models.DateField()
    week_end = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    title = models.CharField(max_length=120)
    objective = models.TextField(max_length=1000, blank=True, default="")
    audience_summary = models.TextField(max_length=2000, blank=True, default="")
    audience_segments = models.JSONField(default=list, blank=True)
    success_metrics = models.JSONField(default=default_success_metrics)
    notes = models.TextField(max_length=5000, blank=True, default="")
    carried_findings = models.JSONField(default=list, blank=True)
    # `source_report` (FK WeeklyReport, SET_NULL) is added by E10 together with WeeklyReport.
    activated_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )

    class Meta:
        ordering = ["-week_start"]
        constraints = [
            models.UniqueConstraint(fields=["account", "week_start"], name="plan_unique_week"),
            models.CheckConstraint(
                condition=models.Q(week_end=models.F("week_start") + timedelta(days=6)),
                name="plan_week_is_seven_days",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=["draft", "active", "closed"]),
                name="plan_status_valid",
            ),
        ]
        indexes = [models.Index(fields=["status", "week_end"], name="plan_status_week_end")]

    def __str__(self) -> str:
        return f"{self.account} · {self.week_start} ({self.status})"


class PlanGoal(TimeStampedModel):
    class Scope(models.TextChoices):
        WEEK_TOTAL = "week_total", "Week total"
        PER_POST = "per_post", "Per post"

    plan = models.ForeignKey(WeeklyPlan, on_delete=models.CASCADE, related_name="goals")
    metric = models.CharField(max_length=20, choices=Metric.choices)
    scope = models.CharField(max_length=12, choices=Scope.choices)
    format = models.CharField(max_length=12, choices=Format.choices, null=True, blank=True)
    target_value = models.PositiveIntegerField()

    class Meta:
        ordering = ["id"]
        constraints = [
            # NULLS NOT DISTINCT: a null format means "all formats" and must be unique too.
            # Deferred so that a goal list replace can swap values inside one transaction.
            models.UniqueConstraint(
                fields=["plan", "metric", "scope", "format"],
                name="goal_unique_tuple",
                nulls_distinct=False,
                deferrable=models.Deferrable.DEFERRED,
            ),
            models.CheckConstraint(
                condition=models.Q(target_value__gte=1, target_value__lte=MAX_TARGET_VALUE),
                name="goal_target_value_range",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.metric} {self.scope} {self.format or 'all'} ≥ {self.target_value}"


class SlotTemplate(TimeStampedModel):
    """One row of the account's usual week."""

    account = models.ForeignKey(
        "accounts.InstagramAccount", on_delete=models.CASCADE, related_name="slot_template_rows"
    )
    weekday = models.PositiveSmallIntegerField(help_text="0 = Monday … 6 = Sunday")
    local_time = models.TimeField(help_text="In the account timezone, 5-minute steps")
    format = models.CharField(max_length=12, choices=Format.choices)
    default_role = models.CharField(max_length=12, choices=Role.choices, null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "weekday", "local_time", "format"],
                name="slot_template_unique_row",
            ),
            models.CheckConstraint(
                condition=models.Q(weekday__gte=0, weekday__lte=6),
                name="slot_template_weekday_range",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.account} · day {self.weekday} {self.local_time:%H:%M} {self.format}"


class PlanSlot(TimeStampedModel):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        RESERVED = "reserved", "Reserved"
        SCHEDULED = "scheduled", "Scheduled"
        PUBLISHED = "published", "Published"
        SKIPPED = "skipped", "Skipped"

    plan = models.ForeignKey(WeeklyPlan, on_delete=models.CASCADE, related_name="slots")
    scheduled_at = models.DateTimeField()
    format = models.CharField(max_length=12, choices=Format.choices)
    role = models.CharField(max_length=12, choices=Role.choices, null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    note = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["scheduled_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["plan", "scheduled_at", "format"], name="slot_unique_time_format"
            ),
        ]
        indexes = [models.Index(fields=["plan", "scheduled_at"], name="slot_plan_time")]

    def __str__(self) -> str:
        return f"{self.plan_id} · {self.scheduled_at:%Y-%m-%d %H:%M}Z {self.format} ({self.status})"
