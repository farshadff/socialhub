"""Group signals into topics: the last stage of a research run (E02-S04 rules 1-13)."""

from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.db.models.functions import Coalesce
from django.utils import timezone

from ..models import TrendSignal, TrendTopic
from ..schemas import TopicSynthesis
from . import evidence, platform
from .plans import account_today
from .text import collapse, cut, normalized_key, unique

MAX_INPUT_SIGNALS = 150
MIN_INPUT_SIGNALS = 3
EXCERPT_FOR_PROMPT = 400
FORMATS = ("reel", "story", "feed_post")
FORMAT_GUIDE = {
    "reel": "Short vertical video for reach and discovery; strong hook in the first second.",
    "story": "Ephemeral image or video for the existing audience; polls, behind the scenes.",
    "feed_post": "Single image that stays on the profile; tips and statements worth saving.",
}
LIMITS = {"title": 120, "summary": 600, "why_now": 300, "hook": 160, "keyword": 40}
LIST_MAX = {"hooks": 5, "suggested_formats": 3, "keywords": 8, "signal_ids": 20}


@dataclass
class SynthesisOutcome:
    synthesis: str  # done | skipped_too_few_signals
    topics: int = 0
    dropped_topics: int = 0
    topic_ids: list[int] = field(default_factory=list)


def max_topics() -> int:
    return int(getattr(settings, "SOCIALHUB_RESEARCH_MAX_TOPICS", 8))


def select_signals(run) -> list[TrendSignal]:
    since = run.started_at - timedelta(days=int(run.params.get("lookback_days", 7)))
    return list(
        TrendSignal.objects.filter(account_id=run.account_id, captured_at__gte=since)
        .annotate(moment=Coalesce(F("published_at"), F("captured_at")))
        .order_by("-moment", "-id")[:MAX_INPUT_SIGNALS]
    )


def _same_plan(qs, plan_id):
    return qs.filter(plan_id=plan_id) if plan_id else qs.filter(plan__isnull=True)


def _candidate_relations() -> list[str]:
    """Reverse relations from selection candidates to topics (E03-S02), if that app exists."""
    return [rel.get_accessor_name() for rel in TrendTopic._meta.related_objects
            if rel.related_model._meta.model_name == "candidate"]


def replaceable_topics(account_id: int, plan_id):
    """Untouched AI topics of the run's plan that no candidate references (rule 12)."""
    qs = _same_plan(TrendTopic.objects.filter(account_id=account_id), plan_id).filter(
        origin=TrendTopic.Origin.AI, status=TrendTopic.Status.NEW)
    for accessor in _candidate_relations():
        qs = qs.filter(**{f"{accessor}__isnull": True})
    return qs


def _brand_vars(account) -> dict:
    brand = getattr(account, "brand", None)
    return {
        "content_pillars": list(getattr(brand, "content_pillars", []) or []),
        "tone_of_voice": getattr(brand, "tone_of_voice", "") or "",
        "audience_summary": getattr(brand, "audience_summary", "") or "",
        "banned_terms": list(getattr(brand, "banned_terms", []) or []),
    }


def _plan_vars(plan) -> dict | None:
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


def build_variables(run, signals, kept, dismissed) -> dict:
    account = run.account
    return {
        "content_language": account.content_language,
        "today": account_today(account).isoformat(),
        "brand": _brand_vars(account),
        "plan": _plan_vars(run.plan),
        "formats": [{"value": f, "guide": FORMAT_GUIDE[f]} for f in FORMATS],
        "signals": [
            {
                "id": s.pk,
                "kind": s.kind,
                "title": s.title,
                "excerpt": cut(s.excerpt, EXCERPT_FOR_PROMPT),
                "author": s.author,
                "published_at": s.published_at.date().isoformat() if s.published_at else None,
                "metrics": s.metrics or {},
            }
            for s in signals
        ],
        "existing_topics": [{"title": t.title, "keywords": t.keywords} for t in kept],
        "dismissed_topics": [t.title for t in dismissed],
        "max_topics": max_topics(),
    }


