# E08-S02 — Calendar and manual controls

| | |
| --- | --- |
| Epic | E08 Schedule and publish |
| Priority | Must |
| Estimate | BE 1.5 d · FE 4 d · QA 0 d |
| Depends on | E08-S01, E00-S02, E00-S06, E01-S02, E03-S04 |
| Needed by | E08-S03, E08-S04, E11-S01 |

## User story

As an operator, I want to see the week's slots and publications on one calendar and move or cancel a publication when plans change, so that I stay in control of what goes out and when without leaving the automatic flow.

## Context

Scheduling is automatic (E08-S01), so most weeks the operator only looks. The calendar answers three questions: what is going out and when, which slots are still empty, and what is stuck. The controls here are the ones that only change the schedule: reschedule and cancel. Sending-related controls (publish now, retry, mark as published) are specified in E08-S03 and E08-S04 and appear in the same places.

## Scope

**In:**

- `GET /publications/`, `GET /publications/{id}/`, `GET /calendar/`.
- `POST /publications/{id}/reschedule/`, `POST /publications/{id}/cancel/`.
- `/calendar` page with a week view and a list view.
- The Publishing tab of `/content/:id`.

**Out (later):**

- Drag-and-drop rescheduling, month view, multi-account calendar.
- Editing slots from the calendar (slots are edited in the plan, E01-S02).
- Bulk reschedule or cancel.

## Behaviour and rules

### Reading

1. `GET /publications/` requires `account`. Filters: `status` (comma-separated), `format`, `delivery`, `blocked` (`true` returns rows with a `blocked_reason`), `content_item`, `from` and `to` (dates in the account timezone, inclusive, applied to the effective time: `published_at` when published, else `scheduled_at`). Ordering: `scheduled_at` (default), `-scheduled_at`, `published_at`, `-published_at`.
2. `GET /publications/{id}/` adds `attempts` (all `PublishAttempt` rows, oldest first; empty until E08-S03 writes them).
3. Every publication carries `allowed_actions`, computed on the server from status, lease, delivery and the caller's role. The panel shows a control only when its action is listed. Values: `reschedule`, `cancel`, `publish_now`, `retry`, `mark_published`.

| Action | Allowed when |
| --- | --- |
| `reschedule` | `status = scheduled`, not leased, `attempt_count = 0` |
| `cancel` | `status` is `scheduled` (not leased) or `failed` |
| `publish_now` | `status = scheduled`, not leased, `delivery = provider` (E08-S03) |
| `retry` | `status = failed` and `container_status` is not `PUBLISHED` (E08-S04; a published container means the post already exists) |
| `mark_published` | `status` is `scheduled`, `failed`, or `verifying` without an active lease (E08-S04) |

"Leased" means `lease_expires_at` is in the future.

4. `in_flight` is true while a lease is active. Lease fields themselves are not exposed.
5. `GET /calendar/` requires `account`, `from` and `to` (dates in the account timezone, inclusive). The range may be at most 42 days; a longer range returns `400 validation_error` on `to`. The response is not paginated.
6. Calendar entries merge slots and publications:
   - A slot with no content item, or with an item that has no live publication, is an entry of `kind = slot` at `slot.scheduled_at`. Slots with status `skipped` are included and marked.
   - A publication in any status except `cancelled` is an entry of `kind = publication` at its effective time. If it holds a slot, the slot is embedded and no separate slot entry is returned.
   - A `cancelled` publication is not returned; its slot, if still `reserved`, appears as a slot entry.
   - Entries are sorted by `at`, then by `kind` (`slot` first).
7. The calendar response includes per-day counts for the two sequencing groups (publications counted as in E08-S01 rule 11; slots without a publication are not counted) so the panel can show "2 of 2 feed posts" without recomputing rules.

### Reschedule

