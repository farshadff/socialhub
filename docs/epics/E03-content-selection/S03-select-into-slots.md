# E03-S03 — Select content into slots

| | |
| --- | --- |
| Epic | E03 Content selection |
| Priority | Must |
| Estimate | BE 2 d · FE 3.5 d · QA 0 d |
| Depends on | E03-S02, E03-S04 (BE1, BE2), E04-S01, E01-S02, E01-S03 |
| Needed by | E04-S02, E04-S03 |

## User story

As an operator, I want the ranked candidates matched to this week's open slots and confirmed in one step, so that every slot has the best-fitting piece of content and production can start.

## Context

After ranking (E03-S02) the plan has a scored list of candidates and a set of open slots, each with a format and sometimes a role hint. This story turns the two into decisions. The system proposes which candidate goes into which slot. The operator can change the proposal and confirms it, or the account's `autopilot.selection` switch confirms it automatically.

Confirming is the moment a candidate becomes a `ContentItem`. From then on the item is followed on `/content`.

## Scope

**In**

- The proposal algorithm and its storage on `Candidate.status` and `Candidate.proposed_slot`.
- `GET /selection/proposal/` and `POST /selection/confirm/` with an idempotency key.
- Automatic confirmation when `autopilot.selection` is on.
- Panel: the `/selection` page header and the Candidates and Proposal tabs.

**Out (later)**

- Drag and drop between slots.
- Diversity rules (for example "no two repurposes in a row") and weekly mix optimisation.
- Selecting a candidate without a slot. Every content item starts with a slot; an operator who needs one adds a slot to the plan first (E01-S02).
- Undoing a confirmation in bulk. A single item is undone by cancelling it (E03-S04).

## Behaviour and rules

### Building the proposal

`selection.services.proposal.build(plan)` runs at the end of every ranking job and after a candidate is rejected or restored.

1. Reset: every candidate of the plan with status `proposed` becomes `candidate` with `proposed_slot` null.
2. Eligible slots: the plan's slots with status `open` and `scheduled_at` later than now, in time order.
3. Eligible candidates: status `candidate`, `duplicate_of` null, `total_score` at least `SOCIALHUB_SELECTION_MIN_SCORE` (default 40), a rank, in rank order.
4. For each candidate in rank order, score every still-free eligible slot:

   | Part | Points |
   | --- | --- |
   | Format | Slot format is first in `suggested_formats` → 3; second → 2; third → 1; not in the list → the slot is not compatible. An empty `suggested_formats` is compatible with every slot at 1 point. |
   | Role | Slot `role` equals `suggested_role` → 2; slot `role` is null → 1; they differ → 0 |

   The candidate takes the compatible slot with the most points; ties go to the earliest slot. If no slot is compatible the candidate stays `candidate`.
5. A matched candidate gets status `proposed` and `proposed_slot`. A slot is proposed to at most one candidate.
6. The proposal is complete when slots or candidates run out. Slots left without a candidate stay open and are reported as unfilled.
7. The algorithm is deterministic: the same ranks and slots always give the same proposal.

Example: slots are a reel on Saturday (role `educate`), a story on Sunday (no role) and a feed post on Monday (role `build_trust`). Rank 1 suggests `[reel, story]` with role `educate`: the Saturday reel scores 3 + 2 = 5, the story 2 + 1 = 3, the feed post is incompatible, so it takes the reel. Rank 2 suggests `[feed_post]` with role `attract`: the feed post scores 3 + 0 = 3 and is the only compatible slot, so it takes it despite the role mismatch. Rank 3 suggests `[reel]`: no free reel slot, so it stays unassigned. Rank 4 suggests `[story, reel]`: it takes the story.

### Reading the proposal

8. `GET /selection/proposal/` returns the stored proposal. It does not write. Assignments whose slot is no longer `open` or is now in the past are left out of `assignments` and the response carries the warning `slots_changed`, so the panel can ask for a new ranking.

### Confirming

`POST /selection/confirm/` is the only way a content item is created.

