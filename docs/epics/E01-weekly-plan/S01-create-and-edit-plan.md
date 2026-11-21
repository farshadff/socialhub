# E01-S01 — Create and edit the weekly plan

| | |
| --- | --- |
| Epic | E01 Weekly plan |
| Priority | Must |
| Estimate | BE 2 d · FE 2.5 d |
| Depends on | E00-S01, E00-S02, E00-S03 |
| Needed by | E01-S02, E01-S03, E02-S02, E03-S02, E10-S01, E10-S03 |

## User story

As an operator, I want to write down who this week's content is for, what it should achieve and how success is measured, so that every later step works toward the same targets.

## Context

This is the first screen of the weekly workflow. The operator arrives with an account that already has a brand profile (E00-S03). The plan they write here is read by research, selection, briefing and evaluation. Slots are handled in E01-S02 and status changes in E01-S03; this story covers creating the plan and editing its content.

## Scope

**In**

- List plans for an account.
- Create a draft plan for a week.
- Edit title, objective, audience summary and segments, success metrics, goals and notes.
- Delete a draft plan.
- Return a readiness checklist and a slot summary with the plan.
- Show carried findings and let the operator mark each as applied or ignored.

**Out (later)**

- AI suggestions for objective or goals.
- Goal templates per account.
- Change history of plan edits.

## Behaviour and rules

1. A plan belongs to one account and one week. `(account, week_start)` is unique.
2. `week_start` must fall on the account's `week_start_day`. `week_end` is always `week_start` + 6 days and is set by the server.
3. A plan can be created for the current week or any of the next eight weeks. A plan cannot be created for a week that has already ended in the account's timezone.
4. A new plan has status `draft`. `title` defaults to "Week of {D MMM}" using `week_start`. `audience_summary` defaults to the brand profile's `audience_summary`. `success_metrics` defaults to `["reach", "saves", "shares"]`.
5. When `generate_slots` is true (the default) and the account has an active slot template, slots are generated as described in E01-S02. A missing template is not an error.
6. Field limits:

   | Field | Rule |
   | --- | --- |
   | `title` | 1–120 characters |
   | `objective` | 0–1,000 characters; required to activate |
   | `audience_summary` | 0–2,000 characters; required to activate |
   | `audience_segments` | 0–5 items; `name` 1–60 characters, `description` 0–300 characters; names unique within the plan |
   | `success_metrics` | 1–4 distinct values from `Metric` |
   | `notes` | 0–5,000 characters |

7. Goals are sent as a full list inside the plan. On update, a goal with an `id` is updated, a goal without an `id` is created, and an existing goal missing from the list is deleted. Sending no `goals` key leaves goals unchanged.
8. Goal validation:

   | Rule | Error code on the field |
   | --- | --- |
   | `metric` is a `Metric` value | `invalid_choice` |
   | `scope` is `week_total` or `per_post` | `invalid_choice` |
   | `format` is a `Format` value or null | `invalid_choice` |
   | `target_value` is an integer from 1 to 100,000,000 | `min_value` / `max_value` |
   | `follower_growth` only with scope `week_total` and format null | `invalid_combination` |
   | `replies` only with format `story` or null | `invalid_combination` |
   | No two goals share metric, scope and format | `duplicate` |
   | At most 20 goals per plan | `max_length` |

9. What can be edited depends on status:

   | Status | Editable |
   | --- | --- |
   | `draft` | Everything in this story |
   | `active` | `title`, `objective`, `audience_summary`, `audience_segments`, `success_metrics`, `goals`, `notes`, carried-finding states |
   | `closed` | `notes` only |

   Any other change returns `409 invalid_transition`.
10. `week_start` cannot be changed after creation. To move a plan, duplicate it to another week (E01-S03) and delete the draft.
11. Only a `draft` plan can be deleted. Its slots and goals are deleted with it.
12. `readiness` is computed on every read. `can_activate` is true when `problems` is empty. Problems:

    | Code | Condition |
    | --- | --- |
    | `objective_missing` | `objective` is empty |
    | `audience_missing` | `audience_summary` is empty |
    | `no_slots` | No slot with a status other than `skipped` |
    | `goal_missing` | A success metric has no goal; `details.metrics` lists them |
    | `week_ended` | The week has ended in the account's timezone |

