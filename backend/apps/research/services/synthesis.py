"""Synthesis stage of a research run: signals → topics (E02-S04 rules 1–13)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q, QuerySet
from django.db.models.functions import Coalesce

from apps.ai.gateway import run_text
from apps.core import clock
from apps.core.enums import Format

from ..models import ResearchRun, TrendSignal, TrendTopic
from . import evidence
from .text import collapse, cut

MAX_INPUT_SIGNALS = 150
MIN_INPUT_SIGNALS = 3
EXCERPT_FOR_PROMPT = 400
LIMITS = {"title": 120, "summary": 600, "why_now": 300, "hook": 160, "keyword": 40}
LIST_MAX = {"hooks": 5, "suggested_formats": 3, "keywords": 8, "signal_ids": 20}
ALL_FORMATS = [value for value, _label in Format.choices]
FORMAT_GUIDE = [
    {"format": "reel", "suits": "Short vertical video; trends, demonstrations, quick tips, reach."},
    {"format": "story", "suits": "Ephemeral frames; polls, behind the scenes, timely nudges, replies."},
    {"format": "feed_post", "suits": "Image or carousel; explainers, lists and guides people save."},
]


@dataclass
class SynthesisOutcome:
    topics: int = 0
    dropped: int = 0
    state: str = "done"


def normalize_title(title: str) -> str:
    return collapse(title).casefold()


def _contains_banned(text: str, banned: list[str]) -> bool:
    lowered = text.casefold()
    return any(term and term.casefold() in lowered for term in banned)


def _dedupe(items) -> list:
    seen = set()
    result = []
    for item in items:
        key = item.casefold() if isinstance(item, str) else item
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _plan_filter(plan) -> Q:
    return Q(plan=plan) if plan is not None else Q(plan__isnull=True)


def referenced_topic_ids(queryset: QuerySet) -> set[int]:
    """Topics referenced by another table (E03 ``Candidate.topic``), found through reverse FKs."""
    ids: set[int] = set()
    for relation in TrendTopic._meta.related_objects:
        if relation.many_to_many or relation.related_model in (TrendSignal,):
            continue
        if not (relation.one_to_many or relation.one_to_one):
            continue
        field_name = relation.field.name
        ids |= set(
            relation.related_model.objects.filter(**{f"{field_name}__in": queryset}).values_list(
                field_name, flat=True
            )
        )
    return ids


def replaceable_topics(run: ResearchRun) -> QuerySet:
    """Untouched AI topics of the run's plan, not used by any candidate (rule 12)."""
    queryset = TrendTopic.objects.filter(
        _plan_filter(run.plan),
        account_id=run.account_id,
        origin=TrendTopic.Origin.AI,
        status=TrendTopic.Status.NEW,
    )
    referenced = referenced_topic_ids(queryset)
    return queryset.exclude(pk__in=referenced) if referenced else queryset


def select_signals(run: ResearchRun) -> list[TrendSignal]:
    lookback = int(run.params.get("lookback_days", 7))
    since = run.started_at - timedelta(days=lookback)
    return list(
        TrendSignal.objects.filter(account_id=run.account_id, captured_at__gte=since)
        .annotate(reference_at=Coalesce("published_at", "captured_at"))
        .order_by("-reference_at", "-id")[:MAX_INPUT_SIGNALS]
    )


def _plan_variables(plan):
    if plan is None:
        return None
    return {
        "objective": plan.objective,
        "audience_summary": plan.audience_summary,
        "audience_segments": plan.audience_segments,
        "success_metrics": plan.success_metrics,
        "week_start": plan.week_start.isoformat(),
        "week_end": plan.week_end.isoformat(),
    }


def build_variables(run: ResearchRun, signals: list[TrendSignal], kept: list, dismissed: list):
    account = run.account
    brand = getattr(account, "brand_profile", None)
    return {
        "content_language": account.content_language,
        "today": clock.now().astimezone(account.tz).date().isoformat(),
        "brand": {
            "content_pillars": list(getattr(brand, "content_pillars", []) or []),
            "tone_of_voice": getattr(brand, "tone_of_voice", "") or "",
            "audience_summary": getattr(brand, "audience_summary", "") or "",
            "banned_terms": list(getattr(brand, "banned_terms", []) or []),
        },
        "plan": _plan_variables(run.plan),
        "formats": FORMAT_GUIDE,
        "signals": [
            {
                "id": signal.pk,
                "kind": signal.kind,
                "title": signal.title,
                "excerpt": cut(signal.excerpt, EXCERPT_FOR_PROMPT),
                "author": signal.author,
                "published_at": signal.published_at.date().isoformat() if signal.published_at else None,
                "metrics": signal.metrics or {},
            }
            for signal in signals
        ],
        "existing_topics": [{"title": t.title, "keywords": t.keywords} for t in kept],
        "dismissed_topics": [t.title for t in dismissed],
        "max_topics": settings.SOCIALHUB_RESEARCH_MAX_TOPICS,
    }


