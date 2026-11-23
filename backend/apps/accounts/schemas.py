"""Shapes of the JSON columns on accounts and brand profiles (docs/DATA-MODEL.md section 2).

The Pydantic models are the single definition used by the model validators (admin, `full_clean`)
and the API serializers. `drf_errors` turns a Pydantic error into the nested DRF error shape, so
the API reports paths such as `posting_rules.min_gap_minutes` with codes such as `min_value`.
"""

from __future__ import annotations

from typing import Annotated

from django.core.exceptions import ValidationError as DjangoValidationError
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool, StrictInt
from pydantic import ValidationError as PydanticValidationError
from pydantic_core import PydanticCustomError
from rest_framework.exceptions import ErrorDetail

from apps.core.fonts import registry as font_registry

HEX_COLOR = r"^#[0-9A-Fa-f]{6}$"
COLOR_KEYS = ("primary", "secondary", "accent", "background", "text")
FONT_KEYS = ("heading", "body")
AUTOPILOT_KEYS = ("selection", "brief", "script")
POSTING_RULE_KEYS = ("min_gap_minutes", "max_feed_per_day", "max_stories_per_day",
                     "max_revisions")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Autopilot(_Strict):
    selection: StrictBool
    brief: StrictBool
    script: StrictBool


class PostingRules(_Strict):
    min_gap_minutes: StrictInt = Field(ge=15, le=1440)
    max_feed_per_day: StrictInt = Field(ge=1, le=10)
    max_stories_per_day: StrictInt = Field(ge=1, le=20)
    max_revisions: StrictInt = Field(ge=0, le=5)


HexColor = Annotated[str, Field(pattern=HEX_COLOR), AfterValidator(str.upper)]


class BrandColors(_Strict):
    primary: HexColor
    secondary: HexColor
    accent: HexColor
    background: HexColor
    text: HexColor


def _bundled_font(key: str) -> str:
    if not font_registry.is_font_key(key):
        raise PydanticCustomError("does_not_exist", "Unknown font key.")
    return key


FontKey = Annotated[str, AfterValidator(_bundled_font)]


class BrandFonts(_Strict):
    heading: FontKey
    body: FontKey


_CODES = {
    "missing": "required",
    "extra_forbidden": "invalid",
    "greater_than_equal": "min_value",
    "greater_than": "min_value",
    "less_than_equal": "max_value",
    "less_than": "max_value",
    "does_not_exist": "does_not_exist",
}


def error_code(error: dict) -> str:
    return _CODES.get(error["type"], "invalid")


def drf_errors(exc: PydanticValidationError):
    """Nested `{key: {key: [ErrorDetail]}}` (or a list for errors on the whole value)."""
    nested: dict = {}
    top: list = []
    for error in exc.errors():
        detail = ErrorDetail(error["msg"], code=error_code(error))
        loc = [str(part) for part in error["loc"]]
        if not loc:
            top.append(detail)
            continue
        node = nested
        for part in loc[:-1]:
            node = node.setdefault(part, {})
            if not isinstance(node, dict):  # an error already sits on the parent
                break
        else:
            node.setdefault(loc[-1], []).append(detail)
    return top or nested


def parse(model: type[BaseModel], value) -> dict:
    """Validate `value` and return the normalised dict; raises Pydantic's ValidationError."""
    return model.model_validate(value).model_dump()


def _django_check(model: type[BaseModel], value) -> None:
    try:
        model.model_validate(value)
    except PydanticValidationError as exc:
        raise DjangoValidationError(str(exc), code="invalid") from None


# Model-field validators (module level so migrations can reference them).
def validate_autopilot(value) -> None:
    _django_check(Autopilot, value)


def validate_posting_rules(value) -> None:
    _django_check(PostingRules, value)


def validate_colors(value) -> None:
    _django_check(BrandColors, value)


def validate_fonts(value) -> None:
    _django_check(BrandFonts, value)
