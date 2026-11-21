# E10-S03 — Apply findings to the next weekly plan

| | |
| --- | --- |
| Epic | E10 Evaluate and feed back |
| Priority | Must |
| Estimate | BE 1.5 d · FE 1.5 d · QA 0 d |
| Depends on | E10-S02, E01-S01, E01-S03 |
| Needed by | E11-S03 |

## User story

As an operator, I want the findings I accepted in last week's report to appear in the next weekly plan as suggestions, so that what we learned changes what we plan without retyping it.

## Context

This is the first feedback loop on the workflow page: "Weekly findings → 01 Weekly plan". E10-S02 produces an accepted report whose findings each name a plan field and a suggested change. This story copies the accepted findings onto a plan as `carried_findings`. The plan editor (E01-S01) already shows carried findings in its "Findings from last week" card and lets the operator apply or ignore each one. This story is the bridge between the two: choosing the target plan, creating it when needed, writing the findings, and keeping report and plan linked.

Timing matters. A plan closes automatically two days after its week ends, so the following week's plan is usually already active when the report arrives. The default target is therefore the next plan that is still a draft, and the operator can choose the running plan instead.

## Scope

**In:**

- Apply an accepted report to a plan: default target resolution, explicit target, creation of a draft plan when none exists.
- A dry run that shows what will happen before anything is written.
- Carried-finding snapshots on the plan, with links in both directions.
- Re-apply rules.
- The data contract between a finding's `plan_field` and `suggested_change` and the plan editor.
- Panel: the apply flow on the report page, the applied state on the report and in the report list.

**Out (later):**

- Applying suggestions to plan fields automatically.
- Moving findings from one plan to another.
- Structured slot suggestions (add, move, remove a slot by data).
- Applying one report to several plans.

## Behaviour and rules

### Preconditions

1. Only an `accepted` report can be applied. A `draft` report returns `409 invalid_transition` with `details.reason = "report_not_accepted"`.
2. The report must have at least one finding with `accepted = true`. Otherwise `400 validation_error` on `findings` with code `no_accepted_findings`.

### Choosing the target plan

3. **Explicit target.** When the request names a `plan`, it must belong to the same account, have `week_start` later than the report's plan, and be `draft` or `active`. A `closed` plan returns `409 invalid_transition` with `details.reason = "plan_closed"`; an earlier or same week returns `400 validation_error` on `plan`.
4. **Default target.** Without `plan`, the target is the account's earliest plan with `week_start` later than the report's plan and status `draft`.
5. **Create when there is none.** If no such draft exists, a new draft plan is created:
   - Target week: the earliest week after the report's week that has no plan and has not ended in the account's timezone.
   - Source: the account's most recent plan with `week_start` before the target week, whatever its status (usually the plan that is running now).
   - Creation uses `planning.services.duplicate(source, week_start, copy_slots=True)` from E01-S03 unchanged: objective, audience, success metrics, goals and slots are copied; notes, carried findings and `source_report` are not; the result is a `draft`.
   - If duplication fails validation (for example the target week is more than eight weeks ahead), the response is `409 invalid_transition` with `details.reason = "cannot_create_plan"` and the underlying problem in `details.problem`.
6. `dry_run: true` performs rules 1–5 without writing and returns what would happen, including the other plans the operator may choose.

### What is written

7. For every finding with `accepted = true`, a carried finding is written to the target plan's `carried_findings` in report order. Its shape is the one E01-S01 reads: the finding without `accepted` and `evidence_publications`, plus `report_id` and `state`:

   ```json
   {
     "id": "f2",
     "report_id": 7,
     "type": "worked",
     "title": "The saves goal was too low",
     "detail": "Saves reached 512 against a goal of 400.",
     "recommendation": "Raise the weekly saves goal to 450.",
     "plan_field": "goals",
     "suggested_change": {"note": "Raise the weekly saves goal to 450", "metric": "saves", "scope": "week_total", "format": null, "target_value": 450},
     "state": "pending"
   }
   ```

8. New carried findings start with `state = pending`.
9. The plan's `source_report` is set to the report. The report's `applied_plan` is set to the plan.
10. Nothing else on the plan changes. Applying never edits `objective`, `audience_summary`, `audience_segments`, `success_metrics`, goals, slots or `notes`, on a draft plan or an active one. Those change only when a person applies a suggestion in the plan editor and saves.
11. Dismissed findings (`accepted = false`) are not carried.
12. Everything happens in one database transaction with the report row locked, so two simultaneous requests cannot create two plans.

### Applying again

