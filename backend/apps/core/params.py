"""Helpers for the shared list conventions in docs/API.md (account scope, filters)."""

from datetime import datetime

from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import NotFound, ValidationError


def csv_values(request, name: str) -> list[str]:
    raw = request.query_params.get(name, "")
    return [value.strip() for value in raw.split(",") if value.strip()]


def int_param(request, name: str, *, required: bool = False) -> int | None:
    raw = request.query_params.get(name)
    if raw in (None, ""):
        if required:
            raise ValidationError({name: [_required()]})
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValidationError({name: ["invalid"]}, code="invalid") from None


def bool_param(request, name: str) -> bool | None:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return None
    if raw.lower() in ("true", "1"):
        return True
    if raw.lower() in ("false", "0"):
        return False
    raise ValidationError({name: ["invalid"]}, code="invalid")


def datetime_param(request, name: str) -> datetime | None:
    raw = request.query_params.get(name)
    if not raw:
        return None
    value = parse_datetime(raw)
    if value is None:
        raise ValidationError({name: ["invalid"]}, code="invalid")
    return value


def required_account(request):
    """Resolve the required `?account=` parameter: 400 when missing, 404 when unknown."""
    from apps.accounts.models import InstagramAccount

    account_id = request.query_params.get("account")
    if not account_id:
        raise ValidationError({"account": [_required()]})
    try:
        return InstagramAccount.objects.get(pk=int(account_id))
    except (InstagramAccount.DoesNotExist, ValueError):
        raise NotFound() from None


def _required():
    from rest_framework.exceptions import ErrorDetail

    return ErrorDetail("This field is required.", code="required")
