"""Text clean-up shared by collectors and topic validation (E02-S02 rule 13, E02-S04 rule 9)."""

import html
import re

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def collapse(value: str | None) -> str:
    """Trim and collapse runs of whitespace to one space. Zero-width non-joiners are kept."""
    return _SPACE.sub(" ", value or "").strip()


def clean(value: str | None) -> str:
    """Remove HTML tags, decode entities and collapse whitespace."""
    return collapse(html.unescape(_TAG.sub(" ", value or "")))


def cut(value: str, limit: int) -> str:
    """Cut at the last whole word within `limit` characters, ending with an ellipsis."""
    if len(value) <= limit:
        return value
    room = value[: limit - 1]
    space = room.rfind(" ")
    if space > limit // 2:
        room = room[:space]
    return room.rstrip(" ,.;:-") + "…"


def normalized_key(value: str) -> str:
    """Case-insensitive, whitespace-collapsed comparison key for titles."""
    return collapse(value).casefold()


def unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result = []
    for item in items:
        key = normalized_key(item)
        if key and key not in seen:
            seen.add(key)
            result.append(item)
    return result
