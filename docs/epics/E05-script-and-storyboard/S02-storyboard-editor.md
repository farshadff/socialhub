# E05-S02 — Storyboard editor and approval

| | |
| --- | --- |
| Epic | E05 Script and storyboard |
| Priority | Must |
| Estimate | BE 1 d · FE 3.5 d |
| Depends on | E05-S01, E03-S04, E04-S01, E00-S02 |
| Needed by | E05-S03, E06-S07, E07-S05 |

## User story

As an operator, I want to read and change the scenario, shots, frames and design notes of a script in one screen and approve it, so that what goes into production is what I intend, without rewriting the whole thing.

## Context

E05-S01 produced a draft `ScriptVersion` and a read-only view. This story turns the Script tab into a storyboard editor, adds saving (each save is a new immutable version) and approval. Approval is the gate between step 05 and step 06: it moves the item to `scripted`, and `advance(item)` runs the `scripted` handler, which starts production (`production.start`, E06-S07).

The operator arrives from the Content list or from the Brief tab after approving a brief. They have the brief one tab away and may keep both open in two browser windows.

## Scope

**In**

- `PUT /content-items/{id}/script/` — save an edit as a new version with `base_version`.
- `POST /content-items/{id}/script/approve/` — approve the latest version.
- The storyboard editor: scenario and hook, shot list table, frame cards with add, remove, duplicate and reorder, design notes form, CTA and music hint.
- Client-side checks against the limits from `GET /formats/`, with the server as the authority.
- Unsaved-changes protection and conflict handling.
- Writing a script by hand when there is none (start from an empty package).

**Out (later)**

- Regenerate with feedback, version list, old-version view, restore (E05-S03).
- Rendered previews of frames (Production tab, E06-S07).
- Drag-and-drop of assets onto frames (E06-S07 maps assets to frames).
- Autosave. Saves are explicit.

## Behaviour and rules

### Saving an edit

1. An edit is allowed when the item's `status` is `briefed`, `scripted`, `in_production` or `needs_revision`, the item has no `active_job`, and the brief is approved. Otherwise `409 invalid_transition` (or `409 job_in_progress`).
2. The request carries `base_version` and the full `payload`. If `base_version` is not the item's latest script version, the server returns `409 version_conflict` with `details.latest_version`. `base_version` is `0` when the item has no script yet.
3. The server normalizes the payload exactly as E05-S01 rule 7 does, then validates its **structure** (all keys present, correct types, enum values). A structural error returns `400 validation_error` with field paths such as `payload.frames.1.template`.
4. Rule problems (counts, durations, text lengths; E05-S01 rules 16–24) do **not** block saving. The version is stored as a `draft`, and the response carries them in `validation.issues`. This lets an operator save work in progress.
5. A payload identical to the base version's payload (after normalization) is not saved again; the server returns `200` with the existing version and `unchanged: true`.
6. The new version has `version = base_version + 1`, `origin = human`, `status = draft`, `brief` = the item's current approved brief, `created_by` = the user, `feedback` = the optional `note` (0–500 characters). Earlier `draft` versions become `superseded`. An earlier `approved` version stays `approved` until another version is approved.
7. `ContentItem.current_script` points to the new version. A `ContentEvent` of type `edited` is written with `data = {"script_version": n, "origin": "human"}`. `hold_reason` is cleared if it was the "Script needs fixes" reason and the new version is valid.
8. Saving while the item is `in_production` or `needs_revision` does not stop or restart production. The Production tab warns that a newer unapproved script exists, and submitting for checks is blocked until the newer script is approved or the content version is produced from it (enforced in E06-S07).

### Approving

