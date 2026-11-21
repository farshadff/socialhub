# E06-S03 — Motion video assembly

| | |
| --- | --- |
| Epic | E06 Assets and copy |
| Priority | Must |
| Estimate | BE 3.5 d · FE 0 d |
| Depends on | E04-S01, E06-S01, E06-S02 |
| Needed by | E06-S04, E06-S07, E07-S02, E08-S03 |

## User story

As an operator, I want the frames of a script turned into a vertical video with gentle movement, transitions and optional music, so that a reel or video story can be produced without filming or editing.

## Context

This is the "motion" in "create video, motion, or design". E06-S02 renders each script frame to a 1080 × 1920 PNG. This story animates each still (a slow zoom), joins them with the transitions named in the script, adds an audio track, and writes one MP4 that meets the format registry's rules for reels and video stories. It also produces the reel cover image.

It applies to items with `production_mode = motion` (formats `reel` and `story` with `media_kind = video`). The panel controls that use it are part of E06-S07.

## Scope

**In**

- FFmpeg assembly of rendered frames into an MP4.
- Slow zoom per frame; `cut`, `fade` and `slide` transitions.
- Optional music from the library, trimmed, faded and mixed at a fixed level; a silent track when there is none.
- Reel cover image from a chosen frame.
- `PATCH /content-items/{id}/production/` to set music and cover frame.
- Output validation against the format registry.

**Out (later)**

- Voiceover, text-to-speech, subtitles from audio, beat-synced cuts.
- Per-element animation inside a frame (text reveals, moving shapes).
- More transition types, speed ramps, custom zoom direction per frame.

## Behaviour and rules

### Inputs

1. Assembly reads the current draft `ContentVersion`: its `frames` (in `index` order), `music_asset` and `cover_frame_index`. Every frame must be in state `rendered`; otherwise the task fails with `frames_not_ready` (the orchestrator in E06-S07 always renders first).
2. **Frame count and durations.** A motion video has 2 to 12 frames. Each frame's `duration_seconds` must be between 1.5 and 10. Total duration is the sum of frame durations and must fall inside the format registry's video duration range for the item's format (for stories at most 60 s). A violation fails the task with `duration_out_of_range` and a message naming the total and the allowed range; nothing is trimmed silently.
3. Frame durations and transitions come from the version's frame entries, which were copied from the approved script and may have been overridden in the frame editor (E06-S07).

### Picture

4. **Output format.** MP4 container, H.264 video (High profile, `yuv420p`, constant 30 fps, square pixels), 1080 × 1920, `+faststart`. Quality is CRF 20 with a maximum bitrate of 8 Mbit/s. AAC stereo audio, 44.1 kHz, 128 kbit/s. These values are defaults in `production/assembly/profile.py`; the format registry's limits (maximum bytes, codecs) are checked after encoding.
5. **Slow zoom.** Each still is scaled up 2× before the zoom filter (to avoid stepping artefacts), then zoomed linearly from 100% to 104% over its duration, centred. Odd-numbered frames zoom in, even-numbered frames zoom out (104% → 100%), so consecutive frames do not all drift the same way. Zoom strength is one constant (`ZOOM_AMOUNT = 0.04`); `0` disables it.
6. **Transitions.** `frames[n].transition` describes how frame n enters. The first frame's value is ignored.

   | Value | Effect | Duration |
   | --- | --- | --- |
   | `cut` | Hard cut | 0 s |
   | `fade` | Cross-fade | 0.4 s |
   | `slide` | The new frame pushes in from the reading-start side: from the right for `fa`, from the left for `en` | 0.4 s |

7. **Timing with overlaps.** A cross-fade or slide overlaps two clips. To keep the total equal to the sum of frame durations, each clip is generated longer by the duration of the transition that follows it. Frame n therefore starts to enter exactly at the sum of the durations before it, and its incoming transition happens inside its own time slot. The previous frame is shown in full for its whole scripted duration, which keeps script timing and (later) audio cues aligned.
8. **Closing hold.** The last frame holds without zoom for its final 0.5 s so the video does not end mid-movement.

### Audio

9. **No music.** A silent stereo AAC track of the full duration is added. Instagram accepts silent video, but some players and checks treat a missing audio stream as an error.
10. **Music.** When `music_asset` is set (an `Asset` with `kind = audio`, `role = music`, same account):
    - it starts at its beginning and is trimmed to the video duration;
    - if it is shorter than the video it is looped;
    - fade in 0.5 s, fade out 1.0 s;
    - level is normalized to −16 LUFS integrated, then reduced by 3 dB.
11. Music whose effective `rights_status` is not `cleared` is still used, with the render warning `rights_not_cleared` (the rights check in E07-S02 decides the outcome).

