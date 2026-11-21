# E07-S04 — Design check

| | |
| --- | --- |
| Epic | E07 Quality check |
| Priority | Must |
| Estimate | BE 2 d · FE 0 d · QA 0 d |
| Depends on | E07-S01, E00-S03, E00-S05, E04-S01, E06-S02, E06-S03 |
| Needed by | E07-S05, E07-S06 |

## User story

As an operator, I want the finished image or video looked at the way a designer would look at it, so that nothing goes out with a missing logo, unreadable or clipped text, broken Persian lettering, or content sitting under Instagram's interface.

## Context

This is the only check that looks at pixels. It combines two sources:

- **Render warnings.** When E06 renders a frame from a template, the renderer knows things exactly: a text box overflowed, a font lacked a glyph, a background was upscaled. Those warnings are turned into findings by rule.
- **Vision.** Claude looks at the final image, or at up to four still images taken from the final video, together with the brand's logo and colours, and reports what a careful reviewer would see.

It runs in parallel with the copy and facts checks inside the `qc.run` job (E07-S01).

## Scope

**In**

- Choosing and extracting the images to inspect.
- Rule findings from render warnings.
- The AI task `qc.design` with images, and the mapping of its issues to catalogue findings.
- Catalogue entries for `design.*`.
- Fake-provider fixtures.

**Out (later)**

- Pixel-exact measurement of contrast, logo position and safe areas by image analysis.
- Motion review (pacing, transitions, flicker) and audio review.
- Comparing against a set of approved brand reference designs.
- Saving the inspected stills as assets.

## Behaviour and rules

### What is inspected

1. Image formats (`feed_post`, image `story`): the final asset.
2. Video formats (`reel`, video `story`): up to `SOCIALHUB_QC_DESIGN_MAX_IMAGES` (default 4) stills:
   - the cover first, when the version has a `cover_asset`;
   - then key frames from the final video. When the version has frames, one still at the midpoint of each frame's time range (from `ContentVersion.frames[].duration_seconds`, the version's working copy including operator overrides), keeping the first frame, the last frame and evenly spaced frames in between until the limit is reached. When there are no frames (manual upload), stills at 10%, 40%, 70% and 95% of the duration.
3. Stills are extracted with FFmpeg from the local copy of the final video (`ffmpeg -ss <t> -i <file> -frames:v 1 -q:v 2 <out>.jpg`). They are taken from the final video, not from the rendered frame images, so that the check sees what viewers will see, including overlays and scaling.
4. Every image is scaled so its longer side is at most 1568 pixels and encoded as JPEG quality 85 before it is sent.
5. When the brand profile has a logo, the logo is sent as an extra first image, labelled as a reference ("this is the brand logo; it is not part of the content"). `logo_light` is used unless only `logo_dark` exists; SVG logos are rasterised to 512 pixels wide. The reference does not count against the limit in rule 2.
6. `QCResult.details.frames_checked` records what was inspected: `[{"image_index": 1, "kind": "cover" | "frame" | "final", "frame_index": 2, "timestamp_ms": 6000, "asset_id": 880}]`. Stills are temporary files and are deleted with the run's temporary directory.
7. If the format check found `format.asset_missing` or `format.unreadable_media`, this check does not run the AI and records only `design.not_checked` (E07-S01 rule 9).

### Rule findings from render warnings

8. The checker reads `ContentVersion.render_warnings`, the single list written by E06-S02, S03, S04 and S07. Each warning is `{"code", "message"}` plus one locator (`frame_index`, `shot_index`, `asset_id` or `field`); the finding keeps the locator.

| Render warning | Finding | Notes |
| --- | --- | --- |
| `text_overflow` | `design.text_overflow` | The text did not fit its box at the template's minimum size |
| `background_low_resolution`, `clip_low_resolution` | `design.low_resolution_source` | An AI background or a footage clip is below the useful resolution |
| `logo_not_configured`, `brand_incomplete` | `design.logo_not_configured` or `design.render_warning` (info) | Brand profile gaps, not defects of this content |
| `banned_term`, `first_line_long`, `rights_not_cleared`, `clip_padded`, `clip_cropped_heavily` | — | Ignored here; the copy, format and rights checks cover them |
| any other code | `design.render_warning` | Passed through as a note |

The renderer always keeps text, logo and handle inside the safe area (E06-S02 rule 13), so there is no render warning for it.

9. When the brand profile has no logo file at all, the checker adds the `info` finding `design.logo_not_configured` (not auto-fixable) and tells the model not to judge the logo.

### Vision findings

