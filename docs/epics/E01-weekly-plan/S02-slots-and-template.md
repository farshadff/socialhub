# E01-S02 — Posting slots and slot template

| | |
| --- | --- |
| Epic | E01 Weekly plan |
| Priority | Must |
| Estimate | BE 1.5 d · FE 2 d |
| Depends on | E01-S01 |
| Needed by | E01-S03, E03-S03, E04-S02, E08-S01, E08-S02 |

## User story

As an operator, I want to define when each Reel, Story and feed post goes out this week, so that selection knows how many pieces to prepare and scheduling knows when each one is due.

## Context

A slot is one planned post: a time and a format, optionally with a role. Selection (E03-S03) fills open slots with content items, and scheduling (E08-S01) publishes each item at its slot's time. Most weeks look alike, so the account keeps a slot template — its usual week — and a plan's slots are generated from it and then adjusted.

## Scope

**In**

- Read and replace the account's slot template.
- Generate a plan's slots from the template.
- Add, change, skip and remove slots in a plan.
- Enforce the account's posting rules on slots.
- A week grid on the plan's Slots tab.

**Out (later)**

- Suggested best times from performance data.
- Recurring exceptions (holidays).
- Drag and drop between days. The MVP edits time in a form.

## Behaviour and rules

### Slot template

1. The template is a list of rows: weekday (0 = Monday … 6 = Sunday), local time, format, optional default role, active flag.
2. `PUT` replaces the whole list. At most 40 rows. No two rows share weekday, local time and format.
3. `local_time` is `HH:MM` in the account's timezone, in 5-minute steps.
4. The template must respect the account's `posting_rules`, counting active rows only:

   | Rule | Check | Field error code |
   | --- | --- | --- |
   | Daily limit for reels and feed posts | Rows with format `reel` or `feed_post` on one weekday ≤ `max_feed_per_day` | `exceeds_daily_limit` |
   | Daily limit for stories | Rows with format `story` on one weekday ≤ `max_stories_per_day` | `exceeds_daily_limit` |
   | Minimum gap | Any two reel or feed-post rows on the same weekday are at least `min_gap_minutes` apart | `gap_too_small` |

   Stories are exempt from the gap rule.

### Generating slots

5. `POST /plans/{id}/slots/generate/` creates one `PlanSlot` per active template row. The slot's date is the day of the plan week with that weekday; its `scheduled_at` is that date and `local_time` converted from the account's timezone to UTC with the timezone database, so daylight-saving changes are handled.
6. A row is skipped when a slot with the same `scheduled_at` and format already exists in the plan, or when its time is less than 30 minutes in the future.
7. With `"replace": true`, slots with status `open` are deleted first. Slots in any other status are never touched.
8. Generation is allowed for `draft` and `active` plans. It returns the counts and the plan's full slot list.
9. Creating a plan with `generate_slots: true` (E01-S01) calls the same service.

### Slots in a plan

10. A plan has at most 60 slots.
11. `scheduled_at` must fall inside the plan week in the account's timezone (from 00:00 on `week_start` to 23:59 on `week_end`) and be at least 30 minutes in the future when created or moved.
12. The posting rules in rule 4 apply to a plan's slots per calendar day in the account's timezone, ignoring `skipped` slots.
13. New slots have status `open`. Status changes made by other stories: `open` → `reserved` when selection assigns an item (E03-S03); `reserved` → `scheduled` when a publication is created (E08-S01); `scheduled` → `published` when the publication is marked published (E08-S05; in Phase 2 also by the publish worker, E08-S03). When its item is cancelled or rejected, the slot is released (E03-S04 cancel rule): back to `open` if its time is still in the future, otherwise `skipped`.
14. What an operator can change through this story:

    | Slot status | `scheduled_at` | `format` | `role`, `note` | Skip / unskip | Delete |
    | --- | --- | --- | --- | --- | --- |
    | `open` | Yes | Yes | Yes | Yes | Yes |
    | `skipped` | Yes | Yes | Yes | Yes | Yes |
    | `reserved` | Yes | No | Yes | No | No |
    | `scheduled` | No — use reschedule in E08-S02 | No | `note` only | No | No |
    | `published` | No | No | `note` only | No | No |

    A disallowed change returns `409 invalid_transition` with the slot's status in `details`.
15. Slots of a `closed` plan are read-only.
16. Moving a `reserved` slot keeps its content item. The item's brief and script are not affected.

## Data

Uses `SlotTemplate` and `PlanSlot` from [DATA-MODEL.md](../../DATA-MODEL.md). No new fields. Database constraints: unique (`account`, `weekday`, `local_time`, `format`) on the template; unique (`plan`, `scheduled_at`, `format`) on slots.

