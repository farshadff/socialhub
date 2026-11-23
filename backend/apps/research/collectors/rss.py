"""RSS and Atom collector (E02-S02 rules 31-35)."""

import calendar
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import urljoin, urlsplit

import feedparser

from apps.core.http import FetchError, FetchHTTPError, FetchTimeout, safe_fetch

from ..models import SignalKind
from .base import CollectContext, CollectorError, SignalDraft

RETRY_DELAY_SECONDS = 2


def _entry_date(entry, now: datetime) -> datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        parsed = entry.get(key)
        if parsed:
            value = datetime.fromtimestamp(calendar.timegm(parsed), tz=UTC)
            if value > now + timedelta(days=1):
                return None
            return value
    return None


class RSSCollector:
    max_signals = 20

    def __init__(self, *, fetch=None, sleep=time.sleep):
        self._fetch_override = fetch
        self._sleep = sleep

    def _fetch(self, url: str):
        # Looked up at call time so tests can patch `rss.safe_fetch`.
        return (self._fetch_override or safe_fetch)(url)

    def _get(self, url: str):
        try:
            return self._fetch(url)
        except FetchTimeout:
            self._sleep(RETRY_DELAY_SECONDS)
            try:
                return self._fetch(url)
            except FetchError as exc:
                raise CollectorError(exc.code) from exc
        except FetchHTTPError as exc:
            raise CollectorError(exc.code) from exc
        except FetchError as exc:
            raise CollectorError(exc.code) from exc

    def collect(self, source, ctx: CollectContext) -> list[SignalDraft]:
        result = self._get(source.value)
        feed = feedparser.parse(result.content)
        if not feed.entries:
            if feed.get("bozo"):
                raise CollectorError("invalid_feed")
            return []

        feed_title = (feed.feed.get("title") or "").strip()
        host = urlsplit(source.value).hostname or ""
        drafts = []
        for entry in feed.entries:
            link = (entry.get("link") or "").strip()
            if not link:
                continue
            content = entry.get("content") or []
            excerpt = entry.get("summary") or (content[0].get("value") if content else "") or ""
            tags = [t.get("term") for t in entry.get("tags") or [] if t.get("term")][:10]
            drafts.append(SignalDraft(
                kind=SignalKind.RSS,
                url=urljoin(result.url, link),
                title=entry.get("title") or "",
                excerpt=excerpt,
                author=entry.get("author") or feed_title or host,
                published_at=_entry_date(entry, ctx.now),
                metrics={},
                raw={"feed_title": feed_title, "entry_id": entry.get("id"), "tags": tags},
            ))
        # Newest first, undated last (rule 35); the age filter and the cut happen in the service.
        drafts.sort(key=lambda d: (d.published_at is None,
                                   -(d.published_at.timestamp() if d.published_at else 0)))
        return drafts
