# E06-S04 — Footage-based video assembly

| | |
| --- | --- |
| Epic | E06 Assets and copy |
| Priority | Should |
| Estimate | BE 2.5 d · FE 1 d |
| Depends on | E06-S01, E06-S02, E06-S03, E06-S07 |
| Needed by | — |

## User story

As an operator, I want to upload the clips my team filmed, match each one to a shot in the script, and get back one edited vertical video with the on-screen text and music in place, so that a filmed reel does not need a video editor.

## Context

This is the "video" in "create video, motion, or design", for items with `production_mode = video` (reels and video stories). The script's shot list (E05) says what to film. The team films it. This story takes those clips, cuts each to its shot's length, fits it to 9:16, lays the script's on-screen text over it using the brand templates, joins the shots and adds music.

It is a Should story. Without it, a filmed reel still ships: the team edits the video themselves and uploads it as the final asset (E06-S07).

## Scope

**In**

- Mapping clips to footage shots, with an in-point per clip.
- Normalizing clips to 1080 × 1920 at 30 fps and trimming them to shot length.
- Text overlays rendered by the E06-S02 templates in overlay mode.
- Graphic and text shots rendered as full frames, as in motion mode.
- Joining, music and cover, reusing the E06-S03 builders.
- The Footage card in the Production tab.

**Out (later)**

- Keeping the clips' own sound, voiceover, ducking music under speech.
- Multiple clips per shot, speed changes, colour correction, stabilisation.
- Choosing the crop position (it is always centred).
- Automatic clip-to-shot matching by content.

## Behaviour and rules

### Shots, frames and clips

1. The script package lists `shots`, each with `index`, `duration_seconds` and `type` (`footage`, `graphic` or `text`), and `frames`, each pointing at a shot through `shot_index`.
2. In video mode each shot becomes one **segment** of the output:

   | Shot type | Picture | Text |
   | --- | --- | --- |
   | `footage` | The mapped clip | The shot's frames rendered as transparent overlays on top of the clip |
   | `graphic`, `text` | The shot's frames rendered as full frames (E06-S02), animated with the slow zoom of E06-S03 | Part of the frame |

3. A footage shot with no frames has no overlay. A graphic or text shot with no frames cannot be built: the assembly fails with `frames_not_ready` naming the shot (the script check in E05 should prevent this).
4. **Overlay timing.** A footage shot's overlays appear one after another from the start of the shot, each for its frame's `duration_seconds`. If their total is shorter than the shot, the last overlay disappears when its time ends. If it is longer, overlays are cut at the end of the shot.
5. **Overlay look.** Frames of footage shots are rendered with `overlay = true` (E06-S02 rule 21): transparent background, no background image, text on a semi-opaque plate in the brand colours so it stays readable over any footage, logo and handle in the footer, all inside the safe area. Overlays fade in and out over 0.2 s.

### Clip mapping

6. `ContentVersion.clips` holds the mapping: one entry per footage shot, `{"shot_index", "asset_id", "start_ms"}`. `PUT …/production/clips/` replaces the whole list.
7. A clip must be an `Asset` of `kind = video` in the same account. Its role is set to `clip` and, if it was a library asset, it stays in the library (it is referenced, not copied).
8. `start_ms` is where in the clip the shot starts. Default 0. It must be less than the clip's duration.
9. **Length.** The usable length is `clip.duration_ms − start_ms`. It must cover the shot's duration.
   - Shortfall up to 1,000 ms: accepted; the clip's last frame is held to fill the gap and the entry is marked `padded` with the warning `clip_padded`.
   - Shortfall above 1,000 ms: `400 validation_error` on that entry with the message "Clip is 2.1 s from this in-point; the shot needs 4 s."
10. A shot index that is not a footage shot, a duplicate shot index, or an asset from another account returns `400 validation_error`.
11. Shots without a clip are listed in `missing_shots`. While any are missing, the video cannot be assembled and the item's `hold_reason` is "Waiting for footage for shot(s) 2, 4." Saving a complete mapping clears it.
12. Changing the mapping marks the final asset stale (`render_status = pending`).

### Normalizing a clip

13. Each clip is processed to the output profile of E06-S03 rule 4:
    - rotation metadata is applied, so phone footage is upright;
    - trimmed from `start_ms` for the shot's duration (plus the following transition's overlap, as in E06-S03 rule 7);
    - scaled to cover 1080 × 1920 and centre-cropped; landscape footage is therefore cropped at the sides, with the warning `clip_cropped_heavily` when more than half of the frame width is lost;
    - converted to 30 fps, square pixels, `yuv420p`;
    - its audio is dropped.
