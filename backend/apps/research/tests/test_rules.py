"""Pure rules: fingerprints, source values, text limits, evidence components."""

from datetime import timedelta
from types import SimpleNamespace

from django.test import SimpleTestCase, override_settings

from apps.research.services import evidence, sources
from apps.research.services.fingerprints import InvalidURL, fingerprint, normalize_url
from apps.research.services.text import clean, cut

from .factories import NOW


class NormalizeURLTests(SimpleTestCase):
    def test_table(self):
        cases = [
            ("  http://WWW.Example.com:80/a/b/  ", "https://example.com/a/b"),
            ("https://m.example.com/a#frag", "https://example.com/a"),
            ("https://example.com:443/", "https://example.com/"),
            ("https://example.com", "https://example.com/"),
            ("https://example.com:8443/x", "https://example.com:8443/x"),
            (
                "https://example.com/a?utm_source=x&b=2&a=1&fbclid=z&gclid=q&ref=r&spm=1",
                "https://example.com/a?a=1&b=2",
            ),
            ("https://example.com/a?igsh=MWx0&igshid=1&mc_cid=1&mc_eid=2&ref_src=t", "https://example.com/a"),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_url(raw), expected)

    def test_instagram_forms_collapse(self):
        forms = [
            "https://www.instagram.com/reel/DCx1abcDEF/?igsh=MWx0",
            "https://instagram.com/p/DCx1abcDEF/",
            "https://m.instagram.com/reels/DCx1abcDEF",
            "http://instagram.com/tv/DCx1abcDEF/?x=1",
        ]
        for form in forms:
            self.assertEqual(normalize_url(form), "https://instagram.com/p/DCx1abcDEF")

    def test_rejects_non_http(self):
        for raw in ("ftp://example.com/a", "javascript:alert(1)", "", "https://"):
            with self.assertRaises(InvalidURL):
                normalize_url(raw)

    def test_utm_and_trailing_slash_are_one_fingerprint(self):
        self.assertEqual(
            fingerprint("rss", "https://example.com/post/?utm_source=feed"),
            fingerprint("rss", "https://example.com/post"),
        )

    def test_no_url_uses_kind_author_excerpt(self):
        a = fingerprint("manual", "", " @Brand ", "Three  step   recipe")
        b = fingerprint("manual", None, "@brand", "three step recipe")
        self.assertEqual(a, b)
        self.assertNotEqual(a, fingerprint("manual", "", "@other", "three step recipe"))


class SourceValueTests(SimpleTestCase):
    def test_normalization(self):
        self.assertEqual(sources.normalize_value("web_search", "  coffee \n  trends  "), "coffee trends")
        self.assertEqual(
            sources.normalize_value("web_search", " ترند   قهوه دمی در کافه‌های تهران "),
            "ترند قهوه دمی در کافه‌های تهران",
        )
        self.assertEqual(
            sources.normalize_value("rss", " HTTPS://Sprudge.com/Feed/ "), "https://sprudge.com/Feed/"
        )

    def test_validation(self):
        ok = [("web_search", "abc"), ("web_search", "x" * 200), ("rss", "https://sprudge.com/feed/")]
        for kind, value in ok:
            sources.validate_value(kind, value)
        bad = [
            ("web_search", "ab", "min_length"),
            ("web_search", "x" * 201, "max_length"),
            ("rss", "ftp://example.com/feed", "invalid"),
            ("rss", "http://127.0.0.1/feed", "invalid"),
            ("rss", "http://[::1]/feed", "invalid"),
            ("rss", "http://localhost/feed", "invalid"),
            ("rss", "example.com/feed", "invalid"),
            ("rss", "https://example.com/" + "a" * 500, "max_length"),
        ]
        for kind, value, code in bad:
            with self.subTest(value=value), self.assertRaises(sources.SourceValueError) as ctx:
                sources.validate_value(kind, value)
            self.assertEqual(ctx.exception.code, code)

    def test_default_label(self):
        self.assertEqual(sources.default_label("rss", "https://sprudge.com/feed/"), "sprudge.com")
        self.assertEqual(sources.default_label("web_search", "coffee trends"), "coffee trends")
        self.assertEqual(len(sources.default_label("web_search", "x" * 150)), 80)

    @override_settings(SOCIALHUB_AI_TEXT_PROVIDER="anthropic", ANTHROPIC_API_KEY="")
    def test_availability_without_provider(self):
        self.assertEqual(sources.availability("web_search").reason, "provider_not_configured")
        self.assertTrue(sources.availability("rss").available)

    def test_availability_with_fake(self):
        self.assertTrue(sources.availability("web_search").available)


