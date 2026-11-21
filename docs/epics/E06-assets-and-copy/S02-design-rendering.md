# E06-S02 — Design rendering with brand templates

| | |
| --- | --- |
| Epic | E06 Assets and copy |
| Priority | Must |
| Estimate | BE 4 d · FE 0.5 d |
| Depends on | E00-S03, E00-S06, E04-S01, E06-S01 |
| Needed by | E05-S01, E06-S03, E06-S04, E06-S07, E07-S04 |

## User story

As an operator, I want every image the system produces to carry my account's logo, colours and fonts and to show Persian text correctly, so that posts look like they came from one brand without a designer touching each one.

## Context

This is the "design" in "create video, motion, or design". A frame from the script (template, headline, body, optional background image) is turned into a PNG by rendering an HTML template in headless Chromium. Text is drawn by the browser from bundled fonts, never by an image model, which is what keeps right-to-left text, ligatures and the zero-width non-joiner correct.

The same renderer serves three uses: the single image of a feed post or image story (`design` mode), the frames of a motion video (E06-S03), and transparent text overlays for footage (E06-S04).

## Scope

**In**

- The template system: seven frame templates, two layouts each, brand kit injection, text fitting, overflow warnings, safe areas.
- The renderer service and its Celery task on the `render` queue.
- Final-image export for `design` mode.
- `GET /render-templates/` and `POST /content-items/{id}/production/render/` (frame part; reassembly of video is E06-S03).
- A template thumbnail list for the panel.

**Out (later)**

- A 1:1 layout, carousels, per-account custom templates, a template editor.
- Animated templates (frames are stills; motion is added in E06-S03).
- Charts and data-driven graphics.

## Behaviour and rules

### Templates

1. **Location and layout of files.**

   ```text
   backend/apps/production/render_templates/
     _base/
       base.html.j2          document skeleton, font faces, CSS variables, safe-area guides
       base.css              reset, shared type scale, logo and handle footer
       fit.js                text fitting and overflow report
     title/
       meta.json             key, name, description, version, fields, image slot, layouts
       layout-4x5.html.j2    extends _base/base.html.j2
       layout-9x16.html.j2
       style.css
       preview-4x5.png       static preview shown in the panel
       preview-9x16.png
     statement/  stat/  list/  quote/  image_caption/  cta/     same structure
   ```

2. **Layouts.** `4x5` is 1080 × 1350 px (feed post). `9x16` is 1080 × 1920 px (story and reel). The layout is chosen from the item's format through the format registry (E04-S01); templates never hard-code which format uses which layout.
3. **The seven templates and their text slots.** Limits are in characters and are returned by `GET /render-templates/` so the script generator (E05-S01) and the frame editor (E06-S07) enforce the same numbers.

   | Key | Use | `headline` | `body` | Background image |
   | --- | --- | --- | --- | --- |
   | `title` | Opening frame | Required, ≤ 60, ≤ 3 lines | Optional, ≤ 120, ≤ 3 lines | Optional, full bleed under a scrim |
   | `statement` | One strong sentence | Required, ≤ 110, ≤ 5 lines | Optional, ≤ 80 | Optional |
   | `stat` | One number and what it means | Required, ≤ 12 (the number, for example `۴۲٪`) | Required, ≤ 100 | None |
   | `list` | 2–5 short points | Required, ≤ 50 | Required: 2–5 lines separated by line breaks, each ≤ 60 | None |
   | `quote` | Quotation | Required, ≤ 160 (the quote) | Optional, ≤ 50 (who said it) | Optional |
   | `image_caption` | Picture with a caption | Optional, ≤ 60 | Optional, ≤ 100 | Required |
   | `cta` | Closing call to action | Required, ≤ 50 | Optional, ≤ 80 | Optional |

   Every template shows the brand logo and `handle_display` in a footer; `cta` shows them larger and centred.
4. **Template version.** `meta.json` has a `version` string. Any visual change bumps it. The version is part of the render input hash (rule 17), so a template change re-renders frames the next time production runs.

### Brand kit

5. The renderer builds a **brand context** from the account's `BrandProfile` and injects it into the page as CSS variables on `:root`:

   | Variable | Source |
   | --- | --- |
   | `--brand-primary`, `--brand-secondary`, `--brand-accent`, `--brand-background`, `--brand-text` | `colors` |
   | `--font-heading`, `--font-body` | `fonts`, resolved to the bundled family names |
   | `--safe-top`, `--safe-right`, `--safe-bottom`, `--safe-left` | Format registry `safe_area` for the item's format, in px |

   Templates use only these variables for colour, font and safe-area padding. A template contains no literal brand colour or font name.