14. Clips smaller than 720 px on the short side are accepted with the warning `clip_low_resolution`.

### Joining, audio and cover

15. Segments are joined in shot order. The transition into a shot is the `transition` of the first frame that belongs to it (`cut` when the shot has no frames), with the durations and direction rules of E06-S03 rule 6.
16. Audio is exactly as E06-S03 rules 9–11: optional music, otherwise silence.
17. **Cover.** For reels the cover is taken from the assembled video at the moment `cover_frame_index`'s frame has been on screen for 0.5 s (default: 0.5 s after the first frame appears; 1.0 s into the video when there are no frames). It is stored as a 1080 × 1920 JPEG with `role = cover`.
18. Duration rules, output validation, the assembly hash (which here also includes clip checksums and in-points), reuse, status handling and cleanup follow E06-S03 rules 2 and 12–17.
19. Rights follow the inputs: the final asset's `rights_status` is the worst among clips, backgrounds and music (E06-S01 rule 9). A clip with rights other than `cleared` adds the warning `rights_not_cleared`. The footage final's `meta.inputs` lists every clip asset ID, every overlay frame asset ID and the music asset ID, so the rights check (E07-S02) reaches all of them through `production.services.rights.version_input_assets(version)`.

### Orchestration

20. When `production.start` (E06-S07) reaches the assemble step for a video item and clips are missing, it does not fail. It finishes with `result.waiting_for = "clips"`, leaves `render_status = pending`, sets the hold reason from rule 11, and stops. Overlays and full frames are already rendered at that point.
21. Once the mapping is complete the operator presses **Assemble video**, which calls `POST …/production/render/` (E06-S02) with `frames: null`; for a video item that job ends with this story's assembly task.

## Data

Uses `ContentVersion`, `Asset` and the script package from [DATA-MODEL.md](../../DATA-MODEL.md).

New field on `ContentVersion`:

| Field | Type | Notes |
| --- | --- | --- |
| `clips` | JSON list | `[{"shot_index", "asset_id", "start_ms"}]`; empty for other production modes |

New render warning codes: `clip_padded`, `clip_cropped_heavily`, `clip_low_resolution`.

## API

### `PUT /api/v1/content-items/{id}/production/clips/`

Signed-in user. Replaces the clip mapping of the current draft version.

Request:

```json
{
  "base_version": 1,
  "clips": [
    {"shot_index": 2, "asset_id": 501, "start_ms": 1200},
    {"shot_index": 4, "asset_id": 502, "start_ms": 0}
  ]
}
```

Response `200`: the production resource (full shape in E06-S07). The parts this story adds:

```json
{
  "content_item": 57,
  "version": 1,
  "latest_version": 1,
  "status": "draft",
  "production_mode": "video",
  "render_status": "pending",
  "shots": [
    {"index": 1, "type": "graphic", "duration_seconds": 3, "description": "Title card", "asset_hint": "", "frame_indexes": [1]},
    {"index": 2, "type": "footage", "duration_seconds": 4, "description": "Hands opening the delivery box", "asset_hint": "Close-up, natural light", "frame_indexes": [2]},
    {"index": 3, "type": "footage", "duration_seconds": 5, "description": "Product on the kitchen counter", "asset_hint": "Slow pan", "frame_indexes": [3, 4]},
    {"index": 4, "type": "footage", "duration_seconds": 3, "description": "Smiling to camera", "asset_hint": "", "frame_indexes": []}
  ],
  "clips": [
    {
      "shot_index": 2,
      "asset": {"id": 501, "original_filename": "unboxing-take3.mov", "duration_ms": 9200, "width": 1080, "height": 1920, "thumbnail_url": "…", "rights_status": "cleared"},
      "start_ms": 1200,
      "shot_duration_ms": 4000,
      "usable_ms": 8000,
      "state": "ok"
    },
    {
      "shot_index": 4,
      "asset": {"id": 502, "original_filename": "smile.mp4", "duration_ms": 2600, "width": 1920, "height": 1080, "thumbnail_url": "…", "rights_status": "unknown"},
      "start_ms": 0,
      "shot_duration_ms": 3000,
      "usable_ms": 2600,
      "state": "padded"
    }
  ],
  "missing_shots": [3],
  "render_warnings": [
    {"code": "clip_padded", "shot_index": 4, "message": "Last frame held for 0.4 s."},
    {"code": "clip_cropped_heavily", "shot_index": 4, "message": "Landscape clip cropped to vertical."},
    {"code": "rights_not_cleared", "asset_id": 502, "message": "Rights are unknown."}
  ]
}
```

