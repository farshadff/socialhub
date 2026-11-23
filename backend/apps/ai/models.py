from django.db import models


class AIRun(models.Model):
    """One logical AI call through the gateway, whatever its outcome (DATA-MODEL.md section 3).

    Written only by `apps.ai.gateway`. Retries inside one call share the row (`units.attempts`).
    `payload` is nulled after 30 days by `ai.prune_payloads`; the rest of the row is kept.
    """

    class Provider(models.TextChoices):
        ANTHROPIC = "anthropic"
        OPENAI = "openai"
        FAKE = "fake"

    class Status(models.TextChoices):
        OK = "ok"
        ERROR = "error"
        REFUSED = "refused"

    created_at = models.DateTimeField(auto_now_add=True)
    job = models.ForeignKey("core.JobRun", null=True, blank=True, on_delete=models.SET_NULL,
                            related_name="ai_runs")
    account = models.ForeignKey("accounts.InstagramAccount", null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="ai_runs",
                                db_index=False)  # covered by (account, created_at)
    provider = models.CharField(max_length=16, choices=Provider.choices)
    model = models.CharField(max_length=100, blank=True, default="")
    task = models.CharField(max_length=64)
    prompt_version = models.CharField(max_length=32, blank=True, default="")
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    units = models.JSONField(default=dict, blank=True)
    cost_usd = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    latency_ms = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=16, choices=Status.choices)
    error_code = models.CharField(max_length=64, null=True, blank=True)
    provider_request_id = models.CharField(max_length=128, null=True, blank=True)
    payload = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["created_at"], name="ai_airun_created_idx"),
            models.Index(fields=["task", "created_at"], name="ai_airun_task_created_idx"),
            models.Index(fields=["account", "created_at"], name="ai_airun_account_created_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.task} via {self.provider} ({self.status})"
