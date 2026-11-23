from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from pathlib import Path
from types import SimpleNamespace

from django.test import SimpleTestCase

from apps.core.http import FetchHTTPError, FetchResult, FetchTimeout

from ..collectors.base import CollectContext, CollectorError
from ..collectors.rss import RSSCollector

FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)


def feed(name):
    text = (FIXTURES / name).read_text()
    return text.format(
        recent=format_datetime(NOW - timedelta(days=1)),
        old=format_datetime(NOW - timedelta(days=20)),
        future=format_datetime(NOW + timedelta(days=5)),
    ).encode() if "{" in text else text.encode()


def ctx():
    return CollectContext(account=SimpleNamespace(pk=1), plan=None, brand=None, lookback_days=7,
                          job_id=None, now=NOW)


def collector_returning(body, url="https://sprudge.com/feed/"):
    return RSSCollector(fetch=lambda u: FetchResult(url=url, status_code=200, content=body),
                        sleep=lambda s: None)


SOURCE = SimpleNamespace(value="https://sprudge.com/feed/")


class RSSCollectorTests(SimpleTestCase):
    def test_rss2_mapping(self):
        drafts = collector_returning(feed("rss2.xml")).collect(SOURCE, ctx())
        titles = [d.title for d in drafts]
        self.assertNotIn("No link", titles)
        first = drafts[0]
        self.assertEqual(first.url, "https://sprudge.com/batch-brew/?utm_source=rss")
        self.assertEqual(first.author, "Editors")
        self.assertEqual(first.raw["feed_title"], "Sprudge")
        self.assertEqual(first.raw["tags"], ["coffee"])
        relative = next(d for d in drafts if d.title == "Undated entry")
        self.assertEqual(relative.url, "https://sprudge.com/relative-entry")
        self.assertIsNone(relative.published_at)
        self.assertEqual(relative.author, "Sprudge")
        future = next(d for d in drafts if d.title == "Future")
        self.assertIsNone(future.published_at)
        # undated entries sort last
        self.assertIsNone(drafts[-1].published_at)

    def test_atom(self):
        drafts = collector_returning(feed("atom.xml")).collect(SOURCE, ctx())
        self.assertEqual(len(drafts), 1)
        self.assertIn("Retailers report", drafts[0].excerpt)
        self.assertEqual(drafts[0].author, "Daily Coffee News")

    def test_malformed_and_empty(self):
        with self.assertRaises(CollectorError) as err:
            collector_returning(feed("malformed.xml")).collect(SOURCE, ctx())
        self.assertEqual(err.exception.code, "invalid_feed")
        self.assertEqual(collector_returning(feed("empty.xml")).collect(SOURCE, ctx()), [])

    def test_timeout_retried_once(self):
        calls = []

        def fetch(url):
            calls.append(url)
            raise FetchTimeout()

        with self.assertRaises(CollectorError) as err:
            RSSCollector(fetch=fetch, sleep=lambda s: None).collect(SOURCE, ctx())
        self.assertEqual(err.exception.code, "timeout")
        self.assertEqual(len(calls), 2)

    def test_http_error_not_retried(self):
        calls = []

        def fetch(url):
            calls.append(url)
            raise FetchHTTPError(503)

        with self.assertRaises(CollectorError) as err:
            RSSCollector(fetch=fetch, sleep=lambda s: None).collect(SOURCE, ctx())
        self.assertEqual(err.exception.code, "http_503")
        self.assertEqual(len(calls), 1)
