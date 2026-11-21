# E05-S03 — Regenerate with feedback and version history

| | |
| --- | --- |
| Epic | E05 Script and storyboard |
| Priority | Must |
| Estimate | BE 1 d · FE 1 d |
| Depends on | E05-S01, E05-S02 |
| Needed by | E07-S05 |

## User story

As an operator, I want to ask for a rewrite of a script by saying what to change, and to see and restore earlier versions, so that I can steer the AI instead of editing every field, and nothing I or the AI wrote is ever lost.

## Context

After E05-S02 an operator can edit a script by hand. Often a sentence of direction is faster: "open with a question", "drop the statistic, we cannot source it", "make it 20 seconds". The same mechanism is what the automatic revise loop (E07-S05) needs: when a check returns Revise with findings that concern on-screen text, structure or design notes, the loop turns the findings into feedback and asks for a new script version without a person.

Because every version is immutable, history is just a list of rows. This story exposes it and adds restore.

## Scope

**In**

- `feedback` and `base_version` on `POST /content-items/{id}/script/generate/`.
- A synchronous service, `write_script_version`, used by the revise loop inside its own job, with optional approval and frame-limited changes.
- `GET /content-items/{id}/script/versions/` and `GET /content-items/{id}/script/versions/{version}/`.
- Restore: saving an old version's payload as a new version (through the existing `PUT`).
- Panel: "Regenerate" dialog, "History" drawer, read-only view of an old version, "Restore this version".

**Out (later)**

- Side-by-side or inline diff between versions.
- Regenerating a single frame or shot.
- Deleting versions.
- Showing AI cost per version in the panel (it is in `AIRun` for admins).

## Behaviour and rules

### Regenerating with feedback

1. `POST /content-items/{id}/script/generate/` accepts two optional fields: `feedback` (text, 0–2,000 characters after trimming) and `base_version` (int).
2. When the item already has a script, the job passes the base version's payload to the AI as `previous_package`, together with `feedback`. The instruction to the model is: apply the feedback, keep everything else.
3. `base_version` defaults to the latest version. If given and not the latest, the endpoint returns `409 version_conflict` with `details.latest_version`. This stops a rewrite from silently discarding an edit someone saved a moment ago.
4. When the item has a script and `feedback` is empty, the job writes a fresh script from the brief without `previous_package` ("start over"). The panel asks for confirmation before doing this.
5. When the item has no script, `feedback` is still passed to the AI as extra direction, and `base_version` must be absent or `0`.
6. The preconditions, repair call, storage, idempotency key and events are those of E05-S01. The new version has `origin = ai`, `feedback` = the feedback text, `brief` = the item's current approved brief (so a regeneration also re-binds the script to a changed brief).
7. Feedback is treated as direction about the script, never as a way around the rules: the result is validated the same way, and facts must still come from the brief's references.
8. The operator-triggered regeneration follows `autopilot.script` for approval, exactly like the first generation.

### Automatic regeneration by the revise loop

9. The operator path (the endpoint, and autopilot) goes through `generate_script(item, *, feedback="", base_version=None, actor=None, auto_approve=None, source="operator") -> JobRun` in `apps/content/services/scripts.py`, which creates the `script.generate` job of E05-S01. `auto_approve=None` follows `account.autopilot["script"]`; approval then follows E05-S02 (including its production restart).
10. E07-S05 does not use the endpoint or `generate_script`. It runs inside its own `qc.revise` job and calls a synchronous service:

```python
# apps/content/services/scripts.py
def write_script_version(
    item: ContentItem,
    *,
    feedback: str,
    base_version: int,
    frame_indexes: list[int] | None = None,  # None = any frame may change
    approve: bool,
    source: str = "qc_revise",
) -> ScriptWriteResult: ...   # (script_version, valid, issues, ai_run_ids)
```