9. The plan must be `active`. A `draft` or `closed` plan returns `409 invalid_transition`.
10. The body carries 1 to 50 assignments. A candidate or slot may appear only once.
11. Each candidate must belong to the plan and have status `candidate` or `proposed`. A duplicate-flagged candidate is accepted from a person; the operator has seen the warning.
12. Each slot must belong to the plan, have status `open`, and be in the future.
13. The slot's format does not have to be in the candidate's `suggested_formats`. The operator's choice wins.
14. Validation is all-or-nothing. If any assignment is invalid, nothing is created and the response lists every invalid assignment by index.
15. In one transaction, with row locks on the slots and candidates, for each assignment:
    - Create a `ContentItem`: `account`, `plan`, `slot`, `candidate`; `title` from the candidate; `format` from the slot; `media_kind` and `production_mode` from the format registry defaults (E04-S01: feed post → `image` / `design`; story → `image` / `design`; reel → `video` / `motion`); `role` from the slot's role, else the candidate's `suggested_role`, else null; `status` `selected`; `created_by` the user, or null for autopilot.
    - Slot status → `reserved`.
    - Candidate status → `selected`; `proposed_slot` is set to the slot.
    - Source record → `used`: `TrendTopic.status`, `FeedItem.status` or `RepurposeTask.status`.
    - Write a `ContentEvent` of type `status_changed` (`from_status` null, `to_status` `selected`, message "Selected for the {format} slot on {local date and time}", data `{"candidate_id", "slot_id", "rank", "total_score"}`).
16. Still in the transaction, the proposal is rebuilt for what is left (rule 1 onward), so remaining candidates are re-matched to remaining slots.
17. After commit, `content.services.pipeline.advance(item)` is called for each new item. With E04-S03 in place this starts brief generation.
18. If a slot or candidate changed between validation and locking (another operator confirmed first), the API returns `409 state_conflict` with `details.conflicts` and nothing is created.

### Idempotency

19. The endpoint accepts an `Idempotency-Key` header (8–64 characters). The first successful response for (user, path, key) is stored for 24 hours with a hash of the request body.
20. The same key with the same body returns the stored response with header `Idempotency-Replayed: true` and creates nothing.
21. The same key with a different body returns `409 state_conflict` with `details.reason` `idempotency_key_reused`.
22. Failed requests (4xx, 5xx) are not stored; the key can be reused after fixing the request.
23. Without the header the request is processed normally; rules 12 and 18 still prevent the same slot from being filled twice.

### Autopilot

24. At the end of a ranking job, after the proposal is built, if the account's `autopilot.selection` is true and the plan is `active`, the job confirms every `proposed` assignment through the same service as rule 15, with no user. The job result's `auto_confirmed` holds the number of items created.
25. Autopilot never selects duplicate-flagged candidates or candidates below the minimum score, because the proposal excludes them.
26. If the plan is `draft`, autopilot does nothing; the proposal waits. Activating the plan (E01-S03) does not confirm it by itself; the next ranking does.
27. With autopilot off, nothing is confirmed without a person.

## Data

Uses `Candidate`, `PlanSlot`, `ContentItem`, `ContentEvent`, `TrendTopic`, `FeedItem`, `RepurposeTask` from [DATA-MODEL.md](../../DATA-MODEL.md).

Additions to record in DATA-MODEL.md:

- New table `core.IdempotencyKey`, reused by E08 for `publish-now` and `retry`:

  | Field | Type | Notes |
  | --- | --- | --- |
  | `user` | FK User | |
  | `key` | text | From the header |
  | `method` / `path` | text | |
  | `request_hash` | text | SHA-256 of the canonical JSON body |
  | `response_status` | int | |
  | `response_body` | JSON | |
  | `created_at` | datetime | Rows older than 24 hours are deleted by a daily task |

  Unique on (`user`, `method`, `path`, `key`).

- New setting `SOCIALHUB_SELECTION_MIN_SCORE` (default 40).

## API

