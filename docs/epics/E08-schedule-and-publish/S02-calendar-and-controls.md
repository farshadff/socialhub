# E08-S02 — Calendar and manual controls

| | |
| --- | --- |
| Epic | E08 Schedule and post |
| Priority | Must |
| Estimate | BE 1.5 d · FE 3.5 d · QA 0 d |
| Depends on | E08-S01, E00-S02, E00-S06, E01-S02, E03-S04 |
| Needed by | E08-S05, E11-S01 |

## User story

As an operator, I want to see the week's slots and publications on one calendar, see at a glance which posts are due by hand, and move or cancel a publication when plans change, so that I stay in control of what goes out and when without leaving the automatic flow.

## Context

Scheduling is automatic (E08-S01), so most weeks the operator only looks. The calendar answers three questions: what is going out and when, which slots are still empty, and which posts are due or overdue for posting by hand. The controls here are the ones that only change the schedule: reschedule and cancel. Posting itself (the posting pack and "Mark as published") is E08-S05; its card and dialog appear in the places this story builds: the calendar drawer and the Publishing tab of the item.

## Scope

**In:**

- `GET /publications/`, `GET /publications/{id}/`, `GET /calendar/`.
- `POST /publications/{id}/reschedule/`, `POST /publications/{id}/cancel/`.
- `allowed_actions` and the due flags on every publication.
- `/calendar` page with a week view and a list view.
- The Publishing tab of `/content/:id`, which hosts the posting pack of E08-S05.

**Out (later):**

- Drag-and-drop rescheduling, month view, multi-account calendar.
- Editing slots from the calendar (slots are edited in the plan, E01-S02).
- Bulk reschedule or cancel.
- "Publish now", "Retry" and sending states (Phase 2).

## Behaviour and rules

### Reading

1. `GET /publications/` requires `account`. Filters: `status` (comma-separated), `format`, `due_state` (comma-separated, rule 4), `content_item`, `from` and `to` (dates in the account timezone, inclusive, applied to the effective time: `published_at` when published, else `scheduled_at`). Ordering: `scheduled_at` (default), `-scheduled_at`, `published_at`, `-published_at`.
2. `GET /publications/{id}/` adds `posting_pack` (E08-S05).
3. Every publication carries `allowed_actions`, computed on the server from the status. The panel shows a control only when its action is listed. Values in Phase 1: `reschedule`, `cancel`, `mark_published`.

| Action | Allowed when |
| --- | --- |
| `reschedule` | `status = scheduled` |
| `cancel` | `status = scheduled` |
| `mark_published` | `status = scheduled` (E08-S05) |

`published` and `cancelled` publications have no actions.

4. Every publication carries `due_state` and `overdue_at`, computed on the server by `publishing.services.manual.due_state` (E08-S05 rules 4–6):

| `due_state` | When |
| --- | --- |
| `upcoming` | `status = scheduled` and `scheduled_at` is in the future |
| `due` | `status = scheduled`, `scheduled_at` has passed, `overdue_at` has not |
| `overdue` | `status = scheduled` and `overdue_at` has passed |
| null | Any other status |

`overdue_at = scheduled_at + SOCIALHUB_MANUAL_POST_OVERDUE_MINUTES` (120) for a scheduled publication, otherwise null. The filter `due_state=due,overdue` is how the list view and E11-S01 find posts waiting for a person.

5. `GET /calendar/` requires `account`, `from` and `to` (dates in the account timezone, inclusive). The range may be at most 42 days; a longer range returns `400 validation_error` on `to`. The response is not paginated.
6. Calendar entries merge slots and publications:
   - A slot with no content item, or with an item that has no live publication, is an entry of `kind = slot` at `slot.scheduled_at`. Slots with status `skipped` are included and marked.
   - A publication in status `scheduled` or `published` is an entry of `kind = publication` at its effective time. If it holds a slot, the slot is embedded and no separate slot entry is returned.
   - A `cancelled` publication is not returned; its slot, if still `reserved`, appears as a slot entry.
   - Entries are sorted by `at`, then by `kind` (`slot` first).