13. Applying a report to the plan it is already applied to is allowed and idempotent: carried findings are matched by (`report_id`, `id`); existing ones keep their `state`; missing ones are added as `pending`; nothing is duplicated. Because an accepted report cannot change, the second call normally changes nothing and returns the same response with `changed = false`.
14. Applying a report that is already applied to a different plan returns `409 invalid_transition` with `details.reason = "already_applied"` and `details.applied_plan`. Moving findings between plans is out of scope.
15. If the plan a report was applied to has been deleted (only drafts can be deleted), `applied_plan` is null again and the report can be applied afresh.
16. A plan can carry findings from more than one report. Items keep their own `report_id`; `source_report` points to the report applied most recently.

### Contract with the plan editor

17. The plan editor (E01-S01) renders `carried_findings` and offers "Apply" and "Ignore" per item. The state change is sent as `carried_findings_state` in `PATCH /plans/{id}/`. This table is the contract for what "Apply" does with each `plan_field`; E01-S01 implements the form behaviour, this story guarantees the data.

   | `plan_field` | `suggested_change` | What "Apply" does in the plan form |
   | --- | --- | --- |
   | `objective` | `{"note"}` | Appends the recommendation to the Objective field |
   | `audience` | `{"note"}` | Appends the recommendation to the Audience summary field |
   | `notes` | `{"note"}` | Appends the recommendation to Notes |
   | `goals` | `{"note", "metric", "scope", "format", "target_value"}` | Adds a goal row pre-filled with the four values; if a goal with the same metric, scope and format exists, that row's target is replaced and highlighted |
   | `goals` | `{"note"}` only | Adds an empty goal row and shows the note beside it |
   | `slots` | `{"note"}` | Marks the finding applied; the operator changes slots on the Slots tab with the note in view |
   | `none` | `{"note"}` | Marks the finding as read |

18. In every case the operator still has to press "Save" in the plan editor. Until then nothing is stored, and "Undo" restores the finding to `pending`.
19. On an `active` plan, goals remain editable (E01-S01), so goal suggestions can be applied there too. Slot suggestions are always manual.

### Worked example

Report 7 belongs to plan 12 (week of 28 Nov, closed on 7 Dec). Plan 13 (week of 5 Dec) is `active`. No later plan exists. Today is 8 Dec in `Asia/Tehran`. The report has three accepted findings and two dismissed ones.

- Default target: no later draft exists → create one. Earliest later week without a plan that has not ended: 12 Dec. Source: plan 13.
- `duplicate(plan 13, 2026-12-12, copy_slots=True)` creates draft plan 14 with plan 13's objective, audience, goals and slots.
- Plan 14 gets three carried findings with `state = pending` and `source_report = 7`. Report 7 gets `applied_plan = 14`.
- Plan 13's goals and slots are untouched.

Had the operator chosen plan 13 in the dialog instead, the three findings would be added to plan 13 and no plan would be created.

## Data

Uses `WeeklyReport.applied_plan`, `WeeklyPlan.carried_findings`, `WeeklyPlan.source_report` as defined in [DATA-MODEL.md](../../DATA-MODEL.md). No new fields.

`WeeklyReport.applied_plan` and `WeeklyPlan.source_report` use `on_delete=SET_NULL`.

## API

### POST /api/v1/weekly-reports/{id}/apply-to-plan/

Permission: any signed-in user.

Request body (all fields optional):

```json
{"plan": null, "dry_run": false}
```

| Field | Rule |
| --- | --- |
| `plan` | Target plan ID. Omit or null for the default target |
| `dry_run` | Default false. True returns the outcome without writing |

Response `200` when the findings were written (or were already there):

```json
{
  "report": {"id": 7, "status": "accepted", "applied_plan": 14},
  "plan": {
    "id": 14,
    "title": "Week of 12 Dec",
    "week_start": "2026-12-12",
    "week_end": "2026-12-18",
    "status": "draft",
    "created": true,
    "duplicated_from": 13
  },
  "carried_findings": [
    {"id": "f1", "report_id": 7, "type": "worked", "title": "Evening reels reached far more people", "detail": "The two reels posted at 19:00 reached 8,900 and 8,400 people. The noon reel reached 4,100.", "recommendation": "Move the Sunday reel from 12:00 to 19:00.", "plan_field": "slots", "suggested_change": {"note": "Move the Sunday reel from 12:00 to 19:00"}, "state": "pending"},
    {"id": "f2", "report_id": 7, "type": "worked", "title": "The saves goal was too low", "detail": "Saves reached 512 against a goal of 400.", "recommendation": "Raise the weekly saves goal to 450.", "plan_field": "goals", "suggested_change": {"note": "Raise the weekly saves goal to 450", "metric": "saves", "scope": "week_total", "format": null, "target_value": 450}, "state": "pending"},
    {"id": "f3", "report_id": 7, "type": "insight", "title": "Stories with a question got replies", "detail": "", "recommendation": "End every story with a question.", "plan_field": "notes", "suggested_change": {"note": "End every story with a question"}, "state": "pending"}
  ],
  "added": 3,
  "changed": true
}
```

