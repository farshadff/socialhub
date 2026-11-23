# E06-S05 — AI image generation

| | |
| --- | --- |
| Epic | E06 Assets and copy |
| Priority | Should |
| Estimate | BE 1.5 d · FE 1 d |
| Depends on | E00-S05, E06-S01, E06-S02, E06-S07 |
| Needed by | — |

## User story

As an operator, I want a fitting background image generated for a frame from the script's visual description, so that a design does not wait for a photo and still looks intentional.

## Context

Each script frame has a `visual_prompt`: a description of the background or illustration, written by the script step with the instruction that it contains no text. Templates that accept an image (`title`, `statement`, `quote`, `image_caption`, `cta`) look better with one. This story generates that image through the AI gateway's image provider (OpenAI), stores it as an asset, and attaches it to the frame.

Generated images never contain the frame's words. All text is drawn by the render templates (E06-S02), which is what keeps Persian text correct.

It is a Should story. Without it, frames use an uploaded or library image, or the brand background colour.

## Scope

**In**

- Generating one background image for one frame, on request.
- Optional automatic generation for frames that need an image during `production.start`.
- Prompt building from the frame, the script's design notes and the brand profile.
- Storing the result with origin, rights and prompt recorded.
- The Generate image controls in the frame editor.

**Out (later)**

- Image editing, inpainting, variations, upscaling, reference images.
- Generating several options to choose from in one call.
- Generated logos, icons or any image containing text.
- Video generation.

## Behaviour and rules

### When an image is generated

1. **On request.** `POST …/production/generate-image/` for one frame of the current draft version. Allowed when the item is `in_production`, the version is `draft` with origin `pipeline`, and no job is active on the item.
2. **Automatically.** During the backgrounds step of `production.start` (E06-S07), when `SOCIALHUB_PRODUCTION_AUTO_IMAGES` is true (default false), for each frame where all of these hold: the template's `image_slot` is `optional` or `required`; the frame has no `background_asset_id`; `visual_prompt` is not empty. Frames are processed one after another. A failure for one frame does not fail production: the frame keeps no background and gets the warning `background_missing` (for `image_caption`, which requires an image, the later render reports `background_required`).
3. Templates with `image_slot = none` (`stat`, `list`) never get an image; a request for such a frame returns `400 validation_error`.
4. **Limit.** At most `SOCIALHUB_AI_MAX_IMAGES_PER_ITEM` (default 12) generated images per content item across all its versions. The next request returns `429 rate_limited` with `retryable: false`. Each image is one logical call against the gateway's per-job limit `SOCIALHUB_AI_MAX_CALLS_PER_JOB` (20); provider retries inside that call do not count. Automatic generation inside one `production.start` job is therefore at most 12 image calls plus at most 2 copy calls.

### Prompt

5. The prompt sent to the provider is built in code from four parts, in this order:

   | Part | Source | Example |
   | --- | --- | --- |
   | Subject | The request's `prompt` if given, otherwise the frame's `visual_prompt` | "Soft morning light on a tidy desk with a notebook and a cup, seen from above" |
   | Style | `design_notes.imagery_style` and `design_notes.mood` of the script | "Style: clean editorial photography. Mood: calm, optimistic." |
   | Palette | Colour names derived from the brand profile's `primary` and `background` hex values (nearest of a fixed list of 24 names) | "Palette leaning toward teal and warm white." |
   | Constraints | Fixed text | "No text, letters, numbers, logos, watermarks or user-interface elements anywhere in the image. Leave calm, uncluttered space for a text overlay. Vertical composition." |

6. The subject is limited to 600 characters. Line breaks are collapsed. The assembled prompt is stored on the asset.
7. The subject is passed to the model as written; it is not translated. The script step writes `visual_prompt` in English regardless of content language (a rule of the `script.generate` task), because image models follow English descriptions most reliably.
8. Text overlay space: for templates whose text sits in the lower half (`title`, `cta`), the constraints add "Keep the lower half simple."; for `image_caption`, "Keep the main subject in the upper two thirds."

### Size

