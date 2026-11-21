# E07-S02 — Format and rights checks

| | |
| --- | --- |
| Epic | E07 Quality check |
| Priority | Must |
| Estimate | BE 2 d · FE 0 d · QA 0 d |
| Depends on | E07-S01, E04-S01, E06-S01, E06-S07 |
| Needed by | E07-S05, E07-S06, E08-S03 |

## User story

As an operator, I want every version checked against Instagram's format rules and against the usage rights of every asset in it, so that nothing is scheduled that Instagram would reject or that we are not allowed to publish.

## Context

These are the two rule-based checks. They use no AI: the format check measures the real files with `ffprobe` and Pillow and compares them with the format registry from E04-S01; the rights check reads the rights metadata that E06-S01 stores on each asset. Both run first in every check run (E07-S01), are fast, and give exact, repeatable results.

The publish worker (E08-S03) relies on the format check: a version that passed it should not be refused by Instagram for technical reasons.

## Scope

**In**

- `FormatChecker`: media file checks for images and videos, cover check for reels, caption and hashtag limits.
- `RightsChecker`: resolve every asset that went into the version, check status, expiry, licence notes, and the AI disclosure rule from the brand profile.
- The catalogue entries for both checks.
- `ffmpeg` (for `ffprobe`) in the default backend image, so the check can run on the `default` queue.

**Out (later)**

- Loudness, bitrate quality and colour-space analysis.
- Detecting copyrighted music or images by content matching.
- Instagram's own AI-content label (the MVP discloses in the caption).
- Rights documents as uploaded files; the MVP stores a licence note and a source link.

## Behaviour and rules

### Shared

1. Both checkers measure and read; they never change an asset, a version or its metadata.
2. Both set `QCResult.checker = rule`.
3. Limits come from the format registry: `spec = content.formats.get_spec(item.format, item.media_kind)`. The numbers in this story are the registry defaults this check expects; the registry is the source of truth, and the checker must not hard-code them.

| Registry field | `feed_post` image | `story` image | `story` video | `reel` video |
| --- | --- | --- | --- | --- |
| `width` × `height` | 1080 × 1350 | 1080 × 1920 | 1080 × 1920 | 1080 × 1920 |
| `aspect_tolerance` | 0.01 | 0.01 | 0.01 | 0.01 |
| `min_width` (manual uploads) | 720 | 720 | 720 | 720 |
| `image_mime` | `image/jpeg` | `image/jpeg` | — | — |
| `max_file_bytes` | 8 MB | 8 MB | 100 MB | 100 MB |
| `min_duration_s` / `max_duration_s` | — | — | 1 / 60 | 5 / 90 |
| `container` / `video_codec` / `pixel_format` | — | — | `mp4` / `h264` / `yuv420p` | same |
| `audio_codec` / `audio_required` | — | — | `aac` / false | `aac` / true |
| `fps_min` / `fps_max` | — | — | 23 / 60 | 23 / 60 |
| `caption_allowed` / `caption_max_chars` | true / 2200 | false / 0 | false / 0 | true / 2200 |
| `max_hashtags` | registry value | 0 | 0 | registry value |
| `cover_required` | false | false | false | true |
| `alt_text_expected` | true | false | false | false |

4. A finding about the media file is auto-fixable only when a deterministic operation can fix it without changing what the content says or shows:
   - **Normalising** (scale at the same aspect ratio, convert image type, transcode container/codec/pixel format/frame rate, compress to the size limit, add a silent audio track, generate a cover from a video frame) is allowed for every version, including `manual_upload`. It is done by E06-S03's `production.services.media.normalise_media(asset, format_spec)` (cover generation by E06-S03's cover export).
   - **Re-rendering** (changing aspect ratio or layout) is allowed only for `origin = pipeline` versions, because only those have templates to render from.
   - **Changing duration** needs a script change and is allowed only for `origin = pipeline` versions.
   - Everything else on a `manual_upload` version is not auto-fixable.

### Format check

