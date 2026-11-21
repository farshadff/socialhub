# E06-S07 — Production orchestration and workspace

| | |
| --- | --- |
| Epic | E06 Assets and copy |
| Priority | Must |
| Estimate | BE 2 d · FE 4 d |
| Depends on | E00-S06, E03-S04, E04-S01, E05-S02, E06-S01, E06-S02, E06-S03, E06-S06 |
| Needed by | E06-S04, E06-S05, E07-S01, E07-S05, E07-S06, E08-S03 |

## User story

As an operator, I want production to run by itself once a script is approved, and one screen where I can see the result, adjust a frame, swap in my own file and send it to checking, so that every item reaches the quality check with as little manual work as possible.

## Context

Step 06 of the workflow is several pieces of work: backgrounds, frame rendering, video assembly and copy. Stories S01–S06 build each piece. This story joins them into one job, `production.start`, that turns an approved script into a `ready` content version, and builds the Production tab of `/content/:id` where a person reviews and adjusts it.

It also owns the three state changes around production: starting it (`scripted → in_production`), submitting a version (`in_production → in_check`, which starts E07-S01), and opening a new version when a check or a reviewer asks for changes (`open_revision`, used by E07-S05 and E07-S06).

An item arrives here in `scripted`, normally a moment after its script was approved (E05-S02). It leaves in `in_check`.

## Scope

**In**

- `production.start`: one job that prepares a draft version and runs backgrounds, frames, assembly and copy, with progress, resume and partial-failure handling.
- The `scripted` pipeline handler and the public services `start_production`, `submit_version` and `open_revision`.
- Read the production resource for the current or an older version.
- Frame overrides on the draft version (text, template, background, duration, transition).
- Use an uploaded file as the final asset, with validation against the format registry.
- Submit for checking, including automatic submission under `autopilot.script`.
- Panel: the Production tab with `MediaPreview`, the frame strip, the frame edit drawer, the action bar and the version selector. It hosts the cards built in S03 (music and cover), S04 (footage), S05 (background generation controls) and S06 (copy).

**Out (later)**

- Adding, removing or reordering frames here. That is a script change: edit the script (E05-S02) and approve it again.
- Transcoding or cropping a manually uploaded file.
- Side-by-side comparison of two versions.
- Live updates without polling.

## Behaviour and rules

### Starting production

1. **Who starts it.** `production.services.start_production(item, *, actor=None, reason, submit="autopilot", submit_trigger="submission", restart_from_script=False)` is the only entry point. It is called by:

   | Caller | When | Arguments |
   | --- | --- | --- |
   | Handler for `scripted`, registered at startup with `pipeline.register_handler("scripted", …)` | After the item enters `scripted` (E05-S02 approval, `autopilot.script`) | `reason="script_approved"` |
   | E05-S02 approve, called directly | A script is approved for an item already `in_production` or `needs_revision` | `reason="script_reapproved"` |
   | E07-S05 revise job | A finding needs a script-level change | `reason="revision"`, `submit="always"`, `submit_trigger="revision"` |
   | `POST …/production/start/` | An operator starts, resumes or restarts | `reason="manual"`, `actor=user` |

   No handler is registered for `in_production`. That is deliberate: E07-S05 moves items `needs_revision → in_production` before doing a smaller rework, and that move must not start a full production run.
2. **Preconditions.** The item is `scripted`, `in_production` or `needs_revision`; it has an approved script (`current_script.status = approved`); it has no active job (`pipeline.ensure_idle`). The handler swallows `JobInProgress` so a repeated `advance` is harmless.
3. **Status.** In the same transaction, `scripted` and `needs_revision` move to `in_production` through `content.services.pipeline.transition`. An item already `in_production` keeps its status.
4. **Which version is used.** Let `v` be `item.current_version` and `s` the approved script.

   | Situation | Result |
   | --- | --- |
   | No version yet | Create version 1 from `s` |
   | `v` is `draft`, `v.origin = pipeline`, `v.script = s`, `restart_from_script` false | Reuse `v` and resume (rule 8) |
   | `v` is `draft` but made from an older script, or `v.origin = manual_upload`, or `restart_from_script` true | Create version n+1 from `s`; `v` stays `draft` but is no longer current |
   | `v` is `submitted`, `passed` or `rejected` | Create version n+1 from `s` |

   n is the highest version number of the item. Running `start_production` twice for the same script therefore produces one version.
5. **Preparing a version from a script** (the `prepare` step, done synchronously inside `start_production` so the response already knows the version):
   - `status = draft`, `origin = pipeline`, `script = s`, `render_status = pending`, `created_by = actor`, `change_note` = "Produced from script version {s.version}".
   - One frame entry per script frame, in order, with `index`, `shot_index`, `template`, `headline`, `body`, `visual_prompt`, `duration_seconds`, `transition` copied from the script; `asset_id` null, `state` `pending`, `input_hash` null, `warnings` empty, `overridden` empty. The full entry shape is in E06-S02.
   - Carried over from the previous version, when one exists: `music_asset`; `cover_frame_index` if that frame still exists; each frame's `background_asset_id` when the frame at the same index has the same template (it is then listed in `overridden`); `clips` entries whose `shot_index` is still a footage shot (they are re-validated by the S04 rules; invalid ones are dropped and show up in `missing_shots`).
   - Not carried over: caption, hashtags and alt text. A new script means new copy, written by the copy step.
   - `item.current_version` is set to the new version and a `ContentEvent` of type `edited` is written: "Version 3 prepared from script version 2".
6. **Job.** `start_production` then creates a `JobRun` of kind `production.start` through `core.jobs.start_job`, sets it as `active_job` and enqueues the step chain (rule 7). It returns the job.

### The step chain

7. **Steps.** One Celery chain carries the job ID. Each step is its own task so it runs on the right queue.

   | # | Step | Queue | Progress | What it does | Owned by |
   | --- | --- | --- | --- | --- | --- |
   | 1 | `prepare` | in the request | 0–5 % | Rule 5 | This story |
   | 2 | `backgrounds` | `default` | 5–20 % | For each frame whose template accepts an image and has no `background_asset_id`: generate one when `SOCIALHUB_PRODUCTION_AUTO_IMAGES` is true and `visual_prompt` is not empty; otherwise leave it empty, which renders the brand background. One frame failing adds `background_missing` and the step goes on. | S05 rules 2–14 |
   | 3 | `frames` | `render` | 20–60 % | Render every frame that is not `rendered` with a matching input hash. A frame whose template requires an image (`image_caption`) and has none is **not** sent to the renderer: it stays `pending` with the warning `background_required`. | S02 rules 17–22 |
   | 4 | `assemble` | `render` | 60–85 % | `design`: export the final image. `motion`: assemble the video and cover. `video`: assemble when every footage shot has a clip. Skipped with status `waiting` when any frame is not `rendered` or clips are missing. | S02 rule 23, S03, S04 |
   | 5 | `copy` | `default` | 85–98 % | Draft caption, hashtags and alt text when the format takes a caption and the draft's caption is empty. Runs even when step 4 is waiting, because copy does not depend on the picture. | S06 rules 5–13 |
   | 6 | `finish` | `default` | 100 % | Rules 10–12 | This story |

