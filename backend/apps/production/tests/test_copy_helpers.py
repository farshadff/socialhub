from django.test import SimpleTestCase

from ..services.copy import (banned_matches, full_caption, hashtag_count, normalise_hashtags)


class CopyHelperTests(SimpleTestCase):
    def test_full_caption(self):
        self.assertEqual(full_caption("Hello", ["a", "b"]), "Hello\n\n#a #b")
        self.assertEqual(full_caption("Hello", []), "Hello")

    def test_hashtag_normalising(self):
        tags, errors = normalise_hashtags(["#خانه سبز", "خانه_سبز", "1234", "ok", "x"])
        self.assertEqual(tags, ["خانه_سبز", "ok"])
        self.assertEqual(set(errors), {2, 4})

    def test_count_includes_tags_in_caption(self):
        self.assertEqual(hashtag_count("Nice #desk and #home", ["desk"]), 2)

    def test_banned_terms_fold_letter_variants(self):
        found = banned_matches({"caption": "تضمينی"}, ["تضمینی"])
        self.assertEqual(found, [("caption", "تضمینی")])
        self.assertEqual(banned_matches({"caption": "Cheapest!"}, ["cheapest"]),
                         [("caption", "cheapest")])
