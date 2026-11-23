"""Text clean-up applied to every signal before saving (E02-S02 rule 13)."""

import html
import re

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def clean(value) -> str:
    """Remove HTML tags, unescape entities and collapse whitespace."""
    if value is None:
        return ""
    text = html.unescape(_TAG.sub(" ", str(value)))
    return _SPACE.sub(" ", text).strip()


def collapse(value) -> str:
    return _SPACE.sub(" ", str(value or "")).strip()


def cut(value: str, limit: int) -> str:
    """Cut at the last whole word that fits and end with "…" when the text is too long."""
    if len(value) <= limit:
        return value
    head = value[: limit - 1]
    space = head.rfind(" ")
    if space > 0:
        head = head[:space]
    return head.rstrip(" ,.;:-—") + "…"


def clean_cut(value, limit: int) -> str:
    return cut(clean(value), limit)
