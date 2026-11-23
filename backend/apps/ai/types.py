"""Value types of the gateway's public surface (re-exported by `apps.ai.gateway`)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ImageInput:
    """An image sent to Claude with a text task (vision). Up to 8 per call."""

    content: bytes
    media_type: str = "image/png"


@dataclass(frozen=True)
class WebSearchOptions:
    """Server-side web search limits. `blocked_domains` is merged with
    `SOCIALHUB_RESEARCH_BLOCKED_DOMAINS`; Claude accepts allowed *or* blocked domains, not both."""

    max_uses: int = 5
    allowed_domains: list[str] | None = None
    blocked_domains: list[str] | None = None


@dataclass(frozen=True)
class TextResult:
    """`data` is an instance of the call's `schema`, or `str` without one."""

    data: Any
    citations: list[dict] = field(default_factory=list)
    ai_run_id: int | None = None


@dataclass(frozen=True)
class ImageResult:
    content: bytes
    mime: str
    width: int
    height: int
    ai_run_id: int | None = None
