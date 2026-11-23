import dataclasses

from django.test import SimpleTestCase, override_settings

from .. import formats, roles
from ..checks import check_format_registry, registry_problems


class RegistryTests(SimpleTestCase):
    def test_four_specs_in_order(self):
        labels = [s.label for s in formats.all_specs()]
        self.assertEqual(labels, ["Feed post", "Image story", "Video story", "Reel"])

    def test_values_from_rule_4(self):
        reel = formats.get_spec("reel", "video")
        self.assertEqual((reel.width, reel.height, reel.layout), (1080, 1920, "9x16"))
        self.assertEqual(reel.safe_area, {"top": 220, "right": 120, "bottom": 420, "left": 60})
        self.assertTrue(reel.cover_required)
        self.assertEqual(reel.max_hashtags, 5)
        feed = formats.get_spec("feed_post", "image")
        self.assertEqual((feed.height, feed.max_file_bytes), (1350, 8 * 1024 * 1024))
        story = formats.get_spec("story", "video")
        self.assertEqual((story.caption_max_chars, story.max_hashtags), (0, 0))

    def test_helpers(self):
        self.assertEqual(formats.defaults_for("reel"), ("video", "motion"))
        self.assertEqual(formats.defaults_for("story"), ("image", "design"))
        self.assertFalse(formats.is_allowed("feed_post", "image", "motion"))
        self.assertTrue(formats.is_allowed("story", "video", "video"))
        self.assertEqual(formats.format_label("story", "video"), "Video story")
        self.assertEqual(formats.format_label("story"), "Story")
        with self.assertRaises(formats.UnknownFormat):
            formats.get_spec("carousel", "image")

    @override_settings(SOCIALHUB_MAX_HASHTAGS=3)
    def test_hashtag_setting(self):
        self.assertEqual(formats.get_spec("reel", "video").max_hashtags, 3)
        self.assertEqual(formats.get_spec("story", "image").max_hashtags, 0)
        self.assertEqual(formats.registry_version(), "1+h3")

    @override_settings(SOCIALHUB_MAX_HASHTAGS=40)
    def test_bad_hashtag_setting_fails_check(self):
        ids = [e.id for e in check_format_registry(None)]
        self.assertIn("content.E001", ids)

    def test_registry_is_consistent(self):
        self.assertEqual(registry_problems(), [])

    def test_check_names_bad_evaluation_checkpoints(self):
        specs = list(formats.SPECS)
        specs[2] = dataclasses.replace(specs[2], evaluation_checkpoints=("24h",))
        problems = registry_problems(specs)
        self.assertTrue(any("story/video" in p and "evaluation_checkpoints" in p
                            for p in problems))

    def test_check_names_bad_publish_method(self):
        specs = list(formats.SPECS)
        specs[3] = dataclasses.replace(specs[3], publish_method="publish_carousel")
        self.assertTrue(any("publish_method" in p for p in registry_problems(specs)))

    def test_payload_carries_roles_rules_and_templates(self):
        payload = formats.registry_payload()
        self.assertEqual(len(payload["roles"]), 5)
        self.assertEqual(len(payload["script_rules"]), 6)
        self.assertEqual(len(payload["frame_templates"]), 7)
        self.assertEqual(payload["specs"][0]["max_hashtags"], 5)

    def test_default_metric(self):
        self.assertEqual(roles.default_metric("engage", "story"), "replies")
        self.assertEqual(roles.default_metric("engage", "reel"), "comments")
        self.assertEqual(roles.default_metric("educate", "feed_post"), "saves")
