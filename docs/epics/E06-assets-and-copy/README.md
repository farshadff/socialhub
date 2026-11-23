# E06 — Assets and copy

Workflow step 06: "Produce assets & copy — create video, motion, or design; draft captions and hashtags."

## Goal

Turn an approved script into something that can be published: a rendered image or video that follows the account's brand profile, plus a caption and hashtags. The result is one `ContentVersion` per attempt. When it is ready it is submitted to the quality check (E07). When a check asks for changes, this epic produces the next version.

## Scope

**In the MVP**

- An asset library per account with uploads, rights metadata and a per-item asset list.
- Brand-consistent image rendering from seven HTML frame templates in two layouts (4:5 and 9:16).
- Motion video: rendered frames animated and joined into a 9:16 MP4, with optional music.
- Footage video (Should): uploaded clips mapped to shots, normalized, overlaid with rendered text, joined.
- AI background images (Should): generated without text, used behind template text.
- AI caption, hashtags and alt text, editable by the operator.
- One production job that runs all of the above for an item, a workspace tab to review and adjust it, manual upload of a finished asset, and submission to checking.

**Left for later**

- Carousels and multi-frame story sequences.
- AI-generated video clips, voiceover and subtitles from audio.
- A timeline editor, per-element animation, custom template authoring in the panel.
- Stock-library integrations and automatic licence lookup.
- General transcoding of uploads. A manual final file that is only off in size, codec, frame rate or missing audio is fixed by the revise loop through S03's `normalise_media`; anything else (wrong media kind, duration, unreadable file) is rejected with the reason.

## Stories

| Story | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E06-S01](S01-asset-library.md) | Asset library and rights metadata | Must | 2 | 2.5 | |
| [E06-S02](S02-design-rendering.md) | Design rendering with brand templates | Must | 4 | 0.5 | |
| [E06-S03](S03-motion-video.md) | Motion video assembly | Must | 3.5 | 0 | |
| [E06-S04](S04-footage-video.md) | Footage-based video assembly | Should | 2.5 | 1 | |
| [E06-S05](S05-ai-image-generation.md) | AI image generation | Should | 1.5 | 1 | |
| [E06-S06](S06-caption-and-hashtags.md) | Caption and hashtags | Must | 1.5 | 1 | |
| [E06-S07](S07-production-workspace.md) | Production orchestration and workspace | Must | 2 | 4 | |
| | **Total** | | **17** | **10** | |

## Flow

1. A script is approved (E05-S02). The item becomes `scripted` and the pipeline starts `production.start` (S07).
2. **Prepare.** The job creates a draft `ContentVersion` and copies the script's frames into it. From here on, frame text and backgrounds can be overridden on the version without touching the approved script.
3. **Backgrounds.** Frames that need an image use an attached library asset (S01), an AI-generated image (S05, when enabled), or the brand background.
4. **Frames.** Each frame is rendered to a PNG from its template with the brand kit applied (S02).
5. **Assemble.** By production mode: `design` exports the single frame as the final image; `motion` animates and joins the frames (S03); `video` waits for clips, then assembles them (S04).
6. **Copy.** Caption, hashtags and alt text are drafted (S06). Stories get no caption.
7. **Ready.** `render_status` becomes `ready`. The operator reviews in the Production tab (S07), edits what they want, and presses **Submit for check**. With `autopilot.script` on, submission is automatic unless one of the five holding warnings is present (`text_overflow`, `background_required`, `rights_not_cleared`, `banned_term`, `final_needs_normalising`; S07 rule 29).
8. **Submit.** The version becomes `submitted`, the item becomes `in_check`, and E07-S01 runs the five checks.
9. **Revise.** When a check or a reviewer asks for changes, a new draft version n+1 is opened as a copy of version n with a `change_note`, and steps 3–8 run again for what changed.

At any point the operator can skip rendering by uploading a finished file as the final asset (S07).

```text
approved script ─► production.start ─► draft ContentVersion
                     prepare ─► backgrounds ─► frames ─► assemble ─► copy ─► ready ─► submit ─► E07
                                  (S01,S05)     (S02)    (S02/S03/S04)  (S06)   (S07)
manual upload ───────────────────────────────────────────► final asset ─► copy ─► ready ─► submit
```

## Owns

| Kind | Items |
| --- | --- |
| Tables | `Asset`, `ContentVersion` (both in the `content` app; see [DATA-MODEL.md](../../DATA-MODEL.md)) |
| Apps | `content` (asset model, upload, library API), `production` (render templates, renderers, FFmpeg assembly, production endpoints and tasks) |
| Endpoints | Everything under "E06 Assets and copy" in [API.md](../../API.md), plus `PATCH /content-items/{id}/production/` introduced in S03 |
| Panel | `/library`; the Production tab of `/content/:id`; shared components `MediaPreview`, `AssetPicker`, `AssetUploader`, `RightsTag` |
| Job kinds | `production.start`, `production.render`, `production.generate_image`, `copy.generate` |
| AI tasks | `copy.generate` (Claude), `image.generate` (OpenAI) |
| Queues | `render` for Chromium and FFmpeg work; `default` for AI calls and orchestration steps |

## Depends on / needed by

| Depends on | For |
| --- | --- |
| E00-S03 | Brand profile (logo, colours, fonts, handle) and the bundled font list |
| E00-S05 | AI gateway (`run_text`, `run_image`) |
| E00-S06 | `JobRun`, `JobButton`, `JobProgress`, media storage |
| E03-S04 | Item workspace shell and its tab frame |
| E04-S01 | Format registry: canvas sizes, safe areas, media and copy limits |
| E04-S03 | Approved brief (input to copy) |
| E05-S01, E05-S02 | Approved script package (frames, shots, design notes) |

| Needed by | For |
| --- | --- |
| E05-S01 | The template list and text limits the script generator must respect (`GET /render-templates/`) |
| E07-S01 … E07-S04 | The submitted `ContentVersion`, its assets and rights metadata |
| E07-S05, E07-S06 | `open_revision` service and re-production of a new version |
| E08-S05 | `final_asset`, `cover_asset`, caption and hashtags for the posting pack (in Phase 2 also E08-S03, which publishes them) |

## Done when

1. For a feed post, a story and a reel on a test account, an approved script becomes a `ready` content version with a final asset, and for the feed post and reel a caption and hashtags, with no manual step.
2. Rendered Persian text is right-to-left, uses the brand fonts and colours, shows the brand logo and handle, and stays inside the format's safe area.
3. Changing one frame's text and re-rendering replaces only that frame and the final asset.
4. A finished file uploaded by hand can be used as the final asset and submitted. A file a person must fix (wrong media kind, duration, unreadable) is rejected with the reason; a file that only needs normalising is accepted with the `final_needs_normalising` warning and fixed by the revise loop.
5. Submitting moves the item to `in_check`; a revision opens version n+1 and leaves version n unchanged.
6. Running `production.start` twice for the same script produces one version, not two.

## Later

| Extension | Seam |
| --- | --- |
| New frame templates or a third layout (1:1) | Add a directory under `render_templates/`; nothing else changes |
| Carousels | `ContentVersion.frames` already holds several rendered frames; add a `final_assets` list and a format registry entry |
| AI video clips and voiceover | New asset origins and one more step between `backgrounds` and `assemble` |
| Animated templates | Replace the still-plus-zoom clip builder in S03 with a frame-capture renderer behind the same function |
| Normalising manual uploads at upload time instead of in the revise loop | Call S03's `normalise_media` from S07's final-asset endpoint |