13. `GET /plans/current/` returns the working plan for an account: the active plan whose week contains today in the account's timezone; if there is none, the active plan with the nearest future `week_start`; if there is none, `404 not_found`. Other pages use it to choose their default plan.
14. Carried findings are written by E10-S03. Each item is a finding from DATA-MODEL.md plus `report_id` and `state` (`pending`, `applied`, `ignored`). This story only changes `state`. Applying a finding never edits the plan by itself: the panel copies the suggestion into the form and the operator saves.

## Data

Uses `WeeklyPlan` and `PlanGoal` as defined in [DATA-MODEL.md](../../DATA-MODEL.md). No new fields.

`carried_findings` item shape:

```json
{
  "id": "f2",
  "report_id": 7,
  "type": "worked",
  "title": "Evening reels reached twice as many people",
  "detail": "Reels posted at 19:00 had a median reach of 8,400 at 24 h against 4,100 for noon reels.",
  "recommendation": "Move the Tuesday reel from 12:00 to 19:00.",
  "plan_field": "slots",
  "suggested_change": {"note": "Move the Tuesday reel from 12:00 to 19:00"},
  "state": "pending"
}
```

## API

All endpoints require a signed-in user. Both roles may use them.

### `GET /api/v1/plans/?account={id}`

Filters: `status` (comma-separated), `week_start_after`, `week_start_before`. Ordering: `week_start` or `-week_start` (default `-week_start`).

```json
{
  "count": 2,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 12,
      "account": 3,
      "week_start": "2026-11-28",
      "week_end": "2026-12-04",
      "status": "draft",
      "title": "Week of 28 Nov",
      "success_metrics": ["reach", "saves", "shares"],
      "slot_summary": {"total": 9, "by_format": {"reel": 3, "story": 4, "feed_post": 2}, "by_status": {"open": 9}},
      "readiness": {"can_activate": false, "problems": [{"code": "objective_missing"}]},
      "updated_at": "2026-11-22T09:14:03Z"
    }
  ]
}
```

List rows omit the long text fields, goals and carried findings.

### `POST /api/v1/plans/`

```json
{
  "account": 3,
  "week_start": "2026-11-28",
  "title": "Launch week",
  "generate_slots": true
}
```

Only `account` and `week_start` are required. Returns `201` with the full plan (shape below).

| Case | Response |
| --- | --- |
| `week_start` not on the account's start day | `400 validation_error`, field `week_start`, code `invalid_week_start` |
| Week already ended, or more than eight weeks ahead | `400 validation_error`, field `week_start`, code `out_of_range` |
| A plan exists for that week | `400 validation_error`, field `week_start`, code `unique` |
| Account archived | `400 validation_error`, field `account`, code `account_archived` |

### `GET /api/v1/plans/{id}/`

```json
{
  "id": 12,
  "account": 3,
  "week_start": "2026-11-28",
  "week_end": "2026-12-04",
  "status": "draft",
  "title": "Launch week",
  "objective": "Introduce the winter collection and grow saves on educational posts.",
  "audience_summary": "Women 25–40 in Tehran who shop online and follow home-decor accounts.",
  "audience_segments": [
    {"name": "New homeowners", "description": "Moved in the last year, furnishing from scratch."},
    {"name": "Gift buyers", "description": "Looking for Yalda gifts under a fixed budget."}
  ],
  "success_metrics": ["reach", "saves", "shares"],
  "goals": [
    {"id": 31, "metric": "reach", "scope": "week_total", "format": null, "target_value": 60000},
    {"id": 32, "metric": "saves", "scope": "per_post", "format": "feed_post", "target_value": 120},
    {"id": 33, "metric": "shares", "scope": "week_total", "format": null, "target_value": 300},
    {"id": 34, "metric": "follower_growth", "scope": "week_total", "format": null, "target_value": 250}
  ],
  "notes": "",
  "carried_findings": [],
  "source_report": null,
  "slot_summary": {"total": 9, "by_format": {"reel": 3, "story": 4, "feed_post": 2}, "by_status": {"open": 9}},
  "readiness": {"can_activate": true, "problems": []},
  "activated_at": null,
  "closed_at": null,
  "created_by": {"id": 1, "name": "Sara"},
  "created_at": "2026-11-22T09:10:41Z",
  "updated_at": "2026-11-22T09:14:03Z"
}
```