8. Body is exactly one of `{"scheduled_at": "<UTC timestamp>"}` or `{"slot": <id>}`. Both or neither returns `400 validation_error`.
9. Allowed only when `reschedule` is in `allowed_actions`; otherwise `409 invalid_transition` with `details.status` and `details.allowed_actions`.
10. With `scheduled_at`: the time must be at least `SOCIALHUB_PUBLISH_MIN_LEAD_MINUTES` (10) minutes from now and at most 30 days from now. The publication's slot, if any, is released to `open`; `Publication.slot` and `ContentItem.slot` become null.
11. With `slot`: the slot must belong to the same account, have `status = open`, the same `format` as the publication, and a time at least 10 minutes from now. The old slot is released to `open`; the new slot becomes `scheduled`; `ContentItem.slot` points to it.
12. The sequencing check of E08-S01 (daily limit, minimum gap) runs against the new time, ignoring the publication's own current time. A failure returns `400 validation_error` on the field sent, with field code `daily_limit`, `min_gap` or `too_soon`.
13. On success: `scheduled_at` is updated, `blocked_reason` and `next_attempt_at` are cleared, a `ContentEvent` of type `edited` records old and new times and the user. The item's status stays `scheduled`.
14. Reschedule is implemented by calling `schedule_item(item, at=…)` or `schedule_item(item, slot=…)` from E08-S01 in "move" mode, so the rules live in one place.

### Cancel

15. Body: `{"reason": "<text>"}`, 3 to 500 characters, required.
16. Allowed when `cancel` is in `allowed_actions`; otherwise `409 invalid_transition`. A publication that is being sent (`in_flight`) returns `409 job_in_progress`.
17. A publication is one-to-one with its item, so cancelling the publication cancels the item: `Publication.status = cancelled`; the item moves to `cancelled` through the pipeline service with `cancelled_reason` set; the slot is released by the E03-S04 cancel rule (`open` if its time is still in the future, otherwise `skipped`) and `ContentItem.slot` is cleared; any open `ReviewTask` for this publication is resolved with `decision = reject` and the reason as `decision_note`. To keep the item and only change the time, the operator uses reschedule.
18. `POST /content-items/{id}/cancel/` (E03-S04) calls the same service when the item has a publication, so both routes behave identically.

### Permissions

19. Operators and admins can read, reschedule and cancel. Nothing in this story is admin-only.

## Data

`Publication`, `PublishAttempt`, `PlanSlot`, `ContentItem`, `ContentVersion`, `Asset`, `ReviewTask`, `ContentEvent` as in [DATA-MODEL.md](../../DATA-MODEL.md). No new fields beyond `Publication.delivery` from E08-S01.

## API

### `GET /publications/?account=1&from=2026-11-21&to=2026-11-27&status=scheduled,published`

Permission: signed in.

```json
{
  "count": 2,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 31,
      "account": 1,
      "content_item": {"id": 42, "title": "Three mistakes first-time buyers make", "status": "scheduled", "role": "educate"},
      "slot": {"id": 77, "scheduled_at": "2026-11-23T15:30:00Z", "status": "scheduled"},
      "content_version": {
        "id": 58,
        "version": 2,
        "caption": "سه اشتباه رایج در خرید خانه اول که می‌شود از آن‌ها دور ماند.",
        "hashtags": ["خانه_اول", "مشاوره_املاک"],
        "final_asset": {"id": 310, "kind": "video", "mime": "video/mp4", "bytes": 18230511, "width": 1080, "height": 1920, "duration_ms": 28000, "url": "/media/accounts/1/2026/11/310-three-mistakes.mp4"},
        "cover_asset": {"id": 311, "kind": "image", "mime": "image/jpeg", "bytes": 240112, "width": 1080, "height": 1920, "duration_ms": null, "url": "/media/accounts/1/2026/11/311-cover.jpg"}
      },
      "format": "reel",
      "delivery": "provider",
      "scheduled_at": "2026-11-23T15:30:00Z",
      "status": "scheduled",
      "blocked_reason": null,
      "in_flight": false,
      "attempt_count": 0,
      "max_attempts": 3,
      "next_attempt_at": null,
      "full_caption": "سه اشتباه رایج در خرید خانه اول که می‌شود از آن‌ها دور ماند.\n\n#خانه_اول #مشاوره_املاک",
      "remote_container_id": null,
      "container_status": null,
      "container_created_at": null,
      "remote_media_id": null,
      "remote_shortcode": null,
      "permalink": null,
      "published_at": null,
      "published_via": null,
      "next_metrics_checkpoint": null,
      "next_metrics_at": null,
      "allowed_actions": ["reschedule", "cancel", "publish_now", "mark_published"],
      "created_at": "2026-11-22T10:14:03Z",
      "updated_at": "2026-11-22T10:14:03Z"
    },
    {
      "id": 29,
      "account": 1,
      "content_item": {"id": 39, "title": "Market snapshot: November", "status": "published", "role": "attract"},
      "slot": {"id": 74, "scheduled_at": "2026-11-21T08:30:00Z", "status": "published"},
      "content_version": {
        "id": 51,
        "version": 1,
        "caption": "بازار آبان در یک نگاه.",
        "hashtags": ["بازار_مسکن"],
        "final_asset": {"id": 290, "kind": "image", "mime": "image/jpeg", "bytes": 512330, "width": 1080, "height": 1350, "duration_ms": null, "url": "/media/accounts/1/2026/11/290-market-snapshot.jpg"},
        "cover_asset": null
      },
      "format": "feed_post",
      "delivery": "provider",
      "scheduled_at": "2026-11-21T08:30:00Z",
      "status": "published",
      "blocked_reason": null,
      "in_flight": false,
      "attempt_count": 1,
      "max_attempts": 3,
      "next_attempt_at": null,
      "full_caption": "بازار آبان در یک نگاه.\n\n#بازار_مسکن",
      "remote_container_id": "17951234567012345",
      "container_status": "PUBLISHED",
      "container_created_at": "2026-11-21T08:30:09Z",
      "remote_media_id": "18047391520683214",
      "remote_shortcode": "DCx1AbCdEfG",
      "permalink": "https://www.instagram.com/p/DCx1AbCdEfG/",
      "published_at": "2026-11-21T08:30:41Z",
      "published_via": "provider",
      "next_metrics_checkpoint": "72h",
      "next_metrics_at": "2026-11-24T08:30:41Z",
      "allowed_actions": [],
      "created_at": "2026-11-20T16:02:11Z",
      "updated_at": "2026-11-22T08:31:02Z"
    }
  ]
}
```

