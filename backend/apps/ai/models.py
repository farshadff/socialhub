"""AIRun: one row per logical AI call (DATA-MODEL.md section 3, E00-S05 rule 23)."""

from django.db import models

from apps.core.models import TimeStampedModel


class AIRun(TimeStampedModel):
    class Provider(models.TextChoices):
        ANTHROPIC = "anthropic", "Anthropic"
        OPENAI = "openai", "OpenAI"
        FAKE = "fake", "Fake"

    class Status(models.TextChoices):
        OK = "ok", "OK"
        ERROR = "error", "Error"
        REFUSED = "refused", "Refused"

    job = models.ForeignKey(
        "core.JobRun", on_delete=models.SET_NULL, null=True, blank=True, related_name="ai_runs"
    )
    account = models.ForeignKey(
        "accounts.InstagramAccount",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ai_runs",
    )
    provider = models.CharField(max_length=16, choices=Provider.choices)
    model = models.CharField(max_length=80, blank=True, default="")
    task = models.CharField(max_length=80)
    prompt_version = models.CharField(max_length=20, blank=True, default="")
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    units = models.JSONField(default=dict, blank=True)
    cost_usd = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    latency_ms = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices)
    error_code = models.CharField(max_length=64, null=True, blank=True)
    provider_request_id = models.CharField(max_length=120, null=True, blank=True)
    payload = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["created_at"], name="airun_created"),
            models.Index(fields=["task", "created_at"], name="airun_task_created"),
            models.Index(fields=["account", "created_at"], name="airun_account_created"),
            models.Index(fields=["job"], name="airun_job"),
        ]

    def __str__(self) -> str:
        return f"{self.task} {self.provider}/{self.model} ({self.status})"