def _contains_banned(text: str, banned: list[str]) -> bool:
    lowered = collapse(text).casefold()
    return any(term and collapse(term).casefold() in lowered for term in banned)


def _clean_list(values, limit_each: int, max_items: int) -> list[str]:
    cleaned = [cut(collapse(v), limit_each) for v in values if collapse(v)]
    return unique(cleaned)[:max_items]


def validate(drafts, *, input_ids: set[int], taken_titles: set[str], banned: list[str]):
    """Apply rules 8 and 9. Returns (kept topic dicts, dropped count)."""
    kept, dropped = [], 0
    seen_titles = set(taken_titles)
    for draft in drafts:
        ids = [i for i in dict.fromkeys(draft.signal_ids) if i in input_ids]
        title = cut(collapse(draft.title), LIMITS["title"])
        key = normalized_key(title)
        if not ids or not title or key in seen_titles or _contains_banned(title, banned):
            dropped += 1
            continue
        hooks = [h for h in _clean_list(draft.hooks, LIMITS["hook"], LIST_MAX["hooks"])
                 if not _contains_banned(h, banned)]
        if not hooks:
            dropped += 1
            continue
        formats = [f for f in dict.fromkeys(draft.suggested_formats) if f in FORMATS]
        seen_titles.add(key)
        kept.append({
            "title": title,
            "summary": cut(collapse(draft.summary), LIMITS["summary"]),
            "why_now": cut(collapse(draft.why_now), LIMITS["why_now"]),
            "hooks": hooks,
            "suggested_formats": formats[:LIST_MAX["suggested_formats"]] or list(FORMATS),
            "keywords": _clean_list(draft.keywords, LIMITS["keyword"], LIST_MAX["keywords"]),
            "signal_ids": ids[:LIST_MAX["signal_ids"]],
        })
    return kept, dropped


def synthesize(run, *, job_id=None) -> SynthesisOutcome:
    """Run the synthesis stage. AI errors propagate; the caller fails the run."""
    signals = select_signals(run)
    if len(signals) < MIN_INPUT_SIGNALS:
        return SynthesisOutcome("skipped_too_few_signals")

    same_plan = _same_plan(TrendTopic.objects.filter(account_id=run.account_id), run.plan_id)
    replaceable_ids = set(replaceable_topics(run.account_id, run.plan_id).values_list("pk",
                                                                                      flat=True))
    dismissed = list(same_plan.filter(status=TrendTopic.Status.DISMISSED))
    kept = [t for t in same_plan.exclude(status=TrendTopic.Status.DISMISSED)
            if t.pk not in replaceable_ids]

    result = platform.run_text(
        "research.synthesize_topics",
        variables=build_variables(run, signals, kept, dismissed),
        schema=TopicSynthesis,
        account_id=run.account_id,
        job_id=job_id,
    )
    banned = _brand_vars(run.account)["banned_terms"]
    taken = {normalized_key(t.title) for t in kept + dismissed}
    drafts = list(result.data.topics)[: max_topics()]
    topics, dropped = validate(drafts, input_ids={s.pk for s in signals}, taken_titles=taken,
                               banned=banned)
    dropped += max(0, len(result.data.topics) - len(drafts))
    if not topics:
        return SynthesisOutcome("done", 0, dropped)

    by_id = {s.pk: s for s in signals}
    now = timezone.now()
    created = []
    with transaction.atomic():
        TrendTopic.objects.filter(pk__in=replaceable_ids).delete()
        for data in topics:
            ids = data.pop("signal_ids")
            topic = TrendTopic.objects.create(
                account_id=run.account_id, plan_id=run.plan_id, run=run,
                origin=TrendTopic.Origin.AI, status=TrendTopic.Status.NEW, **data,
            )
            topic.signals.set([by_id[i] for i in ids])
            evidence.score_topic(topic, now)
            created.append(topic.pk)
    return SynthesisOutcome("done", len(created), dropped, created)
