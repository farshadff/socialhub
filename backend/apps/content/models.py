"""Content items and their versioned documents (docs/DATA-MODEL.md section 7).

Status fields are written only by `content.services` (pipeline, briefs, scripts) and
`production.services`; views never assign them.
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import TimestampedModel
from apps.planning.models import Format, Metric, Role


class MediaKind(models.TextChoices):
    IMAGE = "image", "Image"
    VIDEO = "video", "Video"


class ProductionMode(models.TextChoices):
    DESIGN = "design", "Design"
    MOTION = "motion", "Motion"
    VIDEO = "video", "Video"


class Origin(models.TextChoices):
    AI = "ai"
    HUMAN = "human"


class DocumentStatus(models.TextChoices):
    DRAFT = "draft"
    APPROVED = "approved"
    SUPERSEDED = "superseded"


class ContentItem(TimestampedModel):
    class Status(models.TextChoices):
        SELECTED = "selected"
        BRIEFED = "briefed"
        SCRIPTED = "scripted"
        IN_PRODUCTION = "in_production"
        IN_CHECK = "in_check"
        NEEDS_REVISION = "needs_revision"
        IN_REVIEW = "in_review"
        APPROVED = "approved"
        SCHEDULED = "scheduled"
        PUBLISHING = "publishing"
        PUBLISHED = "published"
        FAILED = "failed"
        CANCELLED = "cancelled"

    account = models.ForeignKey("accounts.InstagramAccount", on_delete=models.CASCADE,
                                related_name="content_items")
    plan = models.ForeignKey("planning.WeeklyPlan", on_delete=models.CASCADE,
                             related_name="content_items")
    slot = models.OneToOneField("planning.PlanSlot", null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="content_item")
    candidate = models.ForeignKey("selection.Candidate", on_delete=models.PROTECT,
                                  related_name="content_items")
    title = models.CharField(max_length=200)
    format = models.CharField(max_length=16, choices=Format.choices)
    media_kind = models.CharField(max_length=8, choices=MediaKind.choices)
    production_mode = models.CharField(max_length=8, choices=ProductionMode.choices)
    role = models.CharField(max_length=16, choices=Role.choices, null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SELECTED)
    current_brief = models.ForeignKey("content.Brief", null=True, blank=True,
                                      on_delete=models.SET_NULL, related_name="+")
    current_script = models.ForeignKey("content.ScriptVersion", null=True, blank=True,
                                       on_delete=models.SET_NULL, related_name="+")
    current_version = models.ForeignKey("content.ContentVersion", null=True, blank=True,
                                        on_delete=models.SET_NULL, related_name="+")
    revision_count = models.PositiveIntegerField(default=0)
    auto_revision_count = models.PositiveIntegerField(default=0)
    active_job = models.ForeignKey("core.JobRun", null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")
    hold_reason = models.TextField(blank=True, default="")
    cancelled_reason = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")

    class Meta:
        indexes = [
            models.Index(fields=["account", "status"]),
            models.Index(fields=["plan", "status"]),
        ]

    def __str__(self) -> str:
        return f"#{self.pk} {self.title} ({self.status})"


class ContentEvent(models.Model):
    class Type(models.TextChoices):
        STATUS_CHANGED = "status_changed"
        JOB_STARTED = "job_started"
        JOB_FAILED = "job_failed"
        EDITED = "edited"
        QC_RESULT = "qc_result"
        REVIEW_DECISION = "review_decision"
        PUBLISH_ATTEMPT = "publish_attempt"
        NOTE = "note"

    content_item = models.ForeignKey(ContentItem, on_delete=models.CASCADE, related_name="events")
    type = models.CharField(max_length=24, choices=Type.choices)
    from_status = models.CharField(max_length=16, null=True, blank=True)
    to_status = models.CharField(max_length=16, null=True, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                              on_delete=models.SET_NULL, related_name="+")
    message = models.TextField(blank=True, default="")
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["content_item", "-created_at"])]


class Brief(TimestampedModel):
    content_item = models.ForeignKey(ContentItem, on_delete=models.CASCADE, related_name="briefs")
    version = models.PositiveIntegerField()
    role = models.CharField(max_length=16, choices=Role.choices)
    objective = models.TextField()
    key_message = models.TextField()
    hook_direction = models.TextField()
    audience_note = models.TextField(blank=True, default="")
    cta = models.TextField(blank=True, default="")
    must_include = models.JSONField(default=list, blank=True)
    must_avoid = models.JSONField(default=list, blank=True)
    references = models.JSONField(default=list, blank=True)
    format_notes = models.TextField(blank=True, default="")
    success_metric = models.CharField(max_length=24, choices=Metric.choices)
    feedback = models.TextField(blank=True, default="")
    status = models.CharField(max_length=16, choices=DocumentStatus.choices,
                              default=DocumentStatus.DRAFT)
    origin = models.CharField(max_length=8, choices=Origin.choices)
    ai_run = models.ForeignKey("ai.AIRun", null=True, blank=True, on_delete=models.SET_NULL,
                               related_name="+", db_constraint=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["content_item", "version"],
                                               name="brief_unique_version")]
        indexes = [models.Index(fields=["content_item", "-version"])]
        ordering = ["-version"]


class ScriptVersion(TimestampedModel):
    content_item = models.ForeignKey(ContentItem, on_delete=models.CASCADE,
                                     related_name="script_versions")
    version = models.PositiveIntegerField()
    brief = models.ForeignKey(Brief, on_delete=models.PROTECT, related_name="script_versions")
    payload = models.JSONField()
    feedback = models.TextField(blank=True, default="")
    status = models.CharField(max_length=16, choices=DocumentStatus.choices,
                              default=DocumentStatus.DRAFT)
    origin = models.CharField(max_length=8, choices=Origin.choices)
    ai_run = models.ForeignKey("ai.AIRun", null=True, blank=True, on_delete=models.SET_NULL,
                               related_name="+", db_constraint=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["content_item", "version"],
                                    name="script_unique_version"),
            models.UniqueConstraint(fields=["content_item"], condition=Q(status="approved"),
                                    name="script_one_approved"),
            models.UniqueConstraint(fields=["content_item"], condition=Q(status="draft"),
                                    name="script_one_draft"),
        ]
        ordering = ["-version"]


class Asset(TimestampedModel):
    class Kind(models.TextChoices):
        IMAGE = "image"
        VIDEO = "video"
        AUDIO = "audio"
        DOCUMENT = "document"

    class Role(models.TextChoices):
        SOURCE = "source"
        BACKGROUND = "background"
        CLIP = "clip"
        MUSIC = "music"
        FRAME = "frame"
        COVER = "cover"
        FINAL = "final"

    class AssetOrigin(models.TextChoices):
        UPLOADED = "uploaded"
        LICENSED = "licensed"
        AI_GENERATED = "ai_generated"
        RENDERED = "rendered"

    class Rights(models.TextChoices):
        CLEARED = "cleared"
        UNKNOWN = "unknown"
        RESTRICTED = "restricted"
        EXPIRED = "expired"

    account = models.ForeignKey("accounts.InstagramAccount", on_delete=models.CASCADE,
                                related_name="assets")
    content_item = models.ForeignKey(ContentItem, null=True, blank=True,
                                     on_delete=models.CASCADE, related_name="assets")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    role = models.CharField(max_length=12, choices=Role.choices)
    file = models.FileField(max_length=300)
    thumbnail = models.FileField(max_length=300, null=True, blank=True)
    original_filename = models.CharField(max_length=255, blank=True, default="")
    mime = models.CharField(max_length=100)
    bytes = models.BigIntegerField(default=0)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    checksum = models.CharField(max_length=64)
    origin = models.CharField(max_length=14, choices=AssetOrigin.choices)
    rights_status = models.CharField(max_length=12, choices=Rights.choices,
                                     default=Rights.UNKNOWN)
    license_note = models.TextField(blank=True, default="")
    source_url = models.URLField(max_length=1000, blank=True, default="")
    rights_expires_at = models.DateField(null=True, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")

    class Meta:
        indexes = [
            models.Index(fields=["account", "content_item", "kind"]),
            models.Index(fields=["account", "checksum"]),
        ]
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"Asset #{self.pk} {self.kind}/{self.role}"


class ContentVersion(TimestampedModel):
    class RenderStatus(models.TextChoices):
        PENDING = "pending"
        RENDERING = "rendering"
        READY = "ready"
        FAILED = "failed"

    class VersionOrigin(models.TextChoices):
        PIPELINE = "pipeline"
        MANUAL_UPLOAD = "manual_upload"

    class Status(models.TextChoices):
        DRAFT = "draft"
        SUBMITTED = "submitted"
        PASSED = "passed"
        REJECTED = "rejected"

    class SubmitTrigger(models.TextChoices):
        SUBMISSION = "submission"
        REVISION = "revision"

    content_item = models.ForeignKey(ContentItem, on_delete=models.CASCADE,
                                     related_name="versions")
    version = models.PositiveIntegerField()
    script = models.ForeignKey(ScriptVersion, null=True, blank=True, on_delete=models.PROTECT,
                               related_name="content_versions")
    caption = models.TextField(blank=True, default="")
    hashtags = models.JSONField(default=list, blank=True)
    alt_text = models.TextField(blank=True, default="")
    frames = models.JSONField(default=list, blank=True)
    clips = models.JSONField(default=list, blank=True)
    music_asset = models.ForeignKey(Asset, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+")
    cover_frame_index = models.PositiveIntegerField(null=True, blank=True)
    final_asset = models.ForeignKey(Asset, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+")
    cover_asset = models.ForeignKey(Asset, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+")
    render_status = models.CharField(max_length=10, choices=RenderStatus.choices,
                                     default=RenderStatus.PENDING)
    render_warnings = models.JSONField(default=list, blank=True)
    production_steps = models.JSONField(default=dict, blank=True)
    origin = models.CharField(max_length=14, choices=VersionOrigin.choices,
                              default=VersionOrigin.PIPELINE)
    change_note = models.TextField(blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    submit_trigger = models.CharField(max_length=10, choices=SubmitTrigger.choices, null=True,
                                      blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name="+")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["content_item", "version"],
                                               name="content_version_unique_version")]
        ordering = ["-version"]