def validate(drafts, *, input_ids: set[int], blocked_titles: set[str], banned: list[str]):
    """Rules 8–9. Returns (clean topic dicts, number dropped)."""
    kept: list[dict] = []
    dropped = 0
    seen_titles = set(blocked_titles)
    for draft in drafts:
        signal_ids = _dedupe([sid for sid in draft.signal_ids if sid in input_ids])
        if not signal_ids:
            dropped += 1
            continue
        title = cut(collapse(draft.title), LIMITS["title"])
        if not title or normalize_title(title) in seen_titles:
            dropped += 1
            continue
        if _contains_banned(title, banned):
            dropped += 1
            continue
        hooks = [
            cut(collapse(hook), LIMITS["hook"])
            for hook in draft.hooks
            if collapse(hook) and not _contains_banned(hook, banned)
        ]
        hooks = _dedupe(hooks)[: LIST_MAX["hooks"]]
        if not hooks:
            dropped += 1
            continue
        formats = _dedupe([f for f in draft.suggested_formats if f in ALL_FORMATS])
        formats = formats[: LIST_MAX["suggested_formats"]] or list(ALL_FORMATS)
        keywords = _dedupe(
            [cut(collapse(k), LIMITS["keyword"]) for k in draft.keywords if collapse(k)]
        )[: LIST_MAX["keywords"]]
        seen_titles.add(normalize_title(title))
        kept.append(
            {
                "title": title,
                "summary": cut(collapse(draft.summary), LIMITS["summary"]),
                "why_now": cut(collapse(draft.why_now), LIMITS["why_now"]),
                "hooks": hooks,
                "suggested_formats": formats,
                "keywords": keywords,
                "signal_ids": signal_ids[: LIST_MAX["signal_ids"]],
            }
        )
    return kept, dropped


def synthesize(run: ResearchRun) -> SynthesisOutcome:
    """Run the stage. ``AIError`` propagates; the caller fails the run and keeps the signals."""
    signals = select_signals(run)
    if len(signals) < MIN_INPUT_SIGNALS:
        return SynthesisOutcome(topics=0, dropped=0, state="skipped_too_few_signals")

    plan_topics = TrendTopic.objects.filter(_plan_filter(run.plan), account_id=run.account_id)
    replaceable_ids = set(replaceable_topics(run).values_list("pk", flat=True))
    kept = [
        t
        for t in plan_topics.exclude(status=TrendTopic.Status.DISMISSED)
        if t.pk not in replaceable_ids
    ]
    dismissed = list(plan_topics.filter(status=TrendTopic.Status.DISMISSED))

    result = run_text(
        "research.synthesize_topics",
        variables=build_variables(run, signals, kept, dismissed),
        account_id=run.account_id,
        job_id=run.job_id,
    )
    brand = getattr(run.account, "brand_profile", None)
    max_topics = settings.SOCIALHUB_RESEARCH_MAX_TOPICS
    drafts = list(result.data.topics)
    topics, dropped = validate(
        drafts[:max_topics],
        input_ids={signal.pk for signal in signals},
        blocked_titles={normalize_title(t.title) for t in kept + dismissed},
        banned=list(getattr(brand, "banned_terms", []) or []),
    )
    dropped += max(0, len(drafts) - max_topics)
    if not topics:
        # Nothing survived: keep the previous topics untouched (rule 10).
        return SynthesisOutcome(topics=0, dropped=dropped, state="done")

    now = clock.now()
    with transaction.atomic():
        TrendTopic.objects.filter(pk__in=replaceable_ids).delete()
        for data in topics:
            signal_ids = data.pop("signal_ids")
            topic = TrendTopic.objects.create(
                account_id=run.account_id,
                run=run,
                plan=run.plan,
                origin=TrendTopic.Origin.AI,
                status=TrendTopic.Status.NEW,
                **data,
            )
            topic.signals.set(signal_ids)
            evidence.rescore(topic, now)
    return SynthesisOutcome(topics=len(topics), dropped=dropped, state="done")
