import json
from pathlib import Path
from types import SimpleNamespace

from django.test import SimpleTestCase

from ..services.briefs import normalise, validate_brief

FIXTURES = Path(__file__).resolve().parents[2] / "ai" / "prompts" / "brief.generate"


def item(format="reel", media_kind="video", role="educate"):
    return SimpleNamespace(format=format, media_kind=media_kind, role=role)


def brief(name="fixture"):
    data = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    data.update(references=[{"title": "Source", "url": "https://example.org/a"}],
                success_metric="saves", feedback="")
    return data


class BriefValidationTests(SimpleTestCase):
    def codes(self, data, it=None):
        return {(i["code"], i["path"]) for i in validate_brief(data, it or item())}

    def test_fixtures_are_valid(self):
        self.assertEqual(validate_brief(brief(), item()), [])
        self.assertEqual(validate_brief(brief("fixture.convert"), item(role="convert"),
                                        "convert"), [])

    def test_too_long_fixture(self):
        self.assertIn(("text_too_long", "key_message"), self.codes(brief("fixture.too_long")))

    def test_convert_needs_cta(self):
        data = brief("fixture.convert")
        data["cta"] = ""
        self.assertIn(("text_required", "cta"), self.codes(data, item(role="convert")))

    def test_metric_rules(self):
        data = brief()
        data["success_metric"] = "replies"
        self.assertIn(("metric_not_allowed", "success_metric"), self.codes(data))
        self.assertNotIn(("metric_not_allowed", "success_metric"),
                         self.codes(data, item(format="story", media_kind="image")))
        data["success_metric"] = "views"
        self.assertIn(("metric_not_allowed", "success_metric"),
                      self.codes(data, item(format="feed_post", media_kind="image")))
        data["success_metric"] = "follower_growth"
        self.assertIn(("metric_not_allowed", "success_metric"), self.codes(data))

    def test_reference_url_and_list_limits(self):
        data = brief()
        data["references"] = [{"title": "x", "url": "ftp://bad"}]
        data["must_include"] = ["a"] * 7
        codes = self.codes(data)
        self.assertIn(("invalid_url", "references.0.url"), codes)
        self.assertIn(("list_too_long", "must_include"), codes)

    def test_normalise_dedupes_case_insensitively(self):
        out = normalise({"must_avoid": [" A ", "a", "", "B"], "objective": "  x "})
        self.assertEqual(out["must_avoid"], ["A", "B"])
        self.assertEqual(out["objective"], "x")