9. The gateway is asked for the provider's portrait size closest to the layout's aspect ratio, at the largest standard size the configured model supports. The renderer then covers the frame with it (`object-fit: cover`), so a small difference in aspect ratio only crops the edges.

   | Layout | Canvas | Requested |
   | --- | --- | --- |
   | `4x5` | 1080 × 1350 | Portrait, nearest ratio to 4:5 |
   | `9x16` | 1080 × 1920 | Portrait, nearest ratio to 9:16 |

   The exact size strings depend on the model in `SOCIALHUB_AI_IMAGE_MODEL`. They live in one mapping (`ai/providers/openai_images.py`) and are confirmed against OpenAI's documentation when implementing.
10. If the returned image's short side is below 1,000 px, it is still used and the frame gets the warning `background_low_resolution`.

### Result

11. The image is stored as an `Asset` through the same pipeline as uploads (E06-S01: checksum, dimensions, thumbnail, storage key) with:

    | Field | Value |
    | --- | --- |
    | `content_item` | The item |
    | `kind` / `role` | `image` / `background` |
    | `origin` | `ai_generated` |
    | `rights_status` | `cleared` |
    | `license_note` | "Generated with {model}" |
    | `meta` | `{"prompt", "subject", "model", "size", "frame_index", "ai_run_id"}` |

12. **Attach.** With `attach: true` (the default) the frame's `background_asset_id` is set to the new asset, the frame's state becomes `stale`, `background_asset_id` is added to its `overridden` list, and the version's `render_status` becomes `pending`.
12a. **Service.** All three callers — the endpoint's task, the backgrounds step of `production.start`, and the E07-S05 revise loop — use one synchronous service: `production.services.images.generate_frame_background(version, frame_index, *, subject=None, extra_constraints=(), attach=True) -> Asset`. It builds the prompt (rules above, plus any `extra_constraints` such as "no text, no letters"), enforces the per-item cap, calls `ai.gateway.run_image`, stores the asset and, when `attach` is true, applies rule 12. It never re-renders; the caller decides whether to render (rule 13 for the endpoint, the Render step for E07-S05).
13. **Re-render.** With `rerender: true` (the default) the same job then renders that frame and rebuilds the final asset (the `production.render` steps of E06-S02 and E06-S03). With `rerender: false` the operator re-renders later.
14. A previous generated background of that frame is not deleted; it stays in the item's assets so the operator can switch back. Unused ones can be deleted from the library.
15. **Disclosure.** The production resource exposes `uses_ai_generated: true` when any asset returned by the shared resolver `production.services.rights.version_input_assets(version)` has `origin = ai_generated`. The resolver returns every asset a version uses: `final_asset`, `cover_asset`, `music_asset`, `clips[].asset_id`, `frames[].asset_id`, `frames[].background_asset_id`, and, recursively, each of their `meta.inputs`. The caption disclosure line (E06-S06 rule on AI disclosure), the rights check (E07-S02) and, in Phase 2, the publisher (E08-S03) all use the same resolver together with the brand profile's `ai_disclosure` setting.

### Failures

16. **Refused.** If the provider declines the prompt, the gateway records an `AIRun` with status `refused` and the job fails with `error_code = provider_error` and `error_detail = "refused"`. The frame is unchanged.
17. **Not configured.** With no OpenAI key, or the image provider set to `fake` in a hosted environment without fixtures, the endpoint returns `503 provider_not_configured` before creating a job. Locally the `fake` provider returns a deterministic gradient image.
18. **Transient errors** retry inside the gateway up to three times. After that the job fails with `provider_error` and `retryable` semantics left to the operator (the button can be pressed again).

## Data

Uses `Asset`, `ContentVersion`, `AIRun`, `ScriptVersion`, `BrandProfile` from [DATA-MODEL.md](../../DATA-MODEL.md). No new fields.

New render warning code: `background_low_resolution`.

New settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| `SOCIALHUB_PRODUCTION_AUTO_IMAGES` | `false` | Generate missing backgrounds during `production.start` |
| `SOCIALHUB_AI_MAX_IMAGES_PER_ITEM` | `12` | Cap per content item |

## API

### `POST /api/v1/content-items/{id}/production/generate-image/`

Signed-in user. Returns `202` with a job of kind `production.generate_image`.

Request:

```json
{
  "base_version": 1,
  "frame_index": 1,
  "prompt": "A sunlit kitchen counter with fresh herbs in small pots, shallow depth of field",
  "attach": true,
  "rerender": true
}
```

`prompt` is optional; when omitted or null the frame's `visual_prompt` is used.

Response `202`:

