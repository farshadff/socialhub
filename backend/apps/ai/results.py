"""Public value types of the gateway."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class WebSearchOptions:
    max_uses: int = 5
    allowed_domains: tuple[str, ...] | None = None
    blocked_domains: tuple[str, ...] | None = None


@dataclass
class TextResult:
    data: Any
    citations: list[dict[str, str]] = field(default_factory=list)
    ai_run_id: int | None = None


@dataclass
class TextRequest:
    """What the gateway hands a provider adapter for one logical call."""

    task: str
    model: str
    system: str
    brand_block: str | None
    user: str
    schema: type | None
    web_search: WebSearchOptions | None
    effort: str
    max_tokens: int
    stream: bool
    timeout: float
    variables: dict


@dataclass
class ProviderResponse:
    data: Any
    model: str
    citations: list[dict[str, str]] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    units: dict = field(default_factory=dict)
    request_id: str | None = None
    raw_text: str = ""
