"""Account and brand profile serializers (E00-S03)."""

from __future__ import annotations

import re

from pydantic import ValidationError as PydanticValidationError
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail

from apps.core.storage import MediaURLField

from . import schemas
from .brand import brand_warnings
from .models import (
    AccountConnection,
    BrandProfile,
    InstagramAccount,
    default_autopilot,
    default_posting_rules,
    is_valid_handle,
    is_valid_timezone,
    normalize_handle,
)

ADMIN_ONLY_FIELDS = frozenset({"handle", "status", "publishing_enabled", "autopilot"})
NOTES_MAX = 1000
_HASHTAG_RE = re.compile(r"^[^\s#]{1,100}$")
HASHTAGS_MAX = 30


def _error(code: str, message: str | None = None) -> ErrorDetail:
    return ErrorDetail(message or code, code=code)


def _parse_json(model, value):
    try:
        return schemas.parse(model, value)
    except PydanticValidationError as exc:
        raise serializers.ValidationError(schemas.drf_errors(exc)) from None


def _merge(model, stored: dict, defaults: dict, sent):
    """Merge a partial JSON object into the stored one; unknown keys are rejected (rules 8-9)."""
    if not isinstance(sent, dict):
        raise serializers.ValidationError(_error("invalid", "Expected an object."))
    return _parse_json(model, {**defaults, **(stored or {}), **sent})


# --- accounts -----------------------------------------------------------------------------


class AccountSerializer(serializers.ModelSerializer):
    """The account representation (list, detail and every write response)."""

    connection_status = serializers.SerializerMethodField()
    connection_provider = serializers.SerializerMethodField()
    brand_complete = serializers.SerializerMethodField()

    class Meta:
        model = InstagramAccount
        fields = ["id", "handle", "display_name", "timezone", "content_language",
                  "week_start_day", "status", "publishing_enabled", "autopilot",
                  "posting_rules", "notes", "connection_status", "connection_provider",
                  "brand_complete", "created_at", "updated_at"]
        read_only_fields = fields

    @staticmethod
    def _connection(account) -> AccountConnection | None:
        try:
            return account.connection
        except AccountConnection.DoesNotExist:
            return None

    def get_connection_status(self, account) -> str:
        connection = self._connection(account)
        return connection.status if connection else AccountConnection.Status.DISCONNECTED

    def get_connection_provider(self, account) -> str | None:
        connection = self._connection(account)
        return connection.provider if connection else None

    def get_brand_complete(self, account) -> bool:
        try:
            return account.brand.complete
        except BrandProfile.DoesNotExist:
            return False


class AccountWriteSerializer(serializers.Serializer):
    """Create (`POST`) and update (`PATCH`, partial) input. Admin-only fields are checked by the
    view before validation; transitions (rules 3, 11, 12) are applied by the view."""

    handle = serializers.CharField(max_length=64)
    display_name = serializers.CharField(max_length=80)
    timezone = serializers.CharField(required=False, max_length=64)
    content_language = serializers.ChoiceField(choices=InstagramAccount.Language.choices,
                                               required=False)
    week_start_day = serializers.IntegerField(min_value=0, max_value=6, required=False)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=NOTES_MAX)
    # PATCH only
    status = serializers.ChoiceField(choices=InstagramAccount.Status.choices, required=False)
    publishing_enabled = serializers.BooleanField(required=False)
    autopilot = serializers.JSONField(required=False)
    posting_rules = serializers.JSONField(required=False)

    UPDATE_ONLY = ("status", "publishing_enabled", "autopilot", "posting_rules")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance is None:
            for name in self.UPDATE_ONLY:
                self.fields.pop(name)

    def validate_handle(self, value):
        handle = normalize_handle(value)
        if not is_valid_handle(handle):
            raise serializers.ValidationError(_error("invalid", "Invalid handle."))
        others = InstagramAccount.objects.filter(handle__iexact=handle)
        if self.instance is not None:
            others = others.exclude(pk=self.instance.pk)
        if others.exists():  # archived accounts included (rule 2)
            raise serializers.ValidationError(_error("unique", "This is already in use."))
        return handle

    def validate_timezone(self, value):
        if not is_valid_timezone(value):
            raise serializers.ValidationError(_error("invalid", "Unknown time zone."))
        return value

    def validate_autopilot(self, value):
        return _merge(schemas.Autopilot, self.instance.autopilot, default_autopilot(), value)

    def validate_posting_rules(self, value):
        return _merge(schemas.PostingRules, self.instance.posting_rules,
                      default_posting_rules(), value)


# --- brand profile ------------------------------------------------------------------------


class BrandSerializer(serializers.ModelSerializer):
    """The brand representation (rules 20-21 add `warnings` and `complete`)."""

    account = serializers.IntegerField(source="account_id", read_only=True)
    logo_light = MediaURLField()
    logo_dark = MediaURLField()
    complete = serializers.BooleanField(read_only=True)
    warnings = serializers.SerializerMethodField()

    class Meta:
        model = BrandProfile
        fields = ["account", "logo_light", "logo_dark", "colors", "fonts", "tone_of_voice",
                  "audience_summary", "content_pillars", "default_hashtags", "banned_terms",
                  "cta_examples", "handle_display", "ai_disclosure", "complete", "warnings",
                  "updated_at"]
        read_only_fields = fields

    def get_warnings(self, brand) -> list[dict]:
        try:
            return brand_warnings(schemas.parse(schemas.BrandColors, brand.colors))
        except PydanticValidationError:
            return []


def _items(max_items: int, max_chars: int) -> serializers.ListField:
    return serializers.ListField(child=serializers.CharField(max_length=max_chars),
                                 max_length=max_items)


class BrandWriteSerializer(serializers.Serializer):
    """`PUT` input: every field is required (rule 16). Logos are handled by the view."""

    colors = serializers.JSONField()
    fonts = serializers.JSONField()
    tone_of_voice = serializers.CharField(allow_blank=True, max_length=2000)
    audience_summary = serializers.CharField(allow_blank=True, max_length=2000)
    content_pillars = _items(10, 80)
    default_hashtags = serializers.ListField(
        child=serializers.CharField(allow_blank=True, max_length=200), max_length=300)
    banned_terms = _items(100, 80)
    cta_examples = _items(10, 200)
    handle_display = serializers.CharField(max_length=40)
    ai_disclosure = serializers.ChoiceField(choices=BrandProfile.AIDisclosure.choices)

    def validate_colors(self, value):
        return _parse_json(schemas.BrandColors, value)

    def validate_fonts(self, value):
        return _parse_json(schemas.BrandFonts, value)

    def validate_default_hashtags(self, value):
        tags, seen, errors = [], set(), {}
        for index, raw in enumerate(value):
            tag = raw[1:] if raw.startswith("#") else raw
            if not _HASHTAG_RE.fullmatch(tag):
                errors[index] = [_error("invalid", "Invalid hashtag.")]
                continue
            folded = tag.casefold()
            if folded not in seen:
                seen.add(folded)
                tags.append(tag)
        if errors:
            raise serializers.ValidationError(errors)
        if len(tags) > HASHTAGS_MAX:
            raise serializers.ValidationError(_error("max_length", "Too many hashtags."))
        return tags
