"""End to end through the API: brief → script → production → copy → submit (E04-E06).

Celery runs eagerly, the AI gateway uses the fake provider and its fixtures, and the renderer is
replaced by a Pillow image so the test needs neither Chromium nor FFmpeg (design mode only).
"""

from __future__ import annotations

import io
from unittest import mock

from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from ..models import Brief, ContentItem, ContentVersion, ScriptVersion
from .factories import make_item, make_user


def fake_render(request):
    from PIL import Image

    from apps.production.rendering.renderer import RenderResult

    image = Image.new("RGB", (request.width, request.height), (240, 240, 240))
    out = io.BytesIO()
    image.save(out, "PNG")
    return RenderResult(png=out.getvalue(), fit={"headline": 80}, warnings=[])


@override_settings(SOCIALHUB_AI_TEXT_PROVIDER="fake", SOCIALHUB_AI_IMAGE_PROVIDER="fake")
class ContentFlowTests(TransactionTestCase):
    def setUp(self):
        from config.celery import app

        self._eager = app.conf.task_always_eager
        app.conf.task_always_eager = True
        app.conf.task_eager_propagates = False
        self.user = make_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def tearDown(self):
        from config.celery import app

        app.conf.task_always_eager = self._eager

    def url(self, item, path=""):
        return f"/api/v1/content-items/{item.pk}/{path}"

    def test_feed_post_from_brief_to_submission(self):
        item = make_item(format="feed_post", role="educate")

        # E04-S03: write and approve the brief.
        r = self.client.post(self.url(item, "brief/generate/"), {}, format="json")
        self.assertEqual(r.status_code, 202, r.content)
        brief = Brief.objects.get(content_item=item)
        self.assertEqual((brief.version, brief.status, brief.origin), (1, "draft", "ai"))
        r = self.client.get(self.url(item, "brief/"))
        self.assertTrue(r.json()["validation"]["valid"], r.json())
        r = self.client.post(self.url(item, "brief/approve/"), {"version": 1}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["item_status"], "briefed")

        # Stale edit is refused (409 version_conflict).
        payload = {**{k: r.json()["brief"][k] for k in (
            "objective", "key_message", "hook_direction", "audience_note", "cta",
            "must_include", "must_avoid", "references", "format_notes", "success_metric")},
            "base_version": 0}
        r = self.client.put(self.url(item, "brief/"), payload, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["code"], "version_conflict")

        # E05: write and approve the script; production starts on approval.
        r = self.client.post(self.url(item, "script/generate/"), {}, format="json")
        self.assertEqual(r.status_code, 202, r.content)
        script = ScriptVersion.objects.get(content_item=item)
        r = self.client.get(self.url(item, "script/"))
        self.assertTrue(r.json()["validation"]["valid"], r.json()["validation"])
        with mock.patch("apps.production.rendering.renderer.render", side_effect=fake_render):
            r = self.client.post(self.url(item, "script/approve/"), {"version": script.version},
                                 format="json")
        self.assertEqual(r.status_code, 200, r.content)
        item.refresh_from_db()
        self.assertEqual(item.status, ContentItem.Status.IN_PRODUCTION)

        # E06: the production run rendered the frame, exported the JPEG and drafted the copy.
        version = ContentVersion.objects.get(content_item=item)
        self.assertEqual(version.render_status, "ready", version.production_steps)
        self.assertEqual(version.final_asset.mime, "image/jpeg")
        self.assertTrue(version.caption)
        self.assertLessEqual(len(version.hashtags), 5)
        r = self.client.get(self.url(item, "production/"))
        body = r.json()
        self.assertEqual(body["actions"]["submit_blockers"], [], body["actions"])

        # Submit for checking.
        r = self.client.post(self.url(item, "production/submit/"),
                             {"base_version": version.version, "acknowledge_warnings": True},
                             format="json")
        self.assertEqual(r.status_code, 200, r.content)
        item.refresh_from_db()
        self.assertEqual(item.status, ContentItem.Status.IN_CHECK)

    def test_format_change_supersedes_and_rewrites_brief(self):
        item = make_item(format="reel", role="educate")
        self.client.post(self.url(item, "brief/generate/"), {}, format="json")
        self.client.post(self.url(item, "brief/approve/"), {"version": 1}, format="json")
        r = self.client.patch(self.url(item), {"format": "feed_post"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["fields"][0]["path"], "slot")
        r = self.client.patch(self.url(item), {"format": "feed_post", "slot": None},
                              format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["fields"][0]["code"], "confirmation_required")
        r = self.client.patch(self.url(item), {"format": "feed_post", "slot": None,
                                               "confirm": True}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        effects = r.json()["effects"]
        self.assertEqual((effects["status_from"], effects["status_to"]), ("briefed", "selected"))
        self.assertEqual(effects["superseded"]["briefs"], [1])
        # advance() wrote brief v2 for the new format.
        self.assertTrue(Brief.objects.filter(content_item=item, version=2).exists())

    def test_list_filters_and_detail(self):
        item = make_item()
        r = self.client.get(f"/api/v1/content-items/?account={item.account_id}&status=selected")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["count"], 1)
        r = self.client.get("/api/v1/content-items/")
        self.assertEqual(r.status_code, 400)
        r = self.client.get(self.url(item))
        self.assertIn("edit_format", r.json()["allowed_actions"])
        r = self.client.get("/api/v1/formats/")
        etag = r["ETag"]
        r = self.client.get("/api/v1/formats/", HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(r.status_code, 304)
