"""Collector protocol (E02-S02 rule 11). A collector returns drafts; the run service saves them."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol


@dataclass
class SignalDraft:
    kind: str
    url: str
    title: str
    excerpt: str = ""
    author: str = ""
    published_at: datetime | None = None
    metrics: dict = field(default_factory=dict)
    raw: dict = field(default_factory=dict)


@dataclass
class CollectorContext:
    account: Any
    plan: Any | None
    brand: Any | None
    lookback_days: int
    job_id: Any | None
    now: datetime


class CollectorError(Exception):
    """An expected source failure. ``code`` becomes the source status ``error:<code>``."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


class Collector(Protocol):
    kind: str
    max_signals: int

    def collect(self, source, ctx: CollectorContext) -> list[SignalDraft]: ...
