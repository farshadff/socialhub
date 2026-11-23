"""FFmpeg assembly tests (E06-S03, E06-S04). Skipped where ffmpeg/ffprobe are absent.

The renderer is replaced by a Pillow image so these run without Chromium; the outputs are
checked by probing the files, not by comparing command strings (E06-S03 implementer notes).
"""

from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from apps.content import formats
from apps.content.models import Asset, ContentVersion, ScriptVersion
from apps.content.services import assets as asset_service
from apps.content.tests.factories import make_item

from ..services import assembly, orchestration

FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def fake_render(request):
    from PIL import Image

    from ..rendering.renderer import RenderResult

    mode = "RGBA" if request.overlay else "RGB"
    color = (0, 0, 0, 0) if request.overlay else (30, 110, 80)
    image = Image.new(mode, (request.width, request.height), color)
    out = io.BytesIO()
    image.save(out, "PNG")
    return RenderResult(png=out.getvalue(), fit={}, warnings=[])


def motion_payload():
    frames, shots = [], []
    for n, (tpl, d, tr) in enumerate([("title", 5, "cut"), ("stat", 5, "fade"),
                                      ("statement", 5, "slide"), ("cta", 5, "fade")], start=1):
        shots.append({"index": n, "duration_seconds": d, "type": "graphic",
                      "description": "A frame of the reel.", "on_screen_text": "",
                      "voiceover": "", "asset_hint": ""})
        frames.append({"index": n, "shot_index": n, "template": tpl, "headline": "متن",
                       "body": "توضیح" if tpl == "stat" else "", "visual_prompt": "",
                       "duration_seconds": d, "transition": tr})
    return {"scenario": "A short reel for the assembly test.", "hook": "A hook line",
            "duration_seconds": 20, "shots": shots, "frames": frames,
            "design_notes": {"mood": "calm", "color_usage": "", "typography": "",
                             "imagery_style": "", "layout": "centred", "do": [], "dont": []},
            "cta": "Save this", "music_hint": ""}


@unittest.skipUnless(FFMPEG, "ffmpeg/ffprobe not available")
class MotionAssemblyTests(TestCase):
    def setUp(self):
        self.item = make_item(format="reel", status="in_production")
        brief = self.item.current_brief
        if brief is None:
            from apps.content.models import Brief

            brief = Brief.objects.create(
                content_item=self.item, version=1, role="educate", objective="o" * 30,
                key_message="k" * 20, hook_direction="h" * 20, format_notes="f" * 20,
                success_metric="saves", status="approved", origin="human")
        self.script = ScriptVersion.objects.create(content_item=self.item, version=1,
                                                   brief=brief, payload=motion_payload(),
                                                   status="approved", origin="human")

    def test_motion_reel_assembles_to_registry_profile(self):
        with mock.patch("apps.production.rendering.renderer.render", side_effect=fake_render):
            version = orchestration.prepare_version(self.item, self.script, previous=None)
            orchestration.run_frames(version)
            version.refresh_from_db()
            self.assertEqual(orchestration.run_assemble(version), "done")
        version.refresh_from_db()
        spec = formats.get_spec("reel", "video")
        final = version.final_asset
        self.assertEqual((final.width, final.height), (spec.width, spec.height))
        with asset_service.local_path(final) as path:
            info = assembly.probe(Path(path))
        self.assertEqual(info["video_codec"], "h264")
        self.assertEqual(info["audio_codec"], "aac")
        self.assertAlmostEqual(info["duration"], 20, delta=0.2)
        self.assertEqual(round(info["fps"]), 30)
        self.assertIsNotNone(version.cover_asset_id)
        # Same inputs: the assembly hash reuses the video (rule 14).
        first = final.pk
        result = assembly.assemble_motion(version)
        self.assertEqual(result["final_asset"].pk, first)

    def test_frame_duration_out_of_range(self):
        payload = motion_payload()
        payload["frames"][0]["duration_seconds"] = 12
        version = ContentVersion(content_item=self.item, version=9, frames=[
            {**f, "state": "rendered", "asset_id": 1} for f in payload["frames"]])
        with self.assertRaises(assembly.AssemblyError) as ctx:
            assembly.check_durations(version.frames, formats.get_spec("reel", "video"))
        self.assertEqual(ctx.exception.code, "duration_out_of_range")


@unittest.skipUnless(FFMPEG, "ffmpeg/ffprobe not available")
class FootageAndUploadTests(TestCase):
    def _clip(self, seconds=6, size="1920x1080") -> SimpleUploadedFile:
        tmp = Path(tempfile.mkdtemp()) / "clip.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                        f"testsrc=size={size}:rate=25:duration={seconds}", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", str(tmp)], check=True)
        return SimpleUploadedFile("clip.mp4", tmp.read_bytes(), content_type="video/mp4")

    def test_video_upload_is_probed_with_poster(self):
        item = make_item(format="reel")
        asset, duplicate = asset_service.upload(account=item.account, uploaded=self._clip(),
                                                role="clip")
        self.assertFalse(duplicate)
        self.assertEqual((asset.kind, asset.width, asset.height), ("video", 1920, 1080))
        self.assertAlmostEqual(asset.duration_ms, 6000, delta=100)
        self.assertEqual(asset.meta["probe"]["video_codec"], "h264")
        self.assertTrue(asset.thumbnail)

    def test_clip_state_padding_rules(self):
        clip = Asset(duration_ms=3600)
        self.assertEqual(assembly.clip_state(clip, 0, 4000)[0], "padded")
        self.assertEqual(assembly.clip_state(clip, 0, 5000)[0], "too_short")
        self.assertEqual(assembly.clip_state(clip, 0, 3000)[0], "ok")