class TextTests(SimpleTestCase):
    def test_clean_and_cut(self):
        self.assertEqual(clean("<p>Hello&nbsp;<b>world</b></p>\n\n  again"), "Hello world again")
        self.assertEqual(cut("one two three four", 12), "one two…")
        self.assertEqual(cut("short", 10), "short")


def _sig(kind="rss", url="https://a.example.com/x", author="", days_old=1, metrics=None):
    return SimpleNamespace(
        kind=kind,
        url=url,
        author=author,
        published_at=NOW - timedelta(days=days_old),
        captured_at=NOW,
        metrics=metrics or {},
    )


class EvidenceTests(SimpleTestCase):
    def test_signal_count_table(self):
        table = {1: 32, 2: 50, 3: 63, 4: 73, 5: 82, 6: 89, 8: 100, 20: 100, 0: 0}
        for n, expected in table.items():
            self.assertEqual(evidence.signal_count_component(n), expected, n)

    def test_source_diversity(self):
        www_same = [_sig(url="https://www.example.com/a"), _sig(url="https://example.com/b")]
        self.assertEqual(evidence.source_diversity_component(www_same), 25)
        instagram = [
            _sig(kind="manual", url="https://instagram.com/p/a", author="@one"),
            _sig(kind="manual", url="https://instagram.com/p/b", author="@two"),
            _sig(kind="manual", url="https://instagram.com/p/c", author=""),
        ]
        self.assertEqual(evidence.source_diversity_component(instagram), 75)
        one_origin_two_kinds = [
            _sig(kind="rss", url="https://example.com/a"),
            _sig(kind="web_search", url="https://example.com/b"),
        ]
        self.assertEqual(evidence.source_diversity_component(one_origin_two_kinds), 50)

    def test_recency_boundaries(self):
        self.assertEqual(evidence.recency_value(_sig(days_old=2), NOW), 100)
        self.assertEqual(evidence.recency_value(_sig(days_old=14), NOW), 0)
        undated = SimpleNamespace(published_at=None, captured_at=NOW - timedelta(days=8))
        self.assertEqual(evidence.recency_value(undated, NOW), 50)

    def test_engagement(self):
        self.assertEqual(evidence.engagement_component([]), 50)
        self.assertEqual(evidence.percentile(10, [1, 2, 3]), 0.5)
        self.assertEqual(evidence.percentile(3, [1, 2, 3, 4, 5]), 0.6)
        self.assertEqual(evidence.engagement_value({"likes": 10, "comments": 2, "views": 100}), 24)

    def test_worked_example(self):
        signals = [
            _sig(kind="web_search", url="https://perfectdailygrind.com/a", days_old=3),
            _sig(kind="rss", url="https://sprudge.com/b", days_old=1),
            _sig(kind="manual", url="https://instagram.com/reel/x", author="@brewlab", days_old=5,
                 metrics={"likes": 1}),
            _sig(kind="manual", url="https://instagram.com/p/y", author="@homebarista", days_old=9,
                 metrics={"likes": 1}),
        ]
        score, breakdown = evidence.compute(signals, [0.92, 0.40], NOW)
        self.assertEqual(
            breakdown, {"signal_count": 73, "source_diversity": 100, "recency": 89, "engagement": 92}
        )
        self.assertEqual(score, 87)

    def test_no_signals(self):
        score, breakdown = evidence.compute([], [], NOW)
        self.assertEqual(score, 0)
        self.assertEqual(set(breakdown.values()), {0})

    @override_settings(SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS={"signal_count": 1, "recency": 0.5})
    def test_weights_check(self):
        from django.core.exceptions import ImproperlyConfigured

        with self.assertRaises(ImproperlyConfigured):
            evidence.check_weights()
