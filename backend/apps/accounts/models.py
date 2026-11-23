"""Instagram accounts, brand profiles and Instagram connections (docs/DATA-MODEL.md section 2).

E00-S03 owns these tables. Every account has exactly one `BrandProfile` (`account.brand`) and one
`AccountConnection` (`account.connection`); both are created with the account in the same
transaction (`services.create_account`, or any `InstagramAccount.objects.create`). E00-S04 fills
the connection; this story only creates it `disconnected` with the default provider.
"""

from __future__ import annotations

import re
from functools import lru_cache
from zoneinfo import available_timezones

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import (
    MaxValueValidator,
    MinLengthValidator,
    MinValueValidator,
    RegexValidator,
)
from django.db import models, transaction

from apps.core.models import TimestampedModel

from .schemas import validate_autopilot, validate_colors, validate_fonts, validate_posting_rules

HANDLE_PATTERN = r"^[a-z0-9._]{1,30}$"
_HANDLE_RE = re.compile(HANDLE_PATTERN)


def normalize_handle(value: str) -> str:
    """Strip surrounding spaces and one leading `@`, then lowercase (rule 2)."""
    value = (value or "").strip()
    if value.startswith("@"):
        value = value[1:].strip()
    return value.lower()


def is_valid_handle(value: str) -> bool:
    return bool(_HANDLE_RE.fullmatch(value or ""))


@lru_cache(maxsize=1)
def _timezones() -> frozenset[str]:
    return frozenset(available_timezones())


def is_valid_timezone(value) -> bool:
    return isinstance(value, str) and value in _timezones()


def validate_timezone(value) -> None:
    if not is_valid_timezone(value):
        raise ValidationError("Unknown IANA time zone.", code="invalid")


def default_autopilot():
    return {"selection": False, "brief": False, "script": False}


def default_posting_rules():
    return {"min_gap_minutes": 120, "max_feed_per_day": 2, "max_stories_per_day": 5,
            "max_revisions": 2}


def default_timezone():
    return settings.SOCIALHUB_DEFAULT_ACCOUNT_TIME_ZONE


