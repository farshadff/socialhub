from types import SimpleNamespace
from unittest import mock

import httpx2 as httpx
from django.test import TestCase

from apps.ai.providers.fake import fake_text
from apps.core import http
from apps.research.collectors.base import CollectorContext, CollectorError
from apps.research.collectors.rss import RSSCollector, parse_feed, select_entries
from apps.research.collectors.web_search import WebSearchCollector

from . import factories as f
from .feeds import ATOM, EMPTY, MALFORMED, RSS


def ctx(acct, lookback=7):
    return CollectorContext(account=acct, plan=None, brand=acct.brand_profile, lookback_days=lookback,
                            job_id=None, now=f.NOW)


def public_dns(host):
    return ["93.184.216.34"]


class RSSCollectorTests(TestCase):
    def setUp(self):
        self.account = f.account()
        patcher = mock.patch.object(http, "resolve_host", public_dns)
        patcher.start()
        self.addCleanup(patcher.stop)

    def collect(self, body, status=200, url="https://feed.example.com/rss"):
        collector = RSSCollector()
        collector.transport = httpx.MockTransport(lambda r: httpx.Response(status, content=body))
        return collector.collect(SimpleNamespace(value=url), ctx(self.account))

    def test_rss_mapping_sorting_and_filters(self):
        drafts = self.collect(RSS)
        titles = [d.title for d in drafts]
        # Old (20 days) dropped; future date treated as missing → undated, kept last; no-link skipped.
        self.assertEqual(titles[:2], ["Same story, other link form", "Filter coffee is back"])
        self.assertNotIn("Old news", titles)
        self.assertNotIn("No link at all", titles)
        relative = next(d for d in drafts if d.title == "Relative link")
        self.assertEqual(relative.url, "https://feed.example.com/relative-post")
        future = next(d for d in drafts if d.title == "From the future")
        self.assertIsNone(future.published_at)
        first = next(d for d in drafts if d.title == "Filter coffee is back")
        self.assertEqual(first.author, "Coffee Daily")
        self.assertEqual(first.raw["tags"], ["trends"])

    def test_atom(self):
        drafts = self.collect(ATOM)
        self.assertEqual(len(drafts), 1)
        self.assertEqual(drafts[0].author, "Sprudge")
        self.assertIn("third of sales", drafts[0].excerpt)

    def test_empty_and_malformed(self):
        self.assertEqual(self.collect(EMPTY), [])
        with self.assertRaises(CollectorError) as caught:
            self.collect(MALFORMED)
        self.assertEqual(caught.exception.code, "invalid_feed")

    def test_http_error_and_blocked(self):
        with self.assertRaises(CollectorError) as caught:
            self.collect(b"", status=500)
        self.assertEqual(caught.exception.code, "http_500")
        with mock.patch.object(http, "resolve_host", lambda host: ["10.0.0.5"]):
            with self.assertRaises(CollectorError) as caught:
                self.collect(RSS)
        self.assertEqual(caught.exception.code, "blocked_url")

    def test_cap_of_twenty(self):
        items = "".join(
            f"<item><title>T{i}</title><link>https://x.example.com/{i}</link></item>" for i in range(30)
        )
        body = f"<rss version='2.0'><channel><title>Big</title>{items}</channel></rss>".encode()
        self.assertEqual(len(self.collect(body)), 20)

    def test_select_entries_lookback(self):
        drafts = parse_feed(RSS, "https://feed.example.com/rss", f.NOW)
        kept = select_entries(drafts, ctx(self.account, lookback=30))
        self.assertIn("Old news", [d.title for d in kept])


class WebSearchCollectorTests(TestCase):
    def setUp(self):
        self.account = f.account()
        self.addCleanup(fake_text.clear)

    def collect(self, query):
        source = SimpleNamespace(value=query)
        return WebSearchCollector().collect(source, ctx(self.account))

    def test_ok_keeps_urls_from_results_only(self):
        drafts = self.collect("coffee trends")
        self.assertEqual([d.url for d in drafts], [
            "https://example.com/fake-result-1",
            "https://example.com/fake-result-2",
        ])
        self.assertEqual(drafts[0].raw["relevance"], 88)
        self.assertEqual(drafts[0].published_at.isoformat(), "2026-11-20T00:00:00+00:00")
        self.assertIsNone(drafts[1].published_at)

    def test_empty_skips_extraction(self):
        with mock.patch("apps.research.collectors.web_search.run_text", wraps=__import__(
            "apps.ai.gateway", fromlist=["run_text"]).run_text) as run_text:
            self.assertEqual(self.collect("coffee [fixture:empty]"), [])
        self.assertEqual(run_text.call_count, 1)

    def test_refused(self):
        with self.assertRaises(CollectorError) as caught:
            self.collect("coffee [fixture:refused]")
        self.assertEqual(caught.exception.code, "refused")

    def test_out_of_list_url_dropped(self):
        drafts = self.collect("coffee [fixture:out_of_list_url]")
        self.assertEqual([d.url for d in drafts], ["https://example.com/fake-result-1"])

    def test_low_relevance_dropped(self):
        drafts = self.collect("coffee [fixture:low_relevance]")
        self.assertEqual(len(drafts), 1)

    def test_provider_error(self):
        from apps.ai.errors import ProviderError

        fake_text.set("research.web_search", ProviderError("bad_request"))
        with self.assertRaises(CollectorError) as caught:
            self.collect("coffee")
        self.assertEqual(caught.exception.code, "provider_error")