10. The checker calls `qc.design` once with the images and the context in the AI section. The model reports issues from a fixed code list, each tied to one image by its index.
11. Location of a finding: `{"frame_index": n}` when the image is a key frame that maps to a script frame; otherwise `{"asset_id": id}` of the cover or final asset, with the time in the message for video stills ("At 0:12, …").
12. Confidence: the model gives each issue a confidence of `low`, `medium` or `high`. A `major` issue with `low` confidence is recorded as `minor`. A `blocker` keeps its severity at any confidence, because a possible lettering error or inappropriate image should be seen by a person.
13. Duplicates: when a rule finding and a vision issue describe the same problem on the same frame (`design.text_overflow` and `text_clipped`), only the rule finding is kept.
14. Fixability depends on where the pixels came from:
    - On a `pipeline` version, a design finding is auto-fixable when a re-render or a script change can fix it (see the catalogue).
    - On a `manual_upload` version, no design finding is auto-fixable. The system cannot edit an uploaded file, so `major` findings escalate.
    - `design.image_quality` and `design.text_in_generated_image` are auto-fixable only when the affected frame's background asset has `origin = ai_generated` (it can be generated again, E06-S05). For an uploaded or licensed background they are not.
15. `QCResult.checker = ai`, `ai_run` points to the `qc.design` call. If the AI call fails, the rule findings already found are kept next to `design.checker_error`.

### Design finding catalogue

"Fix" is the rework level for `pipeline` versions (E07-S05): `render` re-renders the affected frames with adjusted render options; `script` changes the frame's text or visual direction and then re-renders. On `manual_upload` versions every row is not auto-fixable (rule 14).

| Code | Raised when | Source | Severity | Auto-fixable (pipeline) | Fix | Override |
| --- | --- | --- | --- | --- | --- | --- |
| `design.logo_missing` | The brand has a logo and it is not visible where the template or format expects it. The renderer always draws a configured logo, so this points to a template or asset defect | AI | major | no | — | yes |
| `design.logo_incorrect` | Logo is distorted, recoloured, cropped, too small to recognise, or the wrong variant for the background | AI | major | yes | render | yes |
| `design.off_brand_colors` | Dominant colours do not relate to the brand palette. `minor` on pipeline versions (templates apply the palette), `major` on manual uploads | AI | minor / major | no | — | yes |
| `design.illegible_text` | Text is too small or has too little contrast with what is behind it | AI | major | yes | render | yes |
| `design.text_overflow` | Text does not fit its box (renderer) | rule | major | yes | script | yes |
| `design.text_clipped` | Text is visibly cut off or runs outside the image | AI | major | yes | script | yes |
| `design.safe_area_violation` | Text or logo sits inside the format's unsafe zone from the registry (for stories and reels: the top and bottom bands covered by Instagram's interface). The renderer always enforces the safe area, so this is a template defect or a manual upload | AI | major | no | — | yes |
| `design.rtl_shaping_error` | Persian or Arabic letters are disconnected, reversed, or mixed-direction text and numbers are in the wrong order | AI | blocker | no | — | yes |
| `design.image_quality` | Pixelation, compression artefacts, or distorted generated imagery (hands, faces, objects) | AI | major | only for AI-generated backgrounds | render | yes |
| `design.text_in_generated_image` | A generated background contains letters or pseudo-text | AI | major | only for AI-generated backgrounds | render | yes |
| `design.inappropriate_imagery` | Imagery that could offend or that is unsafe for the brand | AI | blocker | no | — | yes |
| `design.off_design_notes` | The result ignores the script's design notes (mood, layout, imagery style) | AI | minor | no | — | yes |
| `design.inconsistent_frames` | Frames of one video look like they belong to different designs | AI | minor | no | — | yes |
| `design.low_resolution_source` | An AI background or a footage clip is below the useful resolution (render warnings `background_low_resolution`, `clip_low_resolution`) | rule | minor | no | — | yes |
| `design.logo_not_configured` | The brand profile has no logo, so the logo was not checked | rule | info | no | — | yes |
| `design.render_warning` | Any other renderer warning | rule | info | no | — | yes |
| `design.not_checked` | The media could not be opened, so nothing was inspected | — | blocker | no | — | yes |
| `design.checker_error` | The checker crashed or the AI call failed | — | blocker | no | — | yes |

`design.rtl_shaping_error` is not auto-fixable on purpose. Broken lettering comes from a template or font defect, and rendering again would reproduce it. A person must see it, and a developer must fix the template.

How the `render` fix works for each auto-fixable design finding (applied by the revise job in E07-S05). E06-S02 supports exactly two per-frame render options, stored in `ContentVersion.frames[].render_options` and part of the input hash:

| Finding | Fix |
| --- | --- |
| `design.logo_incorrect` | Set `render_options.logo_variant` to the opposite of the variant last used for that frame (`light` ↔ `dark`), then render the frame again |
| `design.illegible_text` | Set `render_options.text_backdrop = true` (a panel of the brand background behind every text slot), then render the frame again |
| `design.image_quality`, `design.text_in_generated_image` | Call the E06-S05 image service to generate the frame's background again, with "no text, no letters" added to the prompt, then render the frame again |

