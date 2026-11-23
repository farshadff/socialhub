"""Renderer tests: run only where Chromium is available (the render image).

The default backend test run skips them when Chromium is absent (E06-S02 test notes).
"""

import io
import unittest

from django.test import SimpleTestCase

from apps.content import formats

from ..rendering.brand import BrandContext
from ..rendering.renderer import RenderRequest, render
from ..rendering.templates import all_templates, validate_registry


_CHROMIUM: bool | None = None


def chromium_available() -> bool:
    """True only when a browser actually starts here (a cached binary may lack system libs)."""
    global _CHROMIUM
    if _CHROMIUM is None:
        try:
            spec = formats.get_spec("story", "image")
            render(request_for("title", spec, "x"))
            _CHROMIUM = True
        except Exception:  # noqa: BLE001 - any launch problem means "skip"
            _CHROMIUM = False
    return _CHROMIUM


BRAND = BrandContext(colors={"primary": "#0B6E4F", "secondary": "#21295C", "accent": "#F2A541",
                             "background": "#FFFFFF", "text": "#1B1B1B"},
                     font_heading_key="vazirmatn", font_body_key="vazirmatn",
                     handle="@greenhome.ir")


def request_for(key, spec, headline, body="", **kw):
    return RenderRequest(template_key=key, layout=spec.layout, width=spec.width,
                         height=spec.height, safe_area=dict(spec.safe_area), headline=headline,
                         body=body, brand=BRAND, **kw)


class TemplateRegistryTests(SimpleTestCase):
    def test_seven_valid_templates(self):
        self.assertEqual(validate_registry(), [])
        self.assertEqual(len(all_templates()), 7)


class RendererTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not chromium_available():
            raise unittest.SkipTest("Chromium cannot start in this environment")

    def test_feed_post_title_is_canvas_size_and_reports_fit(self):
        from PIL import Image

        spec = formats.get_spec("feed_post", "image")
        result = render(request_for("title", spec, "سه نشانه که بودجه‌تان نشتی دارد"))
        image = Image.open(io.BytesIO(result.png))
        self.assertEqual(image.size, (spec.width, spec.height))
        self.assertIn("headline", result.fit)
        self.assertIn("logo_not_configured", [w["code"] for w in result.warnings])

    def test_long_headline_overflows_with_warning(self):
        spec = formats.get_spec("feed_post", "image")
        result = render(request_for("title", spec, "بسیار " * 60))
        self.assertIn("text_overflow", [w["code"] for w in result.warnings])

    def test_safe_area_holds_for_reel(self):
        """Debug mode paints text boxes magenta; no magenta pixel may leave the safe area."""
        from PIL import Image

        spec = formats.get_spec("reel", "video")
        result = render(request_for("statement", spec, "یک جمله‌ی بلند " * 4, debug_boxes=True))
        image = Image.open(io.BytesIO(result.png)).convert("RGB")
        sa = spec.safe_area
        px = image.load()
        for y in range(0, spec.height, 4):
            for x in range(0, spec.width, 4):
                inside = sa["left"] <= x < spec.width - sa["right"] and (
                    sa["top"] <= y < spec.height - sa["bottom"])
                if not inside:
                    self.assertNotEqual(px[x, y], (255, 0, 255), f"pixel {x},{y}")

    def test_overlay_mode_keeps_alpha(self):
        from PIL import Image

        spec = formats.get_spec("reel", "video")
        result = render(request_for("title", spec, "متن روی فیلم", overlay=True))
        image = Image.open(io.BytesIO(result.png))
        self.assertEqual(image.mode, "RGBA")
        self.assertEqual(image.getpixel((5, 5))[3], 0)

    def test_english_layout_renders(self):
        spec = formats.get_spec("story", "image")
        result = render(request_for("list", spec, "Three moves", "Clear it\nSort it\nWipe it",
                                    lang="en"))
        self.assertTrue(result.png.startswith(b"\x89PNG"))