9. Approval is allowed when the item's `status` is `briefed`, `scripted`, `in_production` or `needs_revision`, and the item has no `active_job`. (`scripted` is normally passed through in the same request; an item rests there only if production could not be enqueued.)
10. The request names the `version` to approve. It must be the latest; otherwise `409 version_conflict`. It must be a `draft`; approving an already approved version returns `200` with no change (idempotent).
11. The version must pass `validate_script_package`. Otherwise `400 validation_error`, with each issue mapped to a field entry (`path` prefixed with `payload.`, `code` = the issue code).
12. The version's `brief` must be the item's `current_brief`, and that brief must be `approved`. Otherwise `409 invalid_transition` with `details.reason = "brief_changed"`. The operator regenerates or saves a new version, which re-binds it to the current brief.
13. On approval, in one transaction: the version becomes `approved`; any other `approved` version of the item becomes `superseded`; then the pipeline service is called:
    - from `briefed`: status → `scripted`, a `status_changed` event is written, and `advance(item)` starts production (E06-S07), which sets `in_production`;
    - from `scripted`: the status stays `scripted`, and `advance(item)` starts production from the newly approved script;
    - from `in_production` or `needs_revision`: approval calls `production.services.start_production(item, actor=user, reason="script_reapproved")` directly, after the approval commits. `advance()` alone would do nothing here, because no handler is registered for `in_production` (E06-S07 rule 1). `start_production` moves `needs_revision → in_production` itself (an item already `in_production` keeps its status) and starts a new run from the newly approved script. The previous draft `ContentVersion` is left as it is; production creates the next one.
14. The actor is recorded on the event. For automatic approval (`autopilot.script` or the revise loop) the actor is null and the message is "Script approved automatically".
15. Approval by a person is available to operators and admins.

### Editor rules