### `PATCH /api/v1/plans/{id}/`

Any subset of the editable fields. Example that changes the objective, replaces goals and marks a finding:

```json
{
  "objective": "Introduce the winter collection and grow saves on educational posts.",
  "success_metrics": ["reach", "saves"],
  "goals": [
    {"id": 31, "metric": "reach", "scope": "week_total", "format": null, "target_value": 70000},
    {"metric": "saves", "scope": "week_total", "format": null, "target_value": 900}
  ],
  "carried_findings_state": [{"id": "f2", "state": "applied"}]
}
```

Returns `200` with the full plan.

| Case | Response |
| --- | --- |
| Field not editable in the current status | `409 invalid_transition`, `details.status` and `details.fields` |
| Goal rule broken | `400 validation_error`, path such as `goals.1.target_value` |
| `carried_findings_state` names an unknown finding | `400 validation_error`, path `carried_findings_state.0.id`, code `does_not_exist` |
| `week_start` or `account` in the body | `400 validation_error`, code `read_only` |

### `DELETE /api/v1/plans/{id}/`

`204` for a draft. `409 invalid_transition` otherwise.

### `GET /api/v1/plans/current/?account={id}`

`200` with the full plan shape, or `404 not_found` when the account has no active plan for now or the future.

## Background work

None.

## AI

None.

## Panel

### Plan list — `/plans`

- `PageContainer` titled "Weekly plan", primary action "New plan".
- `ProTable` with server paging. Columns: Week (for example "28 Nov – 4 Dec 2026"), Title, Status (`StatusTag`), Slots (for example "0 / 9 filled", from `slot_summary`), Updated (`DateTime`), actions Open, Duplicate (E01-S03), Delete (drafts only, `Popconfirm`: "Delete this draft plan and its slots?").
- Filter: status. Default order: newest week first.
- Empty state: "No plans yet. A plan sets the audience, goals and slots for one week." with the button "New plan".
- "New plan" opens a `ModalForm`:
  - Week: a week picker that offers only valid week starts for the account, from the current week to eight weeks ahead. Weeks that already have a plan are disabled with the hint "Plan exists".
  - Title: optional.
  - Generate slots from template: checkbox, on by default, disabled with the hint "No slot template yet" when the account has none.
  - Submit label "Create plan". On success, go to `/plans/{id}`.

### Plan editor — `/plans/:planId`, tab Plan

Header: title (inline editable), week range, `StatusTag`, and the actions from E01-S03. The Slots tab is E01-S02.

Two-column layout at 1280 px and above: form on the left (two thirds), readiness card on the right. One column below that.

| Card | Content |
| --- | --- |
| Findings from last week | Shown only when `carried_findings` is not empty. Each finding is a list item with a type tag (Worked, Did not work, Insight), title, detail, recommendation, and two buttons: "Apply" and "Ignore". Applied and ignored findings collapse to one line with an "Undo" link. |
| Objective and audience | Objective (`TextArea`, 4 rows, counter 1,000). Audience summary (`TextArea`, 4 rows, counter 2,000, `dir="auto"`). Segments (`ProFormList`, up to 5: name and description). |
| Success metrics | Checkbox group of the eight metrics with one-line explanations; between one and four may be ticked. |
| Goals | Editable table: Metric (select), Scope (Week total / Per post), Format (All, Reel, Story, Feed post), Target (number), remove button. "Add goal" adds a row. Under the table, one hint per success metric without a goal: "No goal for saves yet". Invalid combinations are prevented in the selects (choosing Follower growth fixes scope to Week total and format to All). |
| Notes | `TextArea`, 4 rows. |
| Readiness (side) | A checklist built from `readiness.problems`: Objective written, Audience written, At least one slot, A goal for every success metric, Week not ended. Each failed line links to the field or to the Slots tab. |

Behaviour:

