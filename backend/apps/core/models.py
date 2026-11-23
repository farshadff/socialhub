import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class JobRun(TimestampedModel):
    """One background job (docs/DATA-MODEL.md section 3, E00-S06).

    Create rows only through `apps.core.jobs.start_job`; status changes go through
    `apps.core.jobs` so terminal updates stay conditional and `active_job` stays in sync.
    """

    class Status(models.TextChoices):
        QUEUED = "queued"
        RUNNING = "running"
        SUCCEEDED = "succeeded"
        FAILED = "failed"
        CANCELLED = "cancelled"

    ACTIVE_STATUSES = (Status.QUEUED, Status.RUNNING)
    TERMINAL_STATUSES = (Status.SUCCEEDED, Status.FAILED, Status.CANCELLED)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=64)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    account = models.ForeignKey(
        "accounts.InstagramAccount", null=True, blank=True, on_delete=models.CASCADE,
        related_name="jobs",
    )
    target_type = models.CharField(max_length=32)
    target_id = models.CharField(max_length=64)
    progress = models.PositiveSmallIntegerField(default=0)
    message = models.CharField(max_length=300, blank=True, default="")
    result = models.JSONField(null=True, blank=True)
    error_code = models.CharField(max_length=64, null=True, blank=True)
    error_detail = models.TextField(null=True, blank=True)
    request_id = models.CharField(max_length=64, null=True, blank=True)
    celery_task_id = models.CharField(max_length=255, null=True, blank=True)
    queue = models.CharField(max_length=16, default="default")
    deadline_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["target_type", "target_id", "status"],
                         name="jobrun_target_status"),
            models.Index(fields=["account", "-created_at"], name="jobrun_account_created"),
            models.Index(fields=["status", "deadline_at"], name="jobrun_status_deadline"),
            models.Index(fields=["account", "status", "finished_at"],
                         name="jobrun_account_status_finished"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["target_type", "target_id", "kind"],
                condition=Q(status__in=["queued", "running"]),
                name="jobrun_one_active_per_target_kind",
            )
        ]

    def __str__(self) -> str:
        return f"{self.kind} {self.target_type}#{self.target_id} ({self.status})"

    @property
    def is_terminal(self) -> bool:
        return self.status in self.TERMINAL_STATUSES

    @property
    def is_active(self) -> bool:
        return self.status in self.ACTIVE_STATUSES
