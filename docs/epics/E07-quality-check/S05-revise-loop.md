# E07-S05 — Automatic revise loop

| | |
| --- | --- |
| Epic | E07 Quality check |
| Priority | Must |
| Estimate | BE 2 d · FE 0.5 d · QA 0 d |
| Depends on | E07-S01, E07-S02, E07-S03, E07-S04, E05-S03, E06-S02, E06-S03, E06-S06, E06-S07 |
| Needed by | E07-S06, E11-S03 |

## User story

As an operator, I want content that fails a check for a fixable reason to be corrected and rechecked without me, so that I only review what the system could not fix itself.

## Context

This is the "Revise: return to production, then recheck" outcome. When a check run ends in Revise (E07-S01), or a reviewer requests changes (E07-S06), the item is `needs_revision`. The revise job reads what was wrong, does the smallest rework that addresses it, saves the result as the next content version and submits it for a new check run.

"Smallest" matters: a too-long caption must not trigger a new script and a new render. The catalogue (E07-S02, E07-S03, E07-S04) gives every auto-fixable finding a fix level, and the job works at the lowest level that covers the findings.

The loop is bounded. After `posting_rules.max_revisions` automatic revisions (default 2), a further Revise outcome escalates to a person.

## Scope

**In**

- The `qc.revise` job: plan, rework at copy, render or script level, create version n+1, resubmit.
- Deterministic copy fixes that need no AI.
- Revision instructions built from findings or from a reviewer's request.
- The revision limit and the two counters.
- Failure handling and a retry endpoint.
- The revision banner and change note on the Checks tab.

**Out (later)**

- Choosing between alternative fixes or generating several variants.
- Partial human edits merged with automatic ones.
- Learning which fixes work, or adjusting prompts from revision history.
- Revising a version after it has been approved or scheduled.

## Behaviour and rules

### When the job runs

1. The pipeline's `advance(item)` starts the job when an item enters `needs_revision`. There are two sources, recorded in the `ContentEvent` written on that transition (`data.source`):
   - `{"qc_run_id": n}` — a Revise outcome (E07-S01 rule 20);
   - `{"review_task_id": n}` — a reviewer chose "Request changes" (E07-S06).
