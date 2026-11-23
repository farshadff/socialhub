import copy
import json
from pathlib import Path

from django.test import SimpleTestCase

from ..services.scripts import normalise_package, structure_errors, validate_script_package

FIXTURES = Path(__file__).resolve().parents[2] / "ai" / "prompts" / "script.generate"
COMBOS = {
    "feed_post_image_design": ("feed_post", "image", "design"),
    "story_image_design": ("story", "image", "design"),
    "story_video_motion": ("story", "video", "motion"),
    "story_video_video": ("story", "video", "video"),
    "reel_video_motion": ("reel", "video", "motion"),
    "reel_video_video": ("reel", "video", "video"),
}
BRIEF_CTA = "ذخیره کنید و امشب امتحانش کنید."


def load(name):
    return json.loads((FIXTURES / f"fixture.{name}.json").read_text(encoding="utf-8"))


def validate(payload, combo, cta=BRIEF_CTA, role="educate"):
    fmt, media, mode = COMBOS[combo]
    return validate_script_package(payload, format=fmt, media_kind=media, production_mode=mode,
                                   brief_cta=cta, role=role)


class ScriptFixtureTests(SimpleTestCase):
    def test_every_combination_fixture_is_valid(self):
        for combo in COMBOS:
            with self.subTest(combo=combo):
                self.assertEqual(validate(load(combo), combo), [])

    def test_too_long_headline_fixture_is_invalid(self):
        issues = validate(load("reel_motion_too_long_headline"), "reel_video_motion")
        self.assertIn(("text_too_long", "frames.0.headline"),
                      [(i["code"], i["path"]) for i in issues])
        issue = next(i for i in issues if i["path"] == "frames.0.headline")
        self.assertEqual(issue["limit"], 60)


class ScriptRuleTests(SimpleTestCase):
    def setUp(self):
        self.pkg = load("reel_video_motion")

    def codes(self, payload, combo="reel_video_motion", **kw):
        return {i["code"] for i in validate(payload, combo, **kw)}

    def test_duration_mismatch(self):
        pkg = copy.deepcopy(self.pkg)
        pkg["duration_seconds"] = 30
        self.assertIn("duration_mismatch", self.codes(pkg))

    def test_frame_count(self):
        pkg = copy.deepcopy(self.pkg)
        pkg["frames"] = pkg["frames"][:2]
        self.assertIn("frame_count", self.codes(pkg))

    def test_footage_not_allowed_in_motion(self):
        pkg = copy.deepcopy(self.pkg)
        pkg["shots"][0]["type"] = "footage"
        pkg["shots"][0]["asset_hint"] = "Close-up of a desk"
        self.assertIn("shot_type_not_allowed", self.codes(pkg))

    def test_visual_prompt_asking_for_text(self):
        pkg = copy.deepcopy(self.pkg)
        pkg["frames"][3]["visual_prompt"] = "A desk with a big logo and the word SALE as text"
        self.assertIn("visual_prompt_asks_for_text", self.codes(pkg))

    def test_last_frame_must_be_cta(self):
        pkg = copy.deepcopy(self.pkg)
        pkg["frames"][-1]["template"] = "statement"
        self.assertIn("cta_missing", self.codes(pkg))

    def test_list_lines(self):
        pkg = copy.deepcopy(self.pkg)
        pkg["frames"][2]["body"] = "only one line"
        self.assertIn("list_lines", self.codes(pkg))

    def test_index_sequence(self):
        pkg = copy.deepcopy(self.pkg)
        pkg["frames"][1]["index"] = 7
        self.assertIn("index_sequence", self.codes(pkg))

    def test_video_mode_needs_footage(self):
        pkg = load("reel_video_video")
        for shot in pkg["shots"]:
            shot["type"] = "graphic"
            shot["asset_hint"] = ""
        self.assertIn("footage_shot_required", self.codes(pkg, "reel_video_video"))

    def test_cta_only_frame_for_image_requires_convert(self):
        pkg = load("feed_post_image_design")
        pkg["frames"][0].update(template="cta", headline="ذخیره کنید", body="")
        self.assertIn("template_not_allowed", self.codes(pkg, "feed_post_image_design"))
        self.assertNotIn("template_not_allowed",
                         self.codes(pkg, "feed_post_image_design", role="convert"))

    def test_structure_errors_have_payload_paths(self):
        pkg = copy.deepcopy(self.pkg)
        pkg["frames"][1]["template"] = "carousel"
        del pkg["hook"]
        errors = structure_errors(pkg)
        self.assertIn("payload.frames.1.template", errors)
        self.assertIn("payload.hook", errors)

    def test_normalise_trims_and_zeroes_image_durations(self):
        pkg = load("feed_post_image_design")
        pkg["hook"] = "  hook  "
        pkg["duration_seconds"] = 9
        out = normalise_package(pkg, image_format=True)
        self.assertEqual(out["hook"], "hook")
        self.assertEqual(out["duration_seconds"], 0)
