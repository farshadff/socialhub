import uuid

from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    """Every table carries `created_at` and `updated_at` in UTC (DATA-MODEL.md conventions)."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class JobRun(TimeStampedModel):
    """One background job (DATA-MODEL.md section 3, E00-S06). Created only by ``core.jobs.start_job``."""

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    ACTIVE_STATUSES = (Status.QUEUED, Status.RUNNING)
    TERMINAL_STATUSES = (Status.SUCCEEDED, Status.FAILED, Status.CANCELLED)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=64)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.QUEUED)
    account = models.ForeignKey(
        "accounts.InstagramAccount",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="jobs",
    )
    target_type = models.CharField(max_length=32)
    target_id = models.CharField(max_length=64)
    progress = models.PositiveSmallIntegerField(default=0)
    message = models.CharField(max_length=120, blank=True, default="")
    result = models.JSONField(null=True, blank=True)
    error_code = models.CharField(max_length=64, null=True, blank=True)
    error_detail = models.CharField(max_length=500, null=True, blank=True)
    request_id = models.CharField(max_length=64, null=True, blank=True)
    celery_task_id = models.CharField(max_length=64, null=True, blank=True)
    queue = models.CharField(max_length=16, default="default")
    deadline_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["target_type", "target_id", "kind"],
                condition=models.Q(status__in=["queued", "running"]),
                name="job_one_active_per_target_kind",
            ),
            models.CheckConstraint(
                condition=models.Q(progress__gte=0, progress__lte=100),
                name="job_progress_range",
            ),
        ]
        indexes = [
            models.Index(fields=["account", "status", "finished_at"], name="job_account_status"),
            models.Index(fields=["target_type", "target_id"], name="job_target"),
        ]

    def __str__(self) -> str:
        return f"{self.kind} {self.id} ({self.status})"

    @property
    def is_active(self) -> bool:
        return self.status in self.ACTIVE_STATUSES