Errors: `400 validation_error` on `account` when missing; on `from`/`to` when not dates or `from > to`.

### `GET /publications/{id}/`

Same object plus `attempts`:

```json
{
  "id": 29,
  "…": "all fields of the list item",
  "attempts": [
    {
      "id": 61,
      "number": 1,
      "provider": "graph_api",
      "started_at": "2026-11-21T08:30:07Z",
      "finished_at": "2026-11-21T08:30:43Z",
      "outcome": "success",
      "error_code": null,
      "error_message": null,
      "verification": null
    }
  ]
}
```

Errors: `404 not_found`.

### `GET /calendar/?account=1&from=2026-11-21&to=2026-11-27`

Permission: signed in.

```json
{
  "account": 1,
  "timezone": "Asia/Tehran",
  "from": "2026-11-21",
  "to": "2026-11-27",
  "publishing_enabled": true,
  "posting_rules": {"min_gap_minutes": 120, "max_feed_per_day": 2, "max_stories_per_day": 5, "max_revisions": 2},
  "days": [
    {"date": "2026-11-21", "feed_count": 1, "story_count": 0},
    {"date": "2026-11-22", "feed_count": 0, "story_count": 0},
    {"date": "2026-11-23", "feed_count": 1, "story_count": 0},
    {"date": "2026-11-24", "feed_count": 0, "story_count": 0},
    {"date": "2026-11-25", "feed_count": 0, "story_count": 0},
    {"date": "2026-11-26", "feed_count": 0, "story_count": 0},
    {"date": "2026-11-27", "feed_count": 0, "story_count": 0}
  ],
  "entries": [
    {
      "kind": "publication",
      "at": "2026-11-21T08:30:41Z",
      "date": "2026-11-21",
      "format": "feed_post",
      "slot": {"id": 74, "scheduled_at": "2026-11-21T08:30:00Z", "status": "published", "role": "attract"},
      "content_item": {"id": 39, "title": "Market snapshot: November", "status": "published", "role": "attract"},
      "publication": {"id": 29, "status": "published", "delivery": "provider", "scheduled_at": "2026-11-21T08:30:00Z", "published_at": "2026-11-21T08:30:41Z", "blocked_reason": null, "in_flight": false, "attempt_count": 1, "next_attempt_at": null, "permalink": "https://www.instagram.com/p/DCx1AbCdEfG/", "thumbnail_url": "/media/accounts/1/2026/11/290-market-snapshot.jpg", "allowed_actions": []}
    },
    {
      "kind": "slot",
      "at": "2026-11-22T15:30:00Z",
      "date": "2026-11-22",
      "format": "story",
      "slot": {"id": 75, "scheduled_at": "2026-11-22T15:30:00Z", "status": "reserved", "role": "engage"},
      "content_item": {"id": 40, "title": "Poll: rent or buy?", "status": "in_production", "role": "engage"},
      "publication": null
    },
    {
      "kind": "publication",
      "at": "2026-11-23T15:30:00Z",
      "date": "2026-11-23",
      "format": "reel",
      "slot": {"id": 77, "scheduled_at": "2026-11-23T15:30:00Z", "status": "scheduled", "role": "educate"},
      "content_item": {"id": 42, "title": "Three mistakes first-time buyers make", "status": "scheduled", "role": "educate"},
      "publication": {"id": 31, "status": "scheduled", "delivery": "provider", "scheduled_at": "2026-11-23T15:30:00Z", "published_at": null, "blocked_reason": null, "in_flight": false, "attempt_count": 0, "next_attempt_at": null, "permalink": null, "thumbnail_url": "/media/accounts/1/2026/11/311-cover.jpg", "allowed_actions": ["reschedule", "cancel", "publish_now", "mark_published"]}
    },
    {
      "kind": "slot",
      "at": "2026-11-26T08:30:00Z",
      "date": "2026-11-26",
      "format": "feed_post",
      "slot": {"id": 80, "scheduled_at": "2026-11-26T08:30:00Z", "status": "open", "role": null},
      "content_item": null,
      "publication": null
    }
  ]
}
```

