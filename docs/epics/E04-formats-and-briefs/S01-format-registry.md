# E04-S01 — Format specification registry

| | |
| --- | --- |
| Epic | E04 Formats and briefs |
| Priority | Must |
| Estimate | BE 1 d · FE 0.5 d |
| Depends on | E00-S01, E00-S02 |
| Needed by | E03-S03, E04-S02, E04-S03, E05-S01, E05-S02, E06-S02, E06-S03, E06-S04, E06-S06, E06-S07, E07-S02, E07-S04, E08-S01, E08-S05, E09-S03, E09-S04, E10-S01 |

## User story

As a developer building rendering, checks, publishing and analytics, I want one place that states every format's sizes, limits and rules, so that all parts of the product agree and a changed Instagram limit is fixed in one line.

As an operator, I want the panel to show the same limits the system enforces, so that I am not surprised by a failed check.

## Context

Instagram formats come with hard numbers: canvas size, video length, file size, caption length, hashtag count, the parts of the screen hidden by Instagram's own interface. Several later stories need these numbers: the renderer (E06-S02, E06-S03), the caption writer (E06-S06), the format and design checks (E07-S02, E07-S04), the scheduler and the posting pack (E08-S01, E08-S05) and metric entry (E09-S03, E09-S04). This story puts them in one Python module and serves them to the panel. It is a small story with a large blast radius, so it is built early in R1.

The registry describes formats. It does not hold per-account rules (those are in `InstagramAccount.posting_rules`) and it is not a database table: values change with a code release, which is reviewed and tested.

## Scope

**In**

- `apps/content/formats.py` with one frozen specification per (format, media kind).
- Format-level information: label, allowed media kinds, default media kind, default production mode per media kind.
- Lookup helpers used by every other app.
- `GET /formats/` with caching headers.
- Panel `useFormats` hook and label helpers.
- Consistency tests that fail when the registry contradicts itself or DATA-MODEL.md.

**Out (later)**

- Carousels, feed videos, story stickers.
- Account-level overrides.
- Editing the registry from the panel.

## Behaviour and rules

### Structure

1. The registry knows exactly four combinations, matching [DATA-MODEL.md](../../DATA-MODEL.md) section 1:

   | Format | Media kind | Production modes | Default mode |
   | --- | --- | --- | --- |
   | `feed_post` | `image` | `design` | `design` |
   | `story` | `image` | `design` | `design` |
   | `story` | `video` | `motion`, `video` | `motion` |
   | `reel` | `video` | `motion`, `video` | `motion` |

2. Default media kind per format: `feed_post` → `image`, `story` → `image`, `reel` → `video`. Selection (E03-S03) uses these defaults when it creates an item.
3. Each combination has one `FormatSpec`, a frozen dataclass. Field names are fixed here because other stories read them by name:

   | Field | Type | Meaning |
   | --- | --- | --- |
   | `format`, `media_kind` | enum | The key |
   | `label` | str | "Feed post", "Image story", "Video story", "Reel" |
   | `layout` | str | Render layout key: `4x5` or `9x16` (E06-S02) |
   | `width`, `height` | int | Target canvas in pixels |
   | `aspect_ratio` | str | `"4:5"` or `"9:16"`, for display |
   | `aspect_tolerance` | float | Allowed relative difference of width/height for uploaded files |
   | `min_width` | int | Smallest width accepted for a manual upload before scaling |
   | `production_modes` | tuple | Allowed `ProductionMode` values |
   | `default_production_mode` | enum | |
   | `image_mime` | str or None | MIME type of the final published image |
   | `upload_mimes` | tuple | MIME types accepted for a manual final-asset upload (E06-S07) |
   | `max_file_bytes` | int | Largest final file |
   | `min_duration_s`, `max_duration_s` | float or None | Video length limits; None for images |
   | `container`, `video_codec`, `pixel_format` | str or None | Required video encoding |
   | `audio_codec` | str or None | Required audio codec when audio is present |
   | `audio_required` | bool | Whether the video must carry an audio stream |
   | `fps_min`, `fps_max` | int or None | Allowed frame rate |
   | `caption_allowed` | bool | Whether a caption is published |
   | `caption_max_chars` | int | 0 when captions are not allowed |
   | `max_hashtags` | int | From setting `SOCIALHUB_MAX_HASHTAGS`; 0 when captions are not allowed |
   | `alt_text_expected` | bool | Whether the copy step should write alt text |
   | `alt_text_max_chars` | int | |
   | `cover_required` | bool | Whether a cover image must be supplied |
   | `safe_area` | dict | `{"top", "right", "bottom", "left"}` in pixels of the target canvas |
   | `daily_limit_group` | str | `feed` or `story`: which `posting_rules` daily limit counts it |
   | `metric_checkpoints` | tuple | Checkpoints at which a metric snapshot can be recorded (E09-S03), in order |
   | `evaluation_checkpoints` | tuple | Checkpoints at which E09-S04 asks for metric entry and E10-S01 evaluates; a subset of `metric_checkpoints` |

