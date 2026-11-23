"""InstagramAccount and BrandProfile (DATA-MODEL.md section 2).

Only the data layer is built here, ahead of E00-S03. The /accounts/ API, the fonts list
and logo uploads come with E00-S03; until then accounts are managed in the Django admin.
"""

from functools import cached_property
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models, transaction

from apps.core.models import TimeStampedModel

HANDLE_PATTERN = r"^[a-z0-9._]{1,30}$"

DEFAULT_POSTING_RULES = {
    "min_gap_minutes": 120,
    "max_feed_per_day": 2,
    "max_stories_per_day": 5,
    "max_revisions": 2,
}
DEFAULT_AUTOPILOT = {"selection": False, "brief": False, "script": False}
DEFAULT_BRAND_COLORS = {
    "primary": "#111111",
    "secondary": "#666666",
    "accent": "#1677FF",
    "background": "#FFFFFF",
    "text": "#111111",
}
DEFAULT_BRAND_FONTS = {"heading": "vazirmatn", "body": "vazirmatn"}


def default_timezone() -> str:
    return settings.SOCIALHUB_DEFAULT_ACCOUNT_TIME_ZONE


def default_posting_rules() -> dict:
    return dict(DEFAULT_POSTING_RULES)


def default_autopilot() -> dict:
    return dict(DEFAULT_AUTOPILOT)


def default_brand_colors() -> dict:
    return dict(DEFAULT_BRAND_COLORS)


def default_brand_fonts() -> dict:
    return dict(DEFAULT_BRAND_FONTS)


class InstagramAccount(TimeStampedModel):
    class ContentLanguage(models.TextChoices):
        FA = "fa", "Persian"
        EN = "en", "English"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    handle = models.CharField(
        max_length=30, unique=True, validators=[RegexValidator(HANDLE_PATTERN)]
    )
    display_name = models.CharField(max_length=80)
    timezone = models.CharField(max_length=64, default=default_timezone)
    content_language = models.CharField(
        max_length=2, choices=ContentLanguage.choices, default=ContentLanguage.FA
    )
    week_start_day = models.PositiveSmallIntegerField(
        default=5,
        validators=[MinValueValidator(0), MaxValueValidator(6)],
        help_text="0 = Monday … 6 = Sunday",
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    # Phase 2: the stop switch for sending to Instagram. Not read by any Phase 1 code.
    publishing_enabled = models.BooleanField(default=False)
    autopilot = models.JSONField(default=default_autopilot)
    posting_rules = models.JSONField(default=default_posting_rules)
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["handle"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(week_start_day__gte=0, week_start_day__lte=6),
                name="account_week_start_day_range",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=["active", "archived"]),
                name="account_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"@{self.handle}"

    def save(self, *args, **kwargs):
        # The brand profile is created with the account, in the same transaction.
        creating = self._state.adding
        with transaction.atomic():
            super().save(*args, **kwargs)
            if creating:
                BrandProfile.objects.create(account=self, handle_display=f"@{self.handle}")
        self.__dict__.pop("tz", None)

    @cached_property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def is_archived(self) -> bool:
        return self.status == self.Status.ARCHIVED

    @property
    def rules(self) -> dict:
        """Posting rules with defaults filled in for any key not stored."""
        return {**DEFAULT_POSTING_RULES, **(self.posting_rules or {})}


class BrandProfile(TimeStampedModel):
    class AIDisclosure(models.TextChoices):
        GENERATED_ONLY = "generated_only", "Only on generated content"
        ALWAYS = "always", "Always"
        NEVER = "never", "Never"

    account = models.OneToOneField(
        InstagramAccount, on_delete=models.CASCADE, related_name="brand_profile"
    )
    logo_light = models.FileField(upload_to="accounts/brand/", null=True, blank=True)
    logo_dark = models.FileField(upload_to="accounts/brand/", null=True, blank=True)
    colors = models.JSONField(default=default_brand_colors)
    fonts = models.JSONField(default=default_brand_fonts)
    tone_of_voice = models.TextField(blank=True, default="")
    audience_summary = models.TextField(blank=True, default="")
    content_pillars = models.JSONField(default=list, blank=True)
    default_hashtags = models.JSONField(default=list, blank=True)
    banned_terms = models.JSONField(default=list, blank=True)
    cta_examples = models.JSONField(default=list, blank=True)
    handle_display = models.CharField(max_length=40, blank=True, default="")
    ai_disclosure = models.CharField(
        max_length=20, choices=AIDisclosure.choices, default=AIDisclosure.GENERATED_ONLY
    )

    def __str__(self) -> str:
        return f"Brand profile for {self.account}"