11. `write_script_version` calls `script.generate` through the gateway in the caller's job (its AI calls count toward that job's call limit), runs validation and the one repair call of E05-S01, and stores the new `ScriptVersion` (`origin = ai`, `feedback` = the feedback text, `created_by = null`). If `approve` is true and the result is valid, it approves the version in the same transaction (the previous approved version becomes `superseded`). It never changes `ContentItem.status`, never calls `advance()` and never starts production; E07-S05 owns `needs_revision → in_production → in_check` and decides what to render next.
12. **Frame-limited changes.** When `frame_indexes` is given, the prompt is told which frames may change, and code then copies every other frame (and `scenario`, `hook`, `shots`, `design_notes`, `cta`, `music_hint` unless the feedback names them) verbatim from the base version before validation. A result that changes the frame count is invalid when `frame_indexes` is given.
13. The revise loop passes `feedback` built from the check findings that have a script location (`frame_index`, or `field` values such as `on_screen_text`, `headline`, `body`, `design_notes`). Each finding becomes one line: "Frame 3 headline: {message}. Suggested fix: {suggestion}". If the result is invalid after the repair call, it is stored as a draft and not approved; `valid = false` is returned and E07-S05 escalates the item.
14. `source` (`operator`, `autopilot` or `qc_revise`) is stored in the `edited` event's `data` and, for jobs, in `JobRun.result.source`, so history shows who asked for each version. The revise loop does not increment `revision_count` here; E07-S05 owns that counter.

### Version history

15. The versions list returns every `ScriptVersion` of the item, newest first, without payloads. It is not paginated beyond the standard list envelope; an item rarely has more than ten versions.
16. Each entry has a `summary` computed from the payload: `hook`, `frame_count`, `shot_count`, `duration_seconds`.
17. `GET …/versions/{version}/` returns one version in the same shape as `GET …/script/`, with `actions.can_edit = false` and `actions.can_approve = false` unless it is the latest. An unknown version returns `404 not_found`.
18. Old versions are read-only in the panel and in the API. The only way to bring one back is restore.

### Restore

19. Restore creates a new version from an old one: the panel loads the old version's payload and calls `PUT /content-items/{id}/script/` with `base_version` = the latest version, the old payload, and `note = "Restored from version {n}"`.
20. All E05-S02 saving rules apply: allowed statuses, `version_conflict`, unchanged detection (restoring the version that is already the latest content returns `unchanged: true`), `origin = human`, `status = draft`. A restored version must be approved like any other draft.
21. The restored version is bound to the item's current approved brief. If the brief changed since the old version was written, the response's `brief_is_current` is true for the new version, and it is the operator's job to check it still fits the brief; the panel says so (see Panel).

## Data

- `ScriptVersion.feedback` holds the regeneration feedback or the restore note. See [DATA-MODEL.md](../../DATA-MODEL.md).
- `JobRun.result` gains `source` and `base_version` keys for `script.generate` jobs (a JSON field; no schema change).
- No new tables or columns.

## API

### `POST /content-items/{id}/script/generate/` (with feedback)

Permission: operator or admin.

Request:

```json
{
  "base_version": 2,
  "feedback": "Open with a question instead of a statement. Remove the 3× statistic because we cannot source it, and replace that frame with a short example. Keep it under 25 seconds."
}
```

Response `202`: the job envelope as in E05-S01. Final `job.result`:

```json
{
  "script_version": 3,
  "base_version": 2,
  "valid": true,
  "issues": 0,
  "repaired": false,
  "auto_approved": false,
  "source": "operator",
  "idempotency_key": "42:1:2:9f2c1ab7"
}
```

Errors, in addition to the E05-S01 table:

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| `feedback` longer than 2,000 characters | 400 | `validation_error` | `fields[0].path = "feedback"`, code `max_length` |
| `base_version` is not the latest | 409 | `version_conflict` | `details.latest_version` |
| `base_version` given but the item has no script | 400 | `validation_error` | `fields[0].path = "base_version"` |

### `GET /content-items/{id}/script/versions/`

Permission: operator or admin.

Response `200`:

```json
{
  "count": 3,
  "next": null,
  "previous": null,
  "results": [
    {
      "version": 3,
      "status": "draft",
      "origin": "ai",
      "source": "operator",
      "feedback": "Open with a question instead of a statement. Remove the 3× statistic because we cannot source it, and replace that frame with a short example. Keep it under 25 seconds.",
      "brief_version": 1,
      "is_latest": true,
      "valid": true,
      "summary": {"hook": "Do you really need to post every day?", "frame_count": 5, "shot_count": 5, "duration_seconds": 24},
      "created_by": {"id": 3, "name": "Sara Ahmadi"},
      "created_at": "2026-12-01T09:20:05Z"
    },
    {
      "version": 2,
      "status": "superseded",
      "origin": "human",
      "source": "operator",
      "feedback": "Shortened the hook and merged frames 3 and 4",
      "brief_version": 1,
      "is_latest": false,
      "valid": true,
      "summary": {"hook": "Daily posting is not what grows accounts.", "frame_count": 4, "shot_count": 4, "duration_seconds": 20},
      "created_by": {"id": 3, "name": "Sara Ahmadi"},
      "created_at": "2026-12-01T09:02:11Z"
    },
    {
      "version": 1,
      "status": "superseded",
      "origin": "ai",
      "source": "operator",
      "feedback": "",
      "brief_version": 1,
      "is_latest": false,
      "valid": true,
      "summary": {"hook": "Posting every day is not why accounts grow.", "frame_count": 5, "shot_count": 5, "duration_seconds": 30},
      "created_by": {"id": 3, "name": "Sara Ahmadi"},
      "created_at": "2026-12-01T08:15:42Z"
    }
  ]
}
```

Field notes:

- `source` is `operator`, `autopilot` or `qc_revise` for AI versions, taken from the job that created the version; `operator` for human versions.
- `created_by` is the user who saved the edit or started the job; `null` for autopilot and the revise loop.
- `valid` is computed with the current rules.

### `GET /content-items/{id}/script/versions/{version}/`

Permission: operator or admin. Response `200`: the same shape as `GET /content-items/{id}/script/` (E05-S01) for that version, including `payload` and `validation`. For a version that is not the latest: `"actions": {"can_generate": false, "can_edit": false, "can_approve": false}` and `"latest_version"` shows the real latest number, so the panel can offer restore.

Errors: `404 not_found` for an unknown item or version.

### Restore (uses `PUT /content-items/{id}/script/`)

Request built by the panel from the old version's payload:

```json
{
  "base_version": 3,
  "note": "Restored from version 1",
  "payload": {"…": "payload of version 1, unchanged"}
}
```

Response and errors: as in E05-S02.

## Background work

The same task as E05-S01 (Celery task `script.generate`, queue `default`, job kind `script.generate`). `write_script_version` has no task of its own; it runs inside the caller's job. Additions:

- The idempotency key includes the base version and a hash of the feedback, so two different feedback requests are two jobs, and a duplicate delivery of one request is one version.
- Versions written by `write_script_version` carry the `qc.revise` job's ID in the `edited` event's `data.job_id`, so the chain "check → revise → script" can be followed.

## AI

Task `script.generate`, as specified in E05-S01. This story uses two of its optional variables:

| Variable | Value |
| --- | --- |
| `previous_package` | Payload of the base version, when the item has a script and feedback is not empty |
| `feedback` | The operator's text, or the findings list built by the revise loop |

Prompt behaviour required (already in `system.md`, verified by tests here):

1. With `previous_package` and `feedback`: change what the feedback asks for, keep unrelated frames, shots and design notes as they are, and keep indices contiguous.
2. Feedback cannot override the format rules, the template limits, `brief.must_avoid`, the brand block's banned terms, or the rule that facts come only from the brief's references. If feedback asks for something the rules forbid (for example a ninth frame on a reel), the model follows the rules and the mismatch surfaces as validation issues or simply as an unmet request the operator can see.
3. Feedback text is direction from the operator. Text inside references remains data.

Effort stays `high`. The prompt version is bumped if `system.md` changes for this story.

Fake provider fixtures, in `apps/ai/prompts/script.generate/`: `fixture.with_feedback_question_hook.json` (a rewrite that changes the hook and one frame of the base fixture) and `fixture.qc_revise_fix_headline.json` (shortens one headline).

## Panel

Route: `/content/:id`, tab **Script**. Two controls are added to the editor header from E05-S02: a "Regenerate" button and a "History" button.

### Regenerate dialog

`ModalForm`, title "Regenerate script".