4. The values:

   | Field | `feed_post` image | `story` image | `story` video | `reel` video |
   | --- | --- | --- | --- | --- |
   | `layout` | `4x5` | `9x16` | `9x16` | `9x16` |
   | `width` × `height` | 1080 × 1350 | 1080 × 1920 | 1080 × 1920 | 1080 × 1920 |
   | `aspect_tolerance` | 0.01 | 0.01 | 0.01 | 0.01 |
   | `min_width` | 720 | 720 | 720 | 720 |
   | `image_mime` | `image/jpeg` | `image/jpeg` | — | — |
   | `upload_mimes` | `image/jpeg`, `image/png` | `image/jpeg`, `image/png` | `video/mp4`, `video/quicktime` | `video/mp4`, `video/quicktime` |
   | `max_file_bytes` | 8 MB (8,388,608) | 8 MB | 100 MB (104,857,600) | 100 MB |
   | `min_duration_s` / `max_duration_s` | — | — | 1 / 60 | 5 / 90 |
   | `container` / `video_codec` / `pixel_format` | — | — | `mp4` / `h264` / `yuv420p` | same |
   | `audio_codec` / `audio_required` | — | — | `aac` / false | `aac` / true |
   | `fps_min` / `fps_max` | — | — | 23 / 60 | 23 / 60 |
   | `caption_allowed` / `caption_max_chars` | true / 2,200 | false / 0 | false / 0 | true / 2,200 |
   | `max_hashtags` | setting (default 5) | 0 | 0 | setting (default 5) |
   | `alt_text_expected` / `alt_text_max_chars` | true / 100 | false / 100 | false / 100 | false / 100 |
   | `cover_required` | false | false | false | true |
   | `safe_area` top / right / bottom / left | 60 / 60 / 60 / 60 | 250 / 60 / 250 / 60 | 250 / 60 / 250 / 60 | 220 / 120 / 420 / 60 |
   | `daily_limit_group` | `feed` | `story` | `story` | `feed` |
   | `metric_checkpoints` | `1h`, `6h`, `24h`, `72h`, `7d` | `1h`, `6h`, `23h` | `1h`, `6h`, `23h` | `1h`, `6h`, `24h`, `72h`, `7d` |
   | `evaluation_checkpoints` | `24h`, `7d` | `23h` | `23h` | `24h`, `7d` |

5. Values that depend on Instagram come from Instagram's published specifications (its Help Center and developer documentation for each format) and are kept current: the hashtag limit (the setting exists because Instagram has changed it; check the current limit before launch), reel and story duration limits, maximum file sizes, and the safe-area bands. During R2 the team confirms them by posting one of each format (feed post, image story, video story, reel) by hand from a posting pack on the test account, and adjusts the registry if the Instagram app rejects, crops or recompresses a file in a way the values did not predict. The duration and size values above are deliberately conservative: a file that meets them is accepted by Instagram, even if Instagram would accept more.
6. Script-level limits (number of frames, frame durations, text lengths per frame template) are not media limits. E05-S01 adds them to the same module as `SCRIPT_RULES` and `FRAME_TEMPLATES` and to the same endpoint as `script_rules` and `frame_templates`. This story leaves those two keys for E05-S01.
7. Role definitions live in `apps/content/roles.py` and are added to the endpoint as `roles` by E04-S02.

### Helpers