`date` is the entry's calendar date in the account timezone. `thumbnail_url` is the cover asset for reels, the final asset for images, and the first frame asset for video stories when one exists.

Errors: `400 validation_error` on `account`, `from`, `to` (missing, malformed, `from > to`, range over 42 days).

### `POST /publications/{id}/reschedule/`

Permission: signed in. Request, one of:

```json
{"scheduled_at": "2026-11-24T15:30:00Z"}
```

```json
{"slot": 80}
```

Response `200`: the publication object as in `GET /publications/{id}/`.

| Case | Response |
| --- | --- |
| Both or neither field sent | `400 validation_error`, field `non_field_errors`, code `invalid` |
| Time less than 10 minutes away or in the past | `400 validation_error`, field `scheduled_at`, code `too_soon` |
| Time more than 30 days away | `400 validation_error`, field `scheduled_at`, code `max_value` |
| Day already at its limit | `400 validation_error`, field `scheduled_at` or `slot`, code `daily_limit` |
| Closer than the minimum gap to another feed post or reel | `400 validation_error`, field `scheduled_at` or `slot`, code `min_gap` |
| Slot of another account, not `open`, or another format | `400 validation_error`, field `slot`, code `invalid` |
| Status does not allow it | `409 invalid_transition`, `details: {"status": "publishing", "allowed_actions": []}` |

### `POST /publications/{id}/cancel/`

Permission: signed in. Request:

```json
{"reason": "Campaign postponed to next month"}
```

Response `200`: the publication object with `status: "cancelled"`, `content_item.status: "cancelled"`, `slot: null`, `allowed_actions: []`.

| Case | Response |
| --- | --- |
| `reason` missing or shorter than 3 characters | `400 validation_error`, field `reason` |
| Being sent right now | `409 job_in_progress`, `details.job` holds the active job |
| Already published or cancelled | `409 invalid_transition` |

## Background work

None.

## AI

None.

## Panel

### `/calendar`

Layout: `PageContainer` titled "Calendar" with the description "Slots and publications for the selected account." Primary area is a `ProCard`.

**Toolbar (top of the card, left to right):**

- Week navigation: buttons "Previous week", "This week", "Next week" and the range label, for example "21 – 27 Nov 2026". Weeks start on the account's `week_start_day`.
- `Segmented` control: "Week" | "List".
- Filters: Format (`Select`, multiple: Reel, Story, Feed post), Show (`Select`: All, Publications only, Open slots only, Needs attention).
- Right side: text "Times in Asia/Tehran" (the account timezone).

**Banner:** when `publishing_enabled` is false, an `Alert` of type warning above the grid: "Publishing is off for this account. Nothing will be sent to Instagram until it is turned on." Admins see a link button "Turn publishing on" that calls `PATCH /accounts/{id}/` (E00-S03) after `Modal.confirm` ("Turn publishing on for @handle? Publications that are more than 2 hours late will be moved to a new time instead of being sent at once.").

**Week view:** seven equal columns, one per day, header "Sat 21" with two small counters from `days`: "Feed 1/2" and "Stories 1/5" (counter turns warning colour when at the limit). Each entry is a compact card, sorted by time:

| Element | Content |
| --- | --- |
| Time | `DateTime` in account time, "19:00". For published entries the actual time |
| Format | Icon with text: Reel, Story, Feed post |
| Title | Item title through `ContentText`, one line, ellipsis. For an empty slot: "Open slot" in secondary text |
| Status | `StatusTag` of the publication status, or of the item status for a reserved slot, or "Open" for an empty slot |
| Flags | Tag "Publishing off", "Connection problem" or "Daily limit" when `blocked_reason` is `publishing_paused`, `connection_problem` or `daily_limit`; tag "Post by hand" when `delivery = manual`; tag "Retry 2 of 3" when `attempt_count > 0` and status is `scheduled` (E08-S04 adds "Processing" and "Verifying") |
| Thumbnail | 40 px, cropped to the format's aspect ratio, when `thumbnail_url` exists |

Clicking a card opens the entry drawer. An open slot's card links to `/selection` ("Fill this slot"). Today's column has a highlighted header. Days outside the selected plan week are not shown; the view always shows exactly one week.

**List view:** `ProTable` over `GET /publications/` for the same week. Columns: Time, Format, Item (link to `/content/:id`), Status, Delivery, Attempts ("1 of 3"), Blocked, Link (permalink icon). Row action: "Open". Server-side paging and the same filters.

**Entry drawer** (`Drawer`, 480 px), for a publication entry:

- Header: item title, `StatusTag`, link "Open item" to `/content/:id?tab=publishing`.
- `MediaPreview` of the final asset in the format's aspect ratio.
- `ProDescriptions`: Scheduled for, Slot ("Tue 19:00 slot" or "No slot"), Delivery ("Sent by Social Hub" for `provider`, "Post by hand" for `manual`; E08-S04 explains why on the post-by-hand card), Attempts, Blocked reason (only when set), Published at and Link (only when published).
- Caption block: the `full_caption` through `ContentText`, with a "Copy caption" button.
- Actions, shown only when listed in `allowed_actions`: "Reschedule", "Cancel publication", and the actions added by E08-S03 ("Publish now") and E08-S04 ("Retry", "Mark as published").

For a slot entry the drawer shows the slot's time, format, role, note and, when reserved, the item's title, status and a link "Open item".

**Reschedule** (`ModalForm`, title "Reschedule publication"):

- `Radio`: "Pick a time" | "Use an open slot".
- "Pick a time": date-time picker in the account timezone, minute step 5, disabled for past times. Helper text: "At least 10 minutes from now."
- "Use an open slot": `Select` of open slots of the same format from the current and next plan, labelled "Wed 25 Nov, 19:00". Empty state: "No open slots for this format."
- Submit button "Reschedule". Field errors come from the API: `too_soon` → "Pick a time at least 10 minutes from now."; `daily_limit` → "That day already has the maximum number of posts of this kind."; `min_gap` → "Too close to another post. Leave at least 2 hours between feed posts and reels." (the number comes from `posting_rules`).
- Success: `message.success("Publication rescheduled")`, drawer and grid reload.

**Cancel** (`Modal.confirm`, title "Cancel this publication?"): body "This cancels the item “{title}” and frees its slot. It cannot be undone." with a required reason `Input.TextArea` (3–500 characters). Confirm button "Cancel publication" (danger); dismiss button "Keep it". Success: `message.success("Publication cancelled")`.

**States:**

| State | Display |
| --- | --- |
| Loading | Skeleton cards in each day column; table skeleton in list view |
| Empty week | `Empty`: "No slots or publications this week. Add slots to the weekly plan to start filling the calendar." with button "Open weekly plan" |
| Error | Inline `Result` with the text for the error code, "Retry" button, `request_id` in small text |
| No account selected | The standard prompt from the shell |
| Conflict (`409`) on an action | `message.warning("This publication changed. Reloading.")` and reload |
| In flight | Card shows a spinner in place of the status tag; actions are disabled with tooltip "Being sent to Instagram" |

The grid refetches every 30 seconds while the page is visible, and immediately after any action.

### Publishing tab of `/content/:id`

Shown in the item workspace shell (E03-S04).

