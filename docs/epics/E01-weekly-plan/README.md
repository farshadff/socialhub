# E01 — Weekly plan

Workflow step 01: **Set the weekly plan — audience, goals, slots, and success metrics.**

## Goal

An operator creates one plan per Instagram account per week. The plan says who the week speaks to, what it should achieve in numbers, when posts go out and in which format, and which metrics decide whether the week worked. Every later step reads the plan: research and selection use the objective, audience and goals; scheduling uses the slots; evaluation compares results with the goals.

## Scope

**In the MVP**

- One plan per account per week, with statuses draft, active and closed.
- Objective, audience summary and segments, success metrics, numeric goals per metric.
- Posting slots for the week, created by hand or generated from the account's slot template.
- Activate, close and duplicate a plan. Plans close themselves two days after the week ends.
- A panel in the plan editor that shows findings carried over from last week's report (the data arrives through E10-S03).

**Left for later**

- AI-drafted plans. The findings loop pre-fills the next plan; a person still writes it.
- Month or campaign plans spanning several weeks.
- Per-slot audience or goal overrides.
- Approval workflow between roles.

## Stories

| ID | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E01-S01](S01-create-and-edit-plan.md) | Create and edit the weekly plan | Must | 2 | 2.5 | |
| [E01-S02](S02-slots-and-template.md) | Posting slots and slot template | Must | 1.5 | 2 | |
| [E01-S03](S03-plan-lifecycle.md) | Activate, close and duplicate a plan | Must | 1 | 1 | |

## Flow

1. The operator opens Weekly plan, chooses "New plan" and picks a week. The plan starts as a draft, pre-filled with the brand profile's audience and, if a slot template exists, the week's slots.
2. They write the objective, adjust the audience, tick the success metrics and enter a goal for each.
3. On the Slots tab they adjust the generated slots or add their own.
4. When the readiness checklist is clear they activate the plan. Research (E02) and selection (E03) can now run against it.
5. After the week ends the plan closes, which triggers the weekly report (E10-S02). Next week's plan can be started by duplicating this one; accepted findings arrive in it through E10-S03.

## Owns

| Kind | Items |
| --- | --- |
| Tables | `WeeklyPlan`, `PlanGoal`, `SlotTemplate`, `PlanSlot` |
| Endpoints | Everything under "E01 Weekly plan" in [API.md](../../API.md) |
| Panel | `/plans`, `/plans/:planId` (tabs Plan, Slots) |
| Background tasks | `planning.close_finished_plans` (daily) |
| Signals | `plan_activated`, `plan_closed` |
| AI tasks | None |

## Depends on / needed by

- Depends on: E00-S01 (sign-in), E00-S02 (panel shell), E00-S03 (accounts and brand profile).
- Needed by: E02-S02 (research runs for a plan), E03-S02 and E03-S03 (candidates and slots), E08-S01 (scheduling into slots), E10-S01 (goals), E10-S02 (report on close), E10-S03 (carried findings).

## Done when

An operator can create a plan for next week with an objective, audience, three success metrics with goals and nine slots generated from the template, activate it, see it as the working plan on other pages, and later close it or let it close itself. Invalid input is rejected with field-level errors, and a second plan for the same week cannot be created.

## Later

- `WeeklyPlan` already has a `status` field and timestamps; an approval step is one more status.
- Goals are rows, so new metrics or scopes (per role, per slot) are added without changing the plan table.
- Slot generation is one service function; it can later take performance data to propose better times.