`carried_findings` lists only this report's items on the plan. `added` is the number written by this call.

Response `200` for `dry_run: true`:

```json
{
  "dry_run": true,
  "accepted_findings": 3,
  "target": {
    "plan": null,
    "will_create": true,
    "week_start": "2026-12-12",
    "week_end": "2026-12-18",
    "duplicate_from": {"id": 13, "title": "Week of 5 Dec", "status": "active"}
  },
  "eligible_plans": [
    {"id": 13, "title": "Week of 5 Dec", "week_start": "2026-12-05", "status": "active", "pending_findings": 0}
  ],
  "already_applied_plan": null
}
```

When a later draft exists, `target.plan` is its summary and `will_create` is false. `eligible_plans` lists every later `draft` or `active` plan of the account, earliest first.

Errors:

| Case | Response |
| --- | --- |
| Report not found | `404 not_found` |
| Report is `draft` | `409 invalid_transition`, `details.reason = "report_not_accepted"` |
| No accepted findings | `400 validation_error`, path `findings`, code `no_accepted_findings` |
| `plan` not found or in another account | `400 validation_error`, path `plan`, code `does_not_exist` |
| `plan` is not later than the report's week | `400 validation_error`, path `plan`, code `invalid` |
| `plan` is `closed` | `409 invalid_transition`, `details.reason = "plan_closed"` |
| Already applied to another plan | `409 invalid_transition`, `details.reason = "already_applied"`, `details.applied_plan = 14` |
| A new plan cannot be created | `409 invalid_transition`, `details.reason = "cannot_create_plan"`, `details.problem` |

### Related endpoints owned elsewhere

- `GET /plans/{id}/` returns `carried_findings` and `source_report` (E01-S01).
- `PATCH /plans/{id}/` with `carried_findings_state` changes a finding's `state` (E01-S01).
- `GET /weekly-reports/{id}/` returns `applied_plan` (E10-S02). This story extends it to an object: `{"id": 14, "title": "Week of 12 Dec", "week_start": "2026-12-12", "status": "draft", "finding_states": {"pending": 2, "applied": 1, "ignored": 0}}`, counting only this report's items.

## Background work

None. Applying is a synchronous request; it reads and writes a handful of rows.

## AI

None.

## Panel

### Report page: apply flow

On `/reports/:id`, when the report is `accepted` and `applied_plan` is null, the primary header action is "Apply to next plan". It is disabled with the tooltip "Accept at least one finding first" when no finding is accepted.

Clicking it calls the endpoint with `dry_run: true` and opens a modal titled "Apply findings to a plan":

- A line: "3 accepted findings will be added as suggestions. Nothing in the plan changes until you apply a suggestion there."
- A radio group "Add to":
  - The default target, pre-selected. When it will be created: "A new draft plan for the week of 12 Dec (copied from Week of 5 Dec)". When it exists: "Week of 12 Dec — draft".
  - One option per other entry in `eligible_plans`: "Week of 5 Dec — active (this week's plan)".
- Buttons: "Apply findings" (primary) and "Cancel".

Confirming calls the endpoint with the chosen `plan` (or none for the default). On success: message "3 findings added to Week of 12 Dec", then navigation to `/plans/14?findings=1`, which opens the Plan tab scrolled to the "Findings from last week" card.

### Report page: applied state

When `applied_plan` is set, the header action is replaced by a link button "Open plan — Week of 12 Dec", and an **Applied** card appears above the findings:

- "Applied to Week of 12 Dec (draft)" with the link.
- Three counters from `finding_states`: Pending, Applied, Ignored.
- Each accepted finding in the findings list shows a small state tag ("Pending in plan", "Applied in plan", "Ignored in plan"), read from the plan's `carried_findings` (`GET /plans/{id}/`), matched by `report_id` and `id`.
- A text button "Apply again" calls the endpoint for the same plan; it is only useful after a failure and shows "Findings are already in the plan" when `changed` is false.

### Reports list