### Outputs

12. **Final asset.** Stored as `Asset` with `kind = video`, `role = final`, `origin = rendered`, probed like an upload (E06-S01 rule 3). `meta = {"input_hash", "inputs": [frame asset ids…, music asset id], "profile": "reel_1080x1920_30", "ffmpeg": "<version>"}`. Rights follow the inputs (E06-S01 rule 9). `ContentVersion.final_asset` is set.
13. **Cover.** For reels, the cover is the rendered PNG of frame `cover_frame_index` (default: the first frame) exported as JPEG quality 92 at 1080 × 1920, stored with `role = cover`, and set as `ContentVersion.cover_asset`. Video stories have no cover.
14. **Assembly hash.** `sha256(ordered frame asset checksums, durations, transitions, music checksum, cover frame index, profile, content language)`. If a `final` asset with that hash already exists for the content item, it is reused and FFmpeg does not run.
15. **Validation.** After encoding, the file is probed and checked against the format registry: dimensions, frame rate, codecs, duration range, maximum bytes. If the file is too large, one re-encode is tried at CRF 24; if it still fails, the task fails with `output_invalid`.
16. **Status.** While the task runs `render_status = rendering`. On success it is `ready`. On failure it is `failed`, frames keep their state, and the previous final asset (if any) is detached from the version so a stale video cannot be submitted.
17. **Old outputs.** When a new final asset replaces an older one on the same draft version, the older asset is deleted if no other version references it.

### Music and cover selection

18. `music_asset` and `cover_frame_index` are properties of the draft version and can be changed while it is `draft` and the item is `in_production`. Changing either marks the final asset stale: `render_status` becomes `pending` until the video is reassembled (`POST …/production/render/` with `frames: []` and `reassemble: true`, or any render call).
19. Music can be set on `motion` and `video` items only; `cover_frame_index` on reels only. Other combinations return `400 validation_error`.

### Normalising a finished file