8. The module exposes these functions; nothing else in the code base reads `SPECS` directly:

   | Function | Returns | Raises |
   | --- | --- | --- |
   | `get_spec(format, media_kind)` | `FormatSpec` | `UnknownFormat` |
   | `is_allowed(format, media_kind, production_mode)` | bool | — |
   | `defaults_for(format)` | `(media_kind, production_mode)` | `UnknownFormat` |
   | `default_mode(format, media_kind)` | `ProductionMode` | `UnknownFormat` |
   | `media_kinds_for(format)` | tuple of `MediaKind` | `UnknownFormat` |
   | `all_specs()` | list of `FormatSpec` in a fixed order: feed post, image story, video story, reel | — |
   | `registry_version()` | str: `REGISTRY_VERSION` plus the hashtag setting, for example `"1+h5"` | — |

9. `REGISTRY_VERSION` is a string constant that is bumped whenever a value changes. It is part of the endpoint's ETag, so panels pick up the change.
10. `SOCIALHUB_MAX_HASHTAGS` must be an integer from 0 to 30. Another value stops Django from starting through a system check, with a message naming the setting.

### Self-checks

11. A Django system check runs at startup and in the test suite. It fails, naming the combination and field, when:
    - a combination in DATA-MODEL.md section 1 is missing, or an extra one exists;
    - `default_production_mode` is not in `production_modes`, or a format's default media kind has no spec;
    - `width / height` does not match `layout` (4:5 or 9:16) within `aspect_tolerance`;
    - an image spec carries video fields, or a video spec lacks them;
    - `caption_allowed` is false and `caption_max_chars` or `max_hashtags` is not 0;
    - `evaluation_checkpoints` is not an ordered subset of `metric_checkpoints`, or a checkpoint is not a `Checkpoint` value;
    - a safe area leaves less than half the canvas width or height usable.

### Endpoint

12. `GET /formats/` is available to every signed-in user and is not account-scoped. It returns the same body for everyone.
13. The response carries `ETag: "<registry_version>"` and `Cache-Control: private, max-age=3600`. A request with a matching `If-None-Match` returns `304` with no body.

## Data

No tables. Code constants in `apps/content/formats.py` and one setting, `SOCIALHUB_MAX_HASHTAGS` (default 5).

## API

### `GET /api/v1/formats/`

Permission: signed-in user. No query parameters.

