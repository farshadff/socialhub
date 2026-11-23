"""RSS and Atom collector (E02-S02 rules 31–35)."""

from __future__ import annotations

import calendar
from datetime import UTC, datetime, timedelta
from urllib.parse import urljoin, urlsplit

import feedparser

from apps.core.http import FetchError, safe_fetch

from .base import CollectorContext, CollectorError, SignalDraft

MAX_SIGNALS = 20
FETCH_TIMEOUT = 10.0
FETCH_MAX_BYTES = 2 * 1024 * 1024
FETCH_MAX_REDIRECTS = 3
MAX_TAGS = 10
FUTURE_TOLERANCE = timedelta(days=1)


def _entry_date(entry, now: datetime) -> datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        parsed = entry.get(key)
        if parsed:
            moment = datetime.fromtimestamp(calendar.timegm(parsed), tz=UTC)
            # A date more than one day in the future is treated as missing.
            if moment > now + FUTURE_TOLERANCE:
                return None
            return moment
    return None


def _excerpt(entry) -> str:
    if entry.get("summary"):
        return entry["summary"]
    for content in entry.get("content") or []:
        if content.get("value"):
            return content["value"]
    return ""


def _tags(entry) -> list[str]:
    tags = []
    for tag in entry.get("tags") or []:
        term = tag.get("term") if isinstance(tag, dict) else None
        if term:
            tags.append(str(term))
        if len(tags) >= MAX_TAGS:
            break
    return tags


def parse_feed(content: bytes, feed_url: str, now: datetime) -> list[SignalDraft]:
    parsed = feedparser.parse(content)
    entries = parsed.get("entries") or []
    if not entries:
        if parsed.get("bozo"):
            raise CollectorError("invalid_feed")
        return []
    feed = parsed.get("feed") or {}
    feed_title = feed.get("title") or ""
    host = urlsplit(feed_url).hostname or ""
    drafts = []
    for entry in entries:
        link = entry.get("link")
        if not link:
            continue
        drafts.append(
            SignalDraft(
                kind="rss",
                url=urljoin(feed_url, link),
                title=entry.get("title") or "",
                excerpt=_excerpt(entry),
                author=entry.get("author") or feed_title or host,
                published_at=_entry_date(entry, now),
                metrics={},
                raw={
                    "feed_title": feed_title,
                    "entry_id": entry.get("id") or "",
                    "tags": _tags(entry),
                },
            )
        )
    return drafts


def select_entries(drafts: list[SignalDraft], ctx: CollectorContext) -> list[SignalDraft]:
    """Newest first (undated last), drop entries older than the lookback window, keep 20."""
    cutoff = ctx.now - timedelta(days=ctx.lookback_days)
    dated = sorted((d for d in drafts if d.published_at), key=lambda d: d.published_at, reverse=True)
    undated = [d for d in drafts if not d.published_at]
    fresh = [d for d in dated if d.published_at >= cutoff] + undated
    return fresh[:MAX_SIGNALS]


class RSSCollector:
    kind = "rss"
    max_signals = MAX_SIGNALS
    transport = None  # tests inject an httpx2.MockTransport here

    def collect(self, source, ctx: CollectorContext) -> list[SignalDraft]:
        try:
            response = safe_fetch(
                source.value,
                timeout=FETCH_TIMEOUT,
                max_bytes=FETCH_MAX_BYTES,
                max_redirects=FETCH_MAX_REDIRECTS,
                transport=self.transport,
            )
        except FetchError as exc:
            raise CollectorError(exc.code, exc.detail) from exc
        return select_entries(parse_feed(response.content, response.url, ctx.now), ctx)