5. The checker probes the local copies provided by the check context. Images: Pillow (`Image.open`, `verify`, then size, format, mode). Videos: `ffprobe -v error -print_format json -show_format -show_streams`. The probe result is stored in `QCResult.details.probe`.
6. The checker trusts the probe, not the `Asset` columns. If the probe disagrees with `Asset.width`, `height` or `duration_ms`, it adds the `info` finding `format.metadata_mismatch`.
7. Dimensions: for `pipeline` versions the file must be exactly `width × height`. For `manual_upload` versions a file is accepted when its aspect ratio is within `aspect_tolerance` of the target and its width is at least `min_width`; if it is not exactly the target size, `format.wrong_dimensions` is raised as auto-fixable (scale).
8. Aspect ratio is `width / height` after applying the rotation tag of a video stream.
9. Duration is taken from the container (`format.duration`), rounded to 0.1 s.
10. Frame rate is the video stream's `avg_frame_rate`.
11. Caption length is counted in Unicode code points after normalising line endings to `\n`, on the text built by the single builder `full_caption(version)` owned by E08-S01 (caption, blank line, hashtags as `#tag` separated by spaces). E06-S06 and the publisher use the same builder, so the three never disagree.
12. Hashtags are counted from `ContentVersion.hashtags` plus any `#tag` typed inside the caption text, the same rule E06-S06 applies on save.
13. For reels, `cover_asset` must exist, be an image, and match the reel's dimensions within `aspect_tolerance`.
14. The combination of `format`, `media_kind` and `production_mode` on the item must be allowed by the registry, and the final asset's kind must match `media_kind`.

#### Format finding catalogue

"Fix" is the rework level used by the revise loop (E07-S05): `copy`, `render` (re-render or normalise) or `script`. "—" means not auto-fixable. Where two values are given, the first is for `pipeline` versions and the second for `manual_upload` versions. "Override" says whether a reviewer may approve despite the finding (E07-S06).

| Code | Raised when | Severity | Auto-fixable | Fix | Override |
| --- | --- | --- | --- | --- | --- |
| `format.asset_missing` | No `final_asset`, or its file is not in storage | blocker | no | — | no |
| `format.unreadable_media` | Pillow or `ffprobe` cannot parse the file | blocker | yes / no | render | no |
| `format.unsupported_combination` | Format, media kind and production mode are not an allowed combination | blocker | no | — | no |
| `format.wrong_media_kind` | Final asset is an image where a video is required, or the reverse | blocker | no | — | no |
| `format.wrong_dimensions` | Aspect ratio is right but the pixel size is not the target | major | yes | render | yes |
| `format.wrong_aspect_ratio` | Aspect ratio is outside tolerance | major | yes / no | render | yes |
| `format.resolution_too_low` | Manual upload narrower than `min_width` | major | no | — | yes |
| `format.wrong_image_type` | Image is not `image_mime` (for example PNG or WebP) | major | yes | render | no |
| `format.file_too_large` | File is larger than `max_file_bytes` | major | yes | render | no |
| `format.duration_too_short` | Video shorter than `min_duration_s` | major | yes / no | script | yes |
| `format.duration_too_long` | Video longer than `max_duration_s` | major | yes / no | script | no |
| `format.wrong_container` | Container is not `mp4` | major | yes | render | no |
| `format.wrong_video_codec` | Video codec is not `h264` | major | yes | render | no |
| `format.wrong_pixel_format` | Pixel format is not `yuv420p` | major | yes | render | no |
| `format.wrong_audio_codec` | An audio stream exists and is not `aac` | major | yes | render | no |
| `format.fps_out_of_range` | Frame rate below `fps_min` or above `fps_max` | major | yes | render | no |
| `format.audio_track_missing` | No audio stream. `major` when `audio_required`, otherwise `minor` | major / minor | yes | render | yes |
| `format.cover_missing` | Reel without `cover_asset` | major | yes | render | yes |
| `format.cover_wrong_dimensions` | Cover is not an image in the reel's aspect ratio | major | yes | render | yes |
| `format.caption_too_long` | Published caption longer than `caption_max_chars` | major | yes | copy | no |
| `format.too_many_hashtags` | More hashtags than `max_hashtags` | major | yes | copy | no |
| `format.caption_not_allowed` | Caption or hashtags present where `caption_allowed` is false | minor | yes | copy | yes |
| `format.alt_text_missing` | `alt_text` empty where `alt_text_expected` | minor | yes | copy | yes |
| `format.duration_differs_from_script` | Video duration differs from the script's `duration_seconds` by more than 15% | minor | no | — | yes |
| `format.metadata_mismatch` | Probe values differ from the `Asset` columns | info | no | — | yes |
| `format.checker_error` | The checker crashed (E07-S01 rule 11) | blocker | no | — | yes |