```json
{
  "registry_version": "1+h5",
  "formats": [
    {"format": "feed_post", "label": "Feed post", "media_kinds": ["image"], "default_media_kind": "image"},
    {"format": "story", "label": "Story", "media_kinds": ["image", "video"], "default_media_kind": "image"},
    {"format": "reel", "label": "Reel", "media_kinds": ["video"], "default_media_kind": "video"}
  ],
  "specs": [
    {
      "format": "feed_post",
      "media_kind": "image",
      "label": "Feed post",
      "layout": "4x5",
      "width": 1080,
      "height": 1350,
      "aspect_ratio": "4:5",
      "aspect_tolerance": 0.01,
      "min_width": 720,
      "production_modes": ["design"],
      "default_production_mode": "design",
      "image_mime": "image/jpeg",
      "upload_mimes": ["image/jpeg", "image/png"],
      "max_file_bytes": 8388608,
      "min_duration_s": null,
      "max_duration_s": null,
      "container": null,
      "video_codec": null,
      "pixel_format": null,
      "audio_codec": null,
      "audio_required": false,
      "fps_min": null,
      "fps_max": null,
      "caption_allowed": true,
      "caption_max_chars": 2200,
      "max_hashtags": 5,
      "alt_text_expected": true,
      "alt_text_max_chars": 100,
      "cover_required": false,
      "safe_area": {"top": 60, "right": 60, "bottom": 60, "left": 60},
      "daily_limit_group": "feed",
      "metric_checkpoints": ["1h", "6h", "24h", "72h", "7d"],
      "evaluation_checkpoints": ["24h", "7d"]
    },
    {
      "format": "story",
      "media_kind": "image",
      "label": "Image story",
      "layout": "9x16",
      "width": 1080,
      "height": 1920,
      "aspect_ratio": "9:16",
      "aspect_tolerance": 0.01,
      "min_width": 720,
      "production_modes": ["design"],
      "default_production_mode": "design",
      "image_mime": "image/jpeg",
      "upload_mimes": ["image/jpeg", "image/png"],
      "max_file_bytes": 8388608,
      "min_duration_s": null,
      "max_duration_s": null,
      "container": null,
      "video_codec": null,
      "pixel_format": null,
      "audio_codec": null,
      "audio_required": false,
      "fps_min": null,
      "fps_max": null,
      "caption_allowed": false,
      "caption_max_chars": 0,
      "max_hashtags": 0,
      "alt_text_expected": false,
      "alt_text_max_chars": 100,
      "cover_required": false,
      "safe_area": {"top": 250, "right": 60, "bottom": 250, "left": 60},
      "daily_limit_group": "story",
      "metric_checkpoints": ["1h", "6h", "23h"],
      "evaluation_checkpoints": ["23h"]
    },
    {
      "format": "story",
      "media_kind": "video",
      "label": "Video story",
      "layout": "9x16",
      "width": 1080,
      "height": 1920,
      "aspect_ratio": "9:16",
      "aspect_tolerance": 0.01,
      "min_width": 720,
      "production_modes": ["motion", "video"],
      "default_production_mode": "motion",
      "image_mime": null,
      "upload_mimes": ["video/mp4", "video/quicktime"],
      "max_file_bytes": 104857600,
      "min_duration_s": 1,
      "max_duration_s": 60,
      "container": "mp4",
      "video_codec": "h264",
      "pixel_format": "yuv420p",
      "audio_codec": "aac",
      "audio_required": false,
      "fps_min": 23,
      "fps_max": 60,
      "caption_allowed": false,
      "caption_max_chars": 0,
      "max_hashtags": 0,
      "alt_text_expected": false,
      "alt_text_max_chars": 100,
      "cover_required": false,
      "safe_area": {"top": 250, "right": 60, "bottom": 250, "left": 60},
      "daily_limit_group": "story",
      "metric_checkpoints": ["1h", "6h", "23h"],
      "evaluation_checkpoints": ["23h"]
    },
    {
      "format": "reel",
      "media_kind": "video",
      "label": "Reel",
      "layout": "9x16",
      "width": 1080,
      "height": 1920,
      "aspect_ratio": "9:16",
      "aspect_tolerance": 0.01,
      "min_width": 720,
      "production_modes": ["motion", "video"],
      "default_production_mode": "motion",
      "image_mime": null,
      "upload_mimes": ["video/mp4", "video/quicktime"],
      "max_file_bytes": 104857600,
      "min_duration_s": 5,
      "max_duration_s": 90,
      "container": "mp4",
      "video_codec": "h264",
      "pixel_format": "yuv420p",
      "audio_codec": "aac",
      "audio_required": true,
      "fps_min": 23,
      "fps_max": 60,
      "caption_allowed": true,
      "caption_max_chars": 2200,
      "max_hashtags": 5,
      "alt_text_expected": false,
      "alt_text_max_chars": 100,
      "cover_required": true,
      "safe_area": {"top": 220, "right": 120, "bottom": 420, "left": 60},
      "daily_limit_group": "feed",
      "metric_checkpoints": ["1h", "6h", "24h", "72h", "7d"],
      "evaluation_checkpoints": ["24h", "7d"]
    }
  ],
  "production_modes": [
    {"key": "design", "label": "Design", "description": "A single image rendered from a brand template."},
    {"key": "motion", "label": "Motion", "description": "Rendered frames animated into a video with transitions."},
    {"key": "video", "label": "Video", "description": "Uploaded footage cut to the script, with text overlays."}
  ]
}
```

E05-S01 adds `script_rules` and `frame_templates`; E04-S02 adds `roles`. The panel must ignore keys it does not know.

| Case | Response |
| --- | --- |
| Not signed in | `403 authentication_required` |
| `If-None-Match` matches | `304`, empty body |

## Background work

None.

## AI

None.

## Panel

No page of its own. This story provides the data layer that other pages use.