## Data

Reads `ContentVersion` (`render_warnings`; `frames[]` for `headline`, `body`, `duration_seconds`, `render_options`, `background_asset_id`), its cover and final `Asset` rows, `ScriptVersion.payload` (`design_notes` only), `BrandProfile` (logo files, `colors`, `fonts`, `handle_display`), the format registry (`safe_area`), and `InstagramAccount.content_language`. Writes only `QCResult` (through E07-S01).

`QCResult.details` for design: `{"frames_checked": [...], "logo_reference": true, "render_warnings": n, "ai_issues": n, "downgraded_low_confidence": n, "deduplicated": n}`.

New setting: `SOCIALHUB_QC_DESIGN_MAX_IMAGES` (default 4).

Relies on other stories' data: `ContentVersion.render_warnings` and `frames[].render_options` (E06-S02) and a `safe_area` entry per format in the registry (`{"top", "bottom", "left", "right"}` in pixels of the target size, E04-S01).

## API

None. Results are read through the endpoints in E07-S06.

## Background work

None of its own. The checker runs in the `qc.run` job's thread pool (E07-S01). Still extraction uses a 20-second timeout per still; a failed extraction skips that still, and if no image could be produced at all the checker raises, which E07-S01 records as `design.checker_error`.

## AI

Task `qc.design`, called through `run_text(task="qc.design", variables=…, images=[…], schema=DesignReview, account_id=…, job_id=…)` as described in [AI-INTEGRATION.md](../../AI-INTEGRATION.md). Images are sent as base64 image blocks before the text.

| | |
| --- | --- |
| Effort | medium |
| Cached prefix | System prompt, then the brand block: palette as hex values with their roles, font names, `handle_display`, content language, whether a logo reference is attached |
| Per-call input | Format, media kind and target size; the safe area in pixels and as fractions of the image; the list of images with index, kind and time; for each key frame the text that should appear on it (`headline` and `body` from `ContentVersion.frames`, including overrides), so the model can compare intended and rendered text; the script's design notes; whether backgrounds are AI-generated |
| Instructions (summary) | Act as a brand designer reviewing final artwork before publication. Image 0, when present, is the logo reference and not content. For each content image, check the items on the code list and report only what you can see. Compare the visible text with the intended text for that frame, character by character for Persian, and report disconnected or reversed letters as `rtl_shaping_error`. Do not judge the wording, facts or caption. State your confidence. If unsure whether something is a defect, report it with `low` confidence instead of leaving it out |

```python
class DesignIssue(BaseModel):
    code: Literal["logo_missing", "logo_incorrect", "off_brand_colors", "illegible_text",
                  "text_clipped", "safe_area_violation", "rtl_shaping_error", "image_quality",
                  "text_in_generated_image", "inappropriate_imagery", "off_design_notes",
                  "inconsistent_frames"]
    image_index: int = Field(..., ge=1, description="Index of the content image the issue is on.")
    region: Literal["top", "middle", "bottom", "left", "right", "whole"] = "whole"
    message: str = Field(..., max_length=240, description="One sentence in English describing what is visible.")
    suggestion: str = Field("", max_length=300)
    confidence: Literal["low", "medium", "high"]

class ImageAssessment(BaseModel):
    image_index: int
    logo_visible: bool | None = Field(None, description="Null when no logo reference was provided.")
    text_matches_intended: bool | None = Field(None, description="Null when the image has no intended text.")

class DesignReview(BaseModel):
    images: list[ImageAssessment] = Field(..., max_length=4)
    issues: list[DesignIssue] = Field(..., max_length=15)
    overall_comment: str = Field(..., max_length=300)
```

Failure handling:

| Failure | Result |
| --- | --- |
| Gateway error after retries, timeout, `provider_not_configured` | `design.checker_error`; rule findings are kept (rule 15) |
| Refusal | `design.checker_error` with "refused" in the message. The item escalates, which is right: a person should look at an image the model would not review |
| Issue with an `image_index` that was not sent, or an unknown code | Dropped and logged |
| Schema validation failure | Treated as a gateway error |

Fake provider: fixtures in the prompt directory, `apps/ai/prompts/qc.design/fixture.<variant>.json`, selected by a marker in the item title used in tests (`[qc:design-clean]`, `[qc:logo-missing]`, `[qc:rtl]`, `[qc:low-confidence]`, `[qc:design-error]`).

## Panel

None in this story. E07-S06 shows design findings beside the media preview; selecting a finding with a `frame_index` jumps the preview to that frame, and for video stills to the time recorded in `details.frames_checked`.

## Acceptance criteria