```json
{
  "job": {
    "id": "c2b7a8d4-93f0-4f0e-b1a5-7d1b0a6c5e42",
    "kind": "production.generate_image",
    "status": "queued",
    "progress": 0,
    "message": "",
    "target_type": "content_item",
    "target_id": "42",
    "result": null,
    "error_code": null,
    "error_detail": null,
    "created_at": "2026-11-24T10:31:07Z",
    "started_at": null,
    "finished_at": null
  }
}
```

Job `result` on success:

```json
{
  "content_version": 1,
  "frame_index": 1,
  "asset": 861,
  "attached": true,
  "rendered_frames": [1],
  "final_asset": 866,
  "ai_run": 5521
}
```

Errors:

| Case | Status and code |
| --- | --- |
| Item not `in_production`, no draft version, or version origin is `manual_upload` | `409 invalid_transition` |
| `base_version` is not the current version | `409 version_conflict` |
| Active job on the item | `409 job_in_progress` |
| `frame_index` does not exist; template has no image slot; no `prompt` and the frame's `visual_prompt` is empty; `prompt` longer than 600 characters | `400 validation_error` with `fields` |
| Image provider key missing | `503 provider_not_configured` |
| Per-item cap reached | `429 rate_limited`, `retryable: false` |

A refused or failed generation is reported on the job, not on this response.

## Background work

| Task | Queue | Notes |
| --- | --- | --- |
| `production.tasks.generate_frame_image(job_id, version_id, frame_index, subject, attach)` | `default` | Calls the gateway, stores the asset, attaches it |
| then `render_frames` and the assemble task | `render` | Only when `rerender` is true; chained in the same job |

- **Progress messages:** "Generating image" (0–60), "Rendering frame 1" (60–80), "Rebuilding final asset" (80–100).
- **Idempotency.** The task is keyed by job ID: if the job already has an `asset` in its partial result, a redelivered task skips the provider call and continues with attach and render. Two different requests always produce two images.
- **Retries.** Provider retries happen inside the gateway. The Celery task itself is not retried after a provider failure, so one click never spends on more than the gateway's three attempts.
- **Failure.** Job `failed`, `active_job` cleared, a `job_failed` content event with the frame index. The version is untouched.

## AI

| | |
| --- | --- |
| Task key | `image.generate` |
| Gateway call | `run_image("image.generate", prompt=<assembled prompt>, size=<mapped size>, account_id=…, job_id=…)` |
| Provider | OpenAI image generation, model from `SOCIALHUB_AI_IMAGE_MODEL` |
| Input | The assembled prompt of rule 5 |
| Output | Image bytes and MIME type (`ImageResult`) |
| Logging | One `AIRun` per call with `units = {"images": 1, "size": "<size>"}` and cost from the price table |
| Refusal | `AIRun.status = refused`; job fails with `provider_error` / `refused` (rule 16) |
| Prompt files | `apps/ai/prompts/image.generate/` holds the fixed constraint text, the per-template placement hints and `VERSION`; changing them bumps the version |

The prompt is assembled by `production/images/prompt.py`, not by a language model. No Claude call is made in this story.

## Panel

Controls inside the **frame editor drawer** of the Production tab (the drawer itself is built in E06-S07). They appear in the Background section when the frame's template accepts an image.

- **Background section layout:** current background thumbnail (or "Brand background" placeholder), then three actions: **Choose from library** (opens `AssetPicker`, E06-S01), **Generate image**, **Remove background**.
- **Generate image** opens a small popover:
  - "Describe the image" — a text area pre-filled with the frame's `visual_prompt`, 600-character counter, helper text "Describe a scene. Text is added by the template, not the image."
  - A read-only line showing what will be added: "Style: {imagery_style}. Mood: {mood}. No text in the image."
  - **Generate** (a `JobButton`) and **Cancel**.
- **While generating:** the thumbnail area shows `JobProgress` with the job message; the drawer's other controls are disabled.
- **When done:** the new image appears as the background, the frame preview updates after the re-render, and `message.success("Background generated")` is shown. An "AI generated" tag appears on the thumbnail.
- **Previous images:** a row "Earlier images for this frame" shows up to six thumbnails of this item's `ai_generated` background assets whose `meta.frame_index` matches; clicking one attaches it (a normal frame edit, `PUT …/production/frames/{index}/`).
- **Counter:** "8 of 12 generated images used for this item" in secondary text; at the cap the Generate button is disabled with the tooltip "The limit of generated images for this item is reached."

