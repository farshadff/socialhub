from django.test import SimpleTestCase

from ..services.fingerprints import InvalidURL, fingerprint, normalize_url


class NormalizeURLTests(SimpleTestCase):
    def test_table(self):
        cases = [
            (" HTTP://WWW.Example.com:80/a/?b=2&a=1#frag ", "https://example.com/a?a=1&b=2"),
            ("https://m.example.com/x/", "https://example.com/x"),
            ("https://example.com/", "https://example.com/"),
            ("https://example.com", "https://example.com/"),
            ("https://example.com:8443/x", "https://example.com:8443/x"),
            ("https://example.com/p?utm_source=x&utm_medium=y&id=3&fbclid=z&gclid=1",
             "https://example.com/p?id=3"),
            ("https://example.com/p?ref=a&ref_src=b&mc_cid=c&mc_eid=d&spm=e&igsh=f&igshid=g",
             "https://example.com/p"),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_url(raw), expected)

    def test_instagram_forms(self):
        for raw in ("https://www.instagram.com/reel/DCx1abcDEF/?igsh=MWx0",
                    "https://instagram.com/p/DCx1abcDEF/",
                    "http://m.instagram.com/reels/DCx1abcDEF",
                    "https://instagram.com/tv/DCx1abcDEF/?utm_source=ig"):
            with self.subTest(raw=raw):
                self.assertEqual(normalize_url(raw), "https://instagram.com/p/DCx1abcDEF")

    def test_rejects_other_schemes(self):
        for raw in ("ftp://example.com/feed", "javascript:alert(1)", "example.com", ""):
            with self.subTest(raw=raw), self.assertRaises(InvalidURL):
                normalize_url(raw)

    def test_utm_and_trailing_slash_collide(self):
        self.assertEqual(fingerprint("rss", "https://example.com/a/?utm_source=x"),
                         fingerprint("rss", "https://example.com/a"))

    def test_no_url_uses_kind_author_excerpt(self):
        a = fingerprint("manual", None, "  @Brand ", "Hello   World")
        b = fingerprint("manual", None, "@brand", "hello world")
        c = fingerprint("manual", None, "@other", "hello world")
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertEqual(len(a), 64)