7. The calendar response includes per-day counts for the two sequencing groups (publications counted as in E08-S01 rule 11; slots without a publication are not counted) so the panel can show "2 of 2 feed posts" without recomputing rules.

### Reschedule

8. Body is exactly one of `{"scheduled_at": "<UTC timestamp>"}` or `{"slot": <id>}`. Both or neither returns `400 validation_error`.
9. Allowed only when `reschedule` is in `allowed_actions`; otherwise `409 invalid_transition` with `details.status` and `details.allowed_actions`.
10. With `scheduled_at`: the time must be at least `SOCIALHUB_PUBLISH_MIN_LEAD_MINUTES` (10) minutes from now and at most 30 days from now. The publication's slot, if any, is released to `open`; `Publication.slot` and `ContentItem.slot` become null.
11. With `slot`: the slot must belong to the same account, have `status = open`, the same `format` as the publication, and a time at least 10 minutes from now. The old slot is released to `open`; the new slot becomes `scheduled`; `ContentItem.slot` points to it.
12. The sequencing check of E08-S01 (daily limit, minimum gap) runs against the new time, ignoring the publication's own current time. A failure returns `400 validation_error` on the field sent, with field code `daily_limit`, `min_gap` or `too_soon`.
13. On success: `scheduled_at` is updated, a `ContentEvent` of type `edited` records old and new times and the user. The item's status stays `scheduled`. A due or overdue publication moved to a future time becomes `upcoming` again.
14. Reschedule is implemented by calling `schedule_item(item, at=…)` or `schedule_item(item, slot=…)` from E08-S01 in "move" mode, so the rules live in one place.

### Cancel

15. Body: `{"reason": "<text>"}`, 3 to 500 characters, required.
16. Allowed when `cancel` is in `allowed_actions`; otherwise `409 invalid_transition`.
17. A publication is one-to-one with its item, so cancelling the publication cancels the item: `withdraw` (E08-S01 rule 21) sets `Publication.status = cancelled`; the item moves to `cancelled` through the pipeline service with `cancelled_reason` set; the slot is released by the E03-S04 cancel rule (`open` if its time is still in the future, otherwise `skipped`) and `ContentItem.slot` is cleared. To keep the item and only change the time, the operator uses reschedule.
18. `POST /content-items/{id}/cancel/` (E03-S04) calls the same service when the item has a publication, so both routes behave identically.

### Concurrency

19. Reschedule, cancel and mark-published (E08-S05) lock the publication row (`SELECT … FOR UPDATE`) and re-check `allowed_actions` inside the lock, so two people acting on the same publication at once get one success and one `409 invalid_transition`.

### Permissions

20. Operators and admins can read, reschedule and cancel. Nothing in this story is admin-only.

## Data