- "Save" in the page footer sends one `PATCH` with the changed fields. It is disabled while nothing has changed and shows a spinner while saving. Success message: "Plan saved".
- Field errors from the API appear under the matching field; goal errors appear in the row.
- "Apply" on a finding depends on `plan_field`: for `objective`, `audience` and `notes` it appends the recommendation to that field in the form; for `goals` it adds a goal row pre-filled from `suggested_change` when it carries `metric`, `scope`, `format` and `target_value`, otherwise an empty row; for `slots` and `none` it only marks the finding. In every case the state change is saved with the next "Save".
- Leaving the page with unsaved changes asks: "You have unsaved changes. Leave without saving?"
- In an `active` plan the form stays editable. In a `closed` plan every field except Notes is read-only and a banner says "This plan is closed."
- States: skeleton while loading; a `Result` with Retry on load failure; on `409` the page says "This plan changed. Reloading." and reloads.

## Acceptance criteria

1. Given an account whose week starts on Saturday, when I create a plan with `week_start` 2026-11-28, then the plan is created as a draft with `week_end` 2026-12-04.
2. Given the same account, when I create a plan with `week_start` 2026-11-30, then I get a validation error on `week_start` with code `invalid_week_start`.
3. Given a plan exists for a week, when I create another for the same account and week, then I get a validation error with code `unique`.
4. Given a draft plan, when I save a `follower_growth` goal with scope `per_post`, then I get a validation error with code `invalid_combination` on that goal.
5. Given a draft plan with goals A and B, when I save a goals list containing only A with a new target, then A is updated and B no longer exists.
6. Given a plan whose success metrics are reach and saves and which has a goal only for reach, when I read the plan, then `readiness.problems` contains `goal_missing` listing `saves`.
7. Given an active plan, when I change its objective, then the change is saved; when I send `week_start`, then I get a `read_only` validation error.
8. Given a closed plan, when I change its objective, then I get `409 invalid_transition`; when I change its notes, then the change is saved.
9. Given a plan with a pending carried finding, when I mark it applied and save, then reading the plan shows the finding with state `applied`.
10. Given an account with an active plan for this week and another for next week, when I call `GET /plans/current/`, then I receive this week's plan.
11. In the panel, given I edit the objective and navigate away without saving, then I am asked to confirm.
12. In the panel, given the API rejects a goal, then the message appears on that goal's row and my other edits are still in the form.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E01-S01-BE1 | Models and migration | Create app `planning`; `WeeklyPlan` and `PlanGoal` with constraints (unique account + week, unique goal tuple, check `target_value > 0`); admin registration | 0.5 |
| E01-S01-BE2 | Serializers and validation | List and detail serializers; week-start, range and limit rules; nested goal write with create/update/delete; per-status editable-field guard | 0.5 |
| E01-S01-BE3 | Views and routing | `PlanViewSet` (list, create, retrieve, partial update, destroy), `current` action, filters and ordering, account-scope requirement | 0.5 |
| E01-S01-BE4 | Readiness, slot summary, finding state | `planning.services.readiness(plan)`, `slot_summary` annotation, `carried_findings_state` handling | 0.25 |
| E01-S01-BE5 | Contract and tests | Extend `docs/openapi.yaml`; API tests for every rule and error case above | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E01-S01-FE1 | Plan list and create modal | `src/pages/plans/index.tsx`, service functions, week picker limited to valid starts | 0.75 |
| E01-S01-FE2 | Plan editor form | `src/pages/plans/[planId]/index.tsx`, Plan tab cards for objective, audience, segments, success metrics, notes; save, unsaved-changes guard, status-based read-only | 0.75 |
| E01-S01-FE3 | Goals table | Editable rows with dependent selects, per-row errors, missing-goal hints | 0.5 |
| E01-S01-FE4 | Findings panel and readiness card | Apply and Ignore behaviour per `plan_field`, undo, checklist with links | 0.5 |

### Test

None beyond the tests inside each subtask.

## Test notes

- API tests: one per row of the validation tables; per-status edit matrix; goal list replace semantics; `current` selection with zero, one and two active plans; account-timezone edge where the week has ended locally but not in UTC.
- Panel tests: create flow, goal row validation, unsaved-changes prompt, read-only closed plan.
- Fixtures: one account with Saturday week start in `Asia/Tehran`, one with Monday week start in `UTC`.

## Later

- AI can draft `objective` and goals from the previous report; the form already accepts pre-filled values.
- A `PlanRevision` table can record edits to an active plan if evaluation needs the goal as it was at publish time.
