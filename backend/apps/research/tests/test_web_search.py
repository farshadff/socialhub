from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from apps.ai.errors import ProviderError, ProviderNotConfigured, ProviderRefused

from ..collectors.base import CollectContext, CollectorError
from ..collectors.web_search import WebSearchCollector
from ..schemas import ExtractedSignal, ExtractedSignals
from .helpers import FakeResult

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)
SOURCE = SimpleNamespace(value="specialty coffee trends")
CITATIONS = [{"url": "https://www.example.com/a/?utm_source=x", "title": "A"},
             {"url": "https://example.org/b", "title": "B"}]


def ctx():
    account = SimpleNamespace(pk=3, content_language="fa")
    return CollectContext(account=account, plan=None,
                          brand=SimpleNamespace(audience_summary="Home brewers",
                                                content_pillars=["coffee"]),
                          lookback_days=7, job_id=None, now=NOW)


def signal(url, relevance=80):
    return ExtractedSignal(url=url, title="T", excerpt="E", author="P",
                           published_at=date(2026, 11, 20), relevance=relevance)


class WebSearchCollectorTests(SimpleTestCase):
    def run_collector(self, responses):
        with mock.patch("apps.research.services.platform.run_text", side_effect=responses) as rt, \
                mock.patch("apps.research.services.platform.WebSearchOptions",
                           lambda **kw: kw, create=True):
            drafts = WebSearchCollector().collect(SOURCE, ctx())
        return drafts, rt

    def test_keeps_only_urls_from_results(self):
        extracted = ExtractedSignals(signals=[
            signal("https://example.com/a"),          # same as citation 1 after normalization
            signal("https://not-in-results.example.org/x"),
            signal("https://example.org/b", relevance=10),  # below the relevance cut
        ])
        drafts, rt = self.run_collector([FakeResult("text", CITATIONS), FakeResult(extracted)])
        self.assertEqual([d.url for d in drafts], ["https://www.example.com/a/?utm_source=x"])
        self.assertEqual(drafts[0].raw["relevance"], 80)
        self.assertEqual(drafts[0].published_at, datetime(2026, 11, 20, tzinfo=UTC))
        first_call = rt.call_args_list[0]
        self.assertEqual(first_call.args[0], "research.web_search")
        self.assertEqual(first_call.kwargs["variables"]["window_start"], "2026-11-15")
        self.assertEqual(rt.call_args_list[1].args[0], "research.extract_signals")

    def test_no_results_skips_extraction(self):
        drafts, rt = self.run_collector([FakeResult("nothing", [])])
        self.assertEqual(drafts, [])
        self.assertEqual(rt.call_count, 1)

    def test_failures_map_to_codes(self):
        cases = [(ProviderRefused("refused"), "refused"),
                 (ProviderError("rate_limited"), "provider_error"),
                 (ProviderNotConfigured("ANTHROPIC_API_KEY"), "provider_not_configured")]
        for exc, code in cases:
            with self.subTest(code=code), self.assertRaises(CollectorError) as err:
                self.run_collector([exc])
            self.assertEqual(err.exception.code, code)
