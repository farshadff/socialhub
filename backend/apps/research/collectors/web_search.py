"""Web search collector: Claude with the web search tool, then a structured extraction call
(E02-S02 rules 27–30 and the AI section).
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

from apps.ai.errors import AIError, ProviderNotConfigured, ProviderRefused
from apps.ai.gateway import WebSearchOptions, run_text

from ..services.fingerprints import InvalidURL, normalize_url
from .base import CollectorContext, CollectorError, SignalDraft

MAX_SIGNALS = 8
MIN_RELEVANCE = 30
MAX_SEARCHES = 5


def _audience(ctx: CollectorContext) -> str:
    if ctx.plan is not None and ctx.plan.audience_summary:
        return ctx.plan.audience_summary
    return getattr(ctx.brand, "audience_summary", "") or ""


def _call(task: str, ctx: CollectorContext, **kwargs):
    try:
        return run_text(task, account_id=ctx.account.pk, job_id=ctx.job_id, **kwargs)
    except ProviderRefused as exc:
        raise CollectorError("refused") from exc
    except ProviderNotConfigured as exc:
        raise CollectorError("provider_not_configured") from exc
    except AIError as exc:
        raise CollectorError("provider_error", exc.detail) from exc


class WebSearchCollector:
    kind = "web_search"
    max_signals = MAX_SIGNALS

    def collect(self, source, ctx: CollectorContext) -> list[SignalDraft]:
        window_end = ctx.now.astimezone(ctx.account.tz).date()
        window_start = window_end - timedelta(days=ctx.lookback_days)
        search = _call(
            "research.web_search",
            ctx,
            variables={
                "query": source.value,
                "window_start": window_start.isoformat(),
                "window_end": window_end.isoformat(),
                "content_language": ctx.account.content_language,
                "audience_summary": _audience(ctx),
                "content_pillars": list(getattr(ctx.brand, "content_pillars", []) or []),
                "objective": getattr(ctx.plan, "objective", "") or "",
            },
            web_search=WebSearchOptions(max_uses=MAX_SEARCHES),
        )
        if not search.citations:
            return []

        retrieved: dict[str, dict] = {}
        for citation in search.citations:
            try:
                retrieved.setdefault(normalize_url(citation["url"]), citation)
            except InvalidURL:
                continue
        if not retrieved:
            return []

        extraction = _call(
            "research.extract_signals",
            ctx,
            variables={
                "query": source.value,
                "search_text": search.data,
                "results": [
                    {"url": c["url"], "title": c.get("title", "")} for c in retrieved.values()
                ],
                "window_start": window_start.isoformat(),
                "max_signals": MAX_SIGNALS,
                "content_language": ctx.account.content_language,
            },
        )

        drafts: list[SignalDraft] = []
        for item in extraction.data.signals:
            try:
                key = normalize_url(item.url)
            except InvalidURL:
                continue
            citation = retrieved.get(key)
            # Keep only links the search really returned (rule 28).
            if citation is None or item.relevance < MIN_RELEVANCE:
                continue
            published_at = (
                datetime.combine(item.published_at, time(0, 0), tzinfo=UTC)
                if item.published_at
                else None
            )
            drafts.append(
                SignalDraft(
                    kind=self.kind,
                    url=citation["url"],
                    title=item.title or citation.get("title", ""),
                    excerpt=item.excerpt,
                    author=item.author,
                    published_at=published_at,
                    metrics={},
                    raw={"relevance": item.relevance, "query": source.value},
                )
            )
        return drafts[:MAX_SIGNALS]