16. The editor loads limits from `GET /formats/` (`script_rules` for the item's combination and `frame_templates`). It shows character counters and marks a field as soon as it breaks a limit, but never prevents typing.
17. Indices are not typed. `index` of shots and frames follows their order on screen; reordering renumbers them. `frames[].shot_index` follows the shot a frame is attached to; when a shot is deleted, its frames are deleted with it after a confirmation.
18. `duration_seconds` of the package is shown read-only as the sum of the shots. In `motion` mode a shot's duration is the sum of its frames and is read-only; frame durations are edited. In `video` mode shot durations are edited and frame durations are limited to their shot's duration.
19. For image formats the editor shows one frame card and no shot table, durations or transitions. The single shot is kept in the payload unseen, with `type = graphic`, `duration_seconds = 0`, and its `description` mirrors the frame's `visual_prompt` or headline.
20. Adding a frame beyond the rule maximum, or removing below the minimum, is allowed in the editor but flagged; the save still works (rule 4) and approval does not (rule 11).
21. Changing a frame's template keeps `headline`, `body` and `visual_prompt`, and re-evaluates limits for the new template.

## Data

- `ScriptVersion` — new rows with `origin = human`; status changes `draft → approved → superseded`. See [DATA-MODEL.md](../../DATA-MODEL.md).
- `ContentItem.status`, `current_script`, `hold_reason` — changed only through `content.services.pipeline` and `content.services.scripts`.
- `ContentEvent` — `edited`, `status_changed`.
- No new fields.

## API

### `PUT /content-items/{id}/script/`

Permission: operator or admin.

Request (shortened to two shots and two frames for readability; a real request carries the whole package):

```json
{
  "base_version": 1,
  "note": "Shortened the hook and merged frames 3 and 4",
  "payload": {
    "scenario": "A quick myth-busting reel that opens on a common belief, shows the number that contradicts it, and closes with a checklist to save.",
    "hook": "Daily posting is not what grows accounts.",
    "duration_seconds": 20,
    "shots": [
      {"index": 1, "duration_seconds": 4, "type": "text", "description": "Bold opening statement on a dark brand background.", "on_screen_text": "Daily posting is not what grows accounts.", "voiceover": "", "asset_hint": ""},
      {"index": 2, "duration_seconds": 6, "type": "graphic", "description": "A single large figure with a short label.", "on_screen_text": "3× more saves", "voiceover": "", "asset_hint": ""},
      {"index": 3, "duration_seconds": 5, "type": "graphic", "description": "Three short points.", "on_screen_text": "What matters more", "voiceover": "", "asset_hint": ""},
      {"index": 4, "duration_seconds": 5, "type": "text", "description": "Closing card with the call to action.", "on_screen_text": "Save this checklist", "voiceover": "", "asset_hint": ""}
    ],
    "frames": [
      {"index": 1, "shot_index": 1, "template": "title", "headline": "Daily posting is not what grows accounts.", "body": "", "visual_prompt": "", "duration_seconds": 4, "transition": "cut"},
      {"index": 2, "shot_index": 2, "template": "stat", "headline": "3×", "body": "more saves on posts that teach one clear thing", "visual_prompt": "", "duration_seconds": 6, "transition": "fade"},
      {"index": 3, "shot_index": 3, "template": "list", "headline": "What matters more", "body": "One idea per post\nA first line that earns the second\nA reason to save it", "visual_prompt": "", "duration_seconds": 5, "transition": "slide"},
      {"index": 4, "shot_index": 4, "template": "cta", "headline": "Save this checklist", "body": "Follow for one tip every week", "visual_prompt": "", "duration_seconds": 5, "transition": "fade"}
    ],
    "design_notes": {
      "mood": "Confident and calm.",
      "color_usage": "Dark background, primary colour for highlights.",
      "typography": "Heading font for headlines; body font for labels.",
      "imagery_style": "No photography in this version.",
      "layout": "Text centred in the safe area.",
      "do": ["One idea per frame"],
      "dont": ["No busy backgrounds behind text"]
    },
    "cta": "Save this checklist for your next planning session.",
    "music_hint": "Light, mid-tempo instrumental"
  }
}
```

Response `200`: the same shape as `GET /content-items/{id}/script/` (E05-S01), for the new version, plus `unchanged`:

```json
{
  "content_item": 42,
  "version": 2,
  "latest_version": 2,
  "approved_version": null,
  "status": "draft",
  "origin": "human",
  "feedback": "Shortened the hook and merged frames 3 and 4",
  "brief_version": 1,
  "brief_is_current": true,
  "ai_run": null,
  "created_by": {"id": 3, "name": "Sara Ahmadi"},
  "created_at": "2026-12-01T09:02:11Z",
  "payload": {"…": "the saved package"},
  "validation": {"valid": true, "issues": []},
  "actions": {"can_generate": true, "can_edit": true, "can_approve": true},
  "unchanged": false
}
```

Errors:

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| Item not found | 404 | `not_found` | |
| `base_version` is not the latest | 409 | `version_conflict` | `details.latest_version`, `details.latest_origin`, `details.latest_created_by` |
| Status not allowed, or brief not approved | 409 | `invalid_transition` | `details.status`, plus `details.allowed_statuses` or `details.reason` |
| A job is active on the item | 409 | `job_in_progress` | `details.job` |
| Missing key, wrong type, unknown enum value, `note` too long | 400 | `validation_error` | `fields[].path` such as `payload.frames.1.template`, `note` |
| Payload larger than 200 KB | 413 | `payload_too_large` | |

### `POST /content-items/{id}/script/approve/`

Permission: operator or admin.

Request:

```json
{"version": 2}
```

Response `200`:

```json
{
  "script": {
    "content_item": 42,
    "version": 2,
    "latest_version": 2,
    "approved_version": 2,
    "status": "approved",
    "origin": "human",
    "brief_version": 1,
    "brief_is_current": true,
    "validation": {"valid": true, "issues": []},
    "actions": {"can_generate": true, "can_edit": true, "can_approve": false}
  },
  "content_item": {
    "id": 42,
    "status": "in_production",
    "active_job": {
      "id": "c8a2b1c4-1d2e-4a8f-9b37-0f6d2e5a7c21",
      "kind": "production.start",
      "status": "queued",
      "progress": 0
    }
  }
}
```

`script` is the full script resource (shortened above). `content_item.status` is `in_production` when production was enqueued in the same request, or `scripted` if the production job could not be enqueued yet (it is then picked up by the next `advance`).

Errors:

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| Item not found, or it has no script | 404 | `not_found` | |
| `version` is not the latest | 409 | `version_conflict` | `details.latest_version` |
| Item status does not allow approval | 409 | `invalid_transition` | `details.status`, `details.allowed_statuses = ["briefed", "scripted", "in_production", "needs_revision"]` |
| Script was written from an older brief | 409 | `invalid_transition` | `details.reason = "brief_changed"` |
| A job is active on the item | 409 | `job_in_progress` | `details.job` |
| Package breaks script rules | 400 | `validation_error` | One `fields` entry per issue: `{"path": "payload.frames.2.headline", "code": "text_too_long", "message": "…"}` |

## Background work

None in this story. Approval from `briefed` or `scripted` calls `advance(item)`, whose `scripted` handler enqueues `production.start` (E06-S07). Re-approval from `in_production` or `needs_revision` calls `production.services.start_production(item, reason="script_reapproved")` directly.

## AI

None. Edits are made by a person.

## Panel

Route: `/content/:id`, tab **Script**. Built in `src/pages/content/workspace/tabs/script/`.

### Layout

```text
┌ Version 2 · [Draft] · Edited by sara · written from brief v1        [Save as new version] [Approve script] ┐
│ (warning alert with rule problems, when there are any)                                                    │
├ Story ─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Scenario (textarea, counter n/1200)        Hook (input, counter n/140)                                    │
│ Call to action (input, n/120)              Music hint (input, n/120)     Total duration: 30 s (15–60 s)   │
├ Shots ─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ # │ Type │ Duration │ Description │ On-screen text │ Voiceover note │ Asset hint │ ⋮                       │
│ [+ Add shot]                                                                                              │
├ Frames ────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ 1 · Title ┐ ┌ 2 · Stat ┐ ┌ 3 · List ┐ ┌ 4 · Image + caption ┐ ┌ 5 · CTA ┐  [+ Add frame]               │
├ Design notes ──────────────────────────────────────────────────────────────────────────────────────────┤
│ Mood · Colour use · Typography · Imagery style · Layout · Do (list) · Don't (list)                        │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Components

| Part | Component | Detail |
| --- | --- | --- |
| Header | `ProCard` title area | Version number, `StatusTag` for the version status, origin tag ("AI" or "Edited by {user}"), "written from brief v{n}". Buttons on the right. |
| Problems | `Alert` type warning | "{n} problems must be fixed before this script can be approved." Each issue is a link that scrolls to and focuses its field. Hidden when there are none. |
| Story | `ProForm` fields | `ProFormTextArea` scenario (rows 4), `ProFormText` hook, CTA, music hint. Counters show `n/limit` and switch to the `colorError` token past the limit. Music hint hidden for image formats. |
| Shots | `EditableProTable` | Inline editing, one row per shot. Type is a select (`Footage`, `Graphic`, `Text`; options limited by `allowed_shot_types`). Duration is `InputNumber` (whole seconds) — read-only in `motion` mode with a tooltip "Sum of this shot's frames". Row drag handle reorders. Row menu: "Add frame to this shot", "Delete shot". Hidden for image formats. |
| Frames | Grid of `ProCard`s, four per row at 1280 px | Each card: header "{index} · {template label}" with move-left, move-right, duplicate and delete icon buttons (each with an accessible name); a schematic preview box in the format's aspect ratio (9:16 or 4:5) showing headline and body laid out as plain text with `ContentText`; then fields: Template (select with the purpose as option description), Shot (select; hidden for image formats), Headline, Body (`TextArea`; for `list` a helper "One point per line, 2–5 lines"), Background image description (`TextArea`, label marks it required for `image_caption`), Duration (seconds; hidden for image formats), Transition (select; hidden for image formats). |
| Design notes | `ProForm` in a collapsible `ProCard`, open by default | Five `ProFormTextArea` fields and two `ProFormList` lists ("Do", "Don't") with at most six rows each. |

All text inputs that hold content use `dir="auto"` so Persian text aligns right inside the English panel.

### Actions

| Button | Enabled when | Behaviour |
| --- | --- | --- |
| "Save as new version" (primary while there are unsaved changes) | `actions.can_edit` and the form differs from the loaded version | Opens a small `ModalForm` with one optional field "What changed? (optional)" (500 characters) and "Save". Calls `PUT` with `base_version`. Success message: "Saved as version {n}." The editor reloads from the response. |
| "Approve script" (primary when there are no unsaved changes) | `actions.can_approve` and no unsaved changes | `Modal.confirm`: "Approve version {n}? Production starts right away." On success: message "Script approved. Production started." and the workspace header status updates; the Production tab shows the running job. Disabled with a tooltip when not allowed: "Save your changes first", "Fix the listed problems first", or "The brief changed after this script was written. Regenerate or save a new version." |
| "Write script by hand" | No script exists and the brief is approved | Loads an empty package with the minimum number of shots and frames for the format, so the operator can fill it in and save as version 1 (`base_version: 0`). |

### States

| State | What is shown |
| --- | --- |
| Loading | Skeletons in each card |
| No script | The E05-S01 empty state, with "Write script by hand" as a secondary button next to "Generate script" |
| Job running on the item | `JobProgress` at the top; every field and button disabled with tooltip "{job message}" |
| Read-only (item status is `in_check`, `in_review`, `approved` or later, or `cancelled`) | Fields disabled; an `Alert` (info): "This script is locked while the item is {status label}." |
| Unsaved changes | A "Unsaved changes" tag in the header; leaving the tab, the page or closing the window asks "Leave without saving? Your changes will be lost." |
| Version conflict on save (`409 version_conflict`) | `Modal`: "Someone saved version {latest} while you were editing." Buttons: "Reload latest (discard my changes)" and "Keep editing" — keep editing leaves the form as is and sets nothing; the operator can copy text out, reload, and reapply. |
| Validation error on save (`400`) | Field errors under the fields from `fields[].path`; a `message.error` "Some fields are not valid." |
| Approve refused for rule problems (`400`) | The problems alert is refreshed from the response and scrolled into view |
| Other errors | Inline `Result` with the text for the code, a Retry button and the small `request_id` |

## Acceptance criteria

1. Given a draft script version 1, when the operator changes the hook and clicks "Save as new version", then version 2 exists with `origin = human`, version 1 is `superseded`, and the editor shows version 2.
2. Given two operators both loaded version 1, when the second saves after the first, then the second receives `409 version_conflict` with `details.latest_version = 2` and sees the conflict dialog; nothing is overwritten.
3. Given a headline 20 characters over its template limit, when the operator saves, then the save succeeds, the response lists a `text_too_long` issue, and "Approve script" is disabled with the tooltip "Fix the listed problems first".
4. Given a valid latest draft on an item in `briefed`, when the operator approves it, then the version is `approved`, the item passes through `scripted`, a production job is created and the item is `in_production`.
5. Given an item in `needs_revision` with a new valid draft, when the operator approves it, then the old approved version is `superseded`, the item is `in_production` and a new production job runs.
6. Given the brief was edited and re-approved after the script was written, when the operator tries to approve the script, then the response is `409 invalid_transition` with `details.reason = "brief_changed"`.
7. Given an item in `in_check`, when `PUT` or approve is called, then the response is `409 invalid_transition` and the editor is read-only.
8. Given a motion reel, when the operator drags frame 4 before frame 2, then indices renumber 1…n, each frame keeps its text, shot durations update, and the total duration is unchanged.
9. Given a shot with two frames, when the operator deletes the shot and confirms, then both frames are removed and the remaining shots and frames are renumbered.
10. Given a feed post, when the Script tab opens, then exactly one frame card is shown and there is no shot table, duration or transition field.
11. Given unsaved changes, when the operator switches to another tab of the workspace, then a confirmation appears, and choosing to stay keeps the edits.
12. Given a payload identical to the latest version, when `PUT` is called, then no new version is created and the response has `unchanged: true`.
13. Given an item with an approved brief and no script, when the operator clicks "Write script by hand", fills the form and saves, then version 1 is created with `origin = human` and `base_version` 0 was accepted.
14. Given Persian text in a headline, when it is shown in the frame card and its preview box, then it is right-aligned and reads right to left.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E05-S02-BE1 | Save an edit | `save_script_edit()` in `apps/content/services/scripts.py` (rules 1–8): structural serializer for the package, normalization, `base_version` check under a row lock, unchanged detection, supersede older drafts, event. `PUT …/script/` view and `openapi.yaml`. API tests for every error row and for concurrent saves. | 0.5 |
| E05-S02-BE2 | Approve | `approve_script()` (rules 9–15): validation mapping to field errors, brief binding check, status changes through `content.services.pipeline` (`briefed → scripted`; `in_production`/`needs_revision` handled by a direct `start_production(..., reason="script_reapproved")` call), `advance()` call, idempotent repeat. `POST …/script/approve/` view and `openapi.yaml`. Tests for each allowed and refused status, automatic approval with a null actor, and the supersede behaviour. | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E05-S02-FE1 | Editor state and data layer | `useScriptEditor` hook: loads the script and `GET /formats/` limits, holds the working package, dirty tracking, index renumbering, duration roll-ups per mode (rule 18), client-side issue computation mirroring the server codes. Service functions for `PUT` and approve. Unit tests for renumbering, roll-ups and issue computation. | 0.75 |
| E05-S02-FE2 | Story fields and design notes | Story card and design notes card with counters, `dir="auto"` inputs, limits from the registry. | 0.5 |
| E05-S02-FE3 | Shot table | `EditableProTable` with type select, duration rules per mode, drag reorder, add and delete with frame cascade confirmation; hidden for image formats. | 0.75 |
| E05-S02-FE4 | Frame cards | Card grid with template select, shot select, fields per template, schematic preview box in the format's aspect ratio, move, duplicate, delete, add; single-card mode for image formats. | 1 |
| E05-S02-FE5 | Save, approve and states | Header with version info and buttons, save modal, approve confirmation, problems alert with field focus, unsaved-changes guard, conflict dialog, read-only and job-running states, "Write script by hand". Component tests for save, conflict, approve disabled reasons and read-only. | 0.5 |

### Test

None beyond the tests in each subtask.

## Test notes

- **API:** save and approve for each allowed status; `version_conflict` under concurrency (two requests with the same `base_version`); approval refused for each issue code family; `brief_changed`; idempotent approve.
- **Pipeline:** assert that only `content.services.pipeline` changes `ContentItem.status` (approve goes through it) and that each approval either calls `advance()` once (from `briefed`/`scripted`) or `start_production` once (from `in_production`/`needs_revision`).
- **Panel unit:** renumbering after reorder and delete; duration roll-ups in `motion` and `video` modes; client issue codes equal server issue codes for a shared set of fixture packages (keep the fixtures in one JSON file used by both test suites).
- **Panel component:** dirty guard, conflict dialog, disabled-approve tooltips, image-format layout, right-to-left text.
- **Fixtures:** the valid packages from E05-S01 for all six format combinations.

## Later

- Rendered previews in frame cards: replace the schematic box with a thumbnail from the render endpoint (E06-S02) once a content version exists.
- Autosave of drafts to local storage to survive a closed tab.
- Field-level locking or presence for simultaneous editors; today the last consistent save wins and the other gets a conflict.
- Keyboard reordering shortcuts beyond the move buttons.