20. **Service.** `production.services.media.normalise_media(asset, format_spec) -> Asset` makes an existing file conform to the format registry using the same profile as rule 4. It is used by the revise loop (E07-S05) for auto-fixable `format.*` findings on a manual upload (E06-S07), and runs on the `render` queue inside the calling job.
    - **Video:** scale to cover and centre-crop to the registry size (or pad with black when the source aspect ratio is off by more than the registry's `aspect_tolerance`), constant 30 fps, H.264 `yuv420p`, AAC stereo; a silent track is added when the source has no audio; CRF 20 with the 8 Mbit/s cap, one re-encode at CRF 24 when the file is still over `max_file_bytes`.
    - **Image:** convert to JPEG quality 92, sRGB, no alpha, metadata stripped; scale to cover and centre-crop to the registry size.
    - Durations are never changed: a duration outside the registry range cannot be normalised and raises `duration_out_of_range`.
21. The output is a new `Asset` with `origin = rendered`, `role` copied from the source (`final` or `cover`), `meta = {"inputs": [source asset id], "profile", "ffmpeg", "normalised_from": source asset id}`, rights inherited from the source (E06-S01 rule 9). The source asset is kept. The same source and profile produce the same output (keyed by source checksum and profile), so a repeated call reuses the earlier result.

## Data

Uses `ContentVersion` and `Asset` from [DATA-MODEL.md](../../DATA-MODEL.md) and the frame entry shape defined in E06-S02.

New fields on `ContentVersion`:

| Field | Type | Notes |
| --- | --- | --- |
| `music_asset` | FK Asset, null | Audio used by assembly |
| `cover_frame_index` | int, null | Frame used as the reel cover; null means the first frame |

New render warning code: `rights_not_cleared` (shared with E06-S02) may point at the music (`{"code": "rights_not_cleared", "asset_id": 318}`).

Job error codes introduced here (text values in `JobRun.error_code`): `frames_not_ready`, `duration_out_of_range`, `assembly_failed`, `output_invalid`.

## API

### `PATCH /api/v1/content-items/{id}/production/`

New endpoint. Signed-in user. Changes version-level production settings on the draft.

Request:

```json
{
  "base_version": 1,
  "music_asset_id": 318,
  "cover_frame_index": 2
}
```

Either field may be omitted. `music_asset_id: null` removes the music.

Response `200`: the production resource (full shape in E06-S07), abbreviated here:

```json
{
  "content_item": 42,
  "version": 1,
  "latest_version": 1,
  "status": "draft",
  "render_status": "pending",
  "production_mode": "motion",
  "music_asset": {
    "id": 318, "kind": "audio", "original_filename": "calm-loop.m4a",
    "duration_ms": 92000, "rights_status": "cleared", "url": "…"
  },
  "cover_frame_index": 2,
  "final_asset": null,
  "render_warnings": []
}
```

Errors:

| Case | Status and code |
| --- | --- |
| Item not `in_production`, or no draft version | `409 invalid_transition` |
| `base_version` is not the current version | `409 version_conflict` |
| Active job on the item | `409 job_in_progress` |
| Asset is not audio, not role `music`, or from another account | `400 validation_error` on `music_asset_id` |
| `cover_frame_index` is not an existing frame, or the item is not a reel | `400 validation_error` on `cover_frame_index` |
| Music on a `design` item | `400 validation_error` on `music_asset_id` |

### Reassembly

Reassembly uses `POST /api/v1/content-items/{id}/production/render/` defined in E06-S02. For a motion item its job runs frame rendering first (only what is not up to date) and then this story's assembly task. To rebuild only the video after changing music or the cover:

```json
{"base_version": 1, "frames": [], "reassemble": true}
```

The job `result` then looks like:

```json
{
  "content_version": 1,
  "rendered_frames": [],
  "reused_frames": [1, 2, 3, 4, 5],
  "final_asset": 845,
  "cover_asset": 846,
  "duration_ms": 22000,
  "bytes": 6412233,
  "warnings": 0
}
```

## Background work

| Task | Queue | Notes |
| --- | --- | --- |
| `production.tasks.assemble_motion(job_id, version_id)` | `render` | Builds and runs the FFmpeg command, probes and validates the output, stores assets |

- **Working directory.** Frame PNGs and music are downloaded from storage to a temporary directory on the worker, FFmpeg writes there, and the result is uploaded. The directory is removed in a `finally` block.
- **Progress.** FFmpeg runs with `-progress pipe:1`; the task maps encoded time to job progress and sets the message "Assembling video (12 s of 22 s)".
- **Idempotency.** The assembly hash (rule 14) makes a repeated task a no-op.
- **Timeout.** Ten minutes of wall time; a longer run is killed and counts as transient.
- **Retries.** Storage errors and timeouts retry up to three times (backoff 15 s, 60 s, 180 s). A non-zero FFmpeg exit is retried once; the last 2,000 characters of its error output are kept in `JobRun.error_detail` (never shown to operators verbatim; the panel shows "The video could not be assembled").
- **Failure.** Job `failed` with `assembly_failed` (or the specific code from the rules), `render_status = failed`, `active_job` cleared, `job_failed` content event.

### FFmpeg outline

For three frames lasting 4, 5 and 4 seconds with a fade into frame 2 and a slide into frame 3 (Persian account), with music. Clip lengths include the following transition's overlap (rule 7): 4.4 s, 5.4 s, 4.0 s.

```text
ffmpeg -y \
  -i frame1.png -i frame2.png -i frame3.png \
  -stream_loop -1 -i music.m4a \
  -filter_complex "
    [0:v]scale=2160:3840,zoompan=z='1+0.04*on/132':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=132:s=1080x1920:fps=30,setsar=1,format=yuv420p[v0];
    [1:v]scale=2160:3840,zoompan=z='1.04-0.04*on/162':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=162:s=1080x1920:fps=30,setsar=1,format=yuv420p[v1];
    [2:v]scale=2160:3840,zoompan=z='1+0.04*min(on,105)/105':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=1080x1920:fps=30,setsar=1,format=yuv420p[v2];
    [v0][v1]xfade=transition=fade:duration=0.4:offset=4.0[x1];
    [x1][v2]xfade=transition=slideright:duration=0.4:offset=9.0[vout];
    [3:a]atrim=0:13,asetpts=N/SR/TB,loudnorm=I=-16:TP=-1.5:LRA=11,volume=-3dB,
         afade=t=in:st=0:d=0.5,afade=t=out:st=12:d=1[aout]
  " \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -r 30 -crf 20 -maxrate 8M -bufsize 16M \
  -c:a aac -b:a 128k -ar 44100 -ac 2 \
  -t 13 -movflags +faststart out.mp4
```

Notes for the implementer:

- This is an outline of the filter graph, not a tested command. The builder in `production/assembly/motion.py` generates it from the frame list, and the tests assert on the output file, not on the command string.
- `d` is the clip length in frames (seconds × 30). The xfade `offset` for transition n is the sum of the frame durations before frame n.
- `cut` boundaries have no overlap; the builder joins those segments with the `concat` filter instead of `xfade`.
- The slide direction for `en` is `slideleft`.
- Without music, replace the audio input with `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100` and drop the audio filters.
- `loudnorm` in single-pass mode is good enough for background music.

## AI

None.

## Panel

None in this story. The Production tab (E06-S07) contains the Music card (uses `AssetPicker` with `kind=audio`, `role=music`), the cover selection on the frame list, and the Re-render action; those subtasks are estimated there.

## Acceptance criteria

1. Given a reel with five rendered frames totalling 22 seconds and no music, when assembly runs, then the final asset is an MP4 of 1080 × 1920, 30 fps, H.264 `yuv420p` with an AAC track, lasting 22.0 s ± 0.1 s.
2. Given the same version assembled twice, then FFmpeg runs once and the second job reports the existing final asset.
3. Given frame 1 lasts 4 seconds and frame 2 has `transition = fade`, then the output shows only frame 1 until 4.0 s, the fade runs from 4.0 s to 4.4 s, frame 2 is shown alone from 4.4 s, and the total duration is still the sum of the frame durations.
4. Given a Persian account and a `slide` transition, then the new frame enters from the right; for an English account it enters from the left.
5. Given a 9-second music asset and a 22-second video, then the audio lasts the whole video, fades in and out, and has no gap where the loop restarts longer than one frame.
6. Given no music, then the file still has a silent audio stream.
7. Given a reel with `cover_frame_index = 2`, then `cover_asset` is a 1080 × 1920 JPEG identical in content to frame 2's render.
8. Given a video story, then no cover asset is created.
9. Given frames totalling 75 seconds on a story, then the job fails with `duration_out_of_range`, `render_status` is `failed`, and no final asset is attached.
10. Given one frame is `stale`, when assembly is called directly, then it fails with `frames_not_ready`.
11. Given I PATCH a new music asset, then `render_status` becomes `pending`, and after `render` with `frames: []` a new final asset replaces the old one and the old file is deleted.
12. Given a music asset whose rights are `unknown`, then assembly succeeds and the version has the warning `rights_not_cleared` pointing at that asset.
13. Given the encoded file exceeds the format's maximum size at CRF 20, then one re-encode at CRF 24 is attempted before the job can fail with `output_invalid`.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S03-BE1 | Encoding profile, FFmpeg runner and normalise service | `production/assembly/profile.py`, `production/assembly/ffmpeg.py`: run with progress parsing, timeout, error capture, version detection. `production/services/media.py` `normalise_media` (rules 20–21) reusing the profile, with Pillow for images. | 0.5 d |
| E06-S03-BE2 | Video filter-graph builder | `production/assembly/motion.py`: clip lengths with overlaps, zoom in/out alternation, closing hold, `xfade` and `concat` chaining, slide direction by language. Unit tests on computed offsets. | 1 d |
| E06-S03-BE3 | Audio builder | Silent track, music loop, trim, loudness, fades. | 0.5 d |
| E06-S03-BE4 | Assembly task | Download inputs, assembly hash and reuse, run, probe, validate against the format registry with the one re-encode, store final asset with inherited rights, replace and clean old outputs, status and warnings, retries. | 0.75 d |
| E06-S03-BE5 | Cover export | JPEG from the chosen frame, `cover_asset`, rules for reel versus story. | 0.25 d |
| E06-S03-BE6 | Settings endpoint | Migration for `music_asset` and `cover_frame_index`; `PATCH /content-items/{id}/production/` with validation and stale marking; hook assembly into the `production.render` job; `openapi.yaml`. | 0.5 d |

### Frontend

None.

### Test

None beyond the tests inside each subtask.

## Test notes

- Tests that run FFmpeg are marked for the render image, like the renderer tests in E06-S02.
- **Fixtures:** three solid-colour 1080 × 1920 PNGs with a large frame number drawn on them; a 3-second sine-tone M4A.
- **Timing test:** assemble the fixtures with known durations, extract one output frame just before and just after each boundary with FFmpeg, and assert the dominant colour — this proves offsets and overlaps without comparing whole videos.
- **Probe assertions:** dimensions, fps, codecs, pixel format, duration tolerance, presence of an audio stream, `faststart` (moov atom before mdat).
- **Unit:** offset arithmetic for mixed `cut`/`fade`/`slide` sequences; duration validation; assembly hash changes when any input changes.
- **Normalise:** a 1280 × 720 H.264 clip without audio becomes 1080 × 1920 with an audio stream; a PNG with alpha becomes an opaque JPEG at the registry size; a repeated call returns the same asset; a 120-second video raises `duration_out_of_range`.
- **API:** every row of the PATCH error table; stale marking.

## Later

- Voiceover and subtitles: add a second audio input and a subtitle overlay step; the mixer already has one place for audio.
- Animated frames: replace `zoompan` on stills with captured frame sequences for templates that define animations.
- Encoding on a GPU or a larger worker: only the profile and the queue routing change.