Format blockers and the findings Instagram enforces strictly (file type, size, codec, caption and hashtag limits) cannot be overridden, because publishing would fail.

Message examples (messages always carry the measured and the expected value):

- `format.wrong_dimensions`: "Image is 1200 × 1500 px; this format needs 1080 × 1350 px."
- `format.duration_too_long`: "Video is 97.4 s; reels may be at most 90 s."
- `format.caption_too_long`: "Caption with hashtags is 2,431 characters; the limit is 2,200."
- `format.too_many_hashtags`: "8 hashtags; the limit for this format is 5."

### Rights check

15. **Input set.** The checker uses the shared resolver `production.services.rights.version_input_assets(version)` (E06-S01 rule 12a), which returns every asset that went into the version: `final_asset`, `cover_asset`, `music_asset`, `clips[].asset_id`, `frames[].asset_id`, `frames[].background_asset_id`, and, transitively, every asset listed in `Asset.meta.inputs` of those (depth limit 4, cycles ignored). E06-S05, E06-S06 and the publisher use the same resolver, so disclosure and rights are decided on one input set. The brand logo is not an asset row and is treated as owned. The resolved list (`asset_id`, `kind`, `role`, `origin`, `rights_status`, `rights_expires_at`) is stored in `QCResult.details.assets`.
16. Assets with `origin = rendered` are containers: their own `rights_status` is not judged; their inputs are. A rendered asset with no `meta.inputs` on a `pipeline` version raises `rights.inputs_untracked`.
17. Assets with `origin = ai_generated` are treated as cleared for rights, and count for the disclosure rule.
18. **Reference date** for expiry is the date of the item's slot (`PlanSlot.scheduled_at` in the account timezone), or today when the item has no slot.
19. An asset is expired when `rights_status = expired`, or `rights_expires_at` is before the reference date.
20. A licence note is required for every asset with `origin = licensed` and for every asset with `role = music` whose origin is not `ai_generated`. "Required" means `license_note` is not blank after trimming.
21. For a `manual_upload` version the final asset itself is judged like any uploaded asset: if its `rights_status` is `unknown`, the check escalates so that a person confirms the rights.
22. **AI disclosure.** Disclosure is required when `BrandProfile.ai_disclosure` is `always`, or when it is `generated_only` and the input set contains at least one `ai_generated` asset. It is never required when the setting is `never`.
23. The disclosure is a fixed sentence per content language from the setting `SOCIALHUB_AI_DISCLOSURE_TEXT` (JSON map; defaults `{"en": "Made with the help of AI.", "fa": "این محتوا با کمک هوش مصنوعی تولید شده است."}`). For formats with a caption, the published caption must contain the sentence (compared after Unicode NFC normalisation, whitespace collapsing and, for Persian, unifying Arabic and Persian forms of ی and ک). If it is missing, `rights.ai_disclosure_missing` is raised; the fix appends the sentence as the last line before the hashtags, with no AI call.
24. Stories have no caption. When disclosure is required for a story, the checker raises the `info` finding `rights.ai_disclosure_story` reminding the operator that Instagram's own label must be set by hand if the brand requires it.

#### Rights finding catalogue