On `/reports` the "Applied to" column shows the plan link, and the row menu gets "Apply to next plan" for accepted, unapplied reports (same modal).

### States and messages

| State | Display |
| --- | --- |
| Dry run loading | The button shows a loading state; the modal opens when the response arrives |
| `already_applied` | Message "This report is already applied to Week of 12 Dec." and the page reloads the report |
| `cannot_create_plan` | Inside the modal: "A new plan could not be created: {problem}. Choose an existing plan or create one in Weekly plan." with a link to `/plans` |
| `plan_closed` | "That plan was closed in the meantime. Choose another plan." and the options refresh |
| Other error | `notification` with the error text for the code and the `request_id` |
| Operator without accepted findings | Button disabled with tooltip |

## Acceptance criteria

1. Given an accepted report with three accepted and two dismissed findings and a later draft plan, when I apply it without naming a plan, then that draft has exactly three carried findings with `state = pending` and `report_id` of the report, its `source_report` is the report, and the report's `applied_plan` is the draft.
2. Given the worked example (next week's plan is active, no later plan), when I apply without naming a plan, then a new draft plan for the week of 12 Dec is created as a copy of the active plan, with the three findings carried, and the active plan is unchanged.
3. Given the same situation, when I apply with `plan` set to the active plan, then the findings are added to the active plan, no plan is created, and the active plan's goals and slots are unchanged.
4. Given `dry_run: true`, when I call the endpoint, then no row changes and the response names the target, whether it will be created, and the eligible plans.
5. Given a report already applied to plan 14 with one finding marked `applied` there, when I apply again to plan 14, then the response has `changed = false`, `added = 0`, and that finding is still `applied`.
6. Given a report applied to plan 14, when I apply it to plan 13, then I get `409` with reason `already_applied`.
7. Given a draft report, when I apply it, then I get `409` with reason `report_not_accepted`.
8. Given an accepted report whose findings are all dismissed, when I apply it, then I get `400` with code `no_accepted_findings`.
9. Given a carried finding with `plan_field = goals` and a full suggestion, when I press "Apply" in the plan editor and save, then the draft plan has that goal and the finding's state is `applied`; before saving, the plan is unchanged.
10. Given the draft plan a report was applied to is deleted, when I open the report, then `applied_plan` is null and "Apply to next plan" is available again.
11. In the panel, given I confirm the modal, then I land on the plan page with the findings card in view and a success message naming the plan.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E10-S03-BE1 | Target resolution | `analytics/services/apply_report.py`: `resolve_target(report, plan_id)` implementing rules 3–5 with the dry-run description; reuse of `planning.services.duplicate`; unit tests with a frozen clock for each branch | 0.5 |
| E10-S03-BE2 | Apply service | `apply_report(report, plan_id, dry_run)`: transaction and row lock, carried-finding snapshots, merge by (`report_id`, `id`), links, re-apply and already-applied rules, `SET_NULL` behaviour; tests | 0.5 |
| E10-S03-BE3 | Endpoint and contract | View action, request and response serializers, all error cases, `applied_plan` object with `finding_states` on the report detail, `openapi.yaml`; API tests including the plan-editor round trip through `carried_findings_state` | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E10-S03-FE1 | Apply modal | Dry-run call, target options, confirm, success navigation to `/plans/:planId?findings=1`, error handling inside the modal | 0.5 |
| E10-S03-FE2 | Applied state on the report | Header link button, Applied card with counters, per-finding state tags from the plan, "Apply again" | 0.5 |
| E10-S03-FE3 | List integration and deep link | "Applied to" column and row action on `/reports`; `findings=1` handling on the plan page (scroll to and expand the findings card); tests for the modal and tags | 0.5 |

### Test

None beyond the tests in each subtask.

## Test notes

- Service tests cover: later draft exists; only an active later plan exists; no later plan; next free week has ended; explicit active plan; explicit closed plan; duplication failure.
- A concurrency test sends two apply requests at once and asserts one plan is created.
- A round-trip API test: apply → `PATCH /plans/{id}/` with `carried_findings_state` → `GET /weekly-reports/{id}/` shows the updated `finding_states`.
- Contract test: every `plan_field` value produced by E10-S02's schema appears in the table of rule 17.

## Later

- Structured slot suggestions (`{"action": "move", "weekday", "from", "to"}`) so "Apply" can change a draft plan's slots; the `suggested_change` object has room for the keys.
- An autopilot switch that applies goal suggestions to draft plans automatically.
- A reminder on the new-plan dialog when an accepted report has not been applied.
