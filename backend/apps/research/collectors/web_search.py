"""Web search collector: one Claude search call, then one structured extraction call.

E02-S02 rules 27-30 and the AI section. Every kept signal's URL must be one of the URLs the
search call actually returned (rule 28).
"""

from datetime import UTC, datetime, time, timedelta

from ..models import SignalKind
from ..schemas import ExtractedSignals
from ..services import platform
from ..services.fingerprints import InvalidURL, normalize_url
from .base import CollectContext, CollectorError, SignalDraft

MIN_RELEVANCE = 30
MAX_SIGNALS = 8


def _audience(ctx: CollectContext) -> str:
    plan_audience = getattr(ctx.plan, "audience_summary", "") if ctx.plan else ""
    return plan_audience or (getattr(ctx.brand, "audience_summary", "") if ctx.brand else "")


def _window(ctx: CollectContext) -> tuple[str, str]:
    end = ctx.now.date()
    start = end - timedelta(days=ctx.lookback_days)
    return start.isoformat(), end.isoformat()


def _call(task: str, **kwargs):
    """One gateway call; provider failures become collector status codes (AI section)."""
    try:
        return platform.run_text(task, **kwargs)
    except platform.ProviderNotConfigured as exc:
        raise CollectorError("provider_not_configured") from exc
    except platform.AIError as exc:
        code = "refused" if platform.is_refusal(exc) else "provider_error"
        raise CollectorError(code) from exc


def _citation_field(citation, name: str) -> str:
    if isinstance(citation, dict):
        return citation.get(name) or ""
    return getattr(citation, name, "") or ""


class WebSearchCollector:
    max_signals = MAX_SIGNALS

    def collect(self, source, ctx: CollectContext) -> list[SignalDraft]:
        window_start, window_end = _window(ctx)
        search = _call(
            "research.web_search",
            variables={
                "query": source.value,
                "window_start": window_start,
                "window_end": window_end,
                "content_language": ctx.account.content_language,
                "audience_summary": _audience(ctx),
                "content_pillars": list(getattr(ctx.brand, "content_pillars", []) or []),
                "objective": getattr(ctx.plan, "objective", "") if ctx.plan else "",
            },
            web_search=platform.WebSearchOptions(
                max_uses=5, blocked_domains=platform.blocked_domains()
            ),
            account_id=ctx.account.pk,
            job_id=ctx.job_id,
        )

        results = []
        allowed: dict[str, str] = {}
        for citation in search.citations or []:
            url, title = _citation_field(citation, "url"), _citation_field(citation, "title")
            try:
                key = normalize_url(url)
            except InvalidURL:
                continue
            if key not in allowed:
                allowed[key] = url
                results.append({"url": url, "title": title})
        if not results:
            return []

        search_text = search.data if isinstance(search.data, str) else str(search.data)
        extracted = _call(
            "research.extract_signals",
            variables={
                "search_text": search_text,
                "results": results,
                "window_start": window_start,
                "max_signals": MAX_SIGNALS,
                "content_language": ctx.account.content_language,
            },
            schema=ExtractedSignals,
            account_id=ctx.account.pk,
            job_id=ctx.job_id,
        )

        drafts = []
        for item in extracted.data.signals:
            try:
                key = normalize_url(item.url)
            except InvalidURL:
                continue
            if key not in allowed or item.relevance < MIN_RELEVANCE:
                continue
            published = (
                datetime.combine(item.published_at, time.min, tzinfo=UTC)
                if item.published_at
                else None
            )
            drafts.append(
                SignalDraft(
                    kind=SignalKind.WEB_SEARCH,
                    url=allowed[key],
                    title=item.title,
                    excerpt=item.excerpt,
                    author=item.author,
                    published_at=published,
                    metrics={},
                    raw={
                        "relevance": item.relevance,
                        "query": source.value,
                        "ai_run_id": getattr(extracted, "ai_run_id", None),
                    },
                )
            )
        return drafts