Messages for failures:

| Job or response | Text |
| --- | --- |
| `provider_error` with detail `refused` | "The image provider declined this description. Edit it or choose an image from the library." |
| `provider_error` (other) | "The image could not be generated. Try again in a moment." |
| `provider_not_configured` | "Image generation is not set up. Ask an admin to add the OpenAI key." The Generate image button is hidden when `GET /system/status/` reports no image provider. |
| `rate_limited` | "The limit of generated images for this item is reached." |

States: the section is read-only when the version is not an editable draft; for `stat` and `list` templates the section shows "This template does not use an image."

## Acceptance criteria

1. Given a `title` frame with a `visual_prompt` and the fake image provider, when I press Generate image and confirm, then a new asset exists with `origin = ai_generated`, `rights_status = cleared`, role `background`, and the assembled prompt in `meta.prompt`.
2. Given `attach` and `rerender` are true, then the frame's `background_asset_id` is the new asset, the frame is re-rendered with the image under the scrim, and the final asset is rebuilt in the same job.
3. Given `rerender: false`, then the frame is `stale` and `render_status` is `pending` after the job.
4. Given a custom `prompt` in the request, then `meta.subject` holds it and the frame's `visual_prompt` in the version is unchanged.
5. Given a `stat` frame, when I request an image, then I get `400 validation_error`.
6. Given the provider refuses, then the job fails with `provider_error` and detail `refused`, an `AIRun` with status `refused` exists, the frame is unchanged, and the panel shows the declined message.
7. Given no OpenAI key is configured, then the endpoint returns `503 provider_not_configured` and no job is created.
8. Given twelve generated images already exist for the item, then the next request returns `429 rate_limited`.
9. Given `SOCIALHUB_PRODUCTION_AUTO_IMAGES` is true and a script with three frames that accept images and have visual prompts, when `production.start` runs, then three backgrounds are generated and attached before frames are rendered.
10. Given auto generation fails for one frame, then production continues, that frame renders on the brand background, and the version has the warning `background_missing` for it.
11. Given a version that uses a generated background, then the production resource reports `uses_ai_generated: true`.
12. Given the assembled prompt, then it always ends with the fixed no-text constraint, whatever the subject says.
13. Given a redelivered task for a job that already stored its image, then no second provider call is made.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S05-BE1 | Prompt builder and size mapping | `production/images/prompt.py`: four-part assembly, colour naming from hex, per-template placement hints, limits; size mapping per layout in the OpenAI adapter; prompt files and `VERSION`. Unit tests. | 0.5 d |
| E06-S05-BE2 | Generate task and endpoint | `generate_frame_background` service (rule 12a) used by the `generate_frame_image` task, asset creation through the upload pipeline, attach, chained re-render, idempotency by job; `POST …/production/generate-image/` with guards, cap and error mapping; `uses_ai_generated` on the production serializer; `openapi.yaml`. | 0.75 d |
| E06-S05-BE3 | Automatic backgrounds | Hook in the backgrounds step of `production.start` behind the setting; per-frame failure tolerance and warnings; fake-provider fixtures (gradient image, refusal, low resolution). | 0.25 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S05-FE1 | Generate image popover | Prompt field with counter, style line, `JobButton`, progress, success and failure messages, provider-availability check. | 0.5 d |
| E06-S05-FE2 | Background section additions | "AI generated" tag, earlier-images row with attach, counter and cap state, read-only and no-image-slot states. | 0.5 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- All tests use the `fake` image provider. Its fixtures: a deterministic 1024 × 1536 gradient PNG; a "refuse" mode triggered by the word `REFUSE` in the subject; a "small" mode returning 512 × 768.
- **Unit:** prompt assembly for each template hint, truncation at 600 characters, colour naming for a dozen hex values, constraint text always last.
- **Task:** asset fields, attach on and off, re-render chain, redelivery without a second call, cap counting across versions.
- **API:** every row of the error table.
- **Panel:** popover flow with a mocked job, each failure message, cap state.
- One manual check against the real provider is part of E11-S03, not of the automated suite.

## Later

- Several options per request with a chooser (`n` images, then attach one).
- Using an uploaded photo as a style or subject reference.
- Regenerating with the design check's findings (E07-S04) as extra constraints.
