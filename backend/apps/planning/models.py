"""Weekly plans, goals, slot templates and slots (docs/DATA-MODEL.md section 4, epic E01).

`source_report` is added by E10-S03 together with `WeeklyReport`; until then the API returns null.
"""

from datetime import timedelta

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import TimestampedModel


class Format(models.TextChoices):
    REEL = "reel", "Reel"
    STORY = "story", "Story"
    FEED_POST = "feed_post", "Feed post"


class Role(models.TextChoices):
    ATTRACT = "attract", "Attract"
    EDUCATE = "educate", "Educate"
    BUILD_TRUST = "build_trust", "Build trust"
    CONVERT = "convert", "Convert"
    ENGAGE = "engage", "Engage"


class Metric(models.TextChoices):
    REACH = "reach", "Reach"
    VIEWS = "views", "Views"
    LIKES = "likes", "Likes"
    COMMENTS = "comments", "Comments"
    SAVES = "saves", "Saves"
    SHARES = "shares", "Shares"
    REPLIES = "replies", "Replies"
    FOLLOWER_GROWTH = "follower_growth", "Follower growth"


FEED_FORMATS = (Format.REEL, Format.FEED_POST)


def default_success_metrics():
    return ["reach", "saves", "shares"]


def default_title(week_start) -> str:
    return f"Week of {week_start.day} {week_start:%b}"


class WeeklyPlan(TimestampedModel):
    class Status(models.TextChoices):
        DRAFT = "draft"
        ACTIVE = "active"
        CLOSED = "closed"

    account = models.ForeignKey("accounts.InstagramAccount", on_delete=models.CASCADE,
                                related_name="plans")
    week_start = models.DateField()
    week_end = models.DateField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    title = models.CharField(max_length=120, blank=True, default="")
    objective = models.TextField(blank=True, default="")
    audience_summary = models.TextField(blank=True, default="")
    audience_segments = models.JSONField(default=list, blank=True)
    success_metrics = models.JSONField(default=default_success_metrics)
    notes = models.TextField(blank=True, default="")
    carried_findings = models.JSONField(default=list, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["week_start"]
        constraints = [
            models.UniqueConstraint(fields=["account", "week_start"],
                                    name="weeklyplan_unique_account_week"),
        ]
        indexes = [models.Index(fields=["status", "week_end"], name="weeklyplan_status_end")]

    def __str__(self) -> str:
        return f"{self.title} (@{self.account.handle})"

    def save(self, *args, **kwargs):
        self.week_end = self.week_start + timedelta(days=6)
        if not self.title:
            self.title = default_title(self.week_start)
        super().save(*args, **kwargs)


class PlanGoal(TimestampedModel):
    class Scope(models.TextChoices):
        WEEK_TOTAL = "week_total", "Week total"
        PER_POST = "per_post", "Per post"

    plan = models.ForeignKey(WeeklyPlan, on_delete=models.CASCADE, related_name="goals")
    metric = models.CharField(max_length=24, choices=Metric.choices)
    scope = models.CharField(max_length=16, choices=Scope.choices)
    format = models.CharField(max_length=16, choices=Format.choices, null=True, blank=True)
    target_value = models.PositiveIntegerField()

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["plan", "metric", "scope", "format"],
                                    name="plangoal_unique_tuple", nulls_distinct=False),
            models.CheckConstraint(condition=Q(target_value__gt=0),
                                   name="plangoal_target_positive"),
        ]

    def __str__(self) -> str:
        return f"{self.metric} {self.scope} {self.format or 'all'} ≥ {self.target_value}"


class SlotTemplate(TimestampedModel):
    """One row of an account's usual week."""

    account = models.ForeignKey("accounts.InstagramAccount", on_delete=models.CASCADE,
                                related_name="slot_template")
    weekday = models.PositiveSmallIntegerField()  # 0 = Monday
    local_time = models.TimeField()
    format = models.CharField(max_length=16, choices=Format.choices)
    default_role = models.CharField(max_length=16, choices=Role.choices, null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["weekday", "local_time", "id"]
        constraints = [
            models.UniqueConstraint(fields=["account", "weekday", "local_time", "format"],
                                    name="slottemplate_unique_row"),
            models.CheckConstraint(condition=Q(weekday__lte=6), name="slottemplate_weekday"),
        ]

    def __str__(self) -> str:
        return f"{self.weekday} {self.local_time:%H:%M} {self.format}"


class PlanSlot(TimestampedModel):
    class Status(models.TextChoices):
        OPEN = "open"
        RESERVED = "reserved"
        SCHEDULED = "scheduled"
        PUBLISHED = "published"
        SKIPPED = "skipped"

    plan = models.ForeignKey(WeeklyPlan, on_delete=models.CASCADE, related_name="slots")
    scheduled_at = models.DateTimeField()
    format = models.CharField(max_length=16, choices=Format.choices)
    role = models.CharField(max_length=16, choices=Role.choices, null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    note = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["scheduled_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["plan", "scheduled_at", "format"],
                                    name="planslot_unique_time_format"),
        ]
        indexes = [models.Index(fields=["plan", "scheduled_at"], name="planslot_plan_time")]

    def __str__(self) -> str:
        return f"{self.format} at {self.scheduled_at:%Y-%m-%d %H:%M}Z"