| Code | Raised when | Severity | Auto-fixable | Fix | Override |
| --- | --- | --- | --- | --- | --- |
| `rights.restricted` | An input asset has `rights_status = restricted` | blocker | no | — | no |
| `rights.unknown` | An input asset has `rights_status = unknown` | blocker | no | — | no |
| `rights.expired` | An input asset is expired on the reference date | blocker | no | — | no |
| `rights.license_note_missing` | A `licensed` asset has no licence note | blocker | no | — | no |
| `rights.music_license_missing` | A music asset has no licence note | blocker | no | — | no |
| `rights.inputs_untracked` | A rendered asset on a pipeline version lists no inputs | blocker | no | — | yes |
| `rights.ai_disclosure_missing` | Disclosure is required and the caption does not contain the sentence | major | yes | copy | no |
| `rights.ai_disclosure_story` | Disclosure is required for a story | info | no | — | yes |
| `rights.expires_soon` | An input asset expires within 7 days after the reference date | info | no | — | yes |
| `rights.checker_error` | The checker crashed | blocker | no | — | yes |

The rights blockers that name an asset (`rights.restricted`, `rights.unknown`, `rights.expired` and the two licence codes) are never overridable. The way out is to correct the asset's rights metadata in the library (E06-S01) and run the checks again (E07-S01), or to replace the asset. This keeps the record of why something was publishable on the asset, where the next item that uses it will find it.

Every rights finding has `location = {"asset_id": <id>}` (the offending input asset) and a message that names it: "Background image 'office-team.jpg' has unknown usage rights." The suggestion says what to do: "Open the asset in the library, record where the right to use it comes from, set the status to Cleared, then run the checks again."

## Data

Reads `ContentItem`, `ContentVersion`, `Asset`, `BrandProfile`, `PlanSlot` and the format registry. Writes only `QCResult` (through E07-S01), with:

- `details.probe` for format, for example `{"kind": "video", "width": 1080, "height": 1920, "duration_s": 28.4, "container": "mp4", "video_codec": "h264", "pixel_format": "yuv420p", "fps": 30.0, "audio_codec": "aac", "bytes": 9120331, "cover": {"width": 1080, "height": 1920, "mime": "image/jpeg"}, "caption_chars": 412, "hashtag_count": 4}`.
- `details.assets` and `details.disclosure` for rights, for example `{"assets": [{"asset_id": 311, "kind": "image", "role": "background", "origin": "ai_generated", "rights_status": "cleared", "rights_expires_at": null}], "disclosure": {"required": true, "reason": "generated_only", "present": false}}`.

New setting: `SOCIALHUB_AI_DISCLOSURE_TEXT` (rule 23). E06-S06 rule 4a appends the same sentence when disclosure is required, so this finding is rare and mostly catches a caption saved before an AI asset was added.

## API

None. Results are read through the endpoints in E07-S06.

## Background work

None of its own. Both checkers run inside the `qc.run` job (E07-S01) on the `default` queue. `ffprobe` calls use a 30-second timeout per file; a timeout is reported as `format.unreadable_media`.

## AI

None.

## Panel

None in this story. E07-S06 displays the findings; it shows `details.probe` as a small "Measured" table under the format result and `details.assets` as a list of input assets, each linking to the library, under the rights result.

## Acceptance criteria

