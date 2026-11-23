# E07-S06 — Check results and human review queue

| | |
| --- | --- |
| Epic | E07 Quality check |
| Priority | Must |
| Estimate | BE 1.5 d · FE 4 d · QA 0 d |
| Depends on | E07-S01, E07-S02, E07-S03, E07-S04, E07-S05, E03-S04, E06-S07, E08-S01 |
| Needed by | E11-S01, E11-S03 |

## User story

As an operator, I want to see why a version passed, was revised or was escalated, and to decide escalated items from one queue, so that the only human work in step 07 is fast and every decision is recorded.

## Context

This is the "Escalate: send unresolved issues to human review" outcome on the workflow page, and the place where every check result becomes visible. E07-S01 runs the checks and opens review tasks; E07-S02 to E07-S04 define the findings; E07-S05 reworks versions. E08-S01 also opens review tasks, for an item that found no free time (`no_slot`).

This story gives people three things:

1. The **Checks tab** of `/content/:id`: the latest run, its five results with findings, and the history of runs.
2. The **review queue** at `/review`: every open review task of the current account.
3. The **review task page** at `/review/:taskId`: the media, the copy, the findings, what changed since the previous version, and a decision form with three actions — approve, request changes, reject.

The run action, running state and revision banner on the Checks tab are already specified in E07-S01 and E07-S05; this story places them and builds everything else.

## Scope

**In**

- Read endpoints for check runs of an item and for one run.
- List, detail and resolve endpoints for review tasks.
- Decision rules per task reason, including the override rule from the finding catalogues.
- Checks tab, review queue, review task page, and the open-task count on the Review menu item.

**Out (later)**

- Assigning tasks to a person, due dates, comments, notifications.
- Bulk decisions.
- Editing copy directly on the review page (the reviewer requests changes with rework `manual` and edits in the Production tab).
- Statistics on reviewer decisions and checker accuracy.

## Behaviour and rules

### Reading check results

1. `GET /content-items/{id}/checks/` returns the item's check runs, newest first, each with its five results and their findings. Running runs are included with `status = running` and empty results.
2. Every finding returned by the API carries, besides the stored fields, two values looked up in the catalogue (`quality/catalogue.py`): `override_allowed` (the "Override" column of E07-S02, E07-S03 and E07-S04) and `fix` (`copy`, `render`, `script` or null). They are computed when serialized, so a catalogue change shows on old runs too.
3. Each run carries its version number and the version's `change_note`, so the run history doubles as the revision history.
4. `GET /checks/runs/{id}/` returns one run with the results' `details`: the measured media values (`format`), the resolved input assets (`rights`), the claims table (`facts`), the frames inspected (`design`) and the counters of `copy`. It also returns a short summary of the version that was checked and the review task opened from the run, if any.
5. Both endpoints are read-only and available to both roles. A run or item from an account the user cannot see returns `404 not_found`.

### The review queue

6. `GET /review-tasks/` requires `account`. Filters: `status` (default `open`), `reason`, `content_item`, `created_after`, `created_before`. Ordering: `created_at` (default, oldest first, so the queue is worked in order) or `-created_at`.
7. Each row carries the task, a summary of its item, and a summary of the run that opened it (for `qc_escalated` and `max_revisions`).
8. The panel's Review menu badge shows the `count` of open tasks for the current account.

### The review task page

9. `GET /review-tasks/{id}/` returns everything the page needs in one response: the task, the item, the version under review with media and copy, the run with its five results and findings, the previous version and a computed diff, and `decisions` — for each of the three decisions whether it is allowed now and, if not, why.
10. The diff compares the item's current version with the version numbered one lower. It covers caption, hashtags (added and removed), alt text, final asset, cover asset, the indexes of frames whose asset changed, the script version, and the current version's `change_note`. For version 1 the diff is null.
11. `can_recheck` is true when the item is `in_review`, the task reason is `qc_escalated` or `max_revisions`, and no job is active. The page then shows "Run checks again", which calls the E07-S01 endpoint. A recheck that passes resolves the task itself (E07-S01 rule 20).

### Which decisions are allowed

12. Allowed decisions per reason:

| Reason | Item status expected | Approve | Request changes | Reject |
| --- | --- | --- | --- | --- |
| `qc_escalated` | `in_review` | Yes, subject to the override rule (13) and a note | Yes | Yes |
| `max_revisions` | `in_review` | Yes, subject to the override rule (13) and a note | Yes | Yes |
| `no_slot` | `in_review` | Yes; requires a time or a slot (rule 16) | No | Yes |
| `manual` | `in_review` | As `qc_escalated`; when the task has no run, the override rule does not apply | Yes | Yes |

`manual` is in the reason enum for later use; no Phase 1 flow creates such a task. `publish_failed` is also in the enum and is reserved for Phase 2 (E08-S04); no Phase 1 flow creates it, and the resolve endpoint answers `409 invalid_transition` with `details.reason = "decision_not_allowed"` for it.

13. **Override rule.** Approving a `qc_escalated`, `max_revisions` or `manual` task overrides the findings of its run. Every finding of severity `major` or `blocker` in that run is a *blocking finding*. Approve is allowed only when every blocking finding has `override_allowed = true`. Otherwise approve is refused with `409 invalid_transition`, `details.reason = "not_overridable"` and the blocking findings that cannot be overridden. The way out for those is named in their suggestion: request changes, fix the asset rights in the library and recheck, or reject.
14. Approving with blocking findings requires a `decision_note` of 10 to 1,000 characters. It is stored on the task, the overridden finding codes are stored in `ReviewTask.overridden_findings`, and the `review_decision` event records them (rule 21). For facts findings the note is the place to state how the claim was verified (E07-S03 rule 24).
15. **Request changes** requires `instructions` (10 to 2,000 characters) and `rework`:

| `rework` | Panel label | What happens next (E07-S05) |
| --- | --- | --- |
| `copy` | Rewrite the caption | Revise job at copy level with the instructions first |
| `script` | Rewrite the script and render again | Revise job at script level with the instructions first |
| `manual` | I will fix it myself in Production | No job; the item goes to `in_production` with the instructions as `hold_reason` |

`script` is not available when the version under review has `origin = manual_upload` (it has no script); the API answers `400 validation_error` on `rework` with code `not_available`.

16. **Approve a `no_slot` task** requires exactly one of `scheduled_at` (UTC) or `slot` (an `open` slot of the same format in the item's plan). The service calls `schedule_item(item, at=…)` or `schedule_item(item, slot=…)` from E08-S01 rule 16. A `SchedulingError` becomes `400 validation_error` on `scheduled_at` (or `slot`) with its code: `too_soon`, `daily_limit` or `min_gap`. No note is required.
17. **Reject** requires a `decision_note` of 3 to 500 characters. Optional `release_candidate` (default false) has the meaning defined in E03-S04 rule 15.

### Applying a decision

18. `POST /review-tasks/{id}/resolve/` runs in one transaction with the task row and the item row locked (`select_for_update`), in this order: check the task is `open`; check the item status matches rule 12; check no job is active on the item; validate the body; mark the task `resolved` with `decision`, `decision_note`, `instructions`, `rework`, `overridden_findings`, `resolved_by`, `resolved_at`; then apply the effect. Resolving the task first keeps the one-open-task-per-item index free for a task the effect may open (for example `no_slot` after an approval).
19. Effects for `qc_escalated`, `max_revisions` and `manual` tasks:

| Decision | Effect |
| --- | --- |
| Approve | The run's version must still be `item.current_version` (else `409 invalid_transition`, `details.reason = "version_changed"`). Version → `passed`; item `in_review → approved` through `content.services.pipeline`; `advance(item)` invokes the scheduler (E08-S01), which creates the publication (item → `scheduled`) or, if no time is free, opens a `no_slot` task (item → `in_review`). If the scheduler raises, the whole transaction rolls back and the response is `409 invalid_transition` with `details.reason = "scheduling_failed"` |
| Request changes | Version → `rejected` if it is `submitted`; item `in_review → needs_revision`, with the transition event's `data.source = {"review_task_id": id}`; `advance(item)` starts the revise job, or for rework `manual` opens draft n+1 through E06-S07's `open_revision(source="review")`, which moves the item on to `in_production` (E07-S05 rules 1–2). Counters follow E07-S05 rule 17: `revision_count` grows, `auto_revision_count` does not |
| Reject | Item cancelled through the pipeline's cancel service with reason "Rejected in review: {decision_note}" and the given `release_candidate`. The slot is released as in E03-S04 rule 15 (`open` when its time is in the future, otherwise `skipped`). The version stays as it is |

20. Effects for `no_slot` tasks: approve schedules (rule 16), item `in_review → approved → scheduled`; reject as in rule 19.
21. Every resolution writes one `ContentEvent` of type `review_decision` with `actor` = the user, `message` = a one-line summary ("Approved despite 1 facts finding: 'Checked against the 2025 annual report, page 12.'"), and `data = {"review_task_id", "reason", "decision", "rework", "override": true|false, "overridden_findings": ["facts.unsupported_numeric"], "qc_run_id", "release_candidate"}`.
22. **Concurrency.** A task that is already resolved returns `409 invalid_transition` with `details.status = "resolved"` and who resolved it and how. The request carries an optional `Idempotency-Key`; repeating a successful request with the same key returns the first response instead of the 409, so a double click or a retried request is harmless.
23. The response includes `next_open_task_id`: the oldest other open task of the same account, or null. The panel uses it to move to the next task.

## Data

Uses `QCRun`, `QCResult`, `ReviewTask`, `ContentItem`, `ContentVersion`, `ContentEvent`, `Publication` and `PlanSlot` as defined in [DATA-MODEL.md](../../DATA-MODEL.md), with the fields added by E07-S01 (`QCRun.trigger`, `QCRun.started_by`, `QCResult.details`, `ContentItem.auto_revision_count`) and E07-S05 (`ReviewTask.rework`).

New field added by this story (to be added to DATA-MODEL.md):

| Table | Field | Type | Notes |
| --- | --- | --- | --- |
| `ReviewTask` | `overridden_findings` | JSON list of text, default `[]` | Finding codes a reviewer approved despite; empty for every other decision |

Indexes: `ReviewTask (account, status, created_at)` for the queue (E11-S01 also asks for `ReviewTask (account, status)`; this one covers both).

## API

All endpoints require a signed-in user; both roles may use them. Account scope as in [API.md](../../API.md).

### `GET /api/v1/content-items/{id}/checks/`

Paged, default `page_size` 10, newest run first.

```json
{
  "count": 2,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 119,
      "attempt": 2,
      "trigger": "revision",
      "status": "completed",
      "outcome": "escalate",
      "summary": "Escalated: the caption states '37%' and no reference supports it.",
      "started_by": null,
      "content_version": {"id": 207, "version": 2, "origin": "pipeline", "change_note": "Automatic revision 1 of 2. Caption shortened from 2,431 to 2,084 characters."},
      "review_task": {"id": 31, "status": "open", "reason": "qc_escalated"},
      "finding_counts": {"blocker": 1, "major": 0, "minor": 1, "info": 1},
      "results": [
        {"check": "format", "outcome": "pass", "score": 100, "checker": "rule", "findings": []},
        {"check": "rights", "outcome": "pass", "score": 100, "checker": "rule", "findings": [
          {"code": "rights.expires_soon", "severity": "info", "message": "Background image 'desk-top.jpg' licence ends on 4 Dec 2026, 2 days after the slot.", "location": {"asset_id": 611}, "suggestion": "Renew the licence or replace the image before reusing it.", "auto_fixable": false, "override_allowed": true, "fix": null}
        ]},
        {"check": "copy", "outcome": "pass", "score": 95, "checker": "ai", "findings": [
          {"code": "copy.hashtag_irrelevant", "severity": "minor", "message": "Hashtag 'travel' is unrelated to a post about desk organisation.", "location": {"field": "hashtags"}, "suggestion": "Remove it or replace it with a workspace hashtag.", "auto_fixable": true, "override_allowed": true, "fix": "copy"}
        ]},
        {"check": "facts", "outcome": "escalate", "score": 60, "checker": "ai", "findings": [
          {"code": "facts.unsupported_numeric", "severity": "blocker", "message": "The caption says '۳۷٪ of remote workers lose an hour a day to clutter'; no reference states this figure.", "location": {"field": "caption"}, "suggestion": "Add a source that states the figure, correct it, or remove the sentence.", "auto_fixable": false, "override_allowed": true, "fix": null}
        ]},
        {"check": "design", "outcome": "pass", "score": 100, "checker": "ai", "findings": []}
      ],
      "created_at": "2026-12-01T08:32:10Z",
      "completed_at": "2026-12-01T08:33:02Z"
    },
    {
      "id": 118,
      "attempt": 1,
      "trigger": "submission",
      "status": "completed",
      "outcome": "revise",
      "summary": "Revise: caption is 2,431 characters, limit 2,200.",
      "started_by": null,
      "content_version": {"id": 206, "version": 1, "origin": "pipeline", "change_note": ""},
      "review_task": null,
      "finding_counts": {"blocker": 1, "major": 1, "minor": 0, "info": 0},
      "results": [ "… five results …" ],
      "created_at": "2026-12-01T08:15:02Z",
      "completed_at": "2026-12-01T08:16:40Z"
    }
  ]
}
```

A running run has `"status": "running"`, `"outcome": null`, `"results": []`. An item with no runs returns `count: 0`.

| Case | Response |
| --- | --- |
| Item not found or not visible | `404 not_found` |

### `GET /api/v1/checks/runs/{id}/`

Same run shape as above, plus `details` per result, `item` and `version`:

```json
{
  "id": 119,
  "attempt": 2,
  "trigger": "revision",
  "status": "completed",
  "outcome": "escalate",
  "summary": "Escalated: the caption states '37%' and no reference supports it.",
  "item": {"id": 42, "title": "Four moves for a tidy desk", "format": "reel", "status": "in_review"},
  "version": {
    "id": 207,
    "version": 2,
    "origin": "pipeline",
    "caption": "میز مرتب فقط پنج دقیقه وقت می‌خواهد…",
    "hashtags": ["میز_کار", "نظم", "travel"],
    "alt_text": "A desk being cleared in four steps.",
    "final_asset": {"id": 640, "url": "https://media.example.com/accounts/3/2026/12/640-final.mp4", "kind": "video", "width": 1080, "height": 1920, "duration_ms": 28400},
    "cover_asset": {"id": 641, "url": "https://media.example.com/accounts/3/2026/12/641-cover.jpg", "kind": "image", "width": 1080, "height": 1920, "duration_ms": null},
    "frames": [{"index": 1, "asset_id": 630, "url": "https://media.example.com/accounts/3/2026/12/630-frame-1.png"}]
  },
  "review_task": {"id": 31, "status": "open", "reason": "qc_escalated"},
  "results": [
    {
      "check": "format",
      "outcome": "pass",
      "score": 100,
      "checker": "rule",
      "findings": [],
      "details": {"probe": {"container": "mp4", "video_codec": "h264", "pixel_format": "yuv420p", "width": 1080, "height": 1920, "fps": 30, "duration_s": 28.4, "audio_codec": "aac", "bytes": 18734120}}
    },
    {
      "check": "facts",
      "outcome": "escalate",
      "score": 60,
      "checker": "ai",
      "ai_run": 9921,
      "findings": [ "… as above …" ],
      "details": {
        "claims": [
          {"id": "c1", "text": "۳۷٪ of remote workers lose an hour a day to clutter", "kind": "numeric", "location": {"field": "caption"}, "status": "unsupported", "ref": null, "evidence_quote": "", "note": "No reference mentions a percentage."},
          {"id": "c2", "text": "Clearing the desk takes five minutes", "kind": "general", "location": {"frame_index": 1}, "status": "supported", "ref": "r1", "evidence_quote": "the whole routine takes about five minutes", "note": ""}
        ],
        "references": 2,
        "references_with_text": 2,
        "downgraded": 0
      }
    }
  ],
  "created_at": "2026-12-01T08:32:10Z",
  "completed_at": "2026-12-01T08:33:02Z"
}
```

(Only two of the five results are shown here; the response always has five for a completed run.)

| Case | Response |
| --- | --- |
| Run not found or not visible | `404 not_found` |

### `GET /api/v1/review-tasks/?account={id}`

```json
{
  "count": 1,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 31,
      "reason": "qc_escalated",
      "status": "open",
      "detail": "Escalated: the caption states '37%' and no reference supports it.",
      "item": {"id": 42, "title": "Four moves for a tidy desk", "format": "reel", "status": "in_review", "slot_scheduled_at": "2026-12-02T15:30:00Z", "thumbnail_url": "https://media.example.com/accounts/3/2026/12/641-cover-thumb.jpg"},
      "qc_run": {"id": 119, "attempt": 2, "outcome": "escalate", "finding_counts": {"blocker": 1, "major": 0, "minor": 1, "info": 1}},
      "decision": null,
      "resolved_by": null,
      "resolved_at": null,
      "created_at": "2026-12-01T07:14:51Z"
    }
  ]
}
```

| Case | Response |
| --- | --- |
| `account` missing | `400 validation_error`, field `account`, code `required` |
| Unknown `reason` or `status` value | `400 validation_error`, code `invalid_choice` |

### `GET /api/v1/review-tasks/{id}/`

```json
{
  "id": 31,
  "account": 3,
  "reason": "qc_escalated",
  "status": "open",
  "detail": "Escalated: the caption states '37%' and no reference supports it.",
  "decision": null,
  "decision_note": "",
  "instructions": "",
  "rework": null,
  "overridden_findings": [],
  "resolved_by": null,
  "resolved_at": null,
  "created_at": "2026-12-01T08:33:02Z",
  "item": {
    "id": 42,
    "title": "Four moves for a tidy desk",
    "format": "reel",
    "media_kind": "video",
    "production_mode": "motion",
    "role": "educate",
    "status": "in_review",
    "plan": 12,
    "slot": {"id": 202, "scheduled_at": "2026-12-02T15:30:00Z", "status": "reserved"},
    "revision_count": 1,
    "auto_revision_count": 1,
    "active_job": null
  },
  "version": {
    "id": 207,
    "version": 2,
    "origin": "pipeline",
    "status": "submitted",
    "caption": "میز مرتب فقط پنج دقیقه وقت می‌خواهد…",
    "hashtags": ["میز_کار", "نظم", "travel"],
    "alt_text": "A desk being cleared in four steps.",
    "final_asset": {"id": 640, "url": "https://media.example.com/accounts/3/2026/12/640-final.mp4", "kind": "video", "width": 1080, "height": 1920, "duration_ms": 28400},
    "cover_asset": {"id": 641, "url": "https://media.example.com/accounts/3/2026/12/641-cover.jpg", "kind": "image", "width": 1080, "height": 1920, "duration_ms": null},
    "frames": [
      {"index": 1, "asset_id": 630, "url": "https://media.example.com/accounts/3/2026/12/630-frame-1.png", "start_ms": 0},
      {"index": 2, "asset_id": 631, "url": "https://media.example.com/accounts/3/2026/12/631-frame-2.png", "start_ms": 4000}
    ],
    "change_note": "Automatic revision 1 of 2. Caption shortened from 2,431 to 2,084 characters."
  },
  "previous_version": {"id": 206, "version": 1, "status": "rejected"},
  "diff": {
    "caption": {"changed": true, "before": "میز مرتب فقط پنج دقیقه وقت می‌خواهد… (2,431 characters)", "after": "میز مرتب فقط پنج دقیقه وقت می‌خواهد… (2,084 characters)"},
    "hashtags": {"added": [], "removed": ["دکور", "خانه", "ایده"]},
    "alt_text": {"changed": false},
    "final_asset": {"changed": false},
    "cover_asset": {"changed": false},
    "frames_changed": [],
    "script_version": {"before": 3, "after": 3},
    "change_note": "Automatic revision 1 of 2. Caption shortened from 2,431 to 2,084 characters."
  },
  "qc_run": { "… the run shape of GET /checks/runs/{id}/, without item and version …": true },
  "decisions": {
    "approve": {"allowed": true, "requires_note": true, "blocking_findings": [{"check": "facts", "code": "facts.unsupported_numeric", "override_allowed": true}]},
    "request_changes": {"allowed": true, "rework_options": ["copy", "script", "manual"]},
    "reject": {"allowed": true}
  },
  "can_recheck": true
}
```

In the diff, `before` and `after` are the full texts; they are shortened here. A version-1 item has `"previous_version": null` and `"diff": null`.

`decisions` for a task whose approval is blocked:

```json
{
  "approve": {
    "allowed": false,
    "reason": "not_overridable",
    "blocking_findings": [
      {"check": "rights", "code": "rights.unknown", "override_allowed": false},
      {"check": "facts", "code": "facts.unsupported_numeric", "override_allowed": true}
    ]
  },
  "request_changes": {"allowed": true, "rework_options": ["copy", "script", "manual"]},
  "reject": {"allowed": true}
}
```

Other `reason` values for a disallowed decision: `decision_not_allowed` (rule 12), `item_status` (the item is not in the status rule 12 expects), `job_in_progress`, `resolved`. For `no_slot`, `approve` carries `"requires_time": true`.

| Case | Response |
| --- | --- |
| Task not found or not visible | `404 not_found` |

### `POST /api/v1/review-tasks/{id}/resolve/`

Optional header `Idempotency-Key`. Bodies by decision:

```json
{"decision": "approve", "decision_note": "Checked against the 2025 annual report, page 12, which states 37%."}
```

```json
{"decision": "approve", "scheduled_at": "2026-12-03T16:00:00Z"}
```

```json
{"decision": "approve", "slot": 209}
```

```json
{"decision": "request_changes", "rework": "copy", "instructions": "Remove the 37% sentence. Open with the five-minute promise instead."}
```

```json
{"decision": "reject", "decision_note": "Topic clashes with this week's launch message.", "release_candidate": true}
```

Response `200`:

```json
{
  "review_task": {
    "id": 31,
    "status": "resolved",
    "reason": "qc_escalated",
    "decision": "request_changes",
    "decision_note": "",
    "instructions": "Remove the 37% sentence. Open with the five-minute promise instead.",
    "rework": "copy",
    "overridden_findings": [],
    "resolved_by": {"id": 5, "name": "Sara"},
    "resolved_at": "2026-12-01T09:02:44Z"
  },
  "item": {"id": 42, "status": "in_production", "hold_reason": "", "active_job": "c41e7a90-8d2b-4f61-a3e5-1b9d0f6c2a77"},
  "publication": null,
  "job": {
    "id": "c41e7a90-8d2b-4f61-a3e5-1b9d0f6c2a77",
    "kind": "qc.revise",
    "status": "queued",
    "progress": 0,
    "message": "",
    "target_type": "content_item",
    "target_id": "42",
    "result": null,
    "error_code": null,
    "error_detail": null,
    "created_at": "2026-12-01T09:02:44Z",
    "started_at": null,
    "finished_at": null
  },
  "next_open_task_id": 34
}
```

After an approval the response carries `"item": {"status": "scheduled", …}` and the publication summary (`{"id", "status", "scheduled_at"}`), or `"item": {"status": "in_review", …}` with `next_open_task_id` pointing at the new `no_slot` task when no time was free. After a reject, `"item": {"status": "cancelled", …}`. `job` is null unless the decision started one.

Errors:

| Case | HTTP | Code | Field or `details` |
| --- | --- | --- | --- |
| Task not found or not visible | 404 | `not_found` | |
| `decision` missing or unknown | 400 | `validation_error` | field `decision`, code `required` / `invalid_choice` |
| Approve with blocking findings and no note, or note shorter than 10 | 400 | `validation_error` | field `decision_note`, code `required` / `min_length` |
| Reject without a note, or note outside 3–500 | 400 | `validation_error` | field `decision_note`, code `required` / `min_length` / `max_length` |
| Request changes without `instructions` or outside 10–2,000 | 400 | `validation_error` | field `instructions`, code `required` / `min_length` / `max_length` |
| Request changes without `rework`, or unknown value | 400 | `validation_error` | field `rework`, code `required` / `invalid_choice` |
| `rework = script` on a manual upload | 400 | `validation_error` | field `rework`, code `not_available` |
| `no_slot` approve with neither or both of `scheduled_at` and `slot` | 400 | `validation_error` | field `scheduled_at`, code `required` / `invalid_combination` |
| `slot` not open, other format, or other plan | 400 | `validation_error` | field `slot`, code `slot_unavailable` |
| Scheduling rule broken | 400 | `validation_error` | field `scheduled_at` or `slot`, code `too_soon` / `daily_limit` / `min_gap` |
| A field that does not belong to the decision (for example `rework` on reject) | 400 | `validation_error` | that field, code `not_allowed` |
| Task already resolved | 409 | `invalid_transition` | `{"status": "resolved", "decision": "approve", "resolved_by": {"id": 2, "name": "Reza"}, "resolved_at": "2026-12-01T08:59:10Z"}` |
| Decision not allowed for the reason | 409 | `invalid_transition` | `{"status": "open", "reason": "decision_not_allowed", "allowed_decisions": ["approve", "reject"]}` |
| Approve with a finding that cannot be overridden | 409 | `invalid_transition` | `{"status": "open", "reason": "not_overridable", "findings": [{"check": "rights", "code": "rights.unknown", "message": "Background image 'office-team.jpg' has unknown usage rights."}]}` |
| Item not in the expected status | 409 | `invalid_transition` | `{"status": "open", "reason": "item_status", "item_status": "in_check"}` |
| Current version differs from the run's version | 409 | `invalid_transition` | `{"status": "open", "reason": "version_changed"}` |
| Scheduler raised during approval | 409 | `invalid_transition` | `{"status": "open", "reason": "scheduling_failed"}` |
| A job is active on the item (for example a recheck) | 409 | `job_in_progress` | `{"job": { … }}` |

Example of a resolved-task conflict:

```json
{
  "error": {
    "code": "invalid_transition",
    "message": "…",
    "fields": [],
    "details": {"status": "resolved", "decision": "approve", "resolved_by": {"id": 2, "name": "Reza"}, "resolved_at": "2026-12-01T08:59:10Z"},
    "request_id": "0d6f4b1e-2a90-4c7e-b3f8-7e5a1c9d2b64",
    "retryable": false
  }
}
```

## Background work

None of its own. A resolution may start a `qc.revise` job (E07-S05) through `advance(item)`; it is enqueued after the transaction commits.

## AI

None.

## Panel

### Shared components

Built once in `src/components/quality/` and used on the Checks tab and the review page.

| Component | Content |
| --- | --- |
| `OutcomeTag` | Pass (green), Revise (orange), Escalate (red), Running (blue), Failed run (red, "Run failed"), always with text |
| `SeverityTag` | Blocker (red), Major (orange), Minor (blue), Info (grey) |
| `CheckCard` | `Card` titled by check name (Format, Rights, Copy, Facts, Design) with `OutcomeTag`, score ("Score 60"), checker ("Rules" or "AI + rules"), the finding list, and a collapsible "Details" section: Format → "Measured" `Descriptions` from `details.probe`; Rights → input asset list with origin, rights status and a link to the library; Facts → claims table (Claim, Kind, Status, Reference, Evidence quote) with unsupported and contradicted rows highlighted; Design → frames inspected; Copy → counters |
| `FindingList` | Findings ordered blocker → info. Each row: `SeverityTag`, message (`ContentText`), location link, suggestion in secondary text, and two small markers: "Fixed automatically" when `auto_fixable` and the run ended in Revise, "Cannot be overridden" when `override_allowed` is false |
| `FindingLocation` | `{"field": "caption"}` → "Caption"; `{"frame_index": 2}` → "Frame 2"; `{"asset_id": 611}` → asset file name; `{}` → nothing. On the review page a frame link jumps `MediaPreview` to that frame's start time; a field link scrolls to and highlights that block. On the Checks tab both open the Production tab with `?tab=production&focus=frame-2` or `focus=caption`. Asset links open `/library?asset={id}` |

### Checks tab — `/content/:id?tab=checks`

Layout, top to bottom:

1. `RevisionBanner` (E07-S05) when it applies.
2. Tab header: title "Checks", subtitle "Version {n}" of the latest run, and on the right the `JobButton` "Run checks again" with its rules from E07-S01, plus "Open review task" when `open_review_task` is set.
3. Running state from E07-S01 when a `qc.run` job is active.
4. **Latest run** card: `OutcomeTag`, "Run #{attempt} · {trigger label} · {DateTime}", the run summary, the finding counts ("1 blocker · 1 minor · 1 info"). Below, five `CheckCard`s in a responsive grid (two columns at 1280 px, one below). Cards with a non-pass outcome are expanded; pass cards are collapsed to their header with the finding count.
5. **Run history**: a `Collapse` list of earlier runs, newest first. Each header: `OutcomeTag`, "Run #{attempt}", version, trigger label, `DateTime`, and the change note (`ChangeNote` from E07-S05). Expanding shows the same five cards, read-only.

Trigger labels: Submitted, Automatic revision, Recheck.

States:

| State | Display |
| --- | --- |
| Loading | Skeleton of one run card with five card placeholders |
| No runs, item before `in_check` | `Empty`: "Checks run automatically when a version is submitted from Production." with the link "Open Production" |
| No runs, item `in_check` with an active job | The running state only |
| Last run failed | E07-S01's failure `Result`, then the history |
| Error loading | Inline `Result` with Retry and the `request_id` |
| Item cancelled or published | Everything read-only; no run button |

### Review queue — `/review`

- `PageFrame` titled "Review", description "Items the system could not decide on its own."
- Segmented control: "Open" (default) and "Resolved".
- `Table` (`useTable`), 20 per page, server paging. Columns for Open:

| Column | Content |
| --- | --- |
| (thumbnail) | 48 px preview in the format's aspect ratio, or the format icon |
| Item | Title (`ContentText`) linking to `/review/{taskId}`, format tag under it |
| Reason | Escalated by checks · Revision limit reached · No free time · Flagged by a person |
| Summary | For check reasons: `OutcomeTag` and finding counts ("1 blocker · 1 minor"); for `no_slot`: the detail; shortened to two lines with the full text in a tooltip |
| Slot | `DateTime` of the item's slot, or "No slot"; red text when it is in the past |
| Created | `DateTime` |
| Age | "3 h", "2 d"; orange from 24 h |

- Resolved adds Decision (Approved, Changes requested, Rejected), Resolved by and Resolved at, and orders newest first.
- Filter in the table search form: Reason (multi-select).
- Row click opens the task page.
- Empty states: Open — "Nothing needs review. Items that pass their checks schedule themselves." Resolved — "No resolved tasks yet."
- Errors: inline `Result` with Retry.
- **Menu badge:** the sidebar item "Review" shows a `Badge` with the open count from `GET /review-tasks/?account={id}&status=open&page_size=1`, refetched every 60 seconds and after every resolution. The top-bar attention count already includes open review tasks through E11-S01.

### Review task page — `/review/:taskId`

`PageFrame`: title "Review: {item title}", subtitle reason label and "Opened {DateTime}", extra actions "Open item" (to `/content/{id}?tab=checks`) and, when `can_recheck`, the `JobButton` "Run checks again" (E07-S01 endpoint, `Popconfirm` "Run all five checks on version {n} again?").

Two columns at 1280 px and above:

**Left (about 40%)**

- `MediaPreview` (E06-S07) of the final asset with the safe-area toggle; for a reel, the cover below it. When the version has frames, a frame strip under the preview; clicking a frame jumps to its start.
- Caption block: caption (`ContentText`), hashtags as tags, alt text; stories show "Stories have no caption."
- Slot: `DateTime` and slot status.

**Right (about 60%)**

- Detail `Alert` (warning) with the task's `detail`.
- "Findings" — `FindingList`s grouped by check, only checks with findings, blocking findings first. Each group shows the check's `OutcomeTag`. For `no_slot` this section is replaced by the scheduling explanation.
- "What changed" — from `diff`: a two-column before/after for caption and alt text (changed words highlighted, `ContentText`), hashtag chips marked added (green) and removed (red, struck through), "Final file replaced" or "Same final file", "Frames {list} rendered again", "Script version 3 → 4", and the change note. For version 1: "This is the first version."
- **Decision** card, a `Form` (`useForm`):
  - Radio group: "Approve" (for `no_slot`: "Schedule at a time"), "Request changes", "Reject". A disallowed option is disabled with a tooltip from `decisions.*.reason`: "These findings cannot be overridden: Unknown usage rights. Request changes or fix the asset in the library and run the checks again." / "Not available for this reason."
  - Approve fields: for check reasons, a list "You are approving despite:" with the blocking findings, and "Why is this fine?" `TextArea` (required, 10–1,000). For `no_slot`: a choice between "Open slot" (select of open slots of the same format in the plan, from `GET /plans/{id}/slots/?status=open&format=…`) and "Specific time" (date-time picker in the account timezone, limited to the plan week).
  - Request changes fields: "What should change?" `TextArea` (required, 10–2,000) with a button "Add findings" that appends the selected findings' messages and suggestions as a numbered list; "Who fixes it?" radio with the three rework labels from rule 15 (`script` hidden for manual uploads, `copy` preselected).
  - Reject fields: "Reason" `TextArea` (required, 3–500); checkbox "Return the idea to selection" (sends `release_candidate`).
  - Submit button label follows the choice: "Approve and schedule", "Schedule", "Send back for changes", "Reject item".
- Confirmations (`Modal.confirm`, naming the item):
  - Approve: "Approve '{title}' and schedule it? It will publish at {slot time} without further checks."
  - Request changes: "Send '{title}' back for changes? {rework sentence}" where the sentence is "The caption will be rewritten and checked again." / "The script will be rewritten, frames rendered again and checked again." / "The item moves to Production for you to edit."
  - Reject (danger): "Reject '{title}'? The item is cancelled and the {slot time} slot is freed. This cannot be undone."
- After success: `message.success` ("Approved and scheduled for {time}", "Sent back for changes", "Item rejected"), then navigate to `/review/{next_open_task_id}`, or to `/review` with "All caught up." when it is null. The menu badge refetches.

States:

| State | Display |
| --- | --- |
| Loading | Two-column skeleton |
| Task resolved | Read-only page; the decision card becomes a summary: decision, note or instructions, rework, overridden findings, resolver and time |
| Item has an active job | Decision card disabled with the note "Checks are running. Decide when they finish."; the page refetches every 3 seconds until the job ends |
| `409` already resolved | `message.warning` "{name} already resolved this task." and reload |
| `409` other | Field-level or `Alert` text by `details.reason`; the page reloads the task; the form keeps what was typed |
| Field errors | Under the matching field |
| Not found | 404 page with a link to `/review` |
| Error loading | Inline `Result` with Retry and the `request_id` |

## Acceptance criteria

1. Given an item with two completed runs, when I call `GET /content-items/{id}/checks/`, then both runs are returned newest first, each with five results, and every finding has `override_allowed` and `fix` from the catalogue.
2. Given a running run, then it appears first with `status = running` and empty results.
3. Given a facts result, when I call `GET /checks/runs/{id}/`, then its `details.claims` list is returned with status and reference per claim.
4. Given three open tasks created at different times, when I list with `account` and no other filter, then they are returned oldest first; with `reason=no_slot`, only that reason is returned.
5. Given a version-2 item whose caption and hashtags changed, when I open its task, then `diff.caption.changed` is true, removed hashtags are listed, and `diff.final_asset.changed` is false.
6. Given a `qc_escalated` task whose only blocking finding is `facts.unsupported_numeric`, when I approve with a 12-character note, then the task is resolved with `overridden_findings = ["facts.unsupported_numeric"]`, the version is `passed`, the item is `scheduled` with a publication, and a `review_decision` event with `override: true` exists.
7. Given the same task, when I approve without a note, then I get `400` on `decision_note` and nothing changes.
8. Given a task whose run contains `rights.unknown`, when I approve, then I get `409 invalid_transition` with `reason = not_overridable` listing `rights.unknown`, and `GET` shows approve as not allowed.
9. Given a `max_revisions` task, when I request changes with rework `copy` and instructions, then the task is resolved, the version is `rejected`, a `qc.revise` job is returned, `revision_count` grows by one after the revision and `auto_revision_count` does not.
10. Given a task on a manual upload, when I request changes with rework `script`, then I get `400` on `rework` with code `not_available`.
11. Given request changes with rework `manual`, then no job starts and the item is `in_production` with the instructions in `hold_reason`.
12. Given a `qc_escalated` task, when I reject with a note and `release_candidate: true`, then the item is `cancelled`, its future slot is `open`, the candidate is back to `candidate`, and no other review task is left open.
13. Given a `no_slot` task, when I approve with an open slot of the same format, then the item is `scheduled` at that slot's time; with a time that breaks the daily limit, I get `400` on `scheduled_at` with code `daily_limit`; with request changes, I get `409` with `reason = decision_not_allowed`.
14. Given a `no_slot` task, when I approve with a `scheduled_at` inside the plan week that breaks no scheduling rule, then the item is `scheduled` at that time, the task is resolved, the response carries the publication summary, and a `review_decision` event with `reason = no_slot` and `override: false` exists.
15. Given a `no_slot` task, when I reject it with a note, then the item is `cancelled` and its slot is released as in rule 19.
16. Given two reviewers resolving the same task at the same moment, then exactly one succeeds and the other gets `409 invalid_transition` with `details.status = resolved`.
17. Given a successful resolve, when the same request is repeated with the same `Idempotency-Key`, then the first response is returned and no second effect happens.
18. Given an item with an active recheck job, when I try to resolve its task, then I get `409 job_in_progress`.
19. Given an approval where the scheduler finds no free time, then the `qc_escalated` task is resolved, a new `no_slot` task is open, the item is `in_review`, and `next_open_task_id` points at the new task.
20. In the panel, given an escalated item, when I open the Checks tab, then the facts card is expanded with its blocker finding, the other cards are collapsed, and clicking "Caption" on the finding opens the Production tab focused on the caption.
21. In the panel, given open tasks, then the Review menu item shows their count, and after I resolve one the count drops by one and the next task opens.
22. In the panel, given a task with a non-overridable finding, then "Approve" is disabled with a tooltip naming the finding.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E07-S06-BE1 | Check run read endpoints | `quality/serializers.py` for runs, results and findings with catalogue lookups (`override_allowed`, `fix`); `GET /content-items/{id}/checks/` and `GET /checks/runs/{id}/` with version summary and `details`; API tests | 0.25 |
| E07-S06-BE2 | Review task list and detail | `ReviewTaskViewSet` list and retrieve; filters, ordering, row summaries; diff builder `quality/review/diff.py`; `decisions` and `can_recheck` computed by the same rule functions the resolve service uses; `ReviewTask (account, status, created_at)` index; tests | 0.5 |
| E07-S06-BE3 | Resolve service | `quality/review/resolve.py`: locking, rule 12 table, override rule, per-decision validation, effects through `content.services.pipeline`, the E08-S01 scheduling forms, `overridden_findings` migration, `review_decision` events, `next_open_task_id`; one test per row of the error table and per effect | 0.5 |
| E07-S06-BE4 | Endpoint, idempotency and contract | `POST /review-tasks/{id}/resolve/` view, `Idempotency-Key` store (24 h), concurrency test with two threads, `docs/openapi.yaml` for the five endpoints | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E07-S06-FE1 | Quality components | `OutcomeTag`, `SeverityTag`, `CheckCard` with the four details views, `FindingList`, `FindingLocation`; label maps; component tests | 1 |
| E07-S06-FE2 | Checks tab | `src/pages/content/workspace/tabs/ChecksTab/index.tsx`: banner and run header placement from E07-S01 and E07-S05, latest run card, run history, `focus` links into the Production tab, all states; services in `src/services/socialhub/checks.ts` | 0.75 |
| E07-S06-FE3 | Review queue and menu badge | `src/pages/review/index.tsx`: Open/Resolved switch, `Table` (`useTable`) columns, reason filter, empty states; Review menu `Badge` with 60-second refetch; services in `src/services/socialhub/reviewTasks.ts` | 0.75 |
| E07-S06-FE4 | Review task page layout | `src/pages/review/[taskId]/index.tsx`: header actions and recheck, `MediaPreview` with frame jumps, caption block, findings by check, "What changed" diff view, all states | 0.75 |
| E07-S06-FE5 | Decision form | Three actions with per-reason variants (override list and note, slot or time for `no_slot`), "Add findings", rework choice, confirmations, error mapping by `details.reason`, navigation to the next task; form tests | 0.75 |

### Test

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| — | None beyond the tests in each subtask | The Escalate path end to end is covered in E11-S03 | 0 |

## Test notes

- Fixtures: one item per reason (`qc_escalated` with an overridable facts blocker, `qc_escalated` with `rights.unknown`, `max_revisions`, `no_slot`), each with two versions so the diff is not empty.
- Resolve service tests use a stub of E08's `schedule_item` that records calls and can raise `SchedulingError`.
- Concurrency: two threads resolving the same task; assert one `200`, one `409`, one `review_decision` event.
- Idempotency: same key twice returns the same body; a different key after resolution returns `409`.
- Override rule table test: every catalogue code with `major` or `blocker` severity, approve allowed exactly when `override_allowed` is true.
- Panel: Checks tab expands non-pass cards; disabled Approve shows the right tooltip; `no_slot` form requires slot or time; next-task navigation; menu badge updates after resolve.

## Later

- `ReviewTask` can gain `assignee` and `due_at`; the queue already filters by reason and status, and the resolve service is the single place to enforce assignment.
- `overridden_findings` plus the `review_decision` events are the data for measuring checker accuracy and tuning severities.
- A "Flag for review" action on any item would create `manual` tasks; the decision rules already cover that reason.
- Inline caption editing on the review page could create a new draft version and submit it, reusing the Production endpoints.
- Phase 2: `publish_failed` tasks opened by E08-S04 — the decision rules for that reason (approve calls the retry service, request changes and reject go through `publishing.services.recovery.on_review_decision`), the publication summary on list rows and the detail, the Publication card with "Mark as published" and "Cancel publication", and the "Retry publishing" wording.
