# E01-S03 — Activate, close and duplicate a plan

| | |
| --- | --- |
| Epic | E01 Weekly plan |
| Priority | Must |
| Estimate | BE 1 d · FE 1 d |
| Depends on | E01-S01, E01-S02 |
| Needed by | E02-S02, E03-S02, E10-S02, E10-S03 |

## User story

As an operator, I want to switch a finished plan on, close it when its week is over and start the next week from a copy, so that the rest of the workflow always knows which plan it is working for.

## Context

A draft plan is private working material. Activating it is the signal that research and selection may start. Closing it is the signal that the week is over and its results can be reported. Duplicating saves the operator from retyping a week that looks like the last one.

## Scope

**In**

- Activate a draft plan when it is ready.
- Close an active plan by hand, and automatically two days after its week ends.
- Duplicate a plan to another week.
- Signals that other apps subscribe to.

**Out (later)**

- Reopening a closed plan.
- Approval by a second person before activation.
- Archiving old plans.

## Behaviour and rules

### Activate

1. Only a `draft` plan can be activated. Activation requires `readiness.can_activate` to be true (E01-S01, rule 12). Otherwise the response is `409 invalid_transition` with the problems in `details.problems`.
2. Activation sets `status = active` and `activated_at`, then sends the `plan_activated` signal after the transaction commits.
3. Several plans of one account may be active at once (this week and next week). Two plans can never cover the same week, so there is at most one active plan per week.
4. Activation starts no background work in the MVP. The panel offers "Run research" as the next action.

### Close

5. Only an `active` plan can be closed.
6. Closing before the week has ended (account timezone) requires `"force": true`. Without it the response is `409 invalid_transition` with `details.reason = "week_not_ended"`.
7. Closing sets `status = closed` and `closed_at`, and changes every `open` slot to `skipped`.
8. Closing never cancels content. Items that are still in the pipeline keep their status, and scheduled publications still go out. The response reports how many items are unfinished.
9. After the transaction commits, the `plan_closed` signal is sent. E10-S02 listens to it and starts the weekly report job.
10. A daily task closes every active plan whose `week_end` is at least two full days in the past in the account's timezone. Two days gives the last posts of the week time to reach their 24-hour metrics before the report is built. The task uses the same service as the endpoint and is safe to run twice.

### Duplicate

11. Any plan can be duplicated, whatever its status.
12. The target week defaults to the week after the source plan. It must pass the same checks as plan creation (valid start day, not ended, at most eight weeks ahead, no existing plan).
13. Copied: `objective`, `audience_summary`, `audience_segments`, `success_metrics`, all goals. `title` becomes "Week of {D MMM}" for the new week. Not copied: `notes`, `carried_findings`, `source_report`, timestamps.
14. Slots are copied when `copy_slots` is true (the default): every source slot that is not `skipped` becomes an `open` slot at the same local weekday and time in the new week, with the same format and role. Slots that would fall less than 30 minutes in the future are left out. Content items are never copied.
15. The new plan is a `draft`.

## Data

Uses `WeeklyPlan` and `PlanSlot`. No new fields.

Signals in `apps/planning/signals.py`:

| Signal | Arguments | Sent when |
| --- | --- | --- |
| `plan_activated` | `plan` | After the activation transaction commits |
| `plan_closed` | `plan`, `forced` (bool), `automatic` (bool) | After the close transaction commits |

## API

Both roles may use every endpoint in this story.

### `POST /api/v1/plans/{id}/activate/`

No body. Returns `200` with the full plan.

Not ready:

```json
{
  "error": {
    "code": "invalid_transition",
    "message": "…",
    "fields": [],
    "details": {
      "status": "draft",
      "problems": [
        {"code": "goal_missing", "details": {"metrics": ["saves"]}},
        {"code": "no_slots"}
      ]
    },
    "request_id": "6f3c0f0e-0a57-4f0b-9d0e-2f1d7f1c9b10",
    "retryable": false
  }
}
```

| Case | Response |
| --- | --- |
| Plan is not a draft | `409 invalid_transition`, `details.status` |
| Not ready | `409 invalid_transition`, `details.problems` |

### `POST /api/v1/plans/{id}/close/`

```json
{"force": false}
```

```json
{
  "plan": { /* full plan, status "closed" */ },
  "slots_skipped": 2,
  "unfinished_items": 1
}
```

| Case | Response |
| --- | --- |
| Plan is not active | `409 invalid_transition`, `details.status` |
| Week not ended and `force` is false | `409 invalid_transition`, `details.reason = "week_not_ended"`, `details.week_end` |

### `POST /api/v1/plans/{id}/duplicate/`

```json
{"week_start": "2026-12-05", "copy_slots": true}
```

