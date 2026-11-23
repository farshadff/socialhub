"""Evidence score of a trend topic (E02-S04 rules 14-19).

Pure functions take `now` explicitly; tests never depend on the clock. Rounding is half-up.
"""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import urlsplit

from django.conf import settings

DEFAULT_WEIGHTS = {"signal_count": 0.35, "source_diversity": 0.25, "recency": 0.25,
                   "engagement": 0.15}
COMPONENTS = tuple(DEFAULT_WEIGHTS)
REFERENCE_WINDOW_DAYS = 30
MIN_REFERENCE_SET = 5


def round_half_up(value: float) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def weights() -> dict[str, float]:
    return dict(getattr(settings, "SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS", None) or DEFAULT_WEIGHTS)


@dataclass(frozen=True)
class SignalFacts:
    """What scoring needs from a signal; built from a `TrendSignal` or by hand in tests."""

    kind: str
    url: str
    author: str
    published_at: datetime | None
    captured_at: datetime
    metrics: dict
    percentile: float | None = None  # engagement percentile within its reference set


def signal_count_component(n: int) -> int:
    if n <= 0:
        return 0
    return min(100, round_half_up(100 * math.log(1 + n) / math.log(9)))


def _host(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def origin(signal: SignalFacts) -> str:
    host = _host(signal.url) if signal.url else ""
    if signal.kind == "manual":
        if not signal.url:
            return f"author:{signal.author.strip().lower()}"
        if host.endswith("instagram.com"):
            author = signal.author.strip().lower()
            return f"author:{author}" if author else host
    return host


def source_diversity_component(signals: list[SignalFacts]) -> int:
    if not signals:
        return 0
    origins = {origin(s) for s in signals}
    kinds = {s.kind for s in signals}
    return min(100, 25 * min(len(origins), 3) + (25 if len(kinds) >= 2 else 0))


def _signal_recency(signal: SignalFacts, now: datetime) -> float:
    moment = signal.published_at or signal.captured_at
    age_days = (now - moment) / timedelta(days=1)
    if age_days <= 2:
        return 100.0
    return max(0.0, 100 * (14 - age_days) / 12)


def recency_component(signals: list[SignalFacts], now: datetime) -> int:
    if not signals:
        return 0
    top = sorted((_signal_recency(s, now) for s in signals), reverse=True)[:3]
    return round_half_up(sum(top) / len(top))


def engagement_value(metrics: dict) -> float | None:
    if not metrics or not any(k in metrics for k in ("likes", "comments", "views")):
        return None
    return (float(metrics.get("likes") or 0) + 2 * float(metrics.get("comments") or 0)
            + 0.1 * float(metrics.get("views") or 0))


def percentile(value: float, reference: list[float]) -> float:
    if len(reference) < MIN_REFERENCE_SET:
        return 0.5
    return sum(1 for r in reference if r <= value) / len(reference)


def engagement_component(signals: list[SignalFacts]) -> int:
    scored = [s.percentile for s in signals if s.percentile is not None]
    if not scored:
        return 50
    return round_half_up(100 * max(scored))


def combine(breakdown: dict[str, int], weight_map: dict[str, float] | None = None) -> int:
    w = weight_map or weights()
    return round_half_up(sum(w[name] * breakdown[name] for name in COMPONENTS))


def score_facts(signals: list[SignalFacts], now: datetime,
                weight_map: dict[str, float] | None = None) -> tuple[int, dict[str, int]]:
    if not signals:
        return 0, {name: 0 for name in COMPONENTS}
    breakdown = {
        "signal_count": signal_count_component(len(signals)),
        "source_diversity": source_diversity_component(signals),
        "recency": recency_component(signals, now),
        "engagement": engagement_component(signals),
    }
    return combine(breakdown, weight_map), breakdown


# --- Database-backed scoring -------------------------------------------------------------------


def _percentiles(account_id: int, signals, now: datetime) -> dict[int, float]:
    """Engagement percentile per signal, one reference query per kind (rule 17)."""
    from ..models import TrendSignal

    result: dict[int, float] = {}
    by_kind: dict[str, list] = {}
    for s in signals:
        if engagement_value(s.metrics) is not None:
            by_kind.setdefault(s.kind, []).append(s)
    since = now - timedelta(days=REFERENCE_WINDOW_DAYS)
    for kind, members in by_kind.items():
        reference_rows = TrendSignal.objects.filter(
            account_id=account_id, kind=kind, captured_at__gte=since
        ).values_list("id", "metrics")
        reference = {pk: engagement_value(m) for pk, m in reference_rows}
        for member in members:  # the signal itself always belongs to its reference set
            reference[member.pk] = engagement_value(member.metrics)
        values = [v for v in reference.values() if v is not None]
        for member in members:
            result[member.pk] = percentile(engagement_value(member.metrics), values)
    return result


def facts_for(signals, account_id: int, now: datetime) -> list[SignalFacts]:
    signals = list(signals)
    pct = _percentiles(account_id, signals, now)
    return [
        SignalFacts(kind=s.kind, url=s.url, author=s.author, published_at=s.published_at,
                    captured_at=s.captured_at, metrics=s.metrics or {}, percentile=pct.get(s.pk))
        for s in signals
    ]


def score_topic(topic, now: datetime | None = None, *, save: bool = True):
    """Recompute and store a topic's evidence score from its linked signals."""
    from django.utils import timezone

    now = now or timezone.now()
    facts = facts_for(topic.signals.all(), topic.account_id, now)
    topic.evidence_score, topic.evidence_breakdown = score_facts(facts, now)
    if save:
        topic.save(update_fields=["evidence_score", "evidence_breakdown", "updated_at"])
    return topic