`Publication`, `PlanSlot`, `ContentItem`, `ContentVersion`, `Asset`, `ContentEvent` as in [DATA-MODEL.md](../../DATA-MODEL.md). `due_state` and `overdue_at` are computed in the serializer and not stored. No new fields.

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
      "delivery": "manual",
      "scheduled_at": "2026-11-21T08:30:00Z",
      "status": "published",
      "due_state": null,
      "overdue_at": null,
      "full_caption": "بازار آبان در یک نگاه.\n\n#بازار_مسکن",
      "remote_shortcode": "DCx1AbCdEfG",
      "permalink": "https://www.instagram.com/p/DCx1AbCdEfG/",
      "published_at": "2026-11-21T08:41:00Z",
      "published_via": "manual",
      "next_metrics_checkpoint": "24h",
      "next_metrics_at": "2026-11-22T08:41:00Z",
      "allowed_actions": [],
      "created_at": "2026-11-20T16:02:11Z",
      "updated_at": "2026-11-21T08:44:27Z"
    },
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
      "delivery": "manual",
      "scheduled_at": "2026-11-23T15:30:00Z",
      "status": "scheduled",
      "due_state": "upcoming",
      "overdue_at": "2026-11-23T17:30:00Z",
      "full_caption": "سه اشتباه رایج در خرید خانه اول که می‌شود از آن‌ها دور ماند.\n\n#خانه_اول #مشاوره_املاک",
      "remote_shortcode": null,
      "permalink": null,
      "published_at": null,
      "published_via": null,
      "next_metrics_checkpoint": null,
      "next_metrics_at": null,
      "allowed_actions": ["reschedule", "cancel", "mark_published"],
      "created_at": "2026-11-22T10:14:03Z",
      "updated_at": "2026-11-22T10:14:03Z"
    }
  ]
}
```

Asset `url` values are signed URLs when the bucket is private (E00-S06); the examples show the local form.

Errors: `400 validation_error` on `account` when missing; on `from`/`to` when not dates or `from > to`; on `due_state` or `status` for an unknown value.

### `GET /publications/{id}/`

Same object plus `posting_pack` (shape and rules in E08-S05):

```json
{
  "id": 31,
  "…": "all fields of the list item",
  "posting_pack": {
    "asset_url": "https://media.example.test/accounts/1/2026/11/310-three-mistakes.mp4?X-Amz-Signature=…",
    "asset_filename": "greenhome.ir-reel-42.mp4",
    "cover_url": "https://media.example.test/accounts/1/2026/11/311-cover.jpg?X-Amz-Signature=…",
    "cover_filename": "greenhome.ir-reel-42-cover.jpg",
    "caption": "سه اشتباه رایج در خرید خانه اول که می‌شود از آن‌ها دور ماند.\n\n#خانه_اول #مشاوره_املاک",
    "hashtags": ["خانه_اول", "مشاوره_املاک"],
    "format": "reel",
    "media_kind": "video"
  }
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
  "posting_rules": {"min_gap_minutes": 120, "max_feed_per_day": 2, "max_stories_per_day": 5, "max_revisions": 2},
  "days": [
    {"date": "2026-11-21", "feed_count": 1, "story_count": 0},
    {"date": "2026-11-22", "feed_count": 0, "story_count": 1},
    {"date": "2026-11-23", "feed_count": 1, "story_count": 0},
    {"date": "2026-11-24", "feed_count": 0, "story_count": 0},
    {"date": "2026-11-25", "feed_count": 0, "story_count": 0},
    {"date": "2026-11-26", "feed_count": 0, "story_count": 0},
    {"date": "2026-11-27", "feed_count": 0, "story_count": 0}
  ],
  "entries": [
    {
      "kind": "publication",
      "at": "2026-11-21T08:41:00Z",
      "date": "2026-11-21",
      "format": "feed_post",
      "slot": {"id": 74, "scheduled_at": "2026-11-21T08:30:00Z", "status": "published", "role": "attract"},
      "content_item": {"id": 39, "title": "Market snapshot: November", "status": "published", "role": "attract"},
      "publication": {"id": 29, "status": "published", "delivery": "manual", "scheduled_at": "2026-11-21T08:30:00Z", "published_at": "2026-11-21T08:41:00Z", "due_state": null, "overdue_at": null, "permalink": "https://www.instagram.com/p/DCx1AbCdEfG/", "thumbnail_url": "/media/accounts/1/2026/11/290-market-snapshot.jpg", "allowed_actions": []}
    },
    {
      "kind": "publication",
      "at": "2026-11-22T06:30:00Z",
      "date": "2026-11-22",
      "format": "story",
      "slot": {"id": 75, "scheduled_at": "2026-11-22T06:30:00Z", "status": "scheduled", "role": "engage"},
      "content_item": {"id": 40, "title": "Poll: rent or buy?", "status": "scheduled", "role": "engage"},
      "publication": {"id": 30, "status": "scheduled", "delivery": "manual", "scheduled_at": "2026-11-22T06:30:00Z", "published_at": null, "due_state": "overdue", "overdue_at": "2026-11-22T08:30:00Z", "permalink": null, "thumbnail_url": "/media/accounts/1/2026/11/301-rent-or-buy.jpg", "allowed_actions": ["reschedule", "cancel", "mark_published"]}
    },
    {
      "kind": "publication",
      "at": "2026-11-23T15:30:00Z",
      "date": "2026-11-23",
      "format": "reel",
      "slot": {"id": 77, "scheduled_at": "2026-11-23T15:30:00Z", "status": "scheduled", "role": "educate"},
      "content_item": {"id": 42, "title": "Three mistakes first-time buyers make", "status": "scheduled", "role": "educate"},
      "publication": {"id": 31, "status": "scheduled", "delivery": "manual", "scheduled_at": "2026-11-23T15:30:00Z", "published_at": null, "due_state": "upcoming", "overdue_at": "2026-11-23T17:30:00Z", "permalink": null, "thumbnail_url": "/media/accounts/1/2026/11/311-cover.jpg", "allowed_actions": ["reschedule", "cancel", "mark_published"]}
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

The example is read at 2026-11-22T10:00:00Z, so the story due at 06:30 UTC is past its `overdue_at`. `date` is the entry's calendar date in the account timezone. `thumbnail_url` is the cover asset for reels, the final asset for images, and the first frame asset for video stories when one exists.

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
| Status does not allow it | `409 invalid_transition`, `details: {"status": "published", "allowed_actions": []}` |
| Not found | `404 not_found` |

### `POST /publications/{id}/cancel/`

Permission: signed in. Request:

```json
{"reason": "Campaign postponed to next month"}
```

Response `200`: the publication object with `status: "cancelled"`, `content_item.status: "cancelled"`, `slot: null`, `due_state: null`, `allowed_actions: []`, `posting_pack: null`.

| Case | Response |
| --- | --- |
| `reason` missing or shorter than 3 characters | `400 validation_error`, field `reason` |
| Already published or cancelled | `409 invalid_transition`, `details: {"status", "allowed_actions"}` |
| Not found | `404 not_found` |

## Background work

None. `due_state` is computed when a publication is read, so no task has to move publications when their time passes.

## AI

None.

## Panel

### `/calendar`

Layout: `PageFrame` titled "Calendar" with the description "Slots and publications for the selected account." Primary area is a `Card`.

**Toolbar (top of the card, left to right):**

- Week navigation: buttons "Previous week", "This week", "Next week" and the range label, for example "21 – 27 Nov 2026". Weeks start on the account's `week_start_day`.
- `Segmented` control: "Week" | "List".
- Filters: Format (`Select`, multiple: Reel, Story, Feed post), Show (`Select`: All, Publications only, Open slots only, Needs attention). "Needs attention" shows publications whose `due_state` is `due` or `overdue`.
- Right side: text "Times in Asia/Tehran" (the account timezone).

**Week view:** seven equal columns, one per day, header "Sat 21" with two small counters from `days`: "Feed 1/2" and "Stories 1/5" (counter turns warning colour when at the limit). Each entry is a compact card, sorted by time:

| Element | Content |
| --- | --- |
| Time | `DateTime` in account time, "19:00". For published entries the actual time |
| Format | Icon with text: Reel, Story, Feed post |
| Title | Item title through `ContentText`, one line, ellipsis. For an empty slot: "Open slot" in secondary text |
| Status | `StatusTag` of the publication status ("Scheduled", "Published"), or of the item status for a reserved slot, or "Open" for an empty slot |
| Flags | "Post by hand — due" (warning) when `due_state = due`; "Post by hand — overdue" (error) when `due_state = overdue`. No flag while `upcoming` |
| Thumbnail | 40 px, cropped to the format's aspect ratio, when `thumbnail_url` exists |

A card with a due or overdue flag has a left border in the flag's colour. Clicking a card opens the entry drawer. An open slot's card links to `/selection` ("Fill this slot"). Today's column has a highlighted header. Days outside the selected plan week are not shown; the view always shows exactly one week.

**List view:** `Table` (`useTable`) over `GET /publications/` for the same week. Columns: Time, Format, Item (link to `/content/:id`), Status, Flag (the due or overdue flag), Link (permalink icon, opens in a new tab). Row action: "Open". Server-side paging and the same filters ("Needs attention" sends `due_state=due,overdue`; "All" in the list view also offers a Status filter that includes Cancelled).

**Entry drawer** (`Drawer`, 480 px), for a publication entry:

- Header: item title, `StatusTag`, the due or overdue flag, link "Open item" to `/content/:id?tab=publishing`.
- `Descriptions`: Scheduled for, Slot ("Tue 19:00 slot" or "No slot"), Overdue from (only when `scheduled`), Published at and Link (only when published).
- While `scheduled`: the posting pack card of E08-S05 (`PostingPackCard`), which shows the media preview, downloads and the caption.
- While `published`: `MediaPreview` of the final asset, the caption through `ContentText`, and the button "View on Instagram" (E08-S05).
- Actions, shown only when listed in `allowed_actions`: "Mark as published" (primary, E08-S05), "Reschedule", "Cancel publication".

For a slot entry the drawer shows the slot's time, format, role, note and, when reserved, the item's title, status and a link "Open item".

**Reschedule** (`Modal` form (`useModalForm`), title "Reschedule publication"):

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

The grid refetches every 30 seconds while the page is visible, and immediately after any action, so a flag appears within half a minute of the time passing.

`/calendar?focus={publicationId}` opens the week that contains the publication and its drawer.

### Publishing tab of `/content/:id`

Shown in the item workspace shell (E03-S04).

- Before a publication exists: `Empty` with text by item status — "This item will be scheduled automatically when it passes its checks." For an item in `in_review` with a `no_slot` review task: "No free time was found for this item." and a link "Open review task".
- With a publication: a `Card` "Schedule" with `Descriptions` (Status with the due or overdue flag, Scheduled for, Overdue from, Slot, Placed by — "In its slot", "Next open slot", "Earliest free time" or "Set by {user}" from the latest scheduling `ContentEvent`) and the same action buttons as the drawer.
- Below it, while `scheduled`: the posting pack card of E08-S05. When `published`: the published card of E08-S05 (time, link, "View on Instagram"). When `cancelled`: the cancel reason and who cancelled.

## Acceptance criteria

1. Given publications and slots in a week, when `GET /calendar/` is called for that week, then every slot without a live publication and every scheduled or published publication appears exactly once, sorted by time, and `days` holds correct feed and story counts in the account timezone.
2. Given a range of 43 days, when `GET /calendar/` is called, then the response is `400 validation_error` on `to`.
3. Given a scheduled publication, when it is rescheduled to an open slot of the same format, then the old slot is `open`, the new slot is `scheduled`, the item points to the new slot, and a `ContentEvent` records both times.
4. Given a scheduled publication, when it is rescheduled to a free time closer than `min_gap_minutes` to another reel, then the response is `400` with field code `min_gap` and nothing changes.
5. Given a published publication, when reschedule or cancel is called, then the response is `409 invalid_transition` and nothing changes; `allowed_actions` is empty and the panel shows no action buttons.
6. Given a scheduled publication, when it is cancelled with a reason, then the publication and item are `cancelled`, the slot (whose time is still ahead) is `open`, and the item's history shows the reason.
7. Given a scheduled publication whose time passed 30 minutes ago, then `due_state` is `due` and its card shows "Post by hand — due" in warning colour; given one whose time passed 3 hours ago, then `due_state` is `overdue` and the card shows "Post by hand — overdue" in error colour; given one in the future, then `due_state` is `upcoming` and the card shows only "Scheduled".
8. Given an overdue publication, when it is rescheduled to tomorrow, then `due_state` is `upcoming` and the flag disappears.
9. Given `GET /publications/?account=1&due_state=due,overdue`, then only scheduled publications whose time has passed are returned.
10. Given the week view, when the operator clicks "Next week", then the grid shows the next seven days starting on the account's first day of the week.
11. Given an item with no publication, then its Publishing tab shows the empty state for its status; given a scheduled item, then the tab shows the schedule card and the posting pack.
12. Given a publication changed by someone else, when the operator submits a reschedule and receives `409`, then the panel shows the conflict message and reloads the entry.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S02-BE1 | Publication read API | `apps/publishing/serializers.py`, `views.py`, `urls.py`: list and detail, filters including `due_state`, ordering, nested item/slot/version/asset summaries, `full_caption`, `due_state` and `overdue_at` from `services.manual.due_state`, `allowed_actions`; `posting_pack` field slot on the detail serializer (filled by E08-S05); `openapi.yaml`; API tests for each filter with a fixed clock | 0.5 d |
| E08-S02-BE2 | Calendar endpoint | `GET /calendar/`: range validation, merge rule 6, per-day counts in account timezone, `due_state` on publication entries, `thumbnail_url`; query count bounded (three queries with `select_related`/`prefetch_related`); API tests | 0.5 d |
| E08-S02-BE3 | Reschedule and cancel | Endpoints calling `schedule_item` in move mode and the cancel service (`withdraw` plus slot release and item cancel); row lock of rule 19; mapping of `SchedulingError` codes to field errors; `ContentEvent`s; API tests for every row of the error tables | 0.5 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S02-FE1 | Services and week grid | `src/services/publishing.ts` (types and calls for publications and calendar); `src/pages/calendar/index.tsx` with week navigation, seven-column grid, entry cards with due and overdue flags and border, day counters, `focus` parameter, polling, all page states | 1.25 d |
| E08-S02-FE2 | Entry drawer, filters, list view | Drawer for publication and slot entries with descriptions and the slot for `PostingPackCard`; Format and Show filters including "Needs attention"; `Table` (`useTable`) list view with the Flag column | 1 d |
| E08-S02-FE3 | Reschedule and cancel | `Modal` form (`useModalForm`) with time and slot modes, field-error mapping, cancel confirmation with reason, conflict handling | 0.5 d |
| E08-S02-FE4 | Publishing tab | `src/pages/content/tabs/Publishing.tsx`: empty states, schedule card, placement of the E08-S05 cards by status, shared publication actions component (driven by `allowed_actions`) reused by the drawer | 0.75 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- API tests build one week with: an open slot, a reserved slot with an item in production, a scheduled publication in its slot, a scheduled publication without a slot, a due one, an overdue one, a published one, a cancelled one. Assert the calendar entries one by one.
- Due-state tests use a fixed clock at `scheduled_at − 1 min`, `+ 1 min`, `+ 119 min`, `+ 121 min`, and with `SOCIALHUB_MANUAL_POST_OVERDUE_MINUTES` overridden.
- Timezone test: a publication at 21:00 UTC on Saturday belongs to Sunday in `Asia/Tehran`; check `date` and the day counts.
- Panel tests (Vitest with mocked services): grid renders entries in the right day column; flags follow `due_state`; actions follow `allowed_actions`; reschedule shows each field error text; cancel requires a reason.
- One Playwright test on seeded data: open the calendar, reschedule a publication to an open slot, see the card move.

## Later

- Drag-and-drop: the grid already works on `POST /publications/{id}/reschedule/`; a drop handler calls the same endpoint.
- A month view can reuse `GET /calendar/` with a longer range (the 42-day limit covers a six-week month grid).
- A multi-account view needs only a calendar call per account.
- Phase 2: the actions `publish_now` (E08-S03) and `retry` (E08-S04), and `mark_published` also for `failed` and `verifying` publications; `allowed_actions` then also depends on the lease and `delivery`.
- Phase 2: the fields `blocked_reason`, `in_flight`, `attempt_count`, `max_attempts`, `next_attempt_at`, the container fields and `remote_media_id` on the publication object; `attempts` on the detail; the `delivery` and `blocked` filters; `publishing_enabled` on the calendar response.
- Phase 2: the calendar flags "Publishing off", "Connection problem", "Daily limit", "Retry n of 3", "Processing" and "Verifying"; the "Publishing is off" banner; the in-flight card state; `409 job_in_progress` on reschedule and cancel while a send runs; cancel also resolves an open `publish_failed` review task.