Both fields are optional. Returns `201` with the new plan. Validation errors are the same as `POST /plans/` in E01-S01.

## Background work

| Task | Queue | Schedule | Detail |
| --- | --- | --- | --- |
| `planning.close_finished_plans` | `default` | Daily at 02:00 UTC | Selects active plans, computes "now" in each account's timezone, closes those whose `week_end` + 2 days has passed. One plan failing does not stop the others; failures are logged with the plan ID. Idempotent because closing a closed plan is skipped. |

## AI

None.

## Panel

Actions live in the header of `/plans/:planId` and in the row menu of `/plans`.

| Status | Header actions |
| --- | --- |
| `draft` | "Activate plan" (primary), "Duplicate", "Delete" |
| `active` | "Close plan", "Duplicate" |
| `closed` | "Duplicate"; a link "View report" appears when E10-S02 has produced one |

**Activate plan.** Disabled with a tooltip listing the open readiness items while the plan is not ready. If the form has unsaved changes, the button first asks to save. Clicking opens `Modal.confirm`: title "Activate this plan?", text "Research and selection can start once the plan is active. You can still edit goals and slots." Confirm label "Activate". On success: message "Plan activated" and a `notification` with the action "Run research", linking to `/research?plan={id}`. If the API answers with problems (the plan changed in another tab), the readiness card refreshes and the message reads "The plan is not ready yet."

**Close plan.** When the week has ended: `Modal.confirm` "Close this plan? Open slots will be marked as skipped and the weekly report will be prepared." When it has not ended: the modal adds a warning line, "This week ends on 4 Dec. Closing now skips 4 open slots; items already in production keep going." and the confirm label is "Close early", which sends `force: true`. On success: "Plan closed. 2 slots skipped, 1 item still in progress."

**Duplicate.** `ModalForm` with Week (same picker as "New plan", defaulting to the following week) and "Copy slots" (checked). Submit label "Create copy". On success, go to the new plan with the message "Plan copied. Review the goals and slots before activating."

States: every action button shows a loading state while its request runs and is disabled against double clicks. A `409` reloads the plan.

## Acceptance criteria

1. Given a ready draft plan, when I activate it, then its status is `active`, `activated_at` is set and `plan_activated` is sent once.
2. Given a draft plan with no slots, when I activate it, then I get `409 invalid_transition` with a `no_slots` problem and the plan stays a draft.
3. Given an active plan whose week has not ended, when I close it without `force`, then I get `409` with reason `week_not_ended`; when I close it with `force: true`, then it closes.
4. Given an active plan with two open and three reserved slots, when it is closed, then the two open slots are `skipped`, the reserved slots are unchanged, and the response shows `slots_skipped` 2.
5. Given an active plan with an item in production, when the plan is closed, then the item's status is unchanged and `unfinished_items` is 1.
6. Given an active plan whose week ended three days ago, when the daily task runs, then the plan is closed and `plan_closed` is sent with `automatic` true; when the task runs again, then nothing changes.
7. Given an active plan whose week ended yesterday, when the daily task runs, then the plan stays active.
8. Given a plan with four goals and nine slots, of which one is skipped, when I duplicate it to the next week, then the new draft has four goals and eight open slots at the same local weekdays and times.
9. Given the target week already has a plan, when I duplicate into it, then I get a validation error with code `unique`.
10. In the panel, given a draft that is not ready, then "Activate plan" is disabled and its tooltip lists what is missing.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E01-S03-BE1 | Activate and close | `planning.services.activate(plan)` and `close(plan, force, automatic)` with transactions, slot skipping, unfinished-item count, signals sent on commit; two view actions; tests | 0.5 |
| E01-S03-BE2 | Duplicate | `planning.services.duplicate(plan, week_start, copy_slots)` reusing creation validation and local-time slot shifting; view action; tests | 0.25 |
| E01-S03-BE3 | Automatic close | Celery task, beat entry, per-account timezone logic, idempotency test; OpenAPI additions for the three endpoints | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E01-S03-FE1 | Activate and close actions | Header buttons per status, confirmations with the texts above, readiness tooltip, problem handling, result messages | 0.5 |
| E01-S03-FE2 | Duplicate flow | Modal from header and list row, week picker reuse, navigation to the copy | 0.5 |

### Test

None beyond the tests inside each subtask.

## Test notes

- Service tests with a frozen clock for the week-ended boundary in `Asia/Tehran` and in `UTC`.
- A test that a failing `plan_closed` receiver does not roll back the close.
- Duplicate across a daylight-saving change keeps local times.

## Later

- `plan_activated` is the hook for starting research automatically once the team trusts it.
- A `reopen` action can be added as `closed → active` with a rule about the existing report.
