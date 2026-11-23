"""Collector protocol (E02-S02 rule 11). A collector returns drafts; the run service saves them."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


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
class CollectContext:
    account: object
    plan: object | None
    brand: object | None
    lookback_days: int
    job_id: object | None
    now: datetime


class CollectorError(Exception):
    """An expected failure; `code` becomes the source status `error:<code>`."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code


class Collector(Protocol):
    max_signals: int

    def collect(self, source, ctx: CollectContext) -> list[SignalDraft]: ...