class InstagramAccount(TimestampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active"
        ARCHIVED = "archived"

    class Language(models.TextChoices):
        FA = "fa", "Persian"
        EN = "en", "English"

    handle = models.CharField(
        max_length=30, unique=True,
        validators=[RegexValidator(HANDLE_PATTERN)],
    )
    display_name = models.CharField(max_length=80, validators=[MinLengthValidator(1)])
    timezone = models.CharField(max_length=64, default=default_timezone,
                                validators=[validate_timezone])
    content_language = models.CharField(max_length=2, choices=Language.choices, default="fa")
    week_start_day = models.PositiveSmallIntegerField(
        default=5, validators=[MinValueValidator(0), MaxValueValidator(6)]
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    publishing_enabled = models.BooleanField(default=False)
    autopilot = models.JSONField(default=default_autopilot, validators=[validate_autopilot])
    posting_rules = models.JSONField(default=default_posting_rules,
                                     validators=[validate_posting_rules])
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["handle"]

    def __str__(self) -> str:
        return f"@{self.handle}"

    @property
    def is_archived(self) -> bool:
        return self.status == self.Status.ARCHIVED

    def save(self, *args, **kwargs):
        if self.is_archived:
            self.publishing_enabled = False  # rule 12: archiving switches publishing off
        if not self._state.adding:
            super().save(*args, **kwargs)
            return
        with transaction.atomic():
            super().save(*args, **kwargs)
            BrandProfile.objects.get_or_create(account=self)
            AccountConnection.objects.get_or_create(account=self)


def default_colors():
    return {"primary": "#111111", "secondary": "#666666", "accent": "#1677FF",
            "background": "#FFFFFF", "text": "#111111"}


def default_fonts():
    return {"heading": "vazirmatn", "body": "vazirmatn"}


class BrandProfile(TimestampedModel):
    class AIDisclosure(models.TextChoices):
        GENERATED_ONLY = "generated_only"
        ALWAYS = "always"
        NEVER = "never"

    account = models.OneToOneField(InstagramAccount, on_delete=models.CASCADE,
                                   related_name="brand")
    # Stored files, not Asset rows; keys come from `apps.core.storage.brand_key`.
    logo_light = models.FileField(max_length=255, null=True, blank=True)
    logo_dark = models.FileField(max_length=255, null=True, blank=True)
    colors = models.JSONField(default=default_colors, validators=[validate_colors])
    fonts = models.JSONField(default=default_fonts, validators=[validate_fonts])
    tone_of_voice = models.TextField(blank=True, default="")
    audience_summary = models.TextField(blank=True, default="")
    content_pillars = models.JSONField(default=list, blank=True)
    default_hashtags = models.JSONField(default=list, blank=True)
    banned_terms = models.JSONField(default=list, blank=True)
    cta_examples = models.JSONField(default=list, blank=True)
    handle_display = models.CharField(max_length=40, blank=True, default="")
    ai_disclosure = models.CharField(max_length=16, choices=AIDisclosure.choices,
                                     default=AIDisclosure.GENERATED_ONLY)

    def __str__(self) -> str:
        return f"Brand of @{self.account.handle}"

    @property
    def complete(self) -> bool:
        """Rule 21: a light logo, a tone of voice and both fonts."""
        fonts = self.fonts or {}
        return bool(self.logo_light and (self.tone_of_voice or "").strip()
                    and fonts.get("heading") and fonts.get("body"))

    def save(self, *args, **kwargs):
        if not self.handle_display:
            self.handle_display = f"@{self.account.handle}"
        super().save(*args, **kwargs)


def default_provider():
    return settings.SOCIALHUB_IG_DEFAULT_PROVIDER


def default_capabilities():
    return {"publish_feed": False, "publish_reel": False, "publish_story": False,
            "insights": False}


class AccountConnection(TimestampedModel):
    """The account's link to Instagram. Created here; connected and verified by E00-S04."""

    class Provider(models.TextChoices):
        GRAPH_API = "graph_api"
        MANUAL = "manual"
        FAKE = "fake"

    class Status(models.TextChoices):
        DISCONNECTED = "disconnected"
        CONNECTED = "connected"
        EXPIRING = "expiring"
        NEEDS_ATTENTION = "needs_attention"

    class AccountType(models.TextChoices):  # Instagram's spelling
        BUSINESS = "BUSINESS"
        MEDIA_CREATOR = "MEDIA_CREATOR"

    # Statuses in which publishing may be switched on (S03 rule 11).
    PUBLISHABLE_STATUSES = (Status.CONNECTED, Status.EXPIRING)

    account = models.OneToOneField(InstagramAccount, on_delete=models.CASCADE,
                                   related_name="connection")
    provider = models.CharField(max_length=16, choices=Provider.choices,
                                default=default_provider)
    status = models.CharField(max_length=16, choices=Status.choices,
                              default=Status.DISCONNECTED)
    ig_user_id = models.CharField(max_length=64, null=True, blank=True)
    username = models.CharField(max_length=64, blank=True, default="")
    account_type = models.CharField(max_length=16, choices=AccountType.choices, null=True,
                                    blank=True)
    access_token_encrypted = models.TextField(null=True, blank=True)  # never serialized
    token_expires_at = models.DateTimeField(null=True, blank=True)
    token_refreshed_at = models.DateTimeField(null=True, blank=True)
    scopes = models.JSONField(default=list, blank=True)
    capabilities = models.JSONField(default=default_capabilities)
    last_verified_at = models.DateTimeField(null=True, blank=True)
    last_error_code = models.CharField(max_length=64, null=True, blank=True)
    last_error_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return f"Connection of @{self.account.handle} ({self.provider}, {self.status})"

    @property
    def has_token(self) -> bool:
        return bool(self.access_token_encrypted)

    @property
    def can_publish(self) -> bool:
        return self.status in self.PUBLISHABLE_STATUSES