1. Given a pipeline feed post whose final image is a 1080 × 1350 JPEG of 1.2 MB with a 400-character caption and 4 hashtags (limit 5) and alt text, when the format check runs, then it returns no findings and the outcome is `pass`.
2. Given a manually uploaded reel that is 1080 × 1920 H.264/AAC MP4 at 30 fps, 28 s, with a cover, when the format check runs, then it passes.
3. Given a manually uploaded 720 × 1280 reel, then `format.wrong_dimensions` is raised as `major`, auto-fixable, with both sizes in the message, and the check outcome is `revise`.
4. Given a manually uploaded 1920 × 1080 (landscape) reel, then `format.wrong_aspect_ratio` is raised as not auto-fixable and the check outcome is `escalate`.
5. Given a pipeline reel of 97 s, then `format.duration_too_long` is auto-fixable with fix `script`; given the same file as a manual upload, it is not auto-fixable.
6. Given a reel in HEVC inside a MOV container with no audio stream, then `format.wrong_container`, `format.wrong_video_codec` and `format.audio_track_missing` (major) are all raised, each auto-fixable.
7. Given a caption of 2,180 characters and five hashtags that bring the published text to 2,260 characters, then `format.caption_too_long` is raised with the count 2,260.
8. Given a story version with a non-empty caption, then `format.caption_not_allowed` is raised as `minor` and the check outcome stays `pass`.
9. Given a reel with no cover asset, then `format.cover_missing` is raised and the outcome is `revise`.
10. Given a final file that cannot be parsed, then `format.unreadable_media` is raised and, in the same run, the design check records `design.not_checked`.
11. Given a pipeline version whose rendered frame used a background asset with `rights_status = unknown`, when the rights check runs, then `rights.unknown` is raised with that background's `asset_id` as location and the check outcome is `escalate`.
12. Given a music asset with `rights_status = cleared` and an empty licence note, then `rights.music_license_missing` is raised.
13. Given an asset whose `rights_expires_at` is the day before the slot date, then `rights.expired` is raised; given it expires three days after the slot date, then only `rights.expires_soon` (info) is raised.
14. Given `ai_disclosure = generated_only`, one AI-generated background, and a caption without the disclosure sentence, then `rights.ai_disclosure_missing` is raised as auto-fixable with fix `copy`; given the caption contains the sentence, then nothing is raised.
15. Given `ai_disclosure = never` and AI-generated assets, then no disclosure finding is raised.
16. Given `ai_disclosure = always` on a story, then `rights.ai_disclosure_story` (info) is raised and the outcome stays `pass`.
17. Given all input assets are `cleared` with future or empty expiry, then the rights check passes and `details.assets` lists every input.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E07-S02-BE1 | Media probe utility | `quality/media.py`: `probe_image(path)` with Pillow, `probe_video(path)` with `ffprobe` JSON output, rotation handling, 30 s timeout, typed result dataclass. Add `ffmpeg` to `backend/Dockerfile` so the default worker has `ffprobe`. Unit tests with small fixture files | 0.5 |
| E07-S02-BE2 | Format checker | `quality/checkers/format.py`: registry lookup, media rules 5–14, caption length through E08-S01's `full_caption(version)`, hashtag counting, cover check, `pipeline` versus `manual_upload` fixability, messages with measured and expected values, `details.probe`. Catalogue entries for every `format.*` code | 0.5 |
| E07-S02-BE3 | Input asset resolution and rights checker | Input set from E06-S01's `version_input_assets` resolver (add the depth limit and cycle guard there if missing); `quality/checkers/rights.py`: status, expiry against the slot date, licence note rules, container handling for rendered assets, `details.assets`. Catalogue entries for every `rights.*` code | 0.5 |
| E07-S02-BE4 | AI disclosure rule and test matrix | Disclosure decision (rule 22), sentence matching with normalisation (rule 23), story note (rule 24), `SOCIALHUB_AI_DISCLOSURE_TEXT` setting with defaults in `.env.example`; parametrised tests covering every catalogue code for both checkers | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| — | None | Display is part of E07-S06 | 0 |

### Test

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| — | None beyond the tests in each subtask | | 0 |

## Test notes

- Fixture media in `backend/apps/quality/tests/media/`, generated once with FFmpeg and committed (each under 200 KB): a correct JPEG for each image format; a PNG; an oversize JPEG; a correct 6-second 1080 × 1920 H.264/AAC MP4; the same without audio; an HEVC MOV; a landscape MP4; a 720 × 1280 MP4; a truncated (corrupt) MP4; a correct cover.
- One parametrised test per catalogue code asserting code, severity, `auto_fixable` and that the message contains the measured value.
- Fixability matrix test: the same defect on a `pipeline` and a `manual_upload` version.
- Rights: a three-level input chain (final video → rendered frame → background image), a cycle in `meta.inputs`, and a missing asset ID in `meta.inputs` (ignored with a logged warning).
- Disclosure: all three `ai_disclosure` values × with and without generated assets × caption format and story; Persian sentence matching with Arabic and Persian letter forms.
- The registry is stubbed in unit tests so limits can be varied; one integration test uses the real registry from E04-S01.

## Later

- Carousels: the format check already iterates "media files of the version"; a carousel adds a list instead of one final asset.
- Instagram's AI label through the provider can replace the caption sentence; the decision logic in rule 22 stays.
- A rights document upload on `Asset` would let `rights.license_note_missing` accept a file as evidence.
- Loudness normalisation and bitrate checks can be added as `minor` findings with fix `render`.
