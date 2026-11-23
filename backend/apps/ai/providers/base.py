"""What the gateway hands an adapter and what it gets back.

Adapters translate one attempt into a provider call. They raise `ProviderError` (with
`retryable` and `retry_after`) for transport and HTTP failures, and `ProviderRefused` for an
image content-policy rejection. A text call that completed returns a `TextResponse` whose
`outcome` tells the gateway whether the output is usable, so usage is logged even when it is not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

OUTCOME_OK = "ok"
OUTCOME_REFUSED = "refused"
OUTCOME_TRUNCATED = "truncated"  # stopped by max_tokens
OUTCOME_INVALID = "invalid"  # did not validate against the schema
OUTCOME_WEB_SEARCH_FAILED = "web_search_failed"


@dataclass(frozen=True)
class PreparedImage:
    """An image already downscaled and re-encoded for the provider."""

    data: bytes
    media_type: str
    sha256: str


@dataclass(frozen=True)
class TextRequest:
    task: str
    model: str
    system: list[str]  # stable prefix: system.md, then the brand block when present
    user: str
    effort: str
    max_tokens: int
    stream: bool = False
    schema: type | None = None
    images: list[PreparedImage] = field(default_factory=list)
    web_search: Any = None  # WebSearchOptions with merged blocked domains
    timeout: float = 180.0
    variables: dict = field(default_factory=dict)  # for the fake provider only


@dataclass
class TextResponse:
    outcome: str = OUTCOME_OK
    text: str = ""
    data: Any = None  # parsed schema instance (Anthropic) or raw dict (fake), or None
    citations: list[dict] = field(default_factory=list)
    model: str = ""
    stop_reason: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    web_searches: int = 0
    fallback_used: bool = False
    request_id: str | None = None
    reason: str = ""  # short diagnostic for invalid output, never shown to users


@dataclass(frozen=True)
class ImageRequest:
    task: str
    model: str
    prompt: str
    size: str  # pixel size, for example "1024x1024"
    timeout: float = 180.0


@dataclass
class ImageResponse:
    content: bytes
    mime: str
    model: str = ""
    request_id: str | None = None
    units: dict = field(default_factory=dict)