6. **Fonts.** Only bundled fonts are used, loaded through `@font-face` from local files (the list is owned by E00-S03 and exposed by `GET /fonts/`). `Vazirmatn` is always present and is the fallback for both variables, so Persian glyphs render even when a Latin-only font is chosen. No network font is ever requested.
7. **Logo.** `logo_light` is used on light surfaces and `logo_dark` on dark ones. The surface is "dark" when the relative luminance of the colour behind the footer (the scrim colour when there is a background image, otherwise `--brand-background`) is below 0.5. The frame's `render_options.logo_variant` (rule 14a) can force `light` or `dark`; the default `auto` uses the luminance rule. If the needed variant is missing the other one is used; if both are missing the footer shows only the handle and the render adds the warning `logo_not_configured`. The logo is always drawn when the brand has one; there is no option to hide it.
8. **Missing brand values.** Missing colours fall back to neutral defaults (`#111111` text on `#FFFFFF`, primary `#1677FF`) and add the warning `brand_incomplete`. Rendering never fails because the brand profile is incomplete.

### Text

9. **Direction and language.** The `<html>` element gets `lang` from the account's `content_language` and `dir="rtl"` for `fa`, `dir="ltr"` for `en`. Text slots use `dir="auto"` so a Latin brand name inside a Persian sentence is laid out correctly. Layouts use CSS logical properties only (`margin-inline-start`, `text-align: start`), so one template serves both directions.
10. **Text is rendered as given.** The renderer does not translate, re-case, or convert digits. Line breaks in `body` are kept. HTML in the text is escaped.
11. **Fitting.** Each slot declares `max_font`, `min_font` and `max_lines` in `meta.json`. After fonts load, `fit.js` starts at `max_font` and reduces the size in 2 px steps until the text fits the slot's box and line limit, stopping at `min_font`.
12. **Overflow.** If the text still does not fit at `min_font`, the slot is clipped at `max_lines` with an ellipsis and the render reports the warning `text_overflow` with the slot name. The render still succeeds; the frame is flagged in the panel and the design check (E07-S04) will also see it. Text longer than the character limits in rule 3 is accepted by the renderer (it only warns) but rejected by the frame editor API (E06-S07).
13. **Safe areas.** For `9x16`, all text, the logo and the handle stay inside the safe area from the format registry (the area not covered by Instagram's own interface). Background images and colour fill the whole canvas. For `4x5`, content keeps a 60 px margin on every side. Values assumed when this was written, to be confirmed in E04-S01: story top 250 px, bottom 250 px; reel top 220 px, bottom 420 px, right 120 px.

### Background images

14. A frame's background is the asset in `background_asset_id` when set. It is drawn with `object-fit: cover`, centred, under a scrim (a 45% overlay of `--brand-background` or black, defined per template) so text keeps a contrast ratio of at least 4.5:1.

14a. **Render options.** Each entry of `ContentVersion.frames` may carry `render_options`: `{"text_backdrop": false, "logo_variant": "auto"}`. `text_backdrop: true` draws a rounded panel of `--brand-background` at 85% opacity behind every text slot, with or without a background image; it is how the revise loop (E07-S05) fixes legibility findings. `logo_variant` is `auto`, `light` or `dark` (rule 7). Missing keys take these defaults. Options are part of the input hash (rule 17). These are the only render options; the safe area is always enforced (rule 13) and the logo is always drawn when it exists (rule 7).
15. When a template allows no image, `background_asset_id` is ignored. When `image_caption` has no image, the frame cannot be rendered: the frame state becomes `failed` with the warning `background_required`.
16. Background assets with `rights_status` other than `cleared` are still rendered; the frame gets the warning `rights_not_cleared` so the operator sees the problem before the rights check does.

### Rendering

17. **Input hash.** `input_hash = sha256(template key, template version, layout, headline, body, background asset checksum, render_options, brand context, overlay flag, renderer version)`. Before rendering, the service looks for an existing `frame` asset of the same content item with that hash in `meta.input_hash`; if found it is reused. This makes rendering idempotent and makes partial re-render cheap.
18. **Process.** For each frame the service:
    1. writes the rendered HTML, CSS, fonts, logo and background image into a temporary directory;
    2. opens it in Chromium through Playwright with a viewport of exactly the layout size and device scale factor 1;
    3. blocks every request that is not a `file://` URL inside that directory;
    4. waits for fonts and images to finish loading, runs `fit.js`, and reads its report (final font sizes, overflowing slots);
    5. takes a full-viewport PNG screenshot;
    6. stores the PNG as an `Asset` (`kind = image`, `role = frame`, `origin = rendered`) and deletes the temporary directory.
19. **Asset metadata.** `meta = {"template", "template_version", "layout", "frame_index", "input_hash", "inputs": [background asset id], "warnings": [...], "fit": {"headline": 64, "body": 34}}`. `meta.warnings` is a cache so a reused frame asset brings its warnings with it; readers (the panel, E07-S04) use `ContentVersion.render_warnings` (see Data). `rights_status` and `rights_expires_at` follow the inputs (E06-S01 rule 9); a frame without inputs is `cleared`.
20. **Determinism.** Templates contain no animation, no clock, no randomness. The same inputs on the same render image produce the same PNG. Tests compare against stored reference images with a tolerance of 0.1% differing pixels so a Chromium patch update does not break the suite.
21. **Overlay mode.** With `overlay = true` the page background is transparent, the background image and scrim are omitted, and the screenshot keeps the alpha channel. Used by E06-S04.
22. **Browser lifetime.** One Chromium instance per render-worker process, started on first use and restarted after 200 renders or any crash. Each render uses a fresh browser context. A render that takes longer than 30 seconds is aborted and counted as a transient failure.
23. **Final image for `design` mode.** After the single frame is rendered, the final asset is exported as JPEG (quality 92, sRGB, no alpha, metadata stripped) at the exact canvas size, stored with `role = final`, `origin = rendered`, `meta.inputs = [frame asset id]`. `ContentVersion.final_asset` points to it and `render_status` becomes `ready`.

### Frame state on the content version

24. Each entry of `ContentVersion.frames` carries `state`: `pending` (never rendered), `rendered`, `stale` (inputs changed since the last render), `failed`. `render_status` of the version is `rendering` while a render job runs, `ready` when every frame is `rendered` and the final asset matches them, `failed` when a job ended in failure, otherwise `pending`.

## Data

Uses `Asset`, `ContentVersion`, `BrandProfile`, `ScriptVersion` from [DATA-MODEL.md](../../DATA-MODEL.md).

Change this story needs: each entry of `ContentVersion.frames` becomes the frame's full working copy, not only a pointer.

```json
{
  "index": 1,
  "shot_index": 1,
  "template": "title",
  "headline": "سه نشانه که بودجه‌تان نشتی دارد",
  "body": "",
  "visual_prompt": "Soft morning light on a tidy desk, no people",
  "background_asset_id": 311,
  "duration_seconds": 4,
  "transition": "fade",
  "render_options": {"text_backdrop": false, "logo_variant": "auto"},
  "asset_id": 812,
  "state": "rendered",
  "input_hash": "c41d…77e0",
  "warnings": [],
  "overridden": ["headline"]
}
```

`overridden` lists the fields that differ from the approved script frame. Also new on `ContentVersion`: `render_warnings`, the single source of frame, assembly and copy warnings for the panel and for the design check (E07-S04). Each item is `{"code", "message"}` plus one locator: `frame_index`, `shot_index`, `asset_id` or `field`. Frame warnings are also copied to that frame's `frames[].warnings` for display next to the frame. The version's list is rebuilt after every render, assembly and copy step.

Warning codes from this story: `text_overflow`, `logo_not_configured`, `brand_incomplete`, `background_required`, `background_missing`, `rights_not_cleared`.

## API

### `GET /api/v1/render-templates/`

Any signed-in user. Query: `format` (optional `Format`; returns only templates with a layout for that format).

```json
{
  "count": 7,
  "next": null,
  "previous": null,
  "results": [
    {
      "key": "title",
      "name": "Title",
      "description": "Opening frame with a large headline and an optional line under it.",
      "version": "1",
      "layouts": ["4x5", "9x16"],
      "image_slot": "optional",
      "fields": {
        "headline": {"required": true, "max_chars": 60, "max_lines": 3},
        "body": {"required": false, "max_chars": 120, "max_lines": 3}
      },
      "preview_urls": {
        "4x5": "/static/render-templates/title/preview-4x5.png",
        "9x16": "/static/render-templates/title/preview-9x16.png"
      }
    },
    {
      "key": "list",
      "name": "List",
      "description": "A heading and two to five short points.",
      "version": "1",
      "layouts": ["4x5", "9x16"],
      "image_slot": "none",
      "fields": {
        "headline": {"required": true, "max_chars": 50, "max_lines": 2},
        "body": {"required": true, "max_chars": 300, "max_lines": 5, "items": {"min": 2, "max": 5, "max_chars": 60}}
      },
      "preview_urls": {"4x5": "…", "9x16": "…"}
    }
  ]
}
```

The other five entries have the same shape. `image_slot` is `none`, `optional` or `required`.

### `POST /api/v1/content-items/{id}/production/render/`

Re-renders frames of the current draft version and rebuilds the final asset. Returns `202` with a job of kind `production.render`.

Request:

```json
{
  "base_version": 1,
  "frames": [2],
  "reassemble": true
}
```

- `frames`: list of frame indexes, or `null` for all frames. Listed frames are rendered even if their hash is unchanged (a forced re-render); when `null`, only frames that are not `rendered` with a matching hash are rendered.
- `reassemble` (default `true`): after frames, rebuild the final asset — the JPEG export for `design` mode, the video for `motion` (E06-S03) and `video` (E06-S04).

Response `202`:

```json
{
  "job": {
    "id": "5a0f0c4e-1b7a-4c1e-8a57-2f1d6f1f9c20",
    "kind": "production.render",
    "status": "queued",
    "progress": 0,
    "message": "",
    "target_type": "content_item",
    "target_id": "42",
    "result": null,
    "error_code": null,
    "error_detail": null,
    "created_at": "2026-11-24T10:02:11Z",
    "started_at": null,
    "finished_at": null
  }
}
```

Job `result` on success: `{"content_version": 1, "rendered_frames": [2], "reused_frames": [1, 3, 4], "final_asset": 830, "warnings": 0}`.

Errors:

| Case | Status and code |
| --- | --- |
| Item is not `in_production` | `409 invalid_transition`; `details.allowed_statuses` |
| No draft version, or the version's origin is `manual_upload` | `409 invalid_transition` |
| `base_version` is not the current version | `409 version_conflict` |
| The item has an active job | `409 job_in_progress` with the job in `details.job` |
| A frame index does not exist | `400 validation_error` on `frames` |

## Background work

| Task | Queue | Notes |
| --- | --- | --- |
| `production.tasks.render_frames(job_id, version_id, frame_indexes, force)` | `render` | Renders frames one by one; updates job progress per frame ("Rendering frame 2 of 5") |
| `production.tasks.export_final_image(job_id, version_id)` | `render` | `design` mode only (rule 23) |

- **Idempotency.** The input hash (rule 17) means a repeated task reuses existing frame assets. The final export is keyed the same way by the frame asset's checksum.
- **Retries.** A Chromium crash, a timeout or a storage error retries the frame up to three times (backoff 10 s, 30 s, 90 s). A template error (`TemplateNotFound`, Jinja error) is not retried.
- **Failure.** After retries the frame state is `failed`, the version's `render_status` is `failed`, the job fails with `error_code = render_failed` and a safe `error_detail` ("Frame 2 could not be rendered"), `ContentItem.active_job` is cleared and a `job_failed` content event is written. Frames that did render keep their assets.
- **Concurrency.** The render worker runs one task at a time (existing compose setting). Frames of one version are rendered sequentially.

## AI

None. Text comes from the script; images come from E06-S01 or E06-S05.

## Panel

This story delivers one small, reusable piece; the workspace that uses it is E06-S07.

- **Service** `src/services/socialhub/renderTemplates.ts` with a cached `useRenderTemplates(format)` hook.
- **`TemplateSelect`** component: a select whose options show the template's preview image for the current layout (48 px wide), its name and its description. Under the select, helper text lists the limits of the chosen template: "Headline up to 60 characters. Body optional, up to 120."
- **`FrameWarning`** component: maps warning codes to text and shows them as orange tags.

  | Code | Text |
  | --- | --- |
  | `text_overflow` | "Text does not fit. Shorten it or choose another template." |
  | `logo_not_configured` | "No logo in the brand profile." |
  | `brand_incomplete` | "Brand colours are incomplete; defaults were used." |
  | `background_required` | "This template needs an image." |
  | `background_missing` | "No background image was found; the brand background was used." |
  | `rights_not_cleared` | "The background image's rights are not cleared." |

States: while templates load the select shows a spinner; if loading fails it shows "Templates could not be loaded" with Retry.

## Acceptance criteria

1. Given an account with Persian content, brand colours, a heading font and both logos, when a `title` frame is rendered in `4x5`, then the PNG is exactly 1080 × 1350, the headline is right-aligned and reads right-to-left, the brand colours and logo are used, and the handle is in the footer.
2. Given the same frame rendered twice, then one frame asset exists and the second call reports it as reused.
3. Given a headline of 200 characters in a `title` frame, when it is rendered, then the render succeeds, the text ends with an ellipsis, and the frame has the warning `text_overflow`.
4. Given a `9x16` reel frame, when it is rendered, then no text, logo or handle pixel lies outside the safe area from the format registry.
5. Given a frame with a background asset, when it is rendered, then the image fills the canvas, the scrim is present, and the frame asset's `meta.inputs` contains the background asset's ID.
6. Given an `image_caption` frame without a background, when it is rendered, then the frame state is `failed` with `background_required` and the job fails with `render_failed`.
7. Given a brand profile with no logos, when a frame is rendered, then the render succeeds with the warning `logo_not_configured`, and `ContentVersion.render_warnings` contains it with that frame's `frame_index`.
7a. Given a frame with `render_options.text_backdrop: true`, when it is rendered, then a backdrop panel is drawn behind each text slot, and the input hash differs from the same frame without the option.
8. Given an English-language account, when the same template is rendered, then the layout is mirrored to left-to-right without a different template file.
9. Given a headline that mixes Persian with a Latin brand name and a zero-width non-joiner, then the rendered text matches the reference image for that sample.
10. Given a `design` item with one rendered frame, then `final_asset` is a JPEG of the canvas size with `role = final`, and `render_status` is `ready`.
11. Given `POST …/production/render/` with `frames: [2]` on a four-frame version, then only frame 2 gets a new asset and the final asset is rebuilt.
12. Given the template's `version` is bumped, when production runs again, then every frame using that template is re-rendered.
13. Given `GET /render-templates/?format=feed_post`, then seven templates are returned, each with a `4x5` preview and field limits.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S02-BE1 | Renderer service | `production/rendering/renderer.py`: Playwright Chromium lifecycle, temp directory build, request blocking, font and image wait, screenshot, overlay mode, timeout. Add Playwright to the render image and lockfile. | 0.75 d |
| E06-S02-BE2 | Base template and fitting | `_base/base.html.j2`, `base.css`, `fit.js`; CSS variables, font faces from the bundled list, logical properties, safe-area padding, footer with logo and handle, overflow report. | 0.5 d |
| E06-S02-BE3 | Brand context | `production/rendering/brand.py`: build context from `BrandProfile`, logo variant by luminance, fallbacks and warnings (rules 5–8). Unit tests. | 0.25 d |
| E06-S02-BE4 | Seven templates, two layouts | `title`, `statement`, `stat`, `list`, `quote`, `image_caption`, `cta` with `meta.json`, both layouts, `style.css`, preview images. | 1.25 d |
| E06-S02-BE5 | Frame render task | Input hash (including `render_options`), reuse lookup, asset creation with metadata and inherited rights, frame `state`, `text_backdrop` and `logo_variant` options, rebuild of `ContentVersion.render_warnings`, job progress, retries and failure handling. | 0.5 d |
| E06-S02-BE6 | Final image export and endpoints | JPEG export for `design` mode; `GET /render-templates/` with registry loader and validation of `meta.json` at startup; `POST …/production/render/` with all guards; `openapi.yaml`. | 0.5 d |
| E06-S02-BE7 | Reference-image tests | Fixed sample set (below), comparison helper with tolerance, command to regenerate references. | 0.25 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S02-FE1 | Template service and components | `renderTemplates.ts`, `TemplateSelect`, `FrameWarning` with the text table above. | 0.5 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- **Reference samples** in `backend/apps/production/tests/references/`: for each template and layout, one Persian and one English sample; plus fixed right-to-left cases — mixed Persian and Latin, zero-width non-joiner words (`می‌شود`), Persian digits and percent sign, a long word with no spaces, a five-item list, an empty optional body.
- **Unit:** brand context fallbacks, luminance choice of logo and the forced `logo_variant`, input hash stability (same inputs → same hash; each input changed, including `render_options`, → different hash).
- **Renderer tests** run in the render image only and are marked so the default backend test run skips them when Chromium is absent.
- **Safe-area test:** render with a debug flag that paints text boxes solid, then assert no painted pixel outside the safe rectangle.
- **API:** every row of the error table; `frames: null` versus a list.

## Later

- A 1:1 layout: add `layout-1x1.html.j2` per template and a registry entry.
- Per-account template variants: allow `render_templates/<account-handle>/<template>/` to shadow the default.
- Animated templates: capture frames from CSS animations instead of one screenshot, behind the same `render_frame` function.