- **`src/services/formats.ts`:** `getFormats()` calling `GET /api/v1/formats/`, with TypeScript types `FormatSpec`, `FormatInfo`, `ProductionModeInfo` and, filled by later stories, `RoleInfo`, `ScriptRule`, `FrameTemplate`.
- **`src/hooks/useFormats.ts`:** wraps Refine's `useList` on resource `formats` with `pagination: { mode: "off" }` and `queryOptions: { staleTime: Infinity }`, so the registry is fetched once per browser session and shared by every component. Returns `{data, loading, error, getSpec(format, mediaKind), modesFor(format, mediaKind), formatLabel(format, mediaKind?), modeLabel(mode)}`. `getSpec` returns `undefined` for an unknown combination instead of throwing.
- **Loading and error:** components that need limits show their own skeleton while `loading`. On error they fall back to labels only (no counters) and show nothing alarming; the server still enforces every limit.
- **Labels:** `formatLabel('story', 'video')` returns "Video story"; `formatLabel('story')` returns "Story". Status-free format tags elsewhere (E03-S04 list and board) switch to these labels.

## Acceptance criteria

1. Given the default settings, when I call `GET /formats/`, then I receive four specs in the order feed post, image story, video story, reel, with the values in rule 4 and `max_hashtags` 5 for feed posts and reels.
2. Given `SOCIALHUB_MAX_HASHTAGS=3`, when I call the endpoint, then `max_hashtags` is 3 for feed posts and reels, still 0 for stories, and `registry_version` is `"1+h3"`.
3. Given `SOCIALHUB_MAX_HASHTAGS=40`, when Django starts, then it refuses to start with a system-check error naming the setting.
4. Given a request with `If-None-Match` equal to the current ETag, when I call the endpoint, then I get `304`.
5. Given `defaults_for("reel")`, then it returns `("video", "motion")`; given `is_allowed("feed_post", "image", "motion")`, then it returns false.
6. Given a developer changes the story spec so that `evaluation_checkpoints` contains `24h`, when the test suite runs, then the system check fails naming `story/video` and `evaluation_checkpoints`.
7. Given a developer sets the reel `width` to 1080 and `height` to 1350 while its `layout` stays `9x16`, when Django starts, then the system check fails naming `reel/video` and `layout`.
8. In the panel, given two components on one page use `useFormats`, then only one request to `/api/v1/formats/` is made in that browser session.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E04-S01-BE1 | Registry module | `apps/content/formats.py`: `FormatSpec` dataclass, `FORMATS`, `SPECS`, `PRODUCTION_MODES`, `REGISTRY_VERSION`, helpers from rule 8, `UnknownFormat`; the `SOCIALHUB_MAX_HASHTAGS` setting read at access time | 0.5 |
| E04-S01-BE2 | System checks | Checks from rules 10 and 11 registered in `apps/content/checks.py`; unit tests that break each rule on a patched copy of `SPECS` | 0.25 |
| E04-S01-BE3 | Endpoint | `FormatsView` (no pagination), serializer from the dataclasses, ETag and `Cache-Control`, `304` handling; `docs/openapi.yaml` schema `FormatsResponse`; API tests for criteria 1, 2 and 4 | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E04-S01-FE1 | Service, types and hook | `src/services/formats.ts`, `src/hooks/useFormats.ts` with cache key and helper functions; unit test that the hook fetches once for two consumers | 0.25 |
| E04-S01-FE2 | Labels in existing views | Use `formatLabel` and `modeLabel` in the `/content` list and board and the workspace header; test for unknown-combination fallback | 0.25 |

### Test

None beyond the tests inside each subtask.

## Test notes

- The registry is pure data, so most tests are unit tests on `formats.py` and the system checks.
- Add a test in `apps/core/tests/test_no_format_literals.py` that scans `apps/production`, `apps/quality`, `apps/publishing` and `apps/analytics` for the literals `1350`, `1920`, `2200` and `"9x16"`/`"4x5"` outside comments and fails with the file name. It protects rule 8 as later epics land.
- Other stories stub the registry with `override_settings(SOCIALHUB_MAX_HASHTAGS=…)` or by patching `get_spec`; they should not copy the value table.

## Later

- New formats (carousel, feed video): one `FORMATS` entry and one `FormatSpec` per media kind, then render, check and publish support in their own epics.
- Per-account overrides: a `get_spec(format, media_kind, account=None)` signature that merges `account.format_overrides`; callers already use the helper.
- If limits ever need to change without a release, the dataclass can be loaded from a JSON file or table with the same system checks.
- Phase 2: `publish_method` (the `InstagramProvider` method E08-S03 calls) and `capability` (the `AccountConnection.capabilities` key that must be true) per spec, with a system check against the provider interface. Instagram's API limits are then checked against these values during the E00-S04 setup spike.
