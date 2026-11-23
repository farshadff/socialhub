"""Evidence score of a trend topic (E02-S04 rules 14–20).

Pure functions take ``now`` as an argument; ``score_topic`` adds the database lookups for
engagement reference sets (one query per signal kind). Rounding is half-up everywhere.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import urlsplit

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from apps.core import clock

COMPONENTS = ("signal_count", "source_diversity", "recency", "engagement")
REFERENCE_WINDOW = timedelta(days=30)
MIN_REFERENCE_SET = 5
METRIC_KEYS = ("likes", "comments", "views")


def round_half_up(value: float) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def weights() -> dict[str, float]:
    return dict(settings.SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS)


def check_weights() -> None:
    configured = weights()
    if set(configured) != set(COMPONENTS):
        raise ImproperlyConfigured(
            f"SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS must have exactly the keys {COMPONENTS}."
        )
    if abs(sum(float(value) for value in configured.values()) - 1.0) > 1e-9:
        raise ImproperlyConfigured("SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS must sum to 1.")


# --- Components -------------------------------------------------------------------------------


def signal_count_component(n: int) -> int:
    if n <= 0:
        return 0
    return min(100, round_half_up(100 * math.log(1 + n) / math.log(9)))


def _host(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _is_instagram(host: str) -> bool:
    return host in ("instagram.com", "m.instagram.com")


def origin_of(signal) -> str:
    """An independent place the evidence comes from (rule 15)."""
    author = (signal.author or "").strip().lower()
    if not signal.url:
        return author
    host = _host(signal.url)
    if signal.kind == "manual" and _is_instagram(host):
        return author or "instagram.com"
    return host


def source_diversity_component(signals: Sequence) -> int:
    if not signals:
        return 0
    origins = {origin_of(signal) for signal in signals}
    kinds = {signal.kind for signal in signals}
    return min(100, 25 * min(len(origins), 3) + (25 if len(kinds) >= 2 else 0))


def _reference_time(signal) -> datetime:
    return signal.published_at or signal.captured_at


def recency_value(signal, now: datetime) -> float:
    age_days = (now - _reference_time(signal)).total_seconds() / 86400
    if age_days <= 2:
        return 100.0
    return max(0.0, 100 * (14 - age_days) / 12)


def recency_component(signals: Sequence, now: datetime) -> int:
    if not signals:
        return 0
    values = sorted((recency_value(signal, now) for signal in signals), reverse=True)[:3]
    return round_half_up(sum(values) / len(values))


def has_metrics(metrics) -> bool:
    return isinstance(metrics, dict) and any(metrics.get(key) is not None for key in METRIC_KEYS)


def engagement_value(metrics: dict) -> float:
    def number(key):
        value = metrics.get(key)
        return float(value) if isinstance(value, (int, float)) else 0.0

    return number("likes") + 2 * number("comments") + 0.1 * number("views")


def percentile(value: float, reference: Iterable[float]) -> float:
    reference = list(reference)
    if len(reference) < MIN_REFERENCE_SET:
        return 0.5
    return sum(1 for other in reference if other <= value) / len(reference)


def engagement_component(percentiles: Sequence[float]) -> int:
    """``percentiles`` holds one value per topic signal that has metrics."""
    if not percentiles:
        return 50
    return round_half_up(100 * max(percentiles))


def total(breakdown: dict[str, int]) -> int:
    configured = weights()
    return round_half_up(sum(float(configured[name]) * breakdown[name] for name in COMPONENTS))


def compute(signals: Sequence, percentiles: Sequence[float], now: datetime) -> tuple[int, dict]:
    if not signals:
        return 0, {name: 0 for name in COMPONENTS}
    breakdown = {
        "signal_count": signal_count_component(len(signals)),
        "source_diversity": source_diversity_component(signals),
        "recency": recency_component(signals, now),
        "engagement": engagement_component(percentiles),
    }
    return total(breakdown), breakdown


# --- Database-backed scoring --------------------------------------------------------------------


def _reference_values(account_id: int, kind: str, now: datetime) -> list[float]:
    from ..models import TrendSignal

    rows = TrendSignal.objects.filter(
        account_id=account_id, kind=kind, captured_at__gte=now - REFERENCE_WINDOW
    ).values_list("metrics", flat=True)
    return [engagement_value(metrics) for metrics in rows if has_metrics(metrics)]


def signal_percentiles(signals: Sequence, now: datetime) -> list[float]:
    with_metrics = [signal for signal in signals if has_metrics(signal.metrics)]
    if not with_metrics:
        return []
    references: dict[str, list[float]] = {}
    result = []
    for signal in with_metrics:
        if signal.kind not in references:
            references[signal.kind] = _reference_values(signal.account_id, signal.kind, now)
        reference = list(references[signal.kind])
        own = engagement_value(signal.metrics)
        # The reference set includes the signal itself (it may be older than the window).
        if signal.captured_at < now - REFERENCE_WINDOW:
            reference.append(own)
        result.append(percentile(own, reference))
    return result


def score_topic(topic, now: datetime | None = None) -> tuple[int, dict]:
    """Compute (score, breakdown) from the topic's linked signals. Does not save."""
    now = now or clock.now()
    signals = list(topic.signals.all()) if topic.pk else []
    return compute(signals, signal_percentiles(signals, now), now)


def rescore(topic, now: datetime | None = None) -> None:
    topic.evidence_score, topic.evidence_breakdown = score_topic(topic, now)
    topic.save(update_fields=["evidence_score", "evidence_breakdown", "updated_at"])