- Before a publication exists: `Empty` with text by item status — "This item will be scheduled automatically when it passes its checks." For an item in `in_review` with a `no_slot` review task: "No free time was found for this item." and a link "Open review task".
- With a publication: a `ProCard` "Schedule" with `ProDescriptions` (Status, Scheduled for, Slot, Placed by — "In its slot", "Next open slot", "Earliest free time" or "Set by {user}" from the latest scheduling `ContentEvent` — Delivery, Blocked reason), the same action buttons as the drawer, and a `ProCard` "What will be posted" with `MediaPreview`, the `full_caption` and "Copy caption".
- The attempts timeline (E08-S03) and the post-by-hand card (E08-S04) are added below by those stories.

## Acceptance criteria

1. Given publications and slots in a week, when `GET /calendar/` is called for that week, then every slot without a live publication and every non-cancelled publication appears exactly once, sorted by time, and `days` holds correct feed and story counts in the account timezone.
2. Given a range of 43 days, when `GET /calendar/` is called, then the response is `400 validation_error` on `to`.
3. Given a scheduled publication, when it is rescheduled to an open slot of the same format, then the old slot is `open`, the new slot is `scheduled`, the item points to the new slot, and a `ContentEvent` records both times.
4. Given a scheduled publication, when it is rescheduled to a free time closer than `min_gap_minutes` to another reel, then the response is `400` with field code `min_gap` and nothing changes.
5. Given a publication that is being sent, when reschedule or cancel is called, then the response is `409` and nothing changes.
6. Given a scheduled publication, when it is cancelled with a reason, then the publication and item are `cancelled`, the slot (whose time is still ahead) is `open`, and the item's history shows the reason.
7. Given a published publication, then `allowed_actions` is empty and the panel shows no action buttons.
8. Given the calendar page and an account with publishing off, then the warning banner is visible, and an operator does not see the "Turn publishing on" link.
9. Given the week view, when the operator clicks "Next week", then the grid shows the next seven days starting on the account's first day of the week.
10. Given an item with no publication, then its Publishing tab shows the empty state for its status.
11. Given a publication changed by someone else, when the operator submits a reschedule and receives `409`, then the panel shows the conflict message and reloads the entry.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S02-BE1 | Publication read API | `apps/publishing/serializers.py`, `views.py`, `urls.py`: list and detail, filters, ordering, nested item/slot/version/asset summaries, `full_caption`, `in_flight`, `allowed_actions`; `openapi.yaml`; API tests for each filter | 0.5 d |
| E08-S02-BE2 | Calendar endpoint | `GET /calendar/`: range validation, merge rule 6, per-day counts in account timezone, `thumbnail_url`; query count bounded (three queries with `select_related`/`prefetch_related`); API tests | 0.5 d |
| E08-S02-BE3 | Reschedule and cancel | Endpoints calling `schedule_item` in move mode and the cancel service; mapping of `SchedulingError` codes to field errors; review-task closing on cancel; `ContentEvent`s; API tests for every row of the error tables | 0.5 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S02-FE1 | Services and week grid | `src/services/publishing.ts` (types and calls for publications and calendar); `src/pages/calendar/index.tsx` with week navigation, seven-column grid, entry cards, day counters, banner, polling, all page states | 1.5 d |
| E08-S02-FE2 | Entry drawer, filters, list view | Drawer for publication and slot entries with `MediaPreview`, descriptions, copy caption; Format and Show filters; `ProTable` list view | 1 d |
| E08-S02-FE3 | Reschedule and cancel | `ModalForm` with time and slot modes, field-error mapping, cancel confirmation with reason, conflict handling | 0.5 d |
| E08-S02-FE4 | Publishing tab | `src/pages/content/tabs/Publishing.tsx`: empty states, schedule card, "what will be posted" card, shared action buttons component reused by the drawer | 1 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- API tests build one week with: an open slot, a reserved slot with an item in production, a scheduled publication in its slot, a scheduled publication without a slot, a published one, a cancelled one. Assert the calendar entries one by one.
- Timezone test: a publication at 21:00 UTC on Saturday belongs to Sunday in `Asia/Tehran`; check `date` and the day counts.
- Panel tests (Vitest with mocked services): grid renders entries in the right day column; actions follow `allowed_actions`; reschedule shows each field error text; cancel requires a reason.
- One Playwright test against the fake provider stack: open the calendar, reschedule a publication to an open slot, see the card move.

## Later

- Drag-and-drop: the grid already works on `POST /publications/{id}/reschedule/`; a drop handler calls the same endpoint.
- A month view can reuse `GET /calendar/` with a longer range (the 42-day limit covers a six-week month grid).
- A multi-account view needs only a calendar call per account.
