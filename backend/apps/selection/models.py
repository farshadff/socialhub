"""Candidates (docs/DATA-MODEL.md section 6).

Thin E03-S02 model so content items can reference the candidate they came from. The source
foreign keys (`topic`, `feed_item`, `repurpose_task`) and their check constraint are added by the
story that owns ranking, together with those tables; everything the brief and the facts check
read (`title`, `summary`, `sources`, `rationale`, `suggested_role`, scores) is here already.
"""

from django.db import models

from apps.core.models import TimestampedModel
from apps.planning.models import Role


class Candidate(TimestampedModel):
    class Kind(models.TextChoices):
        TREND = "trend"
        FEED_ITEM = "feed_item"
        REPURPOSE = "repurpose"

    class Status(models.TextChoices):
        CANDIDATE = "candidate"
        PROPOSED = "proposed"
        SELECTED = "selected"
        REJECTED = "rejected"

    account = models.ForeignKey("accounts.InstagramAccount", on_delete=models.CASCADE,
                                related_name="candidates")
    plan = models.ForeignKey("planning.WeeklyPlan", on_delete=models.CASCADE,
                             related_name="candidates")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    title = models.CharField(max_length=200)
    summary = models.TextField(max_length=1500, blank=True, default="")
    suggested_formats = models.JSONField(default=list, blank=True)
    suggested_role = models.CharField(max_length=16, choices=Role.choices, null=True, blank=True)
    sources = models.JSONField(default=list, blank=True)
    evidence_score = models.PositiveSmallIntegerField(default=0)
    goal_fit_score = models.PositiveSmallIntegerField(default=0)
    freshness_score = models.PositiveSmallIntegerField(default=0)
    total_score = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    rationale = models.TextField(max_length=600, blank=True, default="")
    duplicate_of = models.ForeignKey("content.ContentItem", null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name="+")
    rank = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.CANDIDATE)
    proposed_slot = models.ForeignKey("planning.PlanSlot", null=True, blank=True,
                                      on_delete=models.SET_NULL, related_name="+")
    ranked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["plan", "status", "rank"])]

    def __str__(self) -> str:
        return f"{self.kind}: {self.title}"