### `GET /selection/proposal/?account={id}&plan={id}`

Operators and admins. `plan` is required.

```json
{
  "plan": {"id": 12, "status": "active", "week_start": "2026-11-28", "week_end": "2026-12-04"},
  "ranked_at": "2026-11-22T09:14:31Z",
  "autopilot": false,
  "assignments": [
    {
      "slot": {"id": 101, "scheduled_at": "2026-11-28T15:30:00Z", "format": "reel", "role": "educate", "status": "open"},
      "candidate": {
        "id": 540, "kind": "trend", "title": "Five-minute desk setup", "rank": 1, "total_score": "77.80",
        "suggested_formats": ["reel", "story"], "suggested_role": "educate", "duplicate_of": null
      },
      "fit": {"format_points": 3, "role_points": 2, "format_match": true, "role_match": true}
    },
    {
      "slot": {"id": 103, "scheduled_at": "2026-11-30T15:30:00Z", "format": "feed_post", "role": "build_trust", "status": "open"},
      "candidate": {
        "id": 543, "kind": "feed_item", "title": "How we cut delivery time by 30%", "rank": 3, "total_score": "76.20",
        "suggested_formats": ["feed_post"], "suggested_role": "attract", "duplicate_of": null
      },
      "fit": {"format_points": 3, "role_points": 0, "format_match": true, "role_match": false}
    }
  ],
  "unfilled_slots": [
    {"id": 102, "scheduled_at": "2026-11-29T08:30:00Z", "format": "story", "role": null, "status": "open"}
  ],
  "unassigned_candidates": [
    {
      "id": 541, "kind": "repurpose", "title": "Repurpose: Three packing mistakes", "rank": 2, "total_score": "76.75",
      "suggested_formats": ["reel"], "suggested_role": "educate", "duplicate_of": null
    }
  ],
  "reserved_slots": [
    {
      "id": 100, "scheduled_at": "2026-11-28T08:30:00Z", "format": "story", "role": "engage", "status": "reserved",
      "content_item": {"id": 41, "title": "Ask us anything: shipping", "status": "briefed"}
    }
  ],
  "warnings": []
}
```

- `ranked_at` is the latest `ranked_at` among the plan's candidates, or null when ranking has never run.
- `unassigned_candidates` holds up to 50 candidates with status `candidate`, in rank order, including duplicate-flagged ones (with `duplicate_of` as `{"id", "title", "status"}`).
- `reserved_slots` lists slots that already have a content item, for context.
- `warnings` may contain `slots_changed` (rule 8), `never_ranked`, `no_open_slots`.

### `POST /selection/confirm/`

Operators and admins. Header `Idempotency-Key: 6f1c2b9e-3d0a-4a53-9c57-1b2f8a4de001`.

```json
{
  "plan": 12,
  "assignments": [
    {"candidate": 540, "slot": 101},
    {"candidate": 543, "slot": 103},
    {"candidate": 541, "slot": 102}
  ]
}
```

Returns `201`:

```json
{
  "plan": 12,
  "created": [
    {
      "id": 42, "title": "Five-minute desk setup", "format": "reel", "media_kind": "video",
      "production_mode": "motion", "role": "educate", "status": "selected",
      "slot": {"id": 101, "scheduled_at": "2026-11-28T15:30:00Z"}, "candidate": 540
    },
    {
      "id": 43, "title": "How we cut delivery time by 30%", "format": "feed_post", "media_kind": "image",
      "production_mode": "design", "role": "build_trust", "status": "selected",
      "slot": {"id": 103, "scheduled_at": "2026-11-30T15:30:00Z"}, "candidate": 543
    },
    {
      "id": 44, "title": "Repurpose: Three packing mistakes", "format": "story", "media_kind": "image",
      "production_mode": "design", "role": "educate", "status": "selected",
      "slot": {"id": 102, "scheduled_at": "2026-11-29T08:30:00Z"}, "candidate": 541
    }
  ],
  "open_slots_remaining": 0
}
```