## API

Both roles may use every endpoint in this story.

### `GET /api/v1/accounts/{id}/slot-template/`

```json
{
  "account": 3,
  "timezone": "Asia/Tehran",
  "rows": [
    {"id": 1, "weekday": 5, "local_time": "19:00", "format": "reel", "default_role": "attract", "active": true},
    {"id": 2, "weekday": 5, "local_time": "10:00", "format": "story", "default_role": "engage", "active": true},
    {"id": 3, "weekday": 0, "local_time": "12:30", "format": "feed_post", "default_role": "educate", "active": true},
    {"id": 4, "weekday": 2, "local_time": "19:00", "format": "reel", "default_role": null, "active": false}
  ]
}
```

An account without a template returns `rows: []`.

### `PUT /api/v1/accounts/{id}/slot-template/`

Body: `{"rows": [...]}` with the same row shape without `id`. Returns `200` with the stored template. Validation errors use paths such as `rows.3.local_time`.

### `POST /api/v1/plans/{id}/slots/generate/`

```json
{"replace": false}
```

```json
{
  "created": 9,
  "skipped": 1,
  "deleted": 0,
  "slots": [ /* full slot list, shape below */ ]
}
```

| Case | Response |
| --- | --- |
| Plan is closed | `409 invalid_transition` |
| Account has no active template rows | `400 validation_error`, code `no_template` |
| Result would exceed 60 slots | `400 validation_error`, code `max_slots` |

### `GET /api/v1/plans/{id}/slots/`

Filters: `status`, `format`. Ordered by `scheduled_at`. Page size 100 so one page holds the whole week.

```json
{
  "count": 2,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 201,
      "plan": 12,
      "scheduled_at": "2026-11-28T06:30:00Z",
      "local_date": "2026-11-28",
      "local_time": "10:00",
      "weekday": 5,
      "format": "story",
      "role": "engage",
      "status": "open",
      "note": "",
      "content_item": null
    },
    {
      "id": 202,
      "plan": 12,
      "scheduled_at": "2026-11-28T15:30:00Z",
      "local_date": "2026-11-28",
      "local_time": "19:00",
      "weekday": 5,
      "format": "reel",
      "role": "attract",
      "status": "reserved",
      "note": "",
      "content_item": {"id": 88, "title": "Three ways to style a small entryway", "status": "briefed"}
    }
  ]
}
```

`local_date`, `local_time` and `weekday` are computed in the account's timezone for display.

### `POST /api/v1/plans/{id}/slots/`

```json
{"scheduled_at": "2026-11-30T09:00:00Z", "format": "feed_post", "role": "educate", "note": ""}
```

The panel may send `local_date` and `local_time` instead of `scheduled_at`; the server converts. Returns `201` with the slot.

| Case | Response |
| --- | --- |
| Outside the plan week | `400 validation_error`, field `scheduled_at`, code `outside_week` |
| Less than 30 minutes ahead | `400 validation_error`, field `scheduled_at`, code `too_soon` |
| Same time and format exists | `400 validation_error`, field `scheduled_at`, code `unique` |
| Daily limit or gap broken | `400 validation_error`, field `scheduled_at`, code `exceeds_daily_limit` or `gap_too_small` |
| 60 slots already | `400 validation_error`, code `max_slots` |
| Plan closed | `409 invalid_transition` |

### `PATCH /api/v1/slots/{id}/`

Any of `scheduled_at` (or `local_date` + `local_time`), `format`, `role`, `note`, `status` (`open` or `skipped` only). Returns `200` with the slot. Same validation as create, plus the table in rule 14.

### `DELETE /api/v1/slots/{id}/`

`204` for `open` and `skipped` slots; `409 invalid_transition` otherwise.

## Background work

None. Generation runs inside the request; it creates at most 40 rows.

## AI

None.

## Panel

### Plan editor — `/plans/:planId`, tab Slots

Toolbar: "Add slot", "Generate from template" (with a dropdown item "Replace open slots"), "Edit template". A summary line reads, for example, "9 slots · 3 reels · 4 stories · 2 feed posts · 2 filled".

**Week grid.** Seven columns, starting on the account's first weekday, each headed by weekday and date. Each slot is a small card placed in time order:

- Time (account timezone), a format icon with label (Reel, Story, Feed post), a role tag when set, the slot's `StatusTag`.
- When reserved or later: the content item's title as a link to `/content/{id}` and the item's `StatusTag`.
- A menu with the actions allowed by rule 14: Edit, Skip or Restore, Delete.
- Skipped slots are shown dimmed with the label "Skipped".
- Days in the past are dimmed; past open slots carry the hint "Time has passed".