8. **Resume and idempotency.** Each step records its outcome in `ContentVersion.production_steps` (see Data) with an `input_hash`. A step whose status is `done` and whose input hash equals the hash of its current inputs is skipped. The hashes are:

   | Step | Input hash covers |
   | --- | --- |
   | `backgrounds` | Each frame's template, `visual_prompt`, `background_asset_id`; the auto-images setting |
   | `frames` | The ordered list of frame input hashes (E06-S02 rule 17) |
   | `assemble` | The assembly hash (E06-S03 rule 14, E06-S04 rule 18), or the frame asset checksum for `design` |
   | `copy` | Not hashed: the step runs only when the caption is empty |

   Below the step level the existing hashes do the rest: a frame with a matching input hash reuses its asset, an assembly with a matching hash reuses its video. Pressing **Start production** again after a failure therefore redoes only what failed.
9. **Cancellation and staleness.** Every step task first reloads the item and the job. If the job is no longer `running` (cancelled by E03-S04 or failed by the stale-job sweeper of E00-S06), or `item.current_version` is not the version the job was started for, the task exits without writing anything.

### Finishing, waiting and failing

10. **Finish.** The `finish` step:
    - sets `render_status = ready` when every frame is `rendered` and the final asset matches them (and, for reels, a cover exists); otherwise leaves it `pending`;
    - collects `render_warnings` from frames, assembly and copy;
    - sets the job `result` (see API) and status `succeeded`, clears `active_job`;
    - decides on submission (rule 12) and sets `hold_reason`.
11. **Waiting is not failing.** When step 4 was skipped as `waiting`, the job still ends `succeeded` with `result.waiting_for` set and a hold reason. When several things are missing, the first in this order is named:

    | `waiting_for` | Hold reason |
    | --- | --- |
    | `backgrounds` | "Choose an image for frame 3." (lists every frame) |
    | `clips` | "Waiting for footage for shot(s) 2, 4." (E06-S04 rule 11) |

12. **Submission after production.**

    | `submit` argument | Submits automatically when | Otherwise |
    | --- | --- | --- |
    | `autopilot` | `account.autopilot.script` is true, `render_status = ready`, there are no submit blockers (rule 28) and no holding warnings (rule 29) | Hold reason "Ready to submit" or "Ready to submit — 2 warnings to review" |
    | `always` | `render_status = ready` and no submit blockers; holding warnings do not stop it (the checks will judge them) | Hold reason naming the blocker |
    | `never` | — | Hold reason "Ready to submit" |

    Automatic submission calls `submit_version` (rule 27) with `actor=None` and the given `submit_trigger`.
13. **Failure.** When a step fails after its own retries (defined in S02, S03, S04, S05, S06):
    - the step's entry in `production_steps` gets `status = failed` and the `error_code`;
    - the chain stops; later steps keep their previous status;
    - for `frames` and `assemble`, `render_status = failed` (E06-S02 rule 24, E06-S03 rule 16); for `copy`, `render_status` is left as the assemble step left it, so a rendered asset is kept (E06-S06);
    - the job ends `failed` with the step's `error_code` (`render_failed`, `frames_not_ready`, `duration_out_of_range`, `assembly_failed`, `output_invalid`, `copy_too_long`, `provider_error`, `provider_not_configured`);
    - `pipeline.clear_active_job(item, job, failed=True, error_code=…)` writes the `job_failed` event, and the item gets the hold reason "Production stopped at {step}: {short reason}";
    - the item stays `in_production`. The operator can fix the cause and press **Start production** (resume) or **Re-render**.
14. Hold reasons are set with `pipeline.set_hold_reason(item, text)`, which writes no status change and no event. Any later transition clears them.

### Frame overrides

15. **Overrides live on the draft version, never on the script.** `PUT …/production/frames/{index}/` changes only the frame entry inside the current draft `ContentVersion`. The approved `ScriptVersion` is never modified. The script tab keeps showing the approved text; the Production tab marks overridden fields with "Edited here" and can show the script value next to them. The checks (E07) and the publisher (E08) read the version, so what was overridden is what is checked and published.
16. Overrides are lost when production starts again from a different script (rule 4): the new version is built from the new script. Background images are the exception (rule 5).
17. **Editable fields.** `template`, `headline`, `body`, `background_asset_id`, `duration_seconds`, `transition`. Every field is optional in the request; a field that is sent replaces the current value. `null` for `background_asset_id` removes the background.
18. **Validation.**

    | Field | Rule | Field error code |
    | --- | --- | --- |
    | `template` | A key from `GET /render-templates/` with a layout for the item's format | `invalid_choice` |
    | `headline`, `body` | Within the template's `fields` limits (required, `max_chars`, and for `list` 2–5 lines of at most 60 characters each), checked against the template after the change | `required`, `max_length`, `invalid_items` |
    | `background_asset_id` | An `image` asset of the same account; the template's `image_slot` is not `none` | `does_not_exist`, `not_allowed_for_template` |
    | `duration_seconds` | `motion` and `video` only; 1.5–10 s; in `video` mode not longer than the frame's shot; the new total stays within the format registry's `min_duration_s`–`max_duration_s` | `not_allowed_for_mode`, `min_value`, `max_value`, `duration_out_of_range` |
    | `transition` | `cut`, `fade` or `slide`; not on frame 1; `motion` and `video` only | `invalid_choice`, `not_allowed` |

    A template change that makes the existing text too long is rejected; the operator shortens the text in the same request.
19. **Effect.** After a successful change:
    - `overridden` is recomputed by comparing each editable field with the script frame of the same index (`background_asset_id` counts as overridden when it is not null);
    - if the frame's render input hash changed (template, headline, body or background), its `state` becomes `stale`;
    - any change, including duration or transition, makes the final asset stale: `render_status` becomes `pending`;
    - a `ContentEvent` of type `edited` is written with `data = {"frame_index", "fields": [...]}`.
    The request does not render. The panel's **Save and render** button sends the change and then `POST …/production/render/` with `frames: [index]`.
20. Allowed when the item is `in_production`, the current version is `draft` with `origin = pipeline`, and no job is active. While the item is `needs_revision` the revise job (E07-S05) owns the next version, so frame edits return `409 invalid_transition`; the item is back in `in_production` as soon as the revise job opens the revision, or when it fails (E07-S05 rule 21), or when a reviewer chose manual rework (E07-S05 rule 2).

### Using your own file