| Case | Response |
| --- | --- |
| `assignments` empty or more than 50 | `400 validation_error`, field `assignments`, code `min_length` or `max_length` |
| Candidate or slot repeated in the body | `400 validation_error`, field `assignments.{i}.candidate` or `.slot`, code `duplicate` |
| Candidate not in the plan | `400 validation_error`, field `assignments.{i}.candidate`, code `does_not_exist` |
| Candidate is `selected` or `rejected` | `400 validation_error`, field `assignments.{i}.candidate`, code `not_selectable` |
| Slot not in the plan | `400 validation_error`, field `assignments.{i}.slot`, code `does_not_exist` |
| Slot not `open` | `400 validation_error`, field `assignments.{i}.slot`, code `slot_not_open` |
| Slot in the past | `400 validation_error`, field `assignments.{i}.slot`, code `slot_in_past` |
| Plan is `draft` or `closed` | `409 invalid_transition`, `details.allowed_statuses`: `["active"]` |
| Lost a race with another confirmation | `409 state_conflict`, `details.conflicts`: `[{"index": 1, "slot": 103, "reason": "slot_not_open"}]` |
| Same idempotency key, different body | `409 state_conflict`, `details.reason`: `idempotency_key_reused` |

## Background work

No new tasks. Two hooks run inside the `selection.rank` job from E03-S02:

1. `proposal.build(plan)` after ranks are written.
2. `confirm.auto_confirm(plan, job)` when rule 24 applies. A failure here does not fail the ranking job: the job succeeds with `auto_confirmed: 0` and a `warnings` entry `auto_confirm_failed:<code>` in its result, and the proposal stays for a person.

The daily task `core.prune_idempotency_keys` deletes keys older than 24 hours.

## AI

None. The goal-fit task in E03-S02 already supplies `suggested_formats` and `suggested_role`.

## Panel

Route `/selection`. This story builds the page header and fills the "Candidates" and "Proposal" tabs created in E03-S01.

### Header

- Title "Selection". Description: "Rank this week's candidates and fill the open slots."
- **Plan picker** (select): plans of the account that are `draft` or `active`, labelled "Week of 28 Nov — Active". Default: the current plan from `GET /plans/current/`, otherwise the nearest upcoming plan. The choice is kept in `?plan=`.
- **Summary line:** "6 open slots · 14 candidates · last ranked 22 Nov, 12:44". When never ranked: "Not ranked yet".
- **Primary action:** "Rank candidates" (`JobButton` on `POST /selection/rank/`). While the job runs it shows the job's message. On success both tabs reload and a message says "14 candidates ranked, 6 proposed". On failure a notification shows the error text for the code.
- **Autopilot banner** (info alert) when `autopilot` is true: "Selection autopilot is on. Ranking an active plan confirms the proposal automatically."

### Candidates tab

- `Table` (`useTable`), 20 per page, default order by rank.
- Columns:

  | Column | Content |
  | --- | --- |
  | Rank | Number; "—" for rejected |
  | Candidate | Title (`ContentText`), kind tag (default `Tag` with an icon per kind: Trend, Feed item, Repurpose; no colour presets), "Possible duplicate" warning tag linking to `/content/{id}` when `duplicate_of` is set |
  | Formats | Tags in suggested order |
  | Role | Suggested role label |
  | Score | Total in bold; under it "Evidence 72 · Goal fit 85 · Freshness 76" |
  | Status | `StatusTag`: Candidate grey, Proposed cyan, Selected green, Rejected grey |
  | Slot | Proposed or selected slot time (`DateTime`) and format |
  | Actions | "Reject" for candidate and proposed (`Popconfirm`: "Reject this candidate?"); "Restore" for rejected; "Open item" for selected |

- Expanded row: summary, rationale, and the sources as a list of links that open in a new tab.
- Filters: Kind (multi), Status (multi, default Candidate and Proposed), "Duplicates only" (switch).
- Rejecting or restoring reloads the table and the proposal.

### Proposal tab