Errors:

| Case | Status and code |
| --- | --- |
| Item not `in_production`, no draft version, or version origin is `manual_upload` | `409 invalid_transition` |
| Item's `production_mode` is not `video` | `409 invalid_transition` with `details.reason = "not_video_mode"` |
| `base_version` is not the current version | `409 version_conflict` |
| Active job on the item | `409 job_in_progress` |
| Unknown or non-footage `shot_index`, duplicate shot, asset not a video or from another account, `start_ms` out of range, shortfall above 1 s | `400 validation_error` with `fields` paths such as `clips.1.start_ms` |

Sending `"clips": []` clears the mapping.

## Background work

| Task | Queue | Notes |
| --- | --- | --- |
| `production.tasks.assemble_footage(job_id, version_id)` | `render` | Downloads clips, overlays, frames and music; builds and runs FFmpeg; probes, validates, stores final asset and cover |

- Overlay and full-frame PNGs are produced by the E06-S02 frame task before this one, inside the same `production.render` or `production.start` job.
- **Idempotency.** The assembly hash includes each clip's checksum and `start_ms`; an unchanged request reuses the existing final asset.
- **Timeout.** Twenty minutes (clips are larger than stills). Progress and the message "Assembling video (9 s of 15 s)" come from FFmpeg's progress output.
- **Retries and failure** as in E06-S03: transient errors three times, FFmpeg failure once, then `assembly_failed` with `render_status = failed`.
- **Disk.** The task checks free space in the worker's temporary directory before downloading (needs three times the total size of the clips) and fails early with `assembly_failed` and a clear detail if there is not enough.

### FFmpeg outline for one footage segment

A 4-second shot from a clip starting at 1.2 s, with one overlay shown for the first 3 seconds:

```text
[0:v]trim=start=1.2:duration=4,setpts=PTS-STARTPTS,
     scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,
     fps=30,setsar=1,format=yuv420p[base];
[1:v]format=rgba,fade=t=in:st=0:d=0.2:alpha=1,fade=t=out:st=2.8:d=0.2:alpha=1[ov];
[base][ov]overlay=0:0:enable='between(t,0,3)'[seg2]
```

A padded clip adds `tpad=stop_mode=clone:stop_duration=<shortfall>` after `trim`. Segments are then chained with the same `xfade`/`concat` builder as E06-S03, and audio is built by the same audio builder. This is an outline; tests assert on the output file.

## AI

None.

## Panel

A **Footage** card in the Production tab of `/content/:id`, shown only when `production_mode = video`. It sits above the Frames card.

- **Header:** "Footage", with a counter "2 of 3 shots have a clip" and the actions **Save footage** (primary when there are unsaved changes) and **Assemble video** (enabled when no shot is missing, nothing is unsaved, and no job is running).
- **Shot list:** one row per shot, in order.

  | Column | Content |
  | --- | --- |
  | Shot | Number and duration ("2 · 4 s") |
  | What to film | The shot's description and, in secondary text, the asset hint; wrapped in `ContentText` |
  | On-screen text | Headline of the shot's frames, or "—" |
  | Clip | For footage shots: thumbnail, file name, duration and `RightsTag`, with **Choose clip** / **Change** (opens `AssetPicker` with `kind = video`, role preset to Clip, upload allowed) and **Remove**. For graphic and text shots: "Rendered graphic" with the frame thumbnail |
  | Start at | Number input in seconds with one decimal, plus a small muted `<video>` that seeks to the in-point when the value changes |
  | Status | `StatusTag`: "Needs clip" (orange), "Ready" (green), "Padded 0.4 s" (orange, tooltip explains), "Too short" (red, shown before saving when the shortfall is above 1 s) |

- **Validation before saving:** the Too short state is computed in the browser from the clip duration so the operator sees it immediately; the server remains the authority and its field errors are shown on the row.
- **After saving:** `message.success("Footage saved")`. Warnings from the response are listed under the table with `FrameWarning`-style tags: "Landscape clip cropped to vertical", "Low resolution clip", "Rights are not cleared".
- **Assemble video** is a `JobButton` on `POST …/production/render/`. While it runs the card is read-only and shows `JobProgress`.

States:

