from datetime import UTC, datetime, timedelta

from django.test import SimpleTestCase, TestCase

from ..services import evidence
from ..services.evidence import SignalFacts
from .helpers import make_account, make_signal

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)


def facts(kind="rss", url="https://a.com/x", author="", days=1, metrics=None, pct=None,
          published=True):
    moment = NOW - timedelta(days=days)
    return SignalFacts(kind=kind, url=url, author=author,
                       published_at=moment if published else None,
                       captured_at=moment, metrics=metrics or {}, percentile=pct)


class ComponentTests(SimpleTestCase):
    def test_signal_count_table(self):
        expected = {1: 32, 2: 50, 3: 63, 4: 73, 5: 82, 6: 89, 8: 100, 12: 100, 0: 0}
        for n, value in expected.items():
            with self.subTest(n=n):
                self.assertEqual(evidence.signal_count_component(n), value)

    def test_diversity(self):
        one_origin = [facts(url="https://www.example.com/a"), facts(url="https://example.com/b")]
        self.assertEqual(evidence.source_diversity_component(one_origin), 25)
        two_kinds = [facts(url="https://example.com/a"),
                     facts(kind="web_search", url="https://example.com/b")]
        self.assertEqual(evidence.source_diversity_component(two_kinds), 50)
        insta = [facts(kind="manual", url="https://instagram.com/p/1", author="@a"),
                 facts(kind="manual", url="https://instagram.com/p/2", author="@b")]
        self.assertEqual(evidence.source_diversity_component(insta), 50)
        no_author = [facts(kind="manual", url="https://instagram.com/p/1", author=""),
                     facts(kind="manual", url="https://instagram.com/p/2", author="")]
        self.assertEqual(evidence.source_diversity_component(no_author), 25)
        self.assertEqual(evidence.origin(no_author[0]), "instagram.com")

    def test_recency_boundaries(self):
        self.assertEqual(evidence.recency_component([facts(days=2)], NOW), 100)
        self.assertEqual(evidence.recency_component([facts(days=14)], NOW), 0)
        self.assertEqual(evidence.recency_component([facts(days=20)], NOW), 0)
        undated = facts(days=1, published=False)
        self.assertEqual(evidence.recency_component([undated], NOW), 100)

    def test_recency_uses_top_three(self):
        signals = [facts(days=1), facts(days=1), facts(days=1), facts(days=13)]
        self.assertEqual(evidence.recency_component(signals, NOW), 100)

    def test_engagement_without_metrics_is_50(self):
        self.assertEqual(evidence.engagement_component([facts()]), 50)

    def test_percentile_small_reference_set(self):
        self.assertEqual(evidence.percentile(10, [1, 2, 3, 4]), 0.5)
        self.assertEqual(evidence.percentile(3, [1, 2, 3, 4, 5]), 0.6)

    def test_no_signals_scores_zero(self):
        score, breakdown = evidence.score_facts([], NOW)
        self.assertEqual(score, 0)
        self.assertEqual(set(breakdown.values()), {0})

    def test_worked_example(self):
        signals = [
            facts(kind="web_search", url="https://perfectdailygrind.com/x", days=3),
            facts(kind="rss", url="https://sprudge.com/y", days=1),
            facts(kind="manual", url="https://www.instagram.com/reel/A1/", author="@brewlab",
                  days=5, metrics={"likes": 1}, pct=0.92),
            facts(kind="manual", url="https://instagram.com/p/B2/", author="@homebarista",
                  days=9, metrics={"likes": 1}, pct=0.40),
        ]
        score, breakdown = evidence.score_facts(signals, NOW, evidence.DEFAULT_WEIGHTS)
        self.assertEqual(breakdown, {"signal_count": 73, "source_diversity": 100,
                                     "recency": 89, "engagement": 92})
        self.assertEqual(score, 87)


class DatabaseScoringTests(TestCase):
    def test_reference_set_percentiles(self):
        account = make_account()
        now = datetime.now(tz=UTC)
        refs = [make_signal(account, kind="manual", url=f"https://instagram.com/p/{i}",
                            author=f"@a{i}", metrics={"likes": i * 100}) for i in range(1, 6)]
        top = refs[-1]
        result = evidence.facts_for([top], account.pk, now)
        self.assertEqual(result[0].percentile, 1.0)
        no_metrics = make_signal(account)
        self.assertIsNone(evidence.facts_for([no_metrics], account.pk, now)[0].percentile)