- A table of the plan's slots that are open, in time order. It is edited locally; nothing is saved until "Confirm selection".

  | Column | Content |
  | --- | --- |
  | Slot | `DateTime` in the account timezone, weekday shown |
  | Format | Format tag |
  | Role | Role hint or "Any" |
  | Candidate | A searchable select. Options are the proposed candidate and all unassigned candidates, each shown as "#rank Title — 77.8". Candidates already chosen in another row are disabled. Duplicate-flagged candidates show a warning icon. "No candidate" clears the row. |
  | Fit | Tags "Format match" or "Format differs" (warning), "Role match" or "Role differs" (default colour); computed in the panel from the chosen pair |

- Above the table: "Reset to proposal" (restores the server proposal) and the count "4 of 6 open slots filled".
- Below the table, collapsed by default: "Already selected (3)" listing `reserved_slots` with links to the items.
- **Primary action:** "Confirm selection (4)". Disabled when no row has a candidate. `Modal.confirm`: "Create 4 content items for the week of 28 Nov? Their slots will be reserved and production will start with the briefs." The panel generates one idempotency key when the dialog opens and reuses it if the request is retried.
- On success: message "4 content items created" with a link "Open content" to `/content?plan=12`; the tab reloads.
- When `warnings` contains `slots_changed`: warning alert "Slots changed since the last ranking. Rank again to refresh the proposal."

### States

| State | Behaviour |
| --- | --- |
| No account selected | Prompt to pick an account |
| Account has no draft or active plan | `Empty`: "Create a weekly plan first." Button "Go to weekly plan" |
| Plan has no slots | `Empty` on the Proposal tab: "This plan has no slots yet." Button "Add slots" linking to `/plans/{id}?tab=slots` |
| Never ranked | `Empty` on both tabs: "No candidates yet. Run research or add feed items, then rank." Button "Rank candidates" |
| Ranking running | Tables show the previous data dimmed; Confirm, Reject and Restore are disabled with tooltip "Ranking is running" |
| Plan is draft | Confirm is disabled with tooltip "Activate the plan to confirm the selection" |
| No open slots | Info alert "Every slot in this plan has content." |
| `400` on confirm | The affected rows show the field error under the candidate select ("This slot is no longer open", "This slot is in the past", "This candidate was already selected") |
| `409 state_conflict` on confirm | Notification "The selection changed while you were working. The latest proposal is shown." The tab reloads; local edits are discarded |
| Loading / error | Skeleton; inline `Result` with Retry |

## Acceptance criteria