| State | Display |
| --- | --- |
| No clips yet | An `Alert` (info): "This item needs footage. Film the shots below, then upload a clip for each." |
| Waiting for footage | The item header shows the hold reason; the Submit button in the tab is disabled with the tooltip "Add footage for every shot first" |
| Job running | Inputs and buttons disabled, progress shown |
| Assembly failed | `Alert` (error): "The video could not be assembled." with **Try again** |
| Version not editable | Card is read-only (version submitted or item not in production) |

## Acceptance criteria

1. Given a video-mode reel whose script has two footage shots and one graphic shot, when I map a clip to each footage shot and assemble, then the final asset is a 1080 × 1920, 30 fps MP4 whose duration equals the sum of the shot durations (± 0.1 s).
2. Given a landscape 1920 × 1080 clip, then it fills the vertical frame, is centre-cropped, and the version has the warning `clip_cropped_heavily`.
3. Given a clip filmed on a phone with rotation metadata, then it appears upright in the output.
4. Given `start_ms = 1200`, then the segment's first frame matches the clip's frame at 1.2 s.
5. Given a footage shot with one frame lasting 3 seconds in a 4-second shot, then the overlay text is visible from 0 to 3 s of that segment and absent in the last second.
6. Given the overlay is rendered for a Persian account, then its text is right-to-left, uses the brand fonts and colours, and sits inside the reel safe area.
7. Given a clip 0.4 s shorter than its shot, then saving succeeds, the entry's state is `padded`, and the output holds the clip's last frame for 0.4 s.
8. Given a clip 2 s shorter than its shot, then saving fails with `validation_error` on that entry and the mapping is unchanged.
9. Given one footage shot has no clip, then `missing_shots` lists it, the item's hold reason names it, and Assemble video is disabled.
10. Given `production.start` runs for a video item with no clips, then the job succeeds with `waiting_for = "clips"`, overlays and graphic frames exist, and `render_status` is `pending`.
11. Given the clips have sound, then the output's audio is only the music, or silence when there is none.
12. Given I change one clip and assemble again, then a new final asset replaces the old one; assembling again without changes reuses it.
13. Given a `motion` item, when I call `PUT …/production/clips/`, then I get `409 invalid_transition`.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S04-BE1 | Clip mapping | Migration for `ContentVersion.clips`; `PUT …/production/clips/` with rules 6–12, computed `state`, `usable_ms`, `missing_shots`, hold reason; `shots` and `clips` in the production serializer; `openapi.yaml`. | 0.5 d |
| E06-S04-BE2 | Overlay frames | Overlay styling in `_base` and the seven templates (text plate, transparent body); frame task renders footage-shot frames with `overlay = true`; reference images for two overlays. | 0.5 d |
| E06-S04-BE3 | Segment builder | `production/assembly/footage.py`: normalize, trim, pad, overlay timing and fades; graphic and text shots reuse the motion clip builder; warnings for crop and resolution. | 0.75 d |
| E06-S04-BE4 | Assembly task | Segment chaining with the E06-S03 transition and audio builders, cover extraction by time, hash, disk check, validation, storage, rights. | 0.5 d |
| E06-S04-BE5 | Orchestration hook | `waiting_for = "clips"` handling in `production.start`; route `production.render` to footage assembly for video items; tests with fixture clips. | 0.25 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S04-FE1 | Footage card | Shot list, clip picking and removal, statuses, save, warnings, assemble action, all states. | 0.75 d |
| E06-S04-FE2 | In-point control | Seconds input with seeking preview, client-side shortfall check. | 0.25 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- **Fixture clips** (a few hundred kilobytes each, generated with FFmpeg's test sources): a 6-second vertical clip with a burnt-in frame counter, a 6-second landscape clip, a 2.6-second clip, a clip with rotation metadata, a clip with audio.
- **Timing:** extract output frames at known times and read the burnt-in counter region's brightness pattern or dominant colour to prove in-points and trims.
- **Overlay:** compare a frame of the output inside and outside the overlay window against expected alpha blending (overlay region differs from the base clip only inside the window).
- **API:** every row of the error table; replacing versus clearing the mapping; padded versus rejected shortfall at exactly 1,000 ms and 1,001 ms.
- **Panel:** mapping flow with a mocked picker; Too short shown before save; disabled states.

## Later

- Keep clip audio per shot with a `keep_audio` flag on the clip entry and a ducking filter in the audio builder.
- Crop position per clip (`focus_x`, `focus_y` on the entry).
- Shot duration overrides on the version, so a shorter clip can shorten the shot instead of being rejected.