21. `POST …/production/final-asset/` takes a new file (multipart) or the ID of an existing `image` or `video` asset of the same account. A new file goes through the E06-S01 upload pipeline with `content_item` = the item and `role = final`; rights fields follow E06-S01 rule 9.
22. **Allowed statuses.**

    | Item status | Result |
    | --- | --- |
    | `briefed` (approved brief, no script needed) | Moves to `in_production`; a new version is created with `script = null` and no frames |
    | `scripted` | Moves to `in_production`; a new version is created with `script` = the approved script and no frames |
    | `in_production` with a current `draft` | The draft is converted in place (rule 24) |
    | `in_production` with no draft | A new version is created |

    Anything else returns `409 invalid_transition`. An active job returns `409 job_in_progress`.
23. **Validation against the format registry** (`content.formats.get_spec(format, media_kind)`, E04-S01). Field names below are the ones E07-S02 reads; E04-S01 is the source of truth.

    | Rejected with `400 unsupported_media` (reason code) | Accepted with the warning `final_needs_normalising` |
    | --- | --- |
    | Kind does not match `media_kind` (`wrong_media_kind`) | Not exactly `width × height`, but the right aspect ratio |
    | Aspect ratio outside `aspect_tolerance` of `width / height` (`wrong_aspect_ratio`) | Image type is not `image_mime` |
    | Narrower than `min_width` (`resolution_too_low`) | Larger than `max_file_bytes` |
    | Video shorter than `min_duration_s` or longer than `max_duration_s` (`duration_out_of_range`) | Container, video codec, pixel format, audio codec or frame rate differ from the registry, or no audio track |
    | Unreadable file (`unreadable_media`) | |

    Rejected files have something only a person can fix. Accepted-with-warning files are left as uploaded; the format check (E07-S02) raises its findings and the revise loop normalises what it can. The warning lists the exact differences.
24. **Effect on the version.** `origin = manual_upload`, `final_asset` = the asset, `render_status = ready`, `change_note` = "Final file uploaded by {name}". Existing frames are kept for reference but are ignored from now on: they are not rendered, not shown as editable, and not read by the checks. Caption, hashtags and alt text are kept. To go back to rendered output, start production again, which creates a new version from the script (rule 4).
25. **Cover for reels.** A cover can be sent as a second file or asset (`cover` / `cover_asset_id`). It must be an image within the reel's aspect tolerance, else `400 validation_error` on `cover`. Without one, the cover is taken from the uploaded video at 1.0 s, stored as a 1080 × 1920 JPEG with `role = cover`, `origin = rendered`, `meta.inputs = [final asset id]`. Video stories and images have no cover.
26. **Copy after an upload.** When the format takes a caption and the caption is empty, a `copy.generate` job (E06-S06) is started immediately. Its job is returned as `active_job` in the response.

### Submitting

27. `production.services.submit_version(item, version, *, actor, trigger)` is used by the submit endpoint, by automatic submission (rule 12) and by E07-S05. In one transaction with the item locked it checks the blockers, sets the version `status = submitted`, `submitted_at`, `submitted_by = actor`, `submit_trigger = trigger`, moves the item `in_production → in_check` and writes a `status_changed` event "Version 3 submitted for checking". After commit, `advance(item)` runs the `in_check` handler of E07-S01, which reads `submit_trigger` to choose the run's trigger.
28. **Submit blockers.** Returned in `actions.submit_blockers` on every read, and as `409 invalid_transition` with `details.reason = "not_ready"` and `details.blockers` on submit.

    | Code | Condition |
    | --- | --- |
    | `not_current` | The version is not `item.current_version` |
    | `not_draft` | The version is not `draft` |
    | `not_rendered` | `render_status` is not `ready`, or `final_asset` is missing |
    | `waiting_for_backgrounds` | A frame needs an image (pipeline versions) |
    | `waiting_for_clips` | Footage shots without clips (pipeline `video` versions) |
    | `caption_missing` | Format takes a caption and the caption is empty |
    | `cover_missing` | Reel without `cover_asset` |
    | `newer_script` | A newer script exists than the one this pipeline version was made from (E05-S02 rule 8) |
    | `brief_not_approved` | The item's current brief is not approved |

29. **Holding warnings.** These render warnings need an explicit acknowledgement on manual submission (`acknowledge_warnings: true`) and stop automatic submission under `autopilot`: `text_overflow`, `background_required`, `rights_not_cleared`, `banned_term`, `final_needs_normalising`. Other warnings (`brand_incomplete`, `logo_not_configured`, `background_missing`, `background_low_resolution`, `first_line_long`, `clip_padded`, `clip_cropped_heavily`, `clip_low_resolution`) are informational.

### Revisions

30. `production.services.open_revision(item, *, actor=None, change_note, source)` opens version n+1 as a copy of the current version. `source` is `revise_loop` (the Plan step of E07-S05's revise job) or `review` (a reviewer's "request changes" with rework `manual`, E07-S05 rule 2). Operators never open a revision directly. It:
    - returns the current version unchanged when it is already a `draft` (idempotent);
    - otherwise copies `script`, `origin`, `frames` (every entry as it is, including `asset_id`, `state`, `input_hash`, `overridden`, `warnings`), `caption`, `hashtags`, `alt_text`, `final_asset`, `cover_asset`, `music_asset`, `cover_frame_index`, `clips`, `render_status`, `render_warnings` and `production_steps`; sets `status = draft`, `change_note`, `created_by = actor`, and clears `submitted_at`, `submitted_by`, `submit_trigger`;
    - shares assets between the versions instead of copying files, so unchanged frames, the final asset and the cover are reused as they are;
    - moves the item `needs_revision → in_production` when it was in `needs_revision`;
    - sets `item.current_version` and writes an `edited` event "Revision 4 opened: {change_note}".