1. Given a pipeline feed post rendered from a template with the logo, readable text and no render warnings (fixture `[qc:design-clean]`), when the design check runs, then it returns `pass` and `details.frames_checked` lists one image of kind `final`.
2. Given a reel with a cover and a six-frame script, when the check runs with the default limit, then four images are inspected: the cover, the first frame, one middle frame and the last frame, and each key frame's `timestamp_ms` is the midpoint of its script frame.
3. Given a manually uploaded 40-second reel with no script and no cover, then stills at 4 s, 16 s, 28 s and 38 s are inspected.
4. Given the version's `render_warnings` contains `{"code": "text_overflow", "frame_index": 2}`, then `design.text_overflow` is raised with location `{"frame_index": 2}`, auto-fixable, fix `script`; and if the model also reports `text_clipped` on that frame, only the rule finding is kept and `details.deduplicated` is 1.
5. Given the model reports `logo_missing` with `high` confidence on a pipeline version with a configured logo, then the finding is `major`, not auto-fixable, and the check outcome is `escalate`.
6. Given the model reports `illegible_text` with `high` confidence on frame 3 of a pipeline version, then the finding is `major`, auto-fixable with fix `render`, and the outcome is `revise`; given the same report on a `manual_upload` version, then it is not auto-fixable and the outcome is `escalate`.
6a. Given the version's `render_warnings` contains `background_low_resolution` for frame 1 and `banned_term` for the caption, then `design.low_resolution_source` (minor) is raised for frame 1 and nothing is raised for `banned_term`.
7. Given the model reports `illegible_text` with `low` confidence, then the finding is recorded as `minor` and does not change the outcome.
8. Given the model reports `rtl_shaping_error` with `low` confidence, then the finding stays `blocker` and the check outcome is `escalate`.
9. Given `image_quality` on a frame whose background is AI-generated, then it is auto-fixable; given the background is an uploaded image, then it is not.
10. Given the brand profile has no logo, then no logo reference is sent, `design.logo_not_configured` (info) is added, and any `logo_missing` issue from the model is dropped.
11. Given the AI call fails and a render warning exists, then the result contains both the rule finding and `design.checker_error`.
12. Given the format check reported `format.unreadable_media`, then no AI call is made and the result is a single `design.not_checked` finding.
13. Given a 1080 × 1920 final image, then the image sent to the model is 882 × 1568 pixels.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E07-S04-BE1 | Image selection and preparation | `quality/frames.py`: key-frame time selection from `ContentVersion.frames` or by percentages, FFmpeg still extraction with timeout, downscale and JPEG encode with Pillow, logo reference preparation including SVG rasterisation, `frames_checked` records | 0.5 |
| E07-S04-BE2 | Rule findings from render warnings | Read `ContentVersion.render_warnings`; mapping table with ignored codes (rule 8); `design.logo_not_configured`; catalogue entries for rule codes | 0.25 |
| E07-S04-BE3 | `qc.design` task and checker | Prompt files and `schema.py` in `apps/ai/prompts/qc.design/`; variables builder (brand block, safe area, intended text per image, design notes); `quality/checkers/design.py` mapping issues to findings and locations; catalogue entries for AI codes | 0.75 |
| E07-S04-BE4 | Post-processing, fixtures and tests | Confidence downgrade (rule 12), deduplication (rule 13), origin-based fixability (rule 14), rule findings kept on AI failure; fake fixtures; tests for every acceptance criterion | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| — | None | Display is part of E07-S06 | 0 |

### Test

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| — | None beyond the tests in each subtask | | 0 |

## Test notes

- Key-frame selection is a pure function; test it table-driven: 1, 2, 4, 6 and 12 script frames, with and without a cover, and limits of 2 and 4.
- Extraction tests use the 6-second fixture video from E07-S02 and assert image size and count.
- Checker tests use the fake provider; one test per catalogue code for severity and fixability on `pipeline` and `manual_upload` versions.
- A small manual evaluation set lives in `backend/apps/quality/tests/eval/design/`: correct renders, a render with the logo removed, text pushed into the top band, a deliberately broken Persian render (letters disconnected by rendering without shaping), and a low-contrast frame. It is run by hand against the real provider when the `qc.design` prompt version changes, and the results are noted in the pull request. It is not part of CI.
- The broken-Persian sample is also the regression sample for the render templates in E06-S02.

## Later

- Deterministic measurements (contrast under each text box, logo position, font fallback) can be reported by the renderer as more warning codes; the mapping table in rule 8 is where they plug in.
- Approved reference designs per account could be attached as extra reference images, the same way the logo is.
- Motion and audio review would add a sixth check; the orchestration in E07-S01 iterates a list of checkers.
- Saving inspected stills as assets would let the review page show exactly what the model saw.
