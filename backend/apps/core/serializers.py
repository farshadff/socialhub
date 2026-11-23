"""Shared response shapes: jobs (E00-S06) and nested user references."""

from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail

from .jobs import job_payload, job_summary
from .models import JobRun
from .users import user_ref


class UserRefField(serializers.Field):
    """`{"id", "name"}` for any `created_by`/`actor`-style field."""

    def __init__(self, **kwargs):
        kwargs.setdefault("read_only", True)
        super().__init__(**kwargs)

    def to_representation(self, value):
        return user_ref(value)

    def get_attribute(self, instance):
        # Let a null FK reach to_representation instead of being skipped.
        try:
            return super().get_attribute(instance)
        except (AttributeError, KeyError):
            return None


class JobSerializer(serializers.BaseSerializer):
    """The full job shape of docs/API.md "Long actions"."""

    def to_representation(self, instance: JobRun) -> dict:
        return job_payload(instance)


class JobSummarySerializer(serializers.BaseSerializer):
    """`JobSummary` = `{id, kind, status, progress, message}`, embedded as `active_job`."""

    def to_representation(self, instance: JobRun | None) -> dict | None:
        return job_summary(instance)


class _CsvChoiceField(serializers.CharField):
    def __init__(self, choices, **kwargs):
        self.allowed = set(choices)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        values = [v.strip() for v in super().to_internal_value(data).split(",") if v.strip()]
        if any(v not in self.allowed for v in values):
            raise serializers.ValidationError(
                [ErrorDetail("Unknown value.", code="invalid_choice")])
        return values


class _CsvField(serializers.CharField):
    def to_internal_value(self, data):
        return [v.strip() for v in super().to_internal_value(data).split(",") if v.strip()]


class JobListQuerySerializer(serializers.Serializer):
    """Query parameters of `GET /jobs/` (E00-S06 rule 21)."""

    ORDERINGS = ("created_at", "-created_at", "finished_at", "-finished_at")

    account = serializers.CharField(required=False)
    kind = _CsvField(required=False)
    kind_prefix = serializers.CharField(required=False, max_length=64)
    status = _CsvChoiceField(JobRun.Status.values, required=False)
    target_type = serializers.CharField(required=False, max_length=32)
    target_id = serializers.CharField(required=False, max_length=64)
    created_after = serializers.DateTimeField(required=False)
    created_before = serializers.DateTimeField(required=False)
    ordering = serializers.ChoiceField(ORDERINGS, required=False, default="-created_at")

    def validate_account(self, value):
        if value == "none":
            return value
        try:
            account_id = int(value)
        except ValueError:
            raise serializers.ValidationError(
                [ErrorDetail("Invalid account.", code="invalid")]) from None
        if account_id < 1:
            raise serializers.ValidationError([ErrorDetail("Invalid account.", code="invalid")])
        return account_id