31. The previous version is never changed by a revision. Assets it references are not deleted (E06-S01 rule 12 counts every version's references).
32. `open_revision` does not change `revision_count`; E07 counts revisions.

### Reading and concurrency

33. `GET …/production/` returns `item.current_version`. With `?version=n` it returns that version read-only: all `actions` are false. A non-current draft (replaced by rule 4) is shown with `is_current: false`.
34. Every mutation in this story takes `base_version` (except start and upload from `briefed`/`scripted`, where there may be no version) and returns `409 version_conflict` with `details.latest_version` when it is not the current version.
35. While the item has an active job of any kind, every mutation returns `409 job_in_progress` with the job in `details.job`.

## Data

Uses `ContentItem`, `ContentVersion`, `Asset`, `ScriptVersion`, `Brief`, `JobRun`, `ContentEvent` from [DATA-MODEL.md](../../DATA-MODEL.md), plus the `ContentVersion` additions from E06-S02 (`frames` as full working copies, `render_warnings`), E06-S03 (`music_asset`, `cover_frame_index`) and E06-S04 (`clips`).

New fields on `ContentVersion`:

| Field | Type | Notes |
| --- | --- | --- |
| `production_steps` | JSON | Per step: `{"status", "input_hash", "finished_at", "error_code", …}`; `status` is `pending`, `running`, `done`, `skipped`, `waiting` or `failed` |
| `submit_trigger` | enum, null | `submission` or `revision`; set by `submit_version`; read by E07-S01 |
| `submitted_at` | datetime, null | |
| `submitted_by` | FK User, null | Null for automatic submission |

Example `production_steps`:

```json
{
  "prepare": {"status": "done", "finished_at": "2026-11-24T09:30:02Z"},
  "backgrounds": {"status": "done", "input_hash": "1b9e…40aa", "generated": [1], "missing": [], "finished_at": "2026-11-24T09:30:31Z"},
  "frames": {"status": "done", "input_hash": "77c0…e12f", "rendered": [1, 2, 3, 4], "reused": [], "finished_at": "2026-11-24T09:31:10Z"},
  "assemble": {"status": "done", "input_hash": "a3d4…9b01", "finished_at": "2026-11-24T09:32:04Z"},
  "copy": {"status": "done", "finished_at": "2026-11-24T09:32:19Z"},
  "finish": {"status": "done", "finished_at": "2026-11-24T09:32:19Z"}
}
```

New render warning code: `final_needs_normalising` (`{"code": "final_needs_normalising", "message": "1920 × 3414 instead of 1080 × 1920; HEVC instead of H.264"}`).

Job error codes are those of the steps (rule 13). No new ones.

## API

All endpoints require a signed-in user. Operators and admins have the same rights.

### `GET /api/v1/content-items/{id}/production/`

Query: `version` (optional int).

Response `200` for a motion reel whose production has finished:

```json
{
  "content_item": 42,
  "version": 1,
  "latest_version": 1,
  "is_current": true,
  "status": "draft",
  "origin": "pipeline",
  "format": "reel",
  "media_kind": "video",
  "production_mode": "motion",
  "render_status": "ready",
  "script": {"id": 77, "version": 2, "status": "approved", "is_current": true},
  "change_note": "Produced from script version 2",
  "frames": [
    {
      "index": 1, "shot_index": 1, "template": "title",
      "headline": "سه نشانه که بودجه‌تان نشتی دارد", "body": "",
      "visual_prompt": "Soft morning light on a tidy desk, no people",
      "background_asset_id": 811, "duration_seconds": 4, "transition": "cut",
      "asset_id": 812, "state": "rendered", "input_hash": "c41d…77e0",
      "warnings": [], "overridden": ["background_asset_id"],
      "asset": {"id": 812, "url": "https://media.example.test/accounts/3/2026/11/812-frame-1.png?sig=…", "thumbnail_url": "https://media.example.test/accounts/3/2026/11/812-frame-1-thumb.jpg?sig=…", "width": 1080, "height": 1920},
      "background_asset": {"id": 811, "thumbnail_url": "…", "origin": "ai_generated", "rights_status": "cleared"},
      "script_frame": null
    },
    {
      "index": 2, "shot_index": 2, "template": "stat",
      "headline": "۶۰٪", "body": "از خریدهای ماهانه بدون برنامه انجام می‌شود",
      "visual_prompt": "", "background_asset_id": null, "duration_seconds": 5, "transition": "fade",
      "asset_id": 813, "state": "rendered", "input_hash": "08ab…5c3d",
      "warnings": [], "overridden": ["body"],
      "asset": {"id": 813, "url": "…", "thumbnail_url": "…", "width": 1080, "height": 1920},
      "background_asset": null,
      "script_frame": {"template": "stat", "headline": "۶۰٪", "body": "از خریدهای ماهانه بدون فهرست و برنامه انجام می‌شود", "duration_seconds": 5, "transition": "fade"}
    },
    {
      "index": 3, "shot_index": 3, "template": "list",
      "headline": "سه نشانه", "body": "اشتراک‌هایی که یادتان رفته\nخریدهای کوچک روزانه\nکارمزدهای پنهان",
      "visual_prompt": "", "background_asset_id": null, "duration_seconds": 7, "transition": "slide",
      "asset_id": 814, "state": "rendered", "input_hash": "f2e9…0d71",
      "warnings": [], "overridden": [],
      "asset": {"id": 814, "url": "…", "thumbnail_url": "…", "width": 1080, "height": 1920},
      "background_asset": null, "script_frame": null
    },
    {
      "index": 4, "shot_index": 4, "template": "cta",
      "headline": "این پست را ذخیره کنید", "body": "هر هفته یک نکته مالی",
      "visual_prompt": "", "background_asset_id": null, "duration_seconds": 4, "transition": "fade",
      "asset_id": 815, "state": "rendered", "input_hash": "9c11…ab42",
      "warnings": [], "overridden": [],
      "asset": {"id": 815, "url": "…", "thumbnail_url": "…", "width": 1080, "height": 1920},
      "background_asset": null, "script_frame": null
    }
  ],
  "final_asset": {
    "id": 845, "kind": "video", "mime": "video/mp4",
    "url": "https://media.example.test/accounts/3/2026/11/845-reel-final.mp4?sig=…",
    "thumbnail_url": "…", "width": 1080, "height": 1920,
    "duration_ms": 20000, "bytes": 5893120, "rights_status": "cleared"
  },
  "cover_asset": {"id": 846, "url": "…", "thumbnail_url": "…", "width": 1080, "height": 1920},
  "cover_frame_index": 1,
  "music_asset": null,
  "shots": [],
  "clips": [],
  "missing_shots": [],
  "caption": "بودجه‌تان هر ماه زودتر از حقوق تمام می‌شود؟\n\nسه نشانه هست که می‌گوید پول کجا نشت می‌کند. ویدیو را تا آخر ببینید و اولی را همین امروز امتحان کنید.\n\nذخیره کنید تا آخر ماه دوباره سراغش بیایید.",
  "hashtags": ["مدیریت_مالی", "بودجه_بندی", "پس_انداز"],
  "alt_text": "",
  "caption_preview": "بودجه‌تان هر ماه زودتر از حقوق تمام می‌شود؟\n\n…\n\n#مدیریت_مالی #بودجه_بندی #پس_انداز",
  "caption_length": 236,
  "copy_limits": {"caption_max_chars": 2200, "max_hashtags": 5, "alt_text_max_chars": 100},
  "uses_ai_generated": true,
  "render_warnings": [],
  "production_steps": {
    "prepare": {"status": "done"}, "backgrounds": {"status": "done"}, "frames": {"status": "done"},
    "assemble": {"status": "done"}, "copy": {"status": "done"}, "finish": {"status": "done"}
  },
  "submitted_at": null,
  "submitted_by": null,
  "active_job": null,
  "actions": {
    "can_start": true,
    "can_render": true,
    "can_edit_frames": true,
    "can_edit_copy": true,
    "can_upload_final": true,
    "can_submit": true,
    "submit_blockers": [],
    "holding_warnings": []
  },
  "versions": [
    {"version": 1, "status": "draft", "origin": "pipeline", "is_current": true, "change_note": "Produced from script version 2", "created_at": "2026-11-24T09:30:02Z", "submitted_at": null}
  ]
}
```

Notes:

- `script_frame` holds the approved script's values for the frame and is present only when `overridden` is not empty, so the panel can offer "Reset to script".
- `shots`, `clips` and `missing_shots` are filled for `video` mode (E06-S04).
- An item with no version yet returns `200` with `version: null`, empty lists, `render_status: "pending"` and `actions.can_start` / `can_upload_final` set by status. This lets the tab render before production starts.

Errors: `404 not_found` for an unknown item or a `version` that does not exist.

### `POST /api/v1/content-items/{id}/production/start/`

Request:

```json
{"restart_from_script": false}
```

Response `202`:

```json
{
  "job": {
    "id": "c8a2b1c4-1d2e-4a8f-9b37-0f6d2e5a7c21",
    "kind": "production.start",
    "status": "queued",
    "progress": 5,
    "message": "Version 1 prepared",
    "target_type": "content_item",
    "target_id": "42",
    "result": {"content_version": 1},
    "error_code": null,
    "error_detail": null,
    "created_at": "2026-11-24T09:30:02Z",
    "started_at": null,
    "finished_at": null
  }
}
```

Job progress messages, in order: "Version 1 prepared", "Generating background for frame 1", "Rendering frame 2 of 4", "Assembling video (12 s of 20 s)", "Writing caption", "Done".

Job `result` on success:

```json
{
  "content_version": 1,
  "steps": {"backgrounds": "done", "frames": "done", "assemble": "done", "copy": "done"},
  "rendered_frames": [1, 2, 3, 4],
  "reused_frames": [],
  "final_asset": 845,
  "cover_asset": 846,
  "caption_generated": true,
  "waiting_for": null,
  "auto_submitted": false,
  "warnings": 0
}
```

When waiting: `"steps": {"backgrounds": "done", "frames": "waiting", "assemble": "waiting", "copy": "done"}`, `"waiting_for": "backgrounds"`, `"final_asset": null`.

Errors:

| Case | Status and code |
| --- | --- |
| Item status not `scripted`, `in_production` or `needs_revision` | `409 invalid_transition`, `details.allowed_statuses` |
| No approved script | `409 invalid_transition`, `details.reason = "script_not_approved"` |
| Active job on the item | `409 job_in_progress`, `details.job` |
| Nothing to do: current draft is `ready` for the approved script and `restart_from_script` is false | `200` with `{"job": null, "content_version": 1, "unchanged": true}` |

### `POST /api/v1/content-items/{id}/production/render/`

Defined in E06-S02 (frames, forced re-render, `reassemble`) and extended by E06-S03 and E06-S04. This story only calls it from the panel: **Re-render** sends `{"base_version": n, "frames": null, "reassemble": true}`; **Save and render** in the frame drawer sends `{"base_version": n, "frames": [index], "reassemble": true}`.

### `PUT /api/v1/content-items/{id}/production/frames/{index}/`

Request:

```json
{
  "base_version": 1,
  "headline": "۶۰٪",
  "body": "از خریدهای ماهانه بدون برنامه انجام می‌شود",
  "background_asset_id": null
}
```

Response `200`: the production resource. The changed frame:

```json
{
  "index": 2, "template": "stat",
  "headline": "۶۰٪", "body": "از خریدهای ماهانه بدون برنامه انجام می‌شود",
  "background_asset_id": null, "duration_seconds": 5, "transition": "fade",
  "asset_id": 813, "state": "stale", "warnings": [], "overridden": ["body"],
  "script_frame": {"template": "stat", "headline": "۶۰٪", "body": "از خریدهای ماهانه بدون فهرست و برنامه انجام می‌شود", "duration_seconds": 5, "transition": "fade"}
}
```

with `render_status: "pending"` on the version.

Errors:

| Case | Status and code |
| --- | --- |
| Item not `in_production`; version not a `draft`; `origin = manual_upload` | `409 invalid_transition`, `details.status`, `details.allowed_statuses = ["in_production"]` |
| `base_version` is not the current version | `409 version_conflict`, `details.latest_version` |
| Active job | `409 job_in_progress` |
| No frame with that index | `404 not_found` |
| Any rule in the validation table | `400 validation_error`, for example path `body`, code `max_length`, message "Up to 100 characters for this template." |

### `POST /api/v1/content-items/{id}/production/final-asset/`

Multipart with a new file:

| Part | Required | Notes |
| --- | --- | --- |
| `file` | one of `file` / `asset_id` | The finished image or video |
| `asset_id` | one of `file` / `asset_id` | An existing `image` or `video` asset of the account |
| `base_version` | when a current version exists | |
| `origin` | no | `uploaded` (default) or `licensed` |
| `rights_status`, `license_note`, `source_url`, `rights_expires_at` | no | As E06-S01 |
| `cover` / `cover_asset_id` | no | Reels only |

Response `200`: the production resource, for example:

```json
{
  "content_item": 57,
  "version": 2,
  "latest_version": 2,
  "is_current": true,
  "status": "draft",
  "origin": "manual_upload",
  "format": "reel",
  "media_kind": "video",
  "production_mode": "video",
  "render_status": "ready",
  "change_note": "Final file uploaded by Sara",
  "final_asset": {"id": 902, "kind": "video", "mime": "video/quicktime", "url": "…", "thumbnail_url": "…", "width": 2160, "height": 3840, "duration_ms": 27400, "bytes": 141220311, "rights_status": "cleared"},
  "cover_asset": {"id": 903, "url": "…", "thumbnail_url": "…", "width": 1080, "height": 1920},
  "render_warnings": [
    {"code": "final_needs_normalising", "message": "2160 × 3840 instead of 1080 × 1920; MOV instead of MP4; 135 MB, limit 100 MB"}
  ],
  "caption": "",
  "active_job": {"id": "0e4a…", "kind": "copy.generate", "status": "queued", "progress": 0},
  "actions": {"can_start": true, "can_render": false, "can_edit_frames": false, "can_edit_copy": false, "can_upload_final": false, "can_submit": false, "submit_blockers": ["caption_missing"], "holding_warnings": ["final_needs_normalising"]}
}
```

Errors:

| Case | Status and code |
| --- | --- |
| Status not allowed (rule 22) | `409 invalid_transition`, `details.allowed_statuses` |
| `base_version` is not the current version | `409 version_conflict` |
| Active job | `409 job_in_progress` |
| Neither or both of `file` and `asset_id`; asset from another account; bad cover | `400 validation_error` |
| Upload pipeline rejection (E06-S01) or a hard registry rule (rule 23) | `400 unsupported_media`, `details.reasons`, for example `["wrong_aspect_ratio: 16:9, expected 9:16", "duration_out_of_range: 140 s, allowed 5–90 s"]` |
| File larger than the upload limit | `413 payload_too_large` |

### `POST /api/v1/content-items/{id}/production/submit/`

Request:

```json
{"base_version": 1, "acknowledge_warnings": false}
```

Response `200`:

```json
{
  "content_item": {"id": 42, "status": "in_check", "active_job": {"id": "9d3f…", "kind": "qc.run", "status": "queued", "progress": 0}},
  "version": 1,
  "status": "submitted",
  "submitted_at": "2026-11-24T09:40:12Z",
  "submitted_by": {"id": 2, "name": "Sara"},
  "submit_trigger": "submission"
}
```

`active_job` is the check run when E07-S01 queued it during the commit; otherwise `null` and the shell's polling picks it up.

Errors:

| Case | Status and code |
| --- | --- |
| Item not `in_production` | `409 invalid_transition`, `details.allowed_statuses = ["in_production"]` |
| `base_version` is not the current version | `409 version_conflict` |
| Active job | `409 job_in_progress` |
| Blockers present | `409 invalid_transition`, `details.reason = "not_ready"`, `details.blockers = ["caption_missing"]` |
| Holding warnings not acknowledged | `409 invalid_transition`, `details.reason = "warnings_not_acknowledged"`, `details.warnings = [{"code": "text_overflow", "frame_index": 3, "message": "…"}]` |

## Background work

| Task | Queue | Notes |
| --- | --- | --- |
| `production.tasks.step_backgrounds(job_id, version_id)` | `default` | Calls the S05 service per frame |
| `production.tasks.step_frames(job_id, version_id)` | `render` | Calls the S02 frame renderer, skipping frames that need an image |
| `production.tasks.step_assemble(job_id, version_id)` | `render` | Calls S02 export, S03 or S04 by mode; `waiting` when inputs are incomplete |
| `production.tasks.step_copy(job_id, version_id)` | `default` | Calls the S06 copy service when the caption is empty |
| `production.tasks.step_finish(job_id, version_id)` | `default` | Rules 10–12 |

- The chain is built with `celery.chain(...)` of immutable signatures, each routed to its queue. A step that raises stops the chain; its `job_context` marks the job failed (rule 13).
- **Idempotency** as in rule 8. A whole repeated chain on an unchanged version does no rendering, no assembly and no AI call.
- **Retries** belong to the step implementations (S02: three per frame; S03 and S04: three for transient errors, one for FFmpeg; S05 and S06: the gateway's three). The orchestration adds none.
- **Time.** The stale-job timeout for `production.start` (E00-S06) is 45 minutes, enough for a 90-second footage reel on one render worker.
- **Concurrency.** One active job per item (rule 35). Many items can produce in parallel; the render queue serializes their render steps per worker.
- **Logging.** Each step logs `job_id`, `content_item_id`, `version`, step, status and duration.

## AI

None directly. The `backgrounds` step uses `image.generate` (E06-S05) and the `copy` step uses `copy.generate` (E06-S06).

## Panel

The Production tab of `/content/:id`, in `src/pages/content/workspace/tabs/ProductionTab.tsx`. It receives the item and `reload` from the workspace shell (E03-S04) and loads `GET …/production/` itself, again whenever the item's `active_job` ends.

### Layout

```text
┌ Tab header ─────────────────────────────────────────────────────────────────────┐
│ Version [3 · Draft ▾]   Steps: Backgrounds ✓  Frames ✓  Assemble ✓  Copy ⟳      │
│                         [Start production] [Re-render] [Use my own file] [Submit for checking] │
├ Alerts (newer script / waiting / failed / read-only) ───────────────────────────┤
│ ┌ Preview (5/12) ───────────┐  ┌ Right column (7/12) ─────────────────────────┐ │
│ │ MediaPreview              │  │ Footage card (video mode, E06-S04)           │ │
│ │ [Safe area] [Cover]       │  │ Frames card: frame strip                     │ │
│ │ 1080 × 1920 · 20 s · 5.6 MB│  │ Music and cover card (motion/video, E06-S03) │ │
│ │ Warnings                  │  │ Copy card (E06-S06)                          │ │
│ └───────────────────────────┘  └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Below 1200 px the two columns stack, preview first.

### Tab header

- **Version selector.** A `Select` listing `versions`, newest first: "Version 3 · Draft", "Version 2 · Rejected", "Version 1 · Draft (replaced)". Choosing an older one loads `?version=n`, shows a blue `Alert` "You are viewing version 2. It is read-only." with a link "Back to the current version", and hides every action.
- **Steps.** A small `Steps` component built from `production_steps`: Backgrounds, Frames, Assemble, Copy. Icons: done ✓, running spinner, waiting clock, failed red, skipped grey. Hidden for `manual_upload` versions.
- **Actions** (each hidden or disabled according to `actions`):

  | Button | Shown when | Behaviour |
  | --- | --- | --- |
  | **Start production** | `can_start`. Labelled **Resume production** when the current draft has a failed or waiting step, **Start over from script** in the overflow menu when a draft exists | `JobButton` on `POST …/start/`. "Start over from script" asks: "Create a new version from the approved script? Edits made on this tab will not be carried over, except background images." |
  | **Re-render** | `can_render` and at least one frame is `stale` or `failed`, or `render_status` is `pending` or `failed` | `JobButton` on `POST …/render/` with `frames: null` |
  | **Use my own file** | `can_upload_final` | Opens the upload modal |
  | **Submit for checking** (primary) | Current draft | Disabled with a tooltip listing `submit_blockers` in words, for example "Write a caption first" and "Render the changed frames first". Confirmation below |

- **Submit confirmation.** `Modal.confirm`: title "Submit version 3 for checking?", text "The five checks start right away. This version can't be edited after it is submitted." When `holding_warnings` is not empty, the modal lists them with `FrameWarning` and the confirm label is **Submit anyway**, which sends `acknowledge_warnings: true`. On success: `message.success("Submitted for checking")`, `reload()`, and the shell switches to `?tab=checks`.

### Alerts

| Condition | Alert |
| --- | --- |
| `script.is_current` false (a newer script exists) | Warning: "A newer script (version 3) exists. Approve it to produce a new version, or submit this one as it is after the script is approved." with a link to the Script tab |
| `waiting_for` = backgrounds | Warning: "Frame 3 needs an image. Open the frame and choose or generate one, then re-render." |
| Waiting for clips | Handled by the Footage card (E06-S04) |
| Last job failed | Error: "Production stopped at {step}: {text for the error_code}." with **Try again** (resume) |
| `origin = manual_upload` | Info: "This version uses your uploaded file. Frames are not used. Start production again to go back to rendered output." |

### `MediaPreview` component

`src/components/MediaPreview/index.tsx`, reused by E07-S06 (review page) and E08 (publishing tab).

| Prop | Type | Notes |
| --- | --- | --- |
| `asset` | `{url, thumbnail_url, kind, width, height, duration_ms}` or null | |
| `format` | `Format` | Reads `width`, `height` and `safe_area` from the cached registry (`useFormats`, E04-S01) |
| `cover` | asset or null | Reels: shown as the poster and in "Cover" mode |
| `showSafeAreaDefault` | boolean | Default false |
| `state` | `'idle' \| 'rendering' \| 'failed' \| 'empty'` | Overlay states |
| `maxHeight` | number | Default 560 px |
| `alt` | string | Alt text or caption for screen readers |
| `onUrlExpired` | function | Called when the media fails to load, so the parent refetches signed URLs |

Behaviour:

- The frame keeps the format's aspect ratio with CSS `aspect-ratio: width / height` and fits `maxHeight`. Images use `<img>`; videos use `<video controls muted playsInline preload="metadata">` with the cover or thumbnail as poster. Video is never autoplayed.
- **Safe area** toggle (`Switch`, label "Safe area"): draws the regions Instagram covers as translucent bands and a dashed outline of the safe rectangle, positioned in percentages from the registry's pixel values, so it scales with the preview.
- **Cover** toggle (reels only): shows the cover image instead of the video.
- Overlays: `rendering` shows a `Spin` with "Rendering…"; `failed` shows an error icon and "Render failed"; `empty` shows "Nothing rendered yet".
- Under the preview: dimensions, duration and file size ("1080 × 1920 · 20 s · 5.6 MB"), the `RightsTag` of the final asset, and an "AI-generated content" tag when `uses_ai_generated`.
- The container has `role="img"` and `aria-label` from `alt` for images; videos get `aria-label` "Video preview, 20 seconds".

### Frames card

- Header: "Frames", counter "4 frames · 20 s", and for reels a legend "★ cover".
- A horizontal strip of frame cards (wraps to two rows below 900 px). Each card: thumbnail in the layout's aspect ratio (or a schematic box with the template name when not rendered), "Frame 2 · Stat · 5 s", a state tag (Rendered green, Needs render orange, Failed red, Not rendered grey), a warning icon with a tooltip listing `FrameWarning` texts, a small "Edited here" tag when `overridden` is not empty, and for reels a star button "Use as cover" that sends `PATCH …/production/` with `cover_frame_index` (E06-S03).
- Clicking a card selects it: the preview shows that frame's PNG with the label "Frame 2" and a link "Show final". Double-click or the card's **Edit** button opens the drawer.
- For `design` items the strip has one card; for `manual_upload` versions the card is hidden.

### Frame edit drawer

`Drawer` 520 px wide, title "Frame 2".

| Section | Content |
| --- | --- |
| Preview | The frame's PNG at 240 px height, with the state tag |
| Template | `TemplateSelect` (E06-S02). Changing it re-reads the field limits and re-validates the text |
| Text | Headline and Body as `Input.TextArea` with counters from the template's limits ("42 / 60"), `dir="auto"` and the content font through `ContentText` styling. For `list`, helper "One point per line, 2 to 5 points" and a per-line counter. A field over its limit is shown in red; saving is disabled |
| Timing | Duration (`InputNumber`, 1.5–10, step 0.5, suffix "s") and Transition (`Segmented`: Cut, Fade, Slide). Only for `motion` and `video`; transition hidden on frame 1. Under them: "Video length after this change: 21 s (allowed 5–90 s)" |
| Background | Only when the template accepts an image. Current background thumbnail with `RightsTag` or "Brand background". Actions **Choose from library** (`AssetPicker` with `kind=image`, upload allowed), **Generate image** (E06-S05 controls) and **Remove background** |
| Script values | Collapsible "Approved script" showing the `script_frame` values with a **Reset to script** link per field. Shown only when the frame is overridden |

Footer: **Cancel**, **Save**, **Save and render** (primary). Save sends the `PUT`; Save and render sends the `PUT` and then the render job, closes the drawer and shows the job in the tab header. Field errors from the API appear under the field. Closing with unsaved changes asks "Discard your changes to frame 2?"

A note at the top of the drawer, shown once per session: "Changes here apply to this version only. The approved script is not changed."

### Upload modal ("Use my own file")

- Title "Use my own file". Requirements list built from the registry: "Video · 9:16 · 1080 × 1920 · 5–90 s · MP4 (H.264, AAC) · up to 100 MB".
- Two tabs: **Upload** (`AssetUploader` from E06-S01 with role preset to Final, rights fields included) and **From library** (`AssetPicker`, `kind` = the item's media kind).
- Reels: an optional "Cover image" uploader, with the hint "Without a cover, the frame at 1 second is used."
- When the current draft has rendered output, a warning line: "This replaces the rendered video in version 3. To go back, start production again."
- **Use this file** submits. A rejection lists each reason in plain words ("The video is 16:9; reels need 9:16."). An accepted file with `final_needs_normalising` closes the modal and shows the warning in the preview card.

### States

| State | Display |
| --- | --- |
| Loading | Skeletons for the preview and the cards |
| No version yet, item `scripted` | `Empty`: "Production has not started." with **Start production**; if a job is queued, the shell's progress bar is shown instead |
| No version yet, item `briefed` | `Empty`: "Approve the script to start production, or use your own file." with **Use my own file** and a link to the Script tab |
| Job running | Every action disabled with the tooltip "Production is running"; the step that is running shows a spinner; the preview overlay says "Rendering…" during frames and assemble |
| Waiting | Alert from the table above; Submit disabled |
| Failed | Error alert with **Try again**; frames that rendered stay visible |
| Read-only (submitted, older version, item past `in_production`) | All inputs disabled, actions hidden, note "This version was submitted on 24 Nov at 13:10. Changes go into a new version." |
| `needs_revision` | Info alert "An automatic revision is being prepared. Editing is available again when it reaches production." Inputs disabled |
| Conflict (`409 version_conflict`) | Message "This item changed. Reloading." and the tab reloads |
| Signed URL expired | `MediaPreview` calls `onUrlExpired`; the tab refetches once |

## Acceptance criteria

1. Given a `design` feed post whose script was just approved with `autopilot.script` off, when the `scripted` handler runs, then the item is `in_production`, version 1 is a draft with one frame, and after the job: `render_status = ready`, `final_asset` is a 1080 × 1350 JPEG, a caption and hashtags exist, `hold_reason` is "Ready to submit", and the version is still `draft`.
2. Given the same with `autopilot.script` on and no warnings, when the job finishes, then the version is `submitted` with `submit_trigger = submission`, the item is `in_check`, and a `qc.run` job exists.
3. Given `autopilot.script` on and a frame with `text_overflow`, when the job finishes, then the version is not submitted and the hold reason says there are warnings to review.
4. Given production has finished for script version 2, when `start_production` is called again for the same script, then no new version is created and the endpoint answers `unchanged: true`.
5. Given a motion reel whose job failed while assembling, when I press **Resume production**, then backgrounds, frames and copy are not redone (no new frame assets, no new `AIRun`) and only assembly runs.
6. Given an `image_caption` frame with no background and auto images off, when production runs, then the other frames render, the job succeeds with `waiting_for = "backgrounds"`, the hold reason names the frame, and submitting returns `waiting_for_backgrounds`.
7. Given a draft frame, when I change its body through `PUT …/frames/2/`, then the version's frame 2 has the new body and `overridden = ["body"]`, its state is `stale`, `render_status` is `pending`, and the approved `ScriptVersion` payload is byte-for-byte unchanged.
8. Given I send a headline of 75 characters for a `title` frame, then I get `400 validation_error` on `headline` with code `max_length`.
9. Given I change frame durations so the reel would be 95 seconds, then I get `duration_out_of_range` on `duration_seconds`.
10. Given a reel in `in_production`, when I upload a 9:16 MOV of 27 s at 2160 × 3840, then the version's origin is `manual_upload`, `render_status` is `ready`, a cover is taken from the video at 1 s, the warning `final_needs_normalising` is present, and a `copy.generate` job runs because the caption is empty.
11. Given I upload a 16:9 video for a reel, then I get `400 unsupported_media` with `wrong_aspect_ratio` and the version is unchanged.
12. Given an item in `briefed`, when I upload a valid final image for a feed post, then the item is `in_production` and the new version has `script = null`.
13. Given a ready draft with an empty caption on a feed post, when I submit, then I get `409 invalid_transition` with blocker `caption_missing`.
14. Given a ready draft with a `rights_not_cleared` warning, when I submit without acknowledging, then I get `warnings_not_acknowledged`; with `acknowledge_warnings: true`, the version is submitted.
15. Given an item in `needs_revision`, when I edit frame 3 or upload a final file, then I get `409 invalid_transition` and no version is created. Given the revise job then calls `open_revision`, then version n+1 exists as a draft that shares unchanged frame assets with version n, the item is `in_production`, and version n is unchanged.
16. Given an item with a running job, when I call any mutation in this story, then I get `409 job_in_progress` with the job in `details`.
17. Given a job in progress, when the item is cancelled, then the remaining steps exit without writing and no version is submitted.
18. In the panel, given a reel, when I toggle "Safe area", then the bands match the registry's safe area at any preview size.
19. In the panel, given I choose version 1 of an item at version 3, then every input is disabled and the read-only banner is shown.
20. In the panel, given I edit frame 2 and press **Save and render**, then only frame 2's thumbnail changes and the final video is rebuilt.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S07-BE1 | Production resource | Migration for `production_steps`, `submit_trigger`, `submitted_at`, `submitted_by`; serializer combining S02–S06 fields, `script_frame`, `versions`, `actions` with `submit_blockers` and `holding_warnings`; `GET …/production/` with `?version=`. | 0.35 d |
| E06-S07-BE2 | Orchestration | `production/services/orchestration.py`: `start_production` (rules 1–6, version choice and carry-over), step tasks and chain (rule 7), step hashes and skip logic, cancellation checks, finish with waiting, auto-submit and hold reasons, failure handling; `scripted` handler registration; `POST …/start/`. | 0.6 d |
| E06-S07-BE3 | Frame overrides | `PUT …/frames/{index}/`: validation against template limits, mode and duration totals; `overridden` recomputation; stale marking; event; rejection while `needs_revision`. | 0.3 d |
| E06-S07-BE4 | Final asset upload | `POST …/final-asset/`: reuse of the E06-S01 upload pipeline, registry validation split into hard rejections and `final_needs_normalising`, in-place conversion, cover handling, transitions from `briefed` and `scripted`, copy job start. | 0.3 d |
| E06-S07-BE5 | Submit and revisions | `submit_version` with blockers and warning acknowledgement, `POST …/submit/`; `open_revision` (rules 30–32); `pipeline.set_hold_reason` if E03-S04 does not provide it. | 0.3 d |
| E06-S07-BE6 | Contract and flow test | `openapi.yaml` for the five endpoints; one end-to-end test per production mode with fake providers: script approved → ready → submitted → `in_check`. | 0.15 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S07-FE1 | `MediaPreview` | Aspect-ratio frame from the registry, image and video, safe-area overlay, cover mode, overlay states, file facts, accessibility, URL-expiry callback. Component tests. | 0.75 d |
| E06-S07-FE2 | Production tab shell | Data loading and refetch on job end, two-column layout, version selector and read-only mode, steps indicator, alerts, every state in the table. | 1 d |
| E06-S07-FE3 | Frames card | Strip with thumbnails, state and warning tags, "Edited here", selection into the preview, cover star. | 0.5 d |
| E06-S07-FE4 | Frame edit drawer | Template select, text fields with live limits, timing with length summary, background section hosting S05 controls and `AssetPicker`, script values with reset, Save and Save and render, unsaved-changes guard, API field errors. | 1 d |
| E06-S07-FE5 | Actions and upload modal | Start, resume, start over, re-render as `JobButton`s; upload modal with requirements, two tabs, cover, rejection reasons; submit with blockers tooltip, warnings confirmation, switch to Checks tab. | 0.75 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- **Orchestration with fake providers** (AI fake, renderer and FFmpeg real in the render image, stubbed elsewhere): one run per mode (`design`, `motion`, `video` with and without clips); a forced failure in each step, then a resume that asserts which steps were skipped by counting new assets and `AIRun` rows; a cancellation between steps.
- **Version choice table** (rule 4): one test per row, including a re-approved script while a draft exists and a `manual_upload` draft.
- **Carry-over** (rule 5): background kept when the template is the same at that index, dropped when it changed; clips re-validated.
- **Overrides:** the script payload hash before and after a frame edit is identical; `overridden` for each field; template change that breaks the text limit.
- **Upload validation:** a sample per row of the rule 23 table, including a rotated phone video (aspect computed after rotation).
- **Submit:** every blocker; warning acknowledgement; `submit_trigger` passed through to E07-S01 (assert the created `QCRun` trigger).
- **Revisions:** asset sharing (no new files), previous version untouched, idempotent second call.
- **Panel:** `MediaPreview` safe-area geometry at two sizes; drawer counters for `list`; disabled actions while `active_job` is set; read-only older version; submit confirmation with warnings.

## Later

- Adding, removing and reordering frames on this tab, written back as a new script version.
- Normalising manual uploads at upload time (transcode, scale, compress), as a step before rule 23.
- Comparing two versions side by side for reviewers.
- Server-sent events instead of polling for step progress.
- Per-account auto-submit rules separate from `autopilot.script`, for example "auto-submit design items only".
