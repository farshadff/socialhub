"""FFmpeg assembly: motion videos (E06-S03), footage videos (E06-S04), normalising (E06-S03 r20).

Everything runs in a scratch directory on the render worker. Commands are built from the frame
list; tests assert on the output file, not on the command string.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import shutil
import subprocess
import tempfile
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from pathlib import Path

from apps.content import formats
from apps.content.models import Asset, ContentVersion
from apps.content.services import assets as asset_service

from . import rights

logger = logging.getLogger(__name__)

# --- Output profile (rule 4) --------------------------------------------------------------
FPS = 30
CRF = 20
CRF_RETRY = 24
MAXRATE = "8M"
BUFSIZE = "16M"
AUDIO_RATE = 44100
AUDIO_BITRATE = "128k"
ZOOM_AMOUNT = 0.04
TRANSITION_SECONDS = {"cut": 0.0, "fade": 0.4, "slide": 0.4}
CLOSING_HOLD = 0.5
OVERLAY_FADE = 0.2
FFMPEG_TIMEOUT = 600
MAX_PADDING_MS = 1000


class AssemblyError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail


def profile_name(spec: formats.FormatSpec) -> str:
    return f"{spec.format}_{spec.width}x{spec.height}_{FPS}"


def ffmpeg_version() -> str:
    try:
        out = subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=20, text=True)
        first = (out.stdout or "").splitlines()[0] if out.stdout else ""
        match = re.search(r"version (\S+)", first)
        return match.group(1) if match else "unknown"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return "unavailable"


def run_ffmpeg(args: list[str], *, total_seconds: float | None = None, progress=None) -> None:
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-v", "error", "-progress", "pipe:1"]
    cmd += args
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except FileNotFoundError:
        raise AssemblyError("assembly_failed", "ffmpeg is not installed") from None
    stderr_chunks = []
    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            if progress and total_seconds and line.startswith("out_time_ms="):
                try:
                    seconds = int(line.split("=", 1)[1]) / 1_000_000
                    progress(min(seconds, total_seconds), total_seconds)
                except ValueError:
                    pass
        _, err = proc.communicate(timeout=FFMPEG_TIMEOUT)
        stderr_chunks.append(err or "")
    except subprocess.TimeoutExpired:
        proc.kill()
        raise AssemblyError("assembly_failed", "FFmpeg took longer than ten minutes") from None
    if proc.returncode != 0:
        raise AssemblyError("assembly_failed", "".join(stderr_chunks)[-2000:])


def probe(path: Path) -> dict:
    data = asset_service.ffprobe(path)
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None) or {}
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fps = None
    if video.get("avg_frame_rate") and video["avg_frame_rate"] != "0/0":
        num, _, den = video["avg_frame_rate"].partition("/")
        try:
            fps = float(num) / float(den or 1)
        except (ValueError, ZeroDivisionError):
            fps = None
    try:
        duration = float((data.get("format") or {}).get("duration") or 0)
    except ValueError:
        duration = 0
    return {"width": video.get("width"), "height": video.get("height"),
            "video_codec": video.get("codec_name"), "pix_fmt": video.get("pix_fmt"),
            "audio_codec": audio.get("codec_name") if audio else None, "fps": fps,
            "duration": duration, "format": (data.get("format") or {}).get("format_name", "")}


def encode_args(crf: int) -> list[str]:
    return ["-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-crf", str(crf), "-maxrate", MAXRATE, "-bufsize", BUFSIZE,
            "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", str(AUDIO_RATE), "-ac", "2",
            "-movflags", "+faststart"]


def output_problems(info: dict, spec: formats.FormatSpec, size: int, *,
                    check_duration: bool = True) -> list[str]:
    problems = []
    if (info["width"], info["height"]) != (spec.width, spec.height):
        problems.append(f"size {info['width']}x{info['height']}")
    if info["video_codec"] != spec.video_codec:
        problems.append(f"video codec {info['video_codec']}")
    if info["pix_fmt"] != spec.pixel_format:
        problems.append(f"pixel format {info['pix_fmt']}")
    if info["audio_codec"] != spec.audio_codec:
        problems.append(f"audio codec {info['audio_codec']}")
    if info["fps"] is None or not spec.fps_min <= round(info["fps"]) <= spec.fps_max:
        problems.append(f"frame rate {info['fps']}")
    if check_duration and not spec.min_duration_s - 0.05 <= info["duration"] <= (
            spec.max_duration_s + 0.05):
        problems.append(f"duration {info['duration']:.1f} s")
    if size > spec.max_file_bytes:
        problems.append(f"{size} bytes")
    return problems


def _transition_name(transition: str, lang: str) -> str | None:
    if transition == "fade":
        return "fade"
    if transition == "slide":
        # The new frame enters from the reading-start side: from the right for fa (rule 6).
        return "slideleft" if lang == "fa" else "slideright"
    return None


def audio_inputs(music_path: Path | None, total: float) -> tuple[list[str], str]:
    """Input args and the audio filter chain producing [aout] (rules 9-10)."""
    if music_path is None:
        return (["-f", "lavfi", "-t", f"{total:.3f}", "-i",
                 f"anullsrc=channel_layout=stereo:sample_rate={AUDIO_RATE}"], "")
    fade_out_start = max(0.0, total - 1.0)
    chain = (f"atrim=0:{total:.3f},asetpts=N/SR/TB,loudnorm=I=-16:TP=-1.5:LRA=11,volume=-3dB,"
             f"afade=t=in:st=0:d=0.5,afade=t=out:st={fade_out_start:.3f}:d=1,"
             f"aformat=sample_rates={AUDIO_RATE}:channel_layouts=stereo")
    return ["-stream_loop", "-1", "-i", str(music_path)], chain


@dataclass
class Segment:
    path: Path  # a still image or a pre-built video segment
    kind: str  # "still" or "video"
    duration: float  # scripted duration
    transition_in: str  # how this segment enters
    zoom_in: bool = True
    hold_end: bool = False


def _join(segments: list[Segment], *, spec, lang: str, music_path: Path | None, out: Path,
          crf: int, progress=None) -> float:
    """Build stills/segments into one video with zoom and transitions (rules 5-8)."""
    total = sum(s.duration for s in segments)
    args: list[str] = []
    filters: list[str] = []
    W, H = spec.width, spec.height
    for i, seg in enumerate(segments):
        nxt = segments[i + 1] if i + 1 < len(segments) else None
        overlap = TRANSITION_SECONDS.get(nxt.transition_in, 0.0) if nxt else 0.0
        length = seg.duration + overlap
        n = max(1, int(round(length * FPS)))
        if seg.kind == "still":
            args += ["-i", str(seg.path)]
            moving = max(1, n - int(CLOSING_HOLD * FPS)) if seg.hold_end else n
            prog = f"min(on,{moving})/{moving}" if seg.hold_end else f"on/{n}"
            if ZOOM_AMOUNT == 0:
                zoom = "1"
            elif seg.zoom_in:
                zoom = f"1+{ZOOM_AMOUNT}*{prog}"
            else:
                zoom = f"{1 + ZOOM_AMOUNT}-{ZOOM_AMOUNT}*{prog}"
            filters.append(
                f"[{i}:v]scale={2 * W}:{2 * H},zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':"
                f"y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps={FPS},setsar=1,format=yuv420p,"
                f"trim=duration={length:.3f},setpts=PTS-STARTPTS[v{i}]")
        else:
            args += ["-i", str(seg.path)]
            filters.append(f"[{i}:v]fps={FPS},setsar=1,format=yuv420p,"
                           f"tpad=stop_mode=clone:stop_duration={length:.3f},"
                           f"trim=duration={length:.3f},setpts=PTS-STARTPTS[v{i}]")
    acc = "v0"
    elapsed = segments[0].duration
    for i in range(1, len(segments)):
        name = _transition_name(segments[i].transition_in, lang)
        out_label = f"x{i}"
        if name is None:
            filters.append(f"[{acc}][v{i}]concat=n=2:v=1:a=0[{out_label}]")
        else:
            dur = TRANSITION_SECONDS[segments[i].transition_in]
            filters.append(f"[{acc}][v{i}]xfade=transition={name}:duration={dur}:"
                           f"offset={elapsed:.3f}[{out_label}]")
        acc = out_label
        elapsed += segments[i].duration
    audio_args, audio_chain = audio_inputs(music_path, total)
    audio_index = len(segments)
    args += audio_args
    if audio_chain:
        filters.append(f"[{audio_index}:a]{audio_chain}[aout]")
        audio_map = "[aout]"
    else:
        audio_map = f"{audio_index}:a"
    run_ffmpeg(args + ["-filter_complex", ";".join(filters), "-map", f"[{acc}]",
                       "-map", audio_map] + encode_args(crf) + ["-t", f"{total:.3f}", str(out)],
               total_seconds=total, progress=progress)
    return total


def _encode_validated(build, spec, out: Path) -> dict:
    """Run `build(crf, out)`, probe and validate; one CRF 24 retry when too large (rule 15)."""
    build(CRF, out)
    info = probe(out)
    problems = output_problems(info, spec, out.stat().st_size)
    if problems and out.stat().st_size > spec.max_file_bytes:
        build(CRF_RETRY, out)
        info = probe(out)
        problems = output_problems(info, spec, out.stat().st_size)
    if problems:
        raise AssemblyError("output_invalid", "; ".join(problems))
    return info


@contextmanager
def _scratch(prefix: str):
    import os

    directory = Path(tempfile.mkdtemp(prefix=prefix, dir=os.environ.get("SOCIALHUB_WORK_DIR")
                                      or None))
    try:
        yield directory
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def _copy_asset(asset: Asset, dest: Path, stack: ExitStack) -> Path:
    src = stack.enter_context(asset_service.local_path(asset))
    shutil.copyfile(src, dest)
    return dest


def check_durations(frames: list[dict], spec) -> None:
    """Motion inputs (rule 2)."""
    if not 2 <= len(frames) <= 12 and not (len(frames) == 1 and spec.format == "story"):
        raise AssemblyError("duration_out_of_range",
                            f"A motion video needs 2 to 12 frames; this one has {len(frames)}.")
    for frame in frames:
        d = float(frame.get("duration_seconds") or 0)
        if not 1.5 <= d <= 10:
            raise AssemblyError("duration_out_of_range",
                                f"Frame {frame['index']} lasts {d:g} s; each frame needs "
                                "1.5–10 s.")
    total = sum(float(f.get("duration_seconds") or 0) for f in frames)
    if not spec.min_duration_s <= total <= spec.max_duration_s:
        raise AssemblyError("duration_out_of_range",
                            f"The video lasts {total:g} s; allowed {spec.min_duration_s:g}–"
                            f"{spec.max_duration_s:g} s.")


def motion_hash(version: ContentVersion, frame_assets: list[Asset], spec) -> str:
    music = version.music_asset
    data = {"frames": [a.checksum for a in frame_assets],
            "durations": [f.get("duration_seconds") for f in version.frames],
            "transitions": [f.get("transition") for f in version.frames],
            "music": music.checksum if music else "", "cover": version.cover_frame_index,
            "profile": profile_name(spec), "lang": version.content_item.account.content_language}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def _warnings_for_inputs(assets: list[Asset]) -> list[dict]:
    warnings = []
    for asset in assets:
        if asset.role in ("music", "clip") and asset_service.effective_rights(asset) != "cleared":
            warnings.append({"code": "rights_not_cleared", "asset_id": asset.pk,
                             "message": f"Rights are {asset_service.effective_rights(asset)}."})
    return warnings


def _store_final(version, path: Path, info: dict, spec, inputs: list[int], digest: str,
                 extra_meta=None) -> Asset:
    item = version.content_item
    status, expiry = rights.inherited_rights(inputs)
    meta = {"input_hash": digest, "inputs": inputs, "profile": profile_name(spec),
            "ffmpeg": ffmpeg_version(),
            "probe": {"video_codec": info["video_codec"], "audio_codec": info["audio_codec"],
                      "fps": info["fps"], "has_audio": info["audio_codec"] is not None}}
    meta.update(extra_meta or {})
    return asset_service.store_generated_file(
        path=path, account=item.account, content_item=item, kind="video", role="final",
        mime="video/mp4", ext="mp4", filename=f"item-{item.pk}-v{version.version}-final",
        origin="rendered", rights_status=status, rights_expires_at=expiry,
        width=info["width"], height=info["height"],
        duration_ms=int(round(info["duration"] * 1000)), meta=meta)


def store_cover_from_image(version, source: Asset) -> Asset:
    """Reel cover from a rendered frame PNG: JPEG q92 at the canvas size (rule 13)."""
    from PIL import Image

    item = version.content_item
    spec = formats.get_spec(item.format, item.media_kind)
    key = hashlib.sha256(f"cover:{source.checksum}".encode()).hexdigest()
    existing = Asset.objects.filter(content_item=item, role="cover",
                                    meta__input_hash=key).order_by("-pk").first()
    if existing is not None:
        return existing
    with source.file.open("rb") as fh:
        image = Image.open(io.BytesIO(fh.read())).convert("RGB")
    if image.size != (spec.width, spec.height):
        image = image.resize((spec.width, spec.height), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=92, optimize=True)
    status, expiry = rights.inherited_rights([source.pk])
    return asset_service.store_generated(
        account=item.account, content_item=item, kind="image", role="cover", data=out.getvalue(),
        mime="image/jpeg", ext="jpg", filename=f"item-{item.pk}-v{version.version}-cover",
        origin="rendered", rights_status=status, rights_expires_at=expiry, width=spec.width,
        height=spec.height, meta={"input_hash": key, "inputs": [source.pk]})


def store_cover_from_video(version, video: Asset, at_seconds: float) -> Asset:
    item = version.content_item
    spec = formats.get_spec(item.format, item.media_kind)
    key = hashlib.sha256(f"cover:{video.checksum}:{at_seconds:.2f}".encode()).hexdigest()
    existing = Asset.objects.filter(content_item=item, role="cover",
                                    meta__input_hash=key).order_by("-pk").first()
    if existing is not None:
        return existing
    with ExitStack() as stack, _scratch("socialhub-cover-") as tmp:
        src = stack.enter_context(asset_service.local_path(video))
        target = tmp / "cover.jpg"
        run_ffmpeg(["-ss", f"{at_seconds:.3f}", "-i", str(src), "-frames:v", "1", "-vf",
                    f"scale={spec.width}:{spec.height}:force_original_aspect_ratio=increase,"
                    f"crop={spec.width}:{spec.height}", "-q:v", "2", str(target)])
        data = target.read_bytes()
    status, expiry = rights.inherited_rights([video.pk])
    return asset_service.store_generated(
        account=item.account, content_item=item, kind="image", role="cover", data=data,
        mime="image/jpeg", ext="jpg", filename=f"item-{item.pk}-v{version.version}-cover",
        origin="rendered", rights_status=status, rights_expires_at=expiry, width=spec.width,
        height=spec.height, meta={"input_hash": key, "inputs": [video.pk]})


# --- Motion (E06-S03) ---------------------------------------------------------------------

def assemble_motion(version: ContentVersion, *, progress=None) -> dict:
    item = version.content_item
    spec = formats.get_spec(item.format, item.media_kind)
    frames = sorted(version.frames, key=lambda f: f["index"])
    if any(f.get("state") != "rendered" or not f.get("asset_id") for f in frames):
        raise AssemblyError("frames_not_ready", "Every frame must be rendered first.")
    check_durations(frames, spec)
    frame_assets = [Asset.objects.get(pk=f["asset_id"]) for f in frames]
    digest = motion_hash(version, frame_assets, spec)
    inputs = [a.pk for a in frame_assets] + ([version.music_asset_id]
                                            if version.music_asset_id else [])
    warnings = _warnings_for_inputs([version.music_asset] if version.music_asset else [])
    existing = Asset.objects.filter(content_item=item, role="final", kind="video",
                                    meta__input_hash=digest).order_by("-pk").first()
    if existing is None:
        lang = item.account.content_language
        with ExitStack() as stack, _scratch("socialhub-motion-") as tmp:
            segments = []
            for n, (frame, asset) in enumerate(zip(frames, frame_assets)):
                path = _copy_asset(asset, tmp / f"frame{n + 1}.png", stack)
                segments.append(Segment(path=path, kind="still",
                                        duration=float(frame["duration_seconds"]),
                                        transition_in=frame.get("transition") or "cut",
                                        zoom_in=(n % 2 == 0), hold_end=(n == len(frames) - 1)))
            music_path = None
            if version.music_asset:
                music_path = _copy_asset(version.music_asset,
                                         tmp / f"music{Path(version.music_asset.file.name).suffix}",
                                         stack)
            out = tmp / "out.mp4"

            def build(crf, target):
                _join(segments, spec=spec, lang=lang, music_path=music_path, out=target, crf=crf,
                      progress=progress)

            info = _encode_validated(build, spec, out)
            existing = _store_final(version, out, info, spec, inputs, digest)
    result = {"final_asset": existing, "cover_asset": None, "warnings": warnings}
    if spec.cover_required:
        index = version.cover_frame_index or frames[0]["index"]
        cover_frame = next((f for f in frames if f["index"] == index), frames[0])
        result["cover_asset"] = store_cover_from_image(
            version, Asset.objects.get(pk=cover_frame["asset_id"]))
    return result


# --- Footage (E06-S04) --------------------------------------------------------------------

def shots_of(version: ContentVersion) -> list[dict]:
    if version.script is None:
        return []
    return sorted((version.script.payload or {}).get("shots") or [], key=lambda s: s["index"])


def footage_shots(version: ContentVersion) -> list[int]:
    return [s["index"] for s in shots_of(version) if s.get("type") == "footage"]


def missing_shots(version: ContentVersion) -> list[int]:
    mapped = {c.get("shot_index") for c in version.clips or []}
    return [i for i in footage_shots(version) if i not in mapped]


def clip_state(clip_asset: Asset, start_ms: int, shot_ms: int) -> tuple[str, int]:
    usable = (clip_asset.duration_ms or 0) - start_ms
    if usable >= shot_ms:
        return "ok", usable
    if shot_ms - usable <= MAX_PADDING_MS:
        return "padded", usable
    return "too_short", usable


def footage_hash(version, spec, shots, clip_assets, frame_assets) -> str:
    music = version.music_asset
    data = {"shots": [[s["index"], s["type"], s["duration_seconds"]] for s in shots],
            "clips": {str(k): [a.checksum, start] for k, (a, start) in clip_assets.items()},
            "frames": [[f["index"], f.get("shot_index"), a.checksum if a else "",
                        f.get("duration_seconds"), f.get("transition")]
                       for f, a in frame_assets],
            "music": music.checksum if music else "", "cover": version.cover_frame_index,
            "profile": profile_name(spec), "lang": version.content_item.account.content_language}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def _build_footage_segment(tmp: Path, n: int, clip_path: Path, start_ms: int, length: float,
                           overlays: list[tuple[Path, float, float]], spec, crf: int) -> Path:
    W, H = spec.width, spec.height
    args = ["-ss", f"{start_ms / 1000:.3f}", "-t", f"{length:.3f}", "-i", str(clip_path)]
    filters = [f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
               f"fps={FPS},setsar=1,tpad=stop_mode=clone:stop_duration={length:.3f},"
               f"trim=duration={length:.3f},setpts=PTS-STARTPTS[base0]"]
    label = "base0"
    for k, (png, start, end) in enumerate(overlays, start=1):
        args += ["-loop", "1", "-t", f"{length:.3f}", "-i", str(png)]
        fade_out = max(start, end - OVERLAY_FADE)
        filters.append(f"[{k}:v]format=rgba,fade=t=in:st={start:.3f}:d={OVERLAY_FADE}:alpha=1,"
                       f"fade=t=out:st={fade_out:.3f}:d={OVERLAY_FADE}:alpha=1[ov{k}]")
        filters.append(f"[{label}][ov{k}]overlay=0:0:enable='between(t,{start:.3f},{end:.3f})'"
                       f"[base{k}]")
        label = f"base{k}"
    out = tmp / f"segment{n}.mp4"
    run_ffmpeg(args + ["-filter_complex", ";".join(filters), "-map", f"[{label}]", "-an",
                       "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(max(crf - 4, 14)),
                       "-r", str(FPS), str(out)])
    return out


def _build_graphic_segment(tmp: Path, n: int, frames: list[tuple[dict, Path]], length: float,
                           spec, lang: str, crf: int) -> Path:
    out = tmp / f"segment{n}.mp4"
    segments = []
    remaining = length
    for j, (frame, png) in enumerate(frames):
        d = float(frame.get("duration_seconds") or 0)
        if j == len(frames) - 1:
            d = max(d, remaining)
        d = min(d, remaining)
        remaining -= d
        if d <= 0:
            break
        segments.append(Segment(path=png, kind="still", duration=d,
                                transition_in="cut" if j == 0 else frame.get("transition", "cut"),
                                zoom_in=(j % 2 == 0)))
    _join(segments, spec=spec, lang=lang, music_path=None, out=out, crf=max(crf - 4, 14))
    return out


def assemble_footage(version: ContentVersion, *, progress=None) -> dict:
    item = version.content_item
    spec = formats.get_spec(item.format, item.media_kind)
    shots = shots_of(version)
    missing = missing_shots(version)
    if missing:
        raise AssemblyError("frames_not_ready",
                            "Waiting for footage for shot(s) "
                            + ", ".join(str(i) for i in missing) + ".")
    frames = sorted(version.frames, key=lambda f: f["index"])
    by_shot: dict[int, list[dict]] = {}
    for frame in frames:
        by_shot.setdefault(frame.get("shot_index"), []).append(frame)
        if frame.get("state") != "rendered" or not frame.get("asset_id"):
            raise AssemblyError("frames_not_ready", f"Frame {frame['index']} is not rendered.")
    for shot in shots:
        if shot["type"] != "footage" and not by_shot.get(shot["index"]):
            raise AssemblyError("frames_not_ready", f"Shot {shot['index']} has no frame.")
    total = sum(float(s["duration_seconds"]) for s in shots)
    if not spec.min_duration_s <= total <= spec.max_duration_s:
        raise AssemblyError("duration_out_of_range",
                            f"The video lasts {total:g} s; allowed {spec.min_duration_s:g}–"
                            f"{spec.max_duration_s:g} s.")
    clips = {c["shot_index"]: c for c in version.clips or []}
    clip_assets = {k: (Asset.objects.get(pk=c["asset_id"]), int(c.get("start_ms") or 0))
                   for k, c in clips.items()}
    frame_assets = [(f, Asset.objects.get(pk=f["asset_id"])) for f in frames]
    digest = footage_hash(version, spec, shots, clip_assets, frame_assets)
    inputs = [a.pk for a, _ in clip_assets.values()] + [a.pk for _, a in frame_assets] + (
        [version.music_asset_id] if version.music_asset_id else [])
    warnings = _warnings_for_inputs([a for a, _ in clip_assets.values()] + (
        [version.music_asset] if version.music_asset else []))
    for shot_index, (asset, start_ms) in clip_assets.items():
        shot = next(s for s in shots if s["index"] == shot_index)
        state, usable = clip_state(asset, start_ms, int(shot["duration_seconds"] * 1000))
        if state == "padded":
            gap = (shot["duration_seconds"] * 1000 - usable) / 1000
            warnings.append({"code": "clip_padded", "shot_index": shot_index,
                             "message": f"Last frame held for {gap:.1f} s."})
        if asset.width and asset.height:
            kept = min(1.0, (asset.height * spec.width / spec.height) / asset.width)
            if kept < 0.5:
                warnings.append({"code": "clip_cropped_heavily", "shot_index": shot_index,
                                 "message": "Landscape clip cropped to vertical."})
            if min(asset.width, asset.height) < 720:
                warnings.append({"code": "clip_low_resolution", "shot_index": shot_index,
                                 "message": "The clip is smaller than 720 px."})
    existing = Asset.objects.filter(content_item=item, role="final", kind="video",
                                    meta__input_hash=digest).order_by("-pk").first()
    if existing is None:
        lang = item.account.content_language
        with ExitStack() as stack, _scratch("socialhub-footage-") as tmp:
            def build(crf, target):
                segments = []
                for n, shot in enumerate(shots):
                    nxt = shots[n + 1] if n + 1 < len(shots) else None
                    nxt_transition = (by_shot.get(nxt["index"]) or [{}])[0].get(
                        "transition", "cut") if nxt else "cut"
                    overlap = TRANSITION_SECONDS.get(nxt_transition, 0.0) if nxt else 0.0
                    length = float(shot["duration_seconds"]) + overlap
                    shot_frames = []
                    for frame in by_shot.get(shot["index"], []):
                        asset = next(a for f, a in frame_assets if f["index"] == frame["index"])
                        png = tmp / f"f{frame['index']}.png"
                        if not png.exists():
                            _copy_asset(asset, png, stack)
                        shot_frames.append((frame, png))
                    if shot["type"] == "footage":
                        asset, start_ms = clip_assets[shot["index"]]
                        src = tmp / f"clip{shot['index']}{Path(asset.file.name).suffix}"
                        if not src.exists():
                            _copy_asset(asset, src, stack)
                        overlays, t = [], 0.0
                        for frame, png in shot_frames:
                            d = float(frame.get("duration_seconds") or 0)
                            start, end = t, min(t + d, float(shot["duration_seconds"]))
                            if end > start:
                                overlays.append((png, start, end))
                            t += d
                        seg_path = _build_footage_segment(tmp, n, src, start_ms, length,
                                                          overlays, spec, crf)
                    else:
                        seg_path = _build_graphic_segment(tmp, n, shot_frames, length, spec,
                                                          lang, crf)
                    first = (by_shot.get(shot["index"]) or [{}])[0]
                    segments.append(Segment(path=seg_path, kind="video",
                                            duration=float(shot["duration_seconds"]),
                                            transition_in=first.get("transition", "cut")
                                            if n else "cut"))
                music_path = None
                if version.music_asset:
                    music_path = tmp / f"music{Path(version.music_asset.file.name).suffix}"
                    if not music_path.exists():
                        _copy_asset(version.music_asset, music_path, stack)
                _join(segments, spec=spec, lang=lang, music_path=music_path, out=target,
                      crf=crf, progress=progress)

            out = tmp / "out.mp4"
            info = _encode_validated(build, spec, out)
            existing = _store_final(version, out, info, spec, inputs, digest)
    result = {"final_asset": existing, "cover_asset": None, "warnings": warnings}
    if spec.cover_required:
        at = 1.0
        if frames:
            index = version.cover_frame_index or frames[0]["index"]
            target_frame = next((f for f in frames if f["index"] == index), frames[0])
            shot_start = 0.0
            for shot in shots:
                if shot["index"] == target_frame.get("shot_index"):
                    break
                shot_start += float(shot["duration_seconds"])
            offset = 0.0
            for frame in by_shot.get(target_frame.get("shot_index"), []):
                if frame["index"] == target_frame["index"]:
                    break
                offset += float(frame.get("duration_seconds") or 0)
            at = shot_start + offset + 0.5
        result["cover_asset"] = store_cover_from_video(version, existing, at)
    return result


# --- Normalising a finished file (E06-S03 rules 20-21) ------------------------------------

def normalise_media(asset: Asset, spec: formats.FormatSpec) -> Asset:
    profile = profile_name(spec)
    key = hashlib.sha256(f"normalise:{asset.checksum}:{profile}".encode()).hexdigest()
    existing = Asset.objects.filter(account=asset.account, meta__input_hash=key).first()
    if existing is not None:
        return existing
    item = asset.content_item
    W, H = spec.width, spec.height
    status, expiry = rights.inherited_rights([asset.pk])
    meta = {"input_hash": key, "inputs": [asset.pk], "profile": profile,
            "ffmpeg": ffmpeg_version(), "normalised_from": asset.pk}
    if asset.kind == "image":
        from PIL import Image, ImageOps

        with asset.file.open("rb") as fh:
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(fh.read()))).convert("RGB")
        scale = max(W / image.width, H / image.height)
        image = image.resize((round(image.width * scale), round(image.height * scale)),
                             Image.LANCZOS)
        left, top = (image.width - W) // 2, (image.height - H) // 2
        image = image.crop((left, top, left + W, top + H))
        out = io.BytesIO()
        image.save(out, "JPEG", quality=92, optimize=True)
        return asset_service.store_generated(
            account=asset.account, content_item=item, kind="image", role=asset.role,
            data=out.getvalue(), mime="image/jpeg", ext="jpg",
            filename=f"{Path(asset.original_filename or 'file').stem}-normalised",
            origin="rendered", rights_status=status, rights_expires_at=expiry, width=W,
            height=H, meta=meta)
    duration = (asset.duration_ms or 0) / 1000
    if spec.min_duration_s and not spec.min_duration_s <= duration <= spec.max_duration_s:
        raise AssemblyError("duration_out_of_range",
                            f"{duration:.0f} s; allowed {spec.min_duration_s:g}–"
                            f"{spec.max_duration_s:g} s")
    aspect = (asset.width or W) / (asset.height or H)
    off = abs(aspect - W / H) / (W / H) > spec.aspect_tolerance
    vf = (f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2"
          if off else f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}")
    vf += f",fps={FPS},setsar=1,format=yuv420p"
    has_audio = bool((asset.meta or {}).get("probe", {}).get("has_audio"))
    with ExitStack() as stack, _scratch("socialhub-normalise-") as tmp:
        src = stack.enter_context(asset_service.local_path(asset))
        out = tmp / "out.mp4"

        def build(crf, target):
            args = ["-i", str(src)]
            if not has_audio:
                args += ["-f", "lavfi", "-t", f"{duration:.3f}", "-i",
                         f"anullsrc=channel_layout=stereo:sample_rate={AUDIO_RATE}"]
            run_ffmpeg(args + ["-vf", vf, "-map", "0:v:0", "-map", "1:a:0" if not has_audio
                               else "0:a:0"] + encode_args(crf) + ["-t", f"{duration:.3f}",
                                                                   str(target)])

        info = _encode_validated(build, spec, out)
        return asset_service.store_generated_file(
            path=out, account=asset.account, content_item=item, kind="video", role=asset.role,
            mime="video/mp4", ext="mp4",
            filename=f"{Path(asset.original_filename or 'file').stem}-normalised",
            origin="rendered", rights_status=status, rights_expires_at=expiry, width=W, height=H,
            duration_ms=int(round(info["duration"] * 1000)), meta=meta)