1. Given the example slots and ranks in rule 7's example, when the proposal is built, then rank 1 is proposed for the reel, rank 2 for the feed post, rank 4 for the story, and rank 3 stays unassigned.
2. Given a duplicate-flagged candidate with the highest total, when the proposal is built, then it is not proposed for any slot.
3. Given a candidate with total score 35 and the minimum score 40, when the proposal is built, then it is not proposed.
4. Given an open slot whose time has passed, when the proposal is built, then that slot receives no candidate.
5. Given an active plan and a valid body of three assignments, when I confirm, then three content items exist with status `selected`, their slots are `reserved`, their candidates are `selected`, and the topic, feed item and repurpose task behind them are `used`.
6. Given a confirmed item created from a reel slot, when I read it, then its `media_kind` is `video` and its `production_mode` is `motion`.
7. Given a slot with role `build_trust` and a candidate whose suggested role is `attract`, when they are confirmed together, then the item's role is `build_trust`.
8. Given a body where the second assignment's slot is already reserved, when I confirm, then the API returns `400` naming `assignments.1.slot` with code `slot_not_open` and no item is created.
9. Given a successful confirmation with an idempotency key, when the same request is sent again with the same key, then the response is identical, carries `Idempotency-Replayed: true`, and the number of content items is unchanged.
10. Given the same key with a different body, when the request is sent, then the API returns `409 state_conflict` with reason `idempotency_key_reused`.
11. Given a draft plan, when I confirm, then the API returns `409 invalid_transition`.
12. Given `autopilot.selection` on and an active plan with four open slots and four compatible candidates, when ranking finishes, then four content items exist, the job result has `auto_confirmed: 4`, and each item's `created_by` is null.
13. Given `autopilot.selection` off, when ranking finishes, then no content item is created.
14. Given the Proposal tab with a changed row, when I choose "Reset to proposal", then the row shows the server's proposed candidate again.
15. Given each new item, when confirmation commits, then one `ContentEvent` of type `status_changed` with `to_status` `selected` exists for it and `advance` was called once.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E03-S03-BE1 | Proposal builder | `selection.services.proposal.build(plan)` implementing rules 1–7 as a pure matching function plus a persistence step; called from the rank job and from candidate reject and restore. | 0.5 |
| E03-S03-BE2 | Proposal endpoint | `GET /selection/proposal/` with the response shape above, `warnings`, `reserved_slots`; `openapi.yaml`. | 0.25 |
| E03-S03-BE3 | Confirm service | `selection.services.confirm.confirm(plan, assignments, actor)`: validation with per-index errors, row locks, item creation through `content.services.pipeline.create_item`, slot, candidate and source updates, events, proposal rebuild, `advance` on commit. | 0.5 |
| E03-S03-BE4 | Idempotency helper | `core.IdempotencyKey` model and migration, `core.idempotency.idempotent` view decorator (lookup, body hash, store on 2xx, replay header), daily prune task. | 0.25 |
| E03-S03-BE5 | Confirm endpoint and autopilot | `POST /selection/confirm/` with the error table; `confirm.auto_confirm` hook in the rank job with the warning behaviour; job result fields `proposed` and `auto_confirmed`. | 0.25 |
| E03-S03-BE6 | Integration tests | Rank → proposal → confirm with the fake AI provider; race test with two concurrent confirmations; autopilot on and off. | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E03-S03-FE1 | Page header | Plan picker bound to `?plan=`, summary line, "Rank candidates" `JobButton`, autopilot banner, typed services in `src/services/socialhub/selection.ts`. | 0.5 |
| E03-S03-FE2 | Candidates tab | Table with the columns above, score cell, expandable row with rationale and sources, filters, reject and restore. | 1.0 |
| E03-S03-FE3 | Proposal tab | Slot table with local assignment state, candidate select with disabled and duplicate states, fit tags, reset, filled count, "Already selected" section. | 1.0 |
| E03-S03-FE4 | Confirm flow | Confirm dialog, idempotency key handling, per-row field errors from `400`, reload on `409`, success message with link. | 0.5 |
| E03-S03-FE5 | States and tests | Every state in the table; component tests for assignment editing (no candidate twice, reset) and error mapping. | 0.5 |

### Test

None beyond the tests inside each subtask.

## Test notes

- **Matching unit tests** on the pure function: the worked example; empty `suggested_formats`; all slots incompatible; ties broken by time; more candidates than slots and the reverse; determinism (same input, same output).
- **Confirm service tests:** every row of the error table; all-or-nothing on a mixed body; role precedence (slot, then candidate, then null); source status changes for each kind; proposal rebuilt for the remainder.
- **Concurrency test:** two transactions confirming the same slot; exactly one succeeds, the other gets `409 state_conflict`.
- **Idempotency tests:** replay, different body, failed request not stored, key expiry after 24 hours.
- **Autopilot tests:** active plan confirms; draft plan does not; failure inside auto-confirm leaves the job succeeded with a warning.
- **Panel tests:** select disables candidates used in other rows; fit tags update on change; confirm button count; `slots_changed` alert.

## Later

- Diversity and mix rules: add scoring parts to the slot-points table in `proposal.build`; the storage and endpoints stay.
- Drag and drop: the Proposal tab already keeps local assignment state; only the interaction changes.
- Selecting without a slot: allow `slot: null` in an assignment and let E08's scheduler place it; `ContentItem.slot` is already nullable.
- Multi-week selection: the proposal is per plan; a wrapper can call it for several plans.