Below 1200 px the grid becomes a list grouped by day.

**Add or edit slot** (`Modal` form (`useModalForm`)): Date (limited to the plan week), Time (5-minute steps), Format (select; disabled for reserved slots), Role (optional select with one-line explanations), Note. Submit labels "Add slot" and "Save slot". API field errors appear under the field, for example "This would be the third feed post or reel that day. The account allows 2."

**Generate from template.** Calls generate and shows "9 slots created, 1 skipped". "Replace open slots" asks: "Delete the 6 open slots and generate again? Reserved and scheduled slots are kept." When the account has no template, the button opens the template drawer with the message "Set up the usual week first."

**Edit template** (`Drawer`): an editable table with columns Weekday, Time, Format, Default role, Active, remove. "Add row" appends a row. "Save template" sends the whole list. The drawer states the account's limits above the table: "Up to 2 reels or feed posts and 5 stories per day, at least 120 minutes apart." Saving the template does not change existing plans; a note says so.

States: skeleton grid while loading; empty state "No slots yet. Generate them from the usual week or add one." with both buttons; closed plan shows the grid read-only.

## Acceptance criteria

1. Given an account in `Asia/Tehran` with a template row Saturday 19:00 reel, when I generate slots for the plan starting 2026-11-28, then a reel slot exists with `scheduled_at` 2026-11-28T15:30:00Z.
2. Given a template with three active reel rows on one weekday and `max_feed_per_day` 2, when I save the template, then I get `exceeds_daily_limit` on the third row.
3. Given two template rows for a reel at 12:00 and a feed post at 13:00 on the same weekday with `min_gap_minutes` 120, when I save, then I get `gap_too_small`.
4. Given a plan with generated slots, when I generate again without `replace`, then no duplicates are created and `skipped` equals the number of template rows.
5. Given a plan with four open and two reserved slots, when I generate with `replace: true`, then the open slots are replaced and the two reserved slots are unchanged.
6. Given a slot whose time is 10 minutes from now, when I create it, then I get `too_soon`.
7. Given a reserved slot, when I change its time to another valid time, then it is saved and its content item is unchanged; when I change its format, then I get `409 invalid_transition`.
8. Given a scheduled slot, when I change its time through this endpoint, then I get `409 invalid_transition`.
9. Given an open slot, when I skip it, then its status is `skipped` and it no longer counts toward the daily limit or readiness.
10. Given a plan with 60 slots, when I add one, then I get `max_slots`.
11. In the panel, given I open the Slots tab of a new plan for an account with a template, then I see the generated slots in a week grid starting on the account's first weekday.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E01-S02-BE1 | Models and migration | `SlotTemplate`, `PlanSlot` with unique constraints and indexes on (`plan`, `scheduled_at`) | 0.25 |
| E01-S02-BE2 | Template endpoints | `GET`/`PUT` with whole-list replace and posting-rule validation in `planning.services.slot_rules` | 0.25 |
| E01-S02-BE3 | Slot generation | `planning.services.generate_slots(plan, replace)` with timezone conversion, skip and replace logic; endpoint; hook from plan creation | 0.5 |
| E01-S02-BE4 | Slot create, update, delete | Serializer accepting `scheduled_at` or local date and time; status-based permission table; daily-limit and gap checks per local day | 0.25 |
| E01-S02-BE5 | Contract and tests | OpenAPI additions; tests for timezone conversion (including a daylight-saving zone), every validation code, the rule 14 matrix | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E01-S02-FE1 | Week grid | `SlotWeekGrid` component: day columns from `week_start_day`, slot cards, responsive list fallback, summary line | 1 |
| E01-S02-FE2 | Slot modal and actions | Add and edit form, skip, restore, delete with confirmations and API error mapping | 0.5 |
| E01-S02-FE3 | Template drawer and generate | Editable template table, save, generate and replace flows with result messages | 0.5 |

### Test

None beyond the tests inside each subtask.

## Test notes

- Unit tests for `generate_slots`: timezone with a half-hour offset (`Asia/Tehran`), a zone with daylight saving across the plan week (`Europe/Berlin`, last week of March), the skip rules, replace.
- API tests for each error code and for the status matrix.
- Panel tests: grid renders seven days from the right start day; error under the time field for a gap violation.

## Later

- `SlotTemplate` can gain a `score` per row from E10 data to recommend times.
- Slot `role` is a hint today; selection can later weigh it more heavily.
- Drag and drop can call the same `PATCH`.