| Element | Detail |
| --- | --- |
| Text | "The AI rewrites version {n} using your direction. The current version is kept in history." |
| Field | `ProFormTextArea` "What should change?" — 2,000 character counter, `dir="auto"`, placeholder "For example: open with a question; drop the second statistic; make it 20 seconds." |
| Checkbox | "Start over from the brief (ignore the current script)" — unchecked by default. When checked, the text field becomes optional and is sent as extra direction with no `base_version` payload reuse; a line of help says "The new script will not be based on version {n}." |
| Buttons | "Regenerate" (primary; disabled while the field is empty and the checkbox is unchecked) and "Cancel" |
| Unsaved changes | If the editor has unsaved changes, the dialog shows a warning: "You have unsaved changes. Save them first, or they will not be part of the rewrite." with a "Save now" link that runs the save flow and returns. |

On submit the dialog closes, `JobProgress` appears at the top of the tab, the editor is disabled, and when the job succeeds the tab reloads the latest version and shows `message.success` "Version {n} is ready." If `job.result.valid` is false the problems alert is shown instead. On `409 version_conflict`: "Someone saved a newer version. Reload and try again." with a "Reload" button.

### History drawer

`Drawer`, title "Script history", width 480, opened by the "History" button.

- A vertical list (`List`), newest first. Each row: "Version {n}", `StatusTag` (Draft, Approved, Superseded), origin tag ("AI", "Edited", "AI · revise loop", "AI · autopilot"), author and `DateTime`, the summary line "{frame_count} frames · {duration_seconds} s" (or "1 frame" for image formats), the hook in `ContentText`, and the feedback or note in grey italics if present, truncated to two lines with "more".
- A tag "Current" marks the latest version; a tag "In production" marks the approved one.
- Clicking a row opens that version in the editor area in read-only mode.

### Viewing an old version

- The editor shows the old version with every field disabled.
- A sticky `Alert` (info) above it: "You are viewing version {n} from {date}. It is read-only." with two buttons: "Restore this version" and "Back to latest".
- "Restore this version" opens `Modal.confirm`: "Create version {latest + 1} with the content of version {n}? It will be a draft and needs approval." If the old version's `brief_version` differs from the item's current brief version, the dialog adds: "The brief has changed since version {n} was written. Check that it still fits." On confirm it calls the restore `PUT`, then shows the new latest version with `message.success` "Restored as version {n}."
- If restore returns `unchanged: true`: `message.info` "Version {n} is already the current content."

### States

| State | What is shown |
| --- | --- |
| History loading | Skeleton rows in the drawer |
| One version only | The list with a single row; no empty state needed |
| No script | "Regenerate" and "History" are hidden (the E05-S01 empty state applies) |
| Job running | "Regenerate" disabled with tooltip "{job message}"; "History" stays usable but restore is disabled |
| Item locked (`in_check`, `in_review`, `approved` or later, `cancelled`) | "Regenerate" and "Restore this version" disabled with tooltip "This script is locked while the item is {status label}."; history remains viewable |
| Error loading a version | Inline `Result` with Retry and the small `request_id` |

## Acceptance criteria

