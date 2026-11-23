from django.test import SimpleTestCase

from ..services import sources


class NormalizeAndValidateTests(SimpleTestCase):
    def test_web_search(self):
        self.assertEqual(sources.normalize_value("web_search", "  specialty   coffee\ttrends "),
                         "specialty coffee trends")
        persian = sources.normalize_value("web_search", " ترند  قهوه دمی در کافه‌های تهران ")
        self.assertEqual(persian, "ترند قهوه دمی در کافه‌های تهران")
        sources.validate_value("web_search", persian)
        for value, code in (("ab", "min_length"), ("x" * 201, "max_length")):
            with self.subTest(value=value[:5]), self.assertRaises(sources.SourceValueError) as ctx:
                sources.validate_value("web_search", value)
            self.assertEqual(ctx.exception.code, code)

    def test_rss_normalization(self):
        self.assertEqual(sources.normalize_value("rss", " HTTPS://Sprudge.com/feed/ "),
                         "https://sprudge.com/feed/")
        self.assertEqual(sources.normalize_value("rss", "https://SPRUDGE.com/Feed/"),
                         "https://sprudge.com/Feed/")

    def test_rss_rejections(self):
        for value in ("ftp://example.com/feed", "http://127.0.0.1/feed", "http://[::1]/feed",
                      "http://localhost/feed", "https:///nohost", "not a url",
                      "https://example.com/" + "x" * 500):
            with self.subTest(value=value[:40]), self.assertRaises(sources.SourceValueError):
                sources.validate_value("rss", value)
        sources.validate_value("rss", "https://sprudge.com/feed/")

    def test_default_labels(self):
        self.assertEqual(sources.default_label("rss", "https://sprudge.com/feed/"), "sprudge.com")
        self.assertEqual(sources.default_label("web_search", "coffee trends"), "coffee trends")