2. Exception: when the reviewer chose rework `manual`, no job is started. The pipeline calls E06-S07's `open_revision(item, change_note="Changes requested by {user}", source="review")`, which opens draft n+1 and moves the item `needs_revision → in_production`; `hold_reason` is set to `"Changes requested: <instructions>"`, and the operator edits and submits in the Production tab (E06-S07).
3. When the job starts it sets `active_job`; the item stays `needs_revision` until the Plan step opens the revision through `open_revision(item, change_note, source="revise_loop")`, which moves it `needs_revision → in_production`. This story owns that transition and the later `in_production → in_check` (through E06-S07's `submit_version`). While the item is `needs_revision`, operators cannot edit frames, copy or the final file (E06-S06 rule 14, E06-S07 rule 20), so the job never races a person for version n+1.

### Fix levels

4. Every auto-fixable finding has one fix level, from the catalogues:

| Level | What is redone | What is kept from version n | Typical findings |
| --- | --- | --- | --- |
| `copy` | Caption, hashtags, alt text | Script, frames, final and cover assets | `format.caption_too_long`, `format.too_many_hashtags`, `rights.ai_disclosure_missing`, `copy.*` findings located in caption, hashtags or alt text, `facts.unsupported_claim` in the caption |
| `render` | Affected frames are rendered again with changed render options or a regenerated background, or the media file is normalised; video is reassembled | Script, text, unaffected frames, copy | `format.wrong_dimensions`, `format.wrong_container`, codec, frame-rate and size findings, `format.audio_track_missing`, `format.cover_missing`, `design.logo_incorrect`, `design.illegible_text`, `design.image_quality` and `design.text_in_generated_image` on generated backgrounds |
| `script` | A new script version for the affected frames, then those frames are rendered again and the video reassembled | Brief, unaffected frames, copy | `design.text_overflow`, `design.text_clipped`, `format.duration_too_long`, `format.duration_too_short`, `copy.*` and `facts.unsupported_claim` findings located in a frame or in script text |

5. Levels are ordered `copy < render < script`. The plan's level is the highest level among the run's auto-fixable `blocker` and `major` findings.
6. The plan includes every auto-fixable `blocker` and `major` finding. It also includes auto-fixable `minor` findings whose level is at or below the plan's level, so that notes are cleaned up when the work is being done anyway. A `minor` finding never raises the level.
7. A plan at `render` or `script` level also performs the copy step when it contains copy-level findings. Otherwise the caption, hashtags and alt text are carried over unchanged.
8. On a `manual_upload` version only two kinds of rework exist: `copy`, and media normalisation at `render` level (E07-S02 rule 4). A finding that would need anything else is not auto-fixable in the first place.

### Revision instructions

9. Instructions are built in code as a numbered list, one line per finding in the plan: location, the finding's message, then its suggestion. They start with a fixed header:

```text
Revision 1 of 2 for version 3. Fix exactly the problems listed. Change nothing else.
1. [caption] Caption with hashtags is 2,431 characters; the limit is 2,200. → Shorten the caption to at most 2,100 characters without removing the call to action.
2. [frame 2] Text does not fit its box. → Shorten the headline to at most 40 characters.
```

10. For a reviewer's request, the reviewer's instructions come first under the heading "Reviewer's instructions (mandatory)". The auto-fixable `blocker` and `major` findings of the task's check run, at or below the chosen level, follow under "Also fix".
11. Instructions are written in English; the generated content stays in the account's content language. Instructions are stored in `ScriptVersion.feedback` when a script is generated, and summarised in `ContentVersion.change_note`.

### Doing the rework

12. The job is a chain of steps sharing one `JobRun`. Steps that do not apply are skipped.

| Step | Runs when | What it does |
| --- | --- | --- |
| Plan | always | Loads the source, builds the plan and instructions, and opens `ContentVersion` n+1 through E06-S07's `open_revision(item, change_note, source="revise_loop")`: a `draft` copy of version n (same script, frames, assets, copy, `origin`), with the item moved to `in_production` |
| Script | level is `script` | Calls E05-S03's synchronous `scripts.write_script_version(item, feedback=<instructions>, base_version=<current script>, frame_indexes=<affected frames>, approve=True, source="revise_loop")`. It returns the new `ScriptVersion` without changing the item's status, calling `advance()` or starting production. Frames outside `frame_indexes` are copied from the base version verbatim by that service. The new version is approved whatever `autopilot.script` says: the brief and direction were already approved, and the result is about to be checked again. The previous script version becomes `superseded`. Then, on draft n+1, each affected `ContentVersion.frames[i]` is rewritten from the new script frame (template, headline, body, duration, transition, visual prompt) and its `overridden` list is cleared, so the new script text replaces any earlier operator override on those frames; other frames keep their overrides |
| Render | level is `render` or `script` | Renders again only the frames whose content changed in the Script step or that are named by a `render`-level finding. For `design.illegible_text` and `design.logo_incorrect` it first sets `frames[i].render_options` as E07-S04 specifies (`text_backdrop: true`, or the opposite `logo_variant`); for `design.image_quality` and `design.text_in_generated_image` it first generates the background again with E06-S05's image service. For media normalisation it calls E06-S03's `production.services.media.normalise_media(asset, format_spec)` on the final asset (and E06-S03's cover export for `format.cover_missing`). Then reassembles the video when the format is video. Runs on the `render` queue. New assets are `rendered` with `meta.inputs` pointing to their sources |
| Copy | the plan has copy-level findings | First applies the deterministic fixes (rule 13). If any copy finding remains that needs wording, calls `copy.generate` through the copy service from E06-S06 with the instructions and the previous caption; then applies the deterministic fixes again to the result |
| Finalise | always | Writes `change_note`, sets `ContentItem.current_script` when it changed, increments the counters (rule 17), and calls E06-S07's `submit_version(item, version, actor=None, trigger="revision")`, which marks the version `submitted` with `submit_trigger = revision` and moves the item to `in_check`; E07-S01's `in_check` handler then starts a run with `trigger = revision` |

13. Deterministic copy fixes, applied in this order, with no AI call:

| Finding | Fix |
| --- | --- |
| `copy.hashtag_invalid` | Strip `#`, spaces and punctuation from each hashtag; drop it if nothing is left |
| `copy.duplicate_hashtags` | Keep the first occurrence |
| `format.too_many_hashtags` | Keep the first `max_hashtags` entries; remove `#tags` typed inside the caption if the count is still too high |
| `format.caption_not_allowed` | Clear caption and hashtags |
| `rights.ai_disclosure_missing` | Append `SOCIALHUB_AI_DISCLOSURE_TEXT[content_language]` as the last line of the caption (the same rule as E06-S06 rule 4a) |

14. Version n was marked `rejected` when the item entered `needs_revision`. Version n+1 is a new row; versions are never edited after they are submitted.
15. `change_note` is built in code, not by AI, from what actually changed: "Automatic revision 1 of 2. Caption shortened from 2,431 to 2,084 characters. Frame 2 rendered again (text did not fit). Script version 3 → 4." For a reviewer's request it starts with "Changes requested by {user}: {first 200 characters of the instructions}".
16. A revision that changes nothing is still submitted. The next check run will return Revise again and the limit ends the loop; no separate no-change detection is needed.

### Limits and counters

17. Two counters on `ContentItem`:
    - `revision_count` is incremented for every revision: automatic, requested by a reviewer, or handed back for manual rework.
    - `auto_revision_count` is incremented only for revisions whose source is a check run.
18. The limit is `InstagramAccount.posting_rules.max_revisions` (default 2, allowed range 0–5), read when a run is routed. A Revise outcome with `auto_revision_count >= max_revisions` escalates with reason `max_revisions` (E07-S01 rule 20). With `max_revisions = 0`, every Revise outcome escalates.
19. Revisions requested by a reviewer are not limited and do not use up automatic revisions. After a requested revision, the new version is checked like any other: Pass schedules it; Revise starts an automatic revision if automatic revisions remain, otherwise it escalates back to review.
20. Example with the default limit:

```text
v1 submitted ─► run 1: revise ─► auto revision 1 ─► v2 ─► run 2: revise ─► auto revision 2 ─► v3
   ─► run 3: revise ─► limit reached ─► review task (max_revisions), item in_review
```

### Failures

21. Each step uses the retry rules of the service it calls (AI gateway retries, render retries). If a step still fails, the job is `failed` with `error_code = revision_failed` and `error_detail` naming the step and its error. The item stays `in_production`, `active_job` is cleared, and `hold_reason = "Automatic revision failed at <step>. Retry it, or fix the version in Production and submit."`.
22. The draft version n+1 is kept. A retry continues with the same draft: steps are idempotent because each checks whether its output already exists on the draft (a new approved script version linked to the draft, rendered assets for the affected frames, changed copy).
23. The counters are incremented only in the Finalise step, so a failed revision does not use up the limit.
24. A refusal from the AI provider in the Script or Copy step is treated as a failure of that step.
25. A failed revision is visible in three places: the item's `hold_reason` on the pipeline list (E03-S04), the Checks tab banner, and the overview attention list (E11-S01), which lists items whose last job failed.

## Data

Uses `ContentItem` (`revision_count`, `auto_revision_count`, `current_version`, `current_script`, `active_job`, `hold_reason`), `ContentVersion`, `ScriptVersion`, `Asset`, `QCRun`, `QCResult`, `ReviewTask`, `ContentEvent`, `JobRun` as in [DATA-MODEL.md](../../DATA-MODEL.md), with the additions from E07-S01.

New field (to be added to DATA-MODEL.md): `ReviewTask.rework`, enum `copy`, `script`, `manual`, null — the rework the reviewer chose with "Request changes" (set in E07-S06, read here).

Service functions this story calls (owned by other stories):

| Function | Owner | Used for |
| --- | --- | --- |
| `production.services.open_revision(item, *, change_note, source)` | E06-S07 | Plan step; manual rework (rule 2) |
| `scripts.write_script_version(item, *, feedback, base_version, frame_indexes=None, approve, source)` | E05-S03 | Script step (synchronous; no status change, no production start) |
| Frame render service (`production.tasks.render_frames` with `force`, reading `frames[].render_options`) | E06-S02 | Render step |
| `production.services.images.generate_frame_background(version, frame_index, extra_constraints=…)` | E06-S05 | Render step, `design.image_quality` and `design.text_in_generated_image` |
| `production.services.media.normalise_media(asset, format_spec)` and the cover export | E06-S03 | Render step, media normalisation |
| `production.assemble(version)` | E06-S03 | Reassemble the video |
| `production.generate_copy(item, *, base_version, feedback)` | E06-S06 | Copy step |
| `production.services.submit_version(item, version, *, actor, trigger)` | E06-S07 | Finalise |

## API

### `POST /api/v1/content-items/{id}/revision/retry/`

Starts the revise job again after it failed. This endpoint is new and must be added to the endpoint index in API.md. Permission: admin or operator. Body: empty object.

Response `202`:

```json
{
  "job": {
    "id": "a3d1c7b2-5e0f-4c89-8b61-2f7d9e0a4c55",
    "kind": "qc.revise",
    "status": "queued",
    "progress": 0,
    "message": "",
    "target_type": "content_item",
    "target_id": "42",
    "result": null,
    "error_code": null,
    "error_detail": null,
    "created_at": "2026-12-01T08:31:40Z",
    "started_at": null,
    "finished_at": null
  }
}
```

When the job succeeds, `result` is:

```json
{
  "content_version_id": 207,
  "version": 4,
  "level": "copy",
  "source": {"qc_run_id": 118},
  "auto_revision": 1,
  "max_revisions": 2,
  "qc_run_id": 119
}
```

Errors:

| Case | HTTP | Code | `details` |
| --- | --- | --- | --- |
| Item not found | 404 | `not_found` | |
| Item is not `in_production`, or its last `qc.revise` job did not fail | 409 | `invalid_transition` | `{"status": "in_check", "reason": "no_failed_revision"}` |
| A job is active for the item | 409 | `job_in_progress` | `{"job": { … }}` |

No other endpoint is added. Revisions start from the pipeline, never from a direct call.

## Background work

| Item | Value |
| --- | --- |
| Job kind | `qc.revise` |
| Tasks | `quality.tasks.revise_plan`, `revise_script`, `revise_copy`, `revise_finalise` on `default`; the render step calls E06's render tasks on `render` |
| Chaining | A Celery chain built by the Plan step from the plan's level; every task receives the job ID and the draft version ID |
| Idempotency | Keyed by item and draft version number (n+1). Re-running a step that already produced its output is a no-op |
| Retries | No blanket retry on the chain. Each step relies on the retries inside the AI gateway and the render services. A step failure fails the job (rule 21) |
| Progress | 10 "Planning the revision" · 30 "Rewriting the script" · 60 "Rendering frames" · 80 "Rewriting the caption" · 95 "Submitting for checks" · 100 |
| Time limits | Default-queue steps: soft 300 s each. Render steps: the limits set by E06 |

## AI

No new AI task. The job reuses two tasks from the registry in [AI-INTEGRATION.md](../../AI-INTEGRATION.md), both of which accept optional feedback and a previous version:

| Task | Called for | Inputs added by this story | Failure handling |
| --- | --- | --- | --- |
| `copy.generate` | Copy step | `feedback` = the revision instructions; previous caption, hashtags and alt text; the instruction to keep everything that is not listed | Step fails after gateway retries (rule 21) |
| `script.generate` | Script step, through E05-S03's `write_script_version` | `feedback` = the revision instructions; previous script payload; the list of frame indexes that may change, with the instruction to return all other frames and shots unchanged | Step fails after gateway retries. `write_script_version` copies frames outside the list from the previous version verbatim, so a model that changed them has no effect |

## Panel

Route: `/content/:id`, Checks tab. This story adds two elements; the rest of the tab is E07-S06.

**Revision banner** (top of the tab, `Alert`):

| Item state | Banner |
| --- | --- |
| `needs_revision`, or `in_production` with an active `qc.revise` job | Info: "Automatic revision {auto_revision_count + 1} of {max_revisions} in progress" (or "Revision requested by {user} in progress") with `JobProgress` |
| `in_production`, last `qc.revise` job failed | Error: "The automatic revision failed at {step}." Actions: `JobButton` "Retry revision", link "Open Production" to the Production tab. `request_id` in small text |
| `in_production` after rework `manual` | Warning: "Changes requested: {instructions}" with the link "Open Production" |
| `in_review` with reason `max_revisions` | Warning: "Still needs revision after {n} automatic revisions. Waiting for review." with the link "Open review task" |
| otherwise | No banner |

**Change note** (`ChangeNote` component): in the list of check runs, each run whose version has a `change_note` shows it under the run header as "What changed in version {n}", wrapped in `ContentText` so Persian fragments display correctly.

Messages: on retry success start, `message.info` "Revision restarted"; on `409`, "This item has no failed revision to retry." and reload.

## Acceptance criteria

1. Given a run that returned Revise with the single finding `format.caption_too_long`, when the revise job runs, then the plan level is `copy`, `copy.generate` is called once with the instructions, no script or render work happens, version n+1 has the same final asset as version n, and a check run with `trigger = revision` starts.
2. Given the only findings are `format.too_many_hashtags` and `copy.duplicate_hashtags`, when the job runs, then no AI call is made and version n+1 has the trimmed, de-duplicated hashtag list.
3. Given `rights.ai_disclosure_missing` on an English account, then version n+1's caption ends with the configured English disclosure sentence and no AI call is made.
4. Given `design.illegible_text` on frame 3 of a pipeline reel, then the level is `render`, frame 3 of version n+1 has `render_options.text_backdrop = true`, only frame 3 is rendered again, the video is reassembled, and the caption is unchanged.
5. Given `design.text_overflow` on frame 2, where frame 2's headline was an operator override, then the level is `script`, a new approved script version exists whose frames other than 2 are identical to the previous version, version n+1's frame 2 carries the new script text with an empty `overridden` list, other frames keep their overrides, only frame 2 is rendered again, `ContentItem.current_script` points to the new script, and the item's status was never changed by the script service.
5a. Given the revise job has started but the Plan step has not run, when an operator edits the copy, then the API answers `409 invalid_transition` and the job's version n+1 is the only new version.
6. Given a `major` copy-level finding and a `minor` script-level finding, then the level is `copy` and the `minor` finding is not in the instructions.
7. Given a manually uploaded reel with `format.wrong_dimensions`, then `normalise_media` scales the media to the target size, the new final asset has `origin = rendered` with the uploaded file in `meta.inputs`, and the caption is unchanged.
8. Given a successful automatic revision, then `revision_count` and `auto_revision_count` are each one higher and `change_note` starts with "Automatic revision 1 of 2".
9. Given `max_revisions = 2` and three Revise outcomes in a row, then exactly two revise jobs ran, the third outcome opened a review task with reason `max_revisions`, and the item is `in_review`.
10. Given `max_revisions = 0`, then the first Revise outcome opens a review task and no revise job runs.
11. Given a reviewer requested changes with rework `copy` and instructions, then the instructions passed to `copy.generate` begin with the reviewer's text, `revision_count` is incremented, `auto_revision_count` is not, and `change_note` starts with "Changes requested by".
12. Given a reviewer requested changes with rework `manual`, then no job starts, `open_revision` has opened draft n+1, and the item is `in_production` with the instructions in `hold_reason`.
13. Given `copy.generate` fails after retries, then the job is `failed` with `revision_failed`, the item is `in_production`, the counters are unchanged, and the banner shows "Retry revision".
14. Given that failed revision, when `POST /revision/retry/` is called and the provider works again, then the same draft version n+1 is completed and submitted; no version n+2 is created.
15. Given an item in `in_check`, when `POST /revision/retry/` is called, then the response is `409 invalid_transition`.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E07-S05-BE1 | Revision planner | `quality/revision/plan.py`: load the source from the `needs_revision` event, select findings (rules 5–8), compute the level, build instructions (rules 9–11), list affected frames and render options; pure functions with table-driven tests | 0.5 |
| E07-S05-BE2 | Revise job chain | `quality/tasks.py` and `quality/revision/steps.py`: Plan (`open_revision`), Script (`write_script_version`, then rewriting affected version frames and clearing their overrides), Render (render options, background regeneration, `normalise_media`) and Copy steps, deterministic copy fixes (rule 13), Finalise with `change_note`, counters and `submit_version(trigger="revision")`; hook from `advance(item)` for `needs_revision` | 0.75 |
| E07-S05-BE3 | Limits, counters and requested changes | Limit check wired into routing (with E07-S01-BE4), `auto_revision_count` and `revision_count` rules, the reviewer-request path including "Also fix" findings and rework `manual` (through `open_revision`), `ReviewTask.rework` migration | 0.5 |
| E07-S05-BE4 | Failure handling and retry endpoint | Step failure to job failure mapping, `hold_reason`, idempotent step resume, `POST /content-items/{id}/revision/retry/` with its error cases, `docs/openapi.yaml` | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E07-S05-FE1 | Revision banner and change note | `src/pages/content/workspace/tabs/ChecksTab/RevisionBanner.tsx` (five states, `JobProgress`, "Retry revision" `JobButton`, links) and `ChangeNote.tsx`; service function for the retry endpoint; component tests for each banner state | 0.5 |

### Test

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| — | None beyond the tests in each subtask | The full Revise path on real renders is covered in E11-S03 | 0 |

## Test notes

- Planner tests: one case per fix level, mixed levels, `minor`-only at a higher level, `manual_upload` versions, reviewer request with and without a linked run.
- Step tests use stubbed E05 and E06 services that record their arguments, so this story's tests do not depend on rendering.
- Loop test with the fake AI provider: a caption fixture that stays too long forever, asserting the loop ends in a review task after exactly `max_revisions` revisions.
- Idempotency test: kill the chain after the Script step, retry, assert one new script version and one draft content version.
- Overrides test: a script-level revision on a frame whose headline was overridden; version n+1's frame carries the new script text with `overridden = []`, and an untouched overridden frame keeps its override. (Keeping unlisted script frames unchanged is tested in E05-S03's `write_script_version`.)
- Status ownership test: during the Script step the item is `in_production` and no `advance()` or production job is triggered by the script service.
- One integration test with real E06 rendering for the `render` level, marked slow.

## Later

- A fourth level, `brief`, could send an item back to step 04 when findings show the brief itself is wrong; the level ordering already allows it.
- Per-finding render options can grow with the templates without touching the planner: the mapping lives next to the catalogue.
- The planner's output is a plain data structure; showing it to an operator for confirmation before running would be a small panel addition.