1. Given a script at version 2, when the operator submits feedback "open with a question", then a job runs and version 3 exists with `origin = ai`, `feedback` equal to the text, and version 2 is `superseded` (or stays `approved` if it was approved).
2. Given the fake provider's feedback fixture, when version 3 is compared with version 2, then the hook changed and the frames not mentioned in the feedback are identical.
3. Given `base_version = 1` while the latest is 2, when regenerate is called, then the response is `409 version_conflict` with `details.latest_version = 2`.
4. Given feedback of 2,001 characters, when regenerate is called, then the response is `400 validation_error` on `feedback`.
5. Given the "Start over from the brief" box is checked, when the job runs, then the AI call has no `previous_package` and the new version is still numbered latest + 1.
6. Given three versions, when the History drawer opens, then three rows appear newest first with correct status, origin, author, time and summary, and the latest is marked "Current".
7. Given the operator opens version 1 from history, when it is displayed, then all fields are disabled and the read-only alert names version 1.
8. Given the operator restores version 1 while the latest is 3, when they confirm, then version 4 exists with the payload of version 1, `origin = human`, `status = draft`, `feedback = "Restored from version 1"`.
9. Given the latest version already has the same payload as the one being restored, when restore is confirmed, then no version is created and the panel says it is already current.
10. Given the revise loop calls `write_script_version(item, feedback=…, base_version=n, frame_indexes=[3], approve=True)` on an item in `needs_revision` with `autopilot.script` off, when the result is valid, then the new version is `approved`, the previous approved version is `superseded`, every frame except frame 3 is identical to version n, the item is still `needs_revision` (no production job was started by the service), and the history row shows "AI · revise loop" with no author.
11. Given the same call returns an invalid package after repair, when the job ends, then the version is a `draft`, nothing is approved, `job.result.valid = false`, and the item status is unchanged.
12. Given an item in `in_check`, when the operator opens the Script tab, then "Regenerate" and "Restore this version" are disabled and history can still be read.
13. Given unsaved edits in the editor, when the operator opens the Regenerate dialog, then a warning about unsaved changes is shown.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E05-S03-BE1 | Feedback and base version in generation | Extend the generate serializer and `generate_script()` with `feedback`, `base_version`, `source`, `auto_approve`; pass `previous_package` and `feedback` to the AI variables; extend the idempotency key; store `source` and `base_version` in the job result and event. Add the synchronous `write_script_version()` with `frame_indexes` (prompt hint plus verbatim copy of untouched frames). Fake fixtures for feedback and revise cases. Tests for rules 1–8 and for `write_script_version` (rules 10–14), including the invalid-result and frame-count paths. | 0.5 |
| E05-S03-BE2 | Version endpoints | `GET …/script/versions/` (list serializer with `summary`, `source`, `is_latest`, `valid`) and `GET …/script/versions/{version}/` (reuses the script serializer with locked `actions`); `openapi.yaml`. Tests for ordering, a missing version, and `actions` on old versions. | 0.25 |
| E05-S03-BE3 | Restore path and prompt check | API test that a `PUT` carrying an old payload and a note creates the next version and that the unchanged case returns `unchanged: true`; review `system.md` wording for rules in the AI section and bump `VERSION` if changed; test with the fake provider that feedback cannot produce an approved invalid package. | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E05-S03-FE1 | Regenerate dialog | `RegenerateScriptModal.tsx`: field, "start over" checkbox, unsaved-changes warning with "Save now", job wiring through `JobButton`/`JobProgress`, conflict and validation error handling. Component test for enabled/disabled submit and the conflict message. | 0.4 |
| E05-S03-FE2 | History drawer | `ScriptHistoryDrawer.tsx`: list with tags, summary, hook via `ContentText`, feedback truncation; service functions for the two version endpoints. | 0.3 |
| E05-S03-FE3 | Old-version view and restore | Read-only mode of the editor driven by a selected version, sticky alert, restore confirmation with the brief-changed note, unchanged handling, "Back to latest". Component test for restore and locked states. | 0.3 |

### Test

None beyond the tests in each subtask.

## Test notes

- **API:** regeneration from a draft, from an approved version (the approved one must stay approved until the new one is approved), with and without feedback, with a stale `base_version`.
- **Service:** `write_script_version` on an item in `needs_revision` — valid path stores and approves the version and leaves the status and jobs untouched; invalid path stores a draft and returns `valid = false`; with `frame_indexes` the untouched frames are byte-identical to the base. Use the fake provider fixtures `with_feedback_question_hook`, `qc_revise_fix_headline`, and an invalid-twice variant.
- **History:** create five versions through a mix of generate, edit, restore and revise; assert list order, statuses (exactly one `approved` at most, at most one `draft`), and sources.
- **Panel:** component tests for the dialog, drawer and read-only view; the end-to-end flow is covered once in E11-S03.

## Later

- Diff view between any two versions: both payloads are already available from the version endpoint.
- Frame-level regeneration for operators: expose `frame_indexes` on the generate request and a frame picker in the panel; the service already supports it (rule 12).
- Feedback templates: a short list of one-click directions ("Shorter", "Stronger hook", "More formal") that fill the feedback field.
