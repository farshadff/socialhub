# E03-S04 — Content pipeline board and item workspace shell

| | |
| --- | --- |
| Epic | E03 Content selection |
| Priority | Must |
| Estimate | BE 1.5 d · FE 3 d · QA 0 d |
| Depends on | E00-S02, E00-S06, E01-S02, E03-S02 (BE1) |
| Needed by | E03-S03, E04, E05, E06, E07, E08, E09-S03, E10-S01, E11-S01 |

## User story

As an operator, I want one place that shows every piece of content for the week and where it stands, and one page per item where all its work happens, so that I always know what is moving, what is waiting for me and why.

## Context

`ContentItem` is the record that travels through workflow steps 03 to 08. This story creates it, together with the service that is the only code allowed to change its status, and the two panel views every later epic plugs into:

- `/content` — the pipeline as a list and as a board.
- `/content/:id` — the item workspace: a header, a step indicator and seven tabs. This story builds the shell and the History tab. E04 fills Brief, E05 Script, E06 Production, E07 Checks, E08 Publishing, E09 and E10 Performance.

The backend parts BE1 and BE2 must land before E03-S03's confirm service, which creates items through this pipeline service.

## Scope

**In**

- `ContentItem` and `ContentEvent` tables.
- `content.services.pipeline`: item creation, the allowed-transition table, event writing, the `advance` dispatcher with a handler registry, active-job helpers.
- `GET /content-items/`, `GET /content-items/{id}/`, `POST /content-items/{id}/cancel/`, `GET /content-items/{id}/events/`.
- Panel: `/content` list and board, `/content/:id` shell, History tab, cancel flow.

**Out (later)**

- Changing status by dragging cards on the board. Status changes only through the actions each step defines.
- Bulk cancel, bulk move, saved filters.
- Comments and mentions on items. The `note` event type exists but has no endpoint in the MVP.
- Live updates over websockets. The panel polls.

## Behaviour and rules

### The pipeline service

`backend/apps/content/services/pipeline.py` is the single writer of `ContentItem.status`. No view, task or other service assigns the field directly.

1. **`create_item(*, account, plan, slot, candidate, title, format, media_kind, production_mode, role, actor)`** creates the item with status `selected`, writes the first `status_changed` event, and returns it. It validates the format combination with the registry from E04-S01. It does not call `advance`; the caller does so after its transaction commits.
2. **`transition(item, to_status, *, actor=None, message="", data=None, hold_reason="")`**:
   - locks the row (`select_for_update`),
   - checks the move against the allowed-transition table and raises `InvalidTransition` otherwise,
   - sets `status` and `hold_reason` (a transition clears `hold_reason` unless a new one is passed),
   - writes a `ContentEvent` of type `status_changed` with `from_status`, `to_status`, `actor`, `message`, `data`,
   - registers `advance(item.id)` to run after the surrounding transaction commits.
3. **Allowed transitions:**

   | From | To | Owner of the move |
   | --- | --- | --- |
   | `selected` | `briefed` | E04-S03, brief approved |
   | `briefed` | `scripted` | E05-S02, script approved |
   | `briefed` | `selected` | E04-S02 or E04-S03, the approved brief was superseded |
   | `briefed` | `in_production` | E06-S07, the operator uploads a finished file without a script |
   | `scripted` | `in_production` | E06-S07, production started |
   | `scripted` | `briefed` | E04-S02, production mode changed and the script was superseded |
   | `scripted` | `selected` | E04-S02, format, media kind or role changed |
   | `in_production` | `in_check` | E06-S07 or E07-S01, a version was submitted |
   | `in_check` | `approved` | E07-S01, outcome Pass |
   | `in_check` | `needs_revision` | E07-S01, outcome Revise |
   | `in_check` | `in_review` | E07-S01, outcome Escalate or revise limit reached |
   | `needs_revision` | `in_production` | E07-S05, revise job started; E06-S07 `open_revision`; E05-S02, a script re-approved (through E06-S07 `start_production`) |
   | `in_review` | `approved`, `needs_revision` | E07-S06, reviewer decision |
   | `in_review` | `in_check` | E07-S01, manual recheck |
   | `approved` | `scheduled` | E08-S01, publication created |
   | `approved` | `in_review` | E08-S01, no publish time left (review task `no_slot`) |
   | `scheduled` | `publishing` | E08-S03, worker claimed it |
   | `scheduled` | `in_review` | E08-S03, the lateness gate finds no time (`no_slot`) |
   | `scheduled` | `failed` | E08-S03 gate 5, defensive check `version_changed` (publication failed, review task `publish_failed`) |
   | `scheduled` | `published` | E08-S04, marked published by hand |
   | `publishing` | `published` | E08-S03 or E08-S04, confirmed live |
   | `publishing` | `scheduled` | E08-S03 or E08-S04, claim released, waiting to retry or blocked |
   | `publishing` | `failed` | E08-S04, retries exhausted or fatal error |
   | `failed` | `scheduled` | E08-S04, retry |
   | `failed` | `published` | E08-S04, marked published by hand |
   | `failed` | `needs_revision` | E07-S06 request changes on a `publish_failed` task, through E08-S04's `on_review_decision` hook |
   | any except `published`, `cancelled`, `publishing` | `cancelled` | This story, cancel |

   `published` and `cancelled` are terminal. The table lives in one constant, `ALLOWED_TRANSITIONS`, and is the reference for the other epics.
4. **`advance(item_id)`** loads the item and calls the handler registered for its current status. A handler decides whether to enqueue a job or to wait for a person, reading the account's `autopilot` switches. Handlers are registered by their owning app at startup with `pipeline.register_handler(status, fn)`, so `content` does not import later apps:

   | Status | Handler registered by | What it does |
   | --- | --- | --- |
   | `selected` | E04-S03 | Starts brief generation when the item has no brief |
   | `briefed` | E05-S01 | Starts script generation when the item has no script |
   | `scripted` | E06-S07 | Starts production |
   | `in_production` | — | Deliberately none (E06-S07 rule 1): moves into `in_production` start their own work |
   | `in_check` | E07-S01 | Starts the check run when none is running; reads `ContentVersion.submit_trigger` to set the run's trigger |
   | `needs_revision` | E07-S05 | Starts the revise job |
   | `approved` | E08-S01 | Creates the publication |
   | others | — | Nothing; the item is waiting for a job in flight, a person or the clock |

   A status without a handler is a no-op. `advance` never raises to its caller: a handler error is logged, written as a `job_failed` event with the error class, and the item keeps its status with `hold_reason` "Automatic step failed: {code}".
5. **Active job helpers.** `set_active_job(item, job)` stores the job and writes a `job_started` event; `clear_active_job(item, job, *, failed=False, error_code="")` clears it only if it is still that job and writes `job_failed` when `failed`. `ensure_idle(item)` raises `JobInProgress` when `active_job` is set and the job is `queued` or `running`. A job row that reached a final status but is still referenced is treated as idle and cleared. `set_hold_reason(item, text)` changes only `hold_reason` (an empty string clears it); it does not change the status, write an event or call `advance`. E04-S03, E05-S01 and E06-S07 use it for "waiting for …" messages.
6. **`log_event(item, type, *, actor=None, message="", data=None)`** is used by every epic to add `edited`, `qc_result`, `review_decision`, `publish_attempt` and `note` events.
7. Exceptions map to API errors in the shared handler: `InvalidTransition` → `409 invalid_transition` with `details` `{"status": current, "allowed_statuses": [...]}`; `JobInProgress` → `409 job_in_progress` with `details.job`.

### Listing and reading

8. The list requires `account`. It returns summaries only; the detail endpoint returns the nested documents.
9. `needs_attention` is true for items in `needs_revision`, `in_review` or `failed`, and for items whose `hold_reason` is not empty while no job is active (for example a brief waiting for approval).
10. `thumbnail_url` is the first available of: the current version's cover asset, its final asset when that is an image, its first frame asset. It is null until E06 produces something.
11. `allowed_actions` on the detail is computed by the server from status, active job and role. This story contributes `cancel`. Each later epic appends its own action names (`edit_format`, `generate_brief`, `approve_brief`, …), and the panel shows a button only when its action is listed.
12. The nested summaries `current_script`, `current_version`, `latest_check`, `open_review_task` and `publication` are null in this story and are filled by the epics that create those tables. Their shapes are fixed here so the panel types do not change.

### Cancelling

13. Operators and admins may cancel. A reason of 3 to 500 characters is required.
14. Cancel is allowed in every status except `published`, `cancelled` and `publishing`. While `publishing`, the API returns `409 invalid_transition`; the operator waits for the attempt to end.
15. Effects, in one transaction:
    - An active job is marked `cancelled` and its Celery task is revoked (best effort); `active_job` is cleared.
    - `status` → `cancelled`, `cancelled_reason` stored, `hold_reason` cleared.
    - The slot is released: `ContentItem.slot` becomes null and the slot's status becomes `open` when its time is in the future, otherwise `skipped`. The released slot's ID is kept in the event data.
    - Hooks registered with `pipeline.register_cancel_hook(fn)` run. E07 registers one that resolves open review tasks with decision `reject` and note "Item cancelled"; E08 registers one that cancels a `scheduled` publication.
    - With `release_candidate: true`: the candidate returns to status `candidate` (rank null until the next ranking) and its source returns to its usable state — topic → `shortlisted`, feed item → `eligible`, repurpose task → `open`. With `false` (default) the candidate stays `selected` and the source stays `used`.
    - A `status_changed` event is written with the reason as its message.
16. A cancelled item cannot be revived. To use the idea again, release the candidate and select it again.

### Events

17. Events are append-only and never edited or deleted. The list returns newest first.
18. `data` conventions for events written in this story: `status_changed` → the keys passed by the caller; `job_started` and `job_failed` → `{"job_id", "kind", "error_code"}`.

## Data

Uses `ContentItem` and `ContentEvent` from [DATA-MODEL.md](../../DATA-MODEL.md), app `content`.

Additions to record in the shared documents:

- DATA-MODEL.md: indexes on `ContentItem (account, status)`, `ContentItem (plan, status)` and `ContentEvent (content_item, created_at desc)`.
- ARCHITECTURE.md, section 3: the table in rule 3 is the authoritative list of moves; the diagram shows only the main path.
- `ContentItem.candidate` uses `on_delete = PROTECT`; `ContentItem.slot` uses `SET_NULL`.

## API

### `GET /content-items/?account={id}`

Operators and admins.

| Filter | Meaning |
| --- | --- |
| `plan` | Plan ID |
| `status` | Comma-separated statuses |
| `format` | Comma-separated formats |
| `role` | Comma-separated roles; `none` matches items without a role |
| `production_mode` | Comma-separated modes |
| `needs_attention` | `true` or `false` (rule 9) |
| `has_active_job` | `true` or `false` |
| `slot_from`, `slot_to` | ISO timestamps bounding the slot time |
| `search` | Title contains, case-insensitive |

Ordering: `slot_time` (default, items without a slot last), `-slot_time`, `-updated_at`, `-created_at`, `status` (pipeline order, not alphabetical).

```json
{
  "count": 3,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 42,
      "account": 3,
      "title": "Five-minute desk setup",
      "format": "reel",
      "media_kind": "video",
      "production_mode": "motion",
      "role": "educate",
      "status": "selected",
      "hold_reason": "Brief waiting for approval",
      "needs_attention": true,
      "revision_count": 0,
      "plan": {"id": 12, "title": "Week of 28 Nov", "week_start": "2026-11-28"},
      "slot": {"id": 101, "scheduled_at": "2026-11-28T15:30:00Z", "format": "reel", "role": "educate", "status": "reserved"},
      "candidate": {"id": 540, "kind": "trend", "total_score": "77.80"},
      "active_job": null,
      "thumbnail_url": null,
      "publication": null,
      "created_at": "2026-11-22T09:20:11Z",
      "updated_at": "2026-11-22T09:21:40Z"
    },
    {
      "id": 43,
      "account": 3,
      "title": "How we cut delivery time by 30%",
      "format": "feed_post",
      "media_kind": "image",
      "production_mode": "design",
      "role": "build_trust",
      "status": "selected",
      "hold_reason": "",
      "needs_attention": false,
      "revision_count": 0,
      "plan": {"id": 12, "title": "Week of 28 Nov", "week_start": "2026-11-28"},
      "slot": {"id": 103, "scheduled_at": "2026-11-30T15:30:00Z", "format": "feed_post", "role": "build_trust", "status": "reserved"},
      "candidate": {"id": 543, "kind": "feed_item", "total_score": "76.20"},
      "active_job": {"id": "5d0c7f6a-2b1e-4c7b-8a55-0f6f2f1f9b10", "kind": "brief.generate", "status": "running", "progress": 40, "message": "Writing brief"},
      "thumbnail_url": null,
      "publication": null,
      "created_at": "2026-11-22T09:20:11Z",
      "updated_at": "2026-11-22T09:20:13Z"
    }
  ]
}
```

`publication`, once E08 exists, is `{"id", "status", "scheduled_at", "permalink"}`.

### `GET /content-items/{id}/`

```json
{
  "id": 42,
  "account": 3,
  "title": "Five-minute desk setup",
  "format": "reel",
  "media_kind": "video",
  "production_mode": "motion",
  "role": "educate",
  "status": "selected",
  "hold_reason": "Brief waiting for approval",
  "needs_attention": true,
  "revision_count": 0,
  "cancelled_reason": "",
  "plan": {"id": 12, "title": "Week of 28 Nov", "week_start": "2026-11-28", "week_end": "2026-12-04", "status": "active"},
  "slot": {"id": 101, "scheduled_at": "2026-11-28T15:30:00Z", "format": "reel", "role": "educate", "status": "reserved"},
  "candidate": {
    "id": 540,
    "kind": "trend",
    "title": "Five-minute desk setup",
    "summary": "Short routines for tidying a work desk are spreading across home-office accounts.\nSearch interest doubled this week after two large creators posted their versions.",
    "rationale": "Teaches a small, repeatable routine, which matches the week's saves goal and the home-office segment. Fits a 30-second reel.",
    "sources": [
      {"title": "Desk reset routine — 1.2M views", "url": "https://www.instagram.com/reel/Cx1a2b3c4d5/"},
      {"title": "Why tidy desks are trending again", "url": "https://example.org/articles/tidy-desks"}
    ],
    "evidence_score": 72,
    "goal_fit_score": 85,
    "freshness_score": 76,
    "total_score": "77.80",
    "rank": 1
  },
  "active_job": null,
  "current_brief": {"id": 88, "version": 1, "status": "draft", "origin": "ai", "role": "educate", "key_message": "A tidy desk takes five minutes if you follow the same four moves.", "success_metric": "saves", "created_at": "2026-11-22T09:21:40Z"},
  "current_script": null,
  "current_version": null,
  "latest_check": null,
  "open_review_task": null,
  "publication": null,
  "thumbnail_url": null,
  "allowed_actions": ["cancel", "edit_format", "generate_brief", "edit_brief", "approve_brief"],
  "created_by": {"id": 5, "name": "Sara"},
  "created_at": "2026-11-22T09:20:11Z",
  "updated_at": "2026-11-22T09:21:40Z"
}
```

Shapes reserved for later epics:

| Field | Shape | Filled by |
| --- | --- | --- |
| `current_brief` | `{"id", "version", "status", "origin", "role", "key_message", "success_metric", "created_at"}` | E04-S03 |
| `current_script` | `{"id", "version", "status", "origin", "hook", "duration_seconds", "frame_count", "shot_count", "created_at"}` | E05-S01 |
| `current_version` | `{"id", "version", "status", "render_status", "origin", "caption", "hashtags", "final_asset": {"id", "url", "kind", "width", "height", "duration_ms"}, "cover_asset"}` | E06-S07 |
| `latest_check` | `{"id", "attempt", "status", "outcome", "summary", "completed_at"}` | E07-S01 |
| `open_review_task` | `{"id", "reason", "detail", "created_at"}` | E07-S06 |
| `publication` | `{"id", "status", "scheduled_at", "blocked_reason", "attempt_count", "permalink", "published_at"}` | E08-S01 |

An unknown ID, or an ID from an account the user cannot see, returns `404 not_found`.

### `POST /content-items/{id}/cancel/`

```json
{"reason": "Topic no longer relevant after the product delay.", "release_candidate": false}
```

Returns `200` with the item detail (status `cancelled`, `slot` null).

| Case | Response |
| --- | --- |
| `reason` missing, shorter than 3 or longer than 500 characters | `400 validation_error`, field `reason` |
| Status is `published` or `cancelled` | `409 invalid_transition`, `details.allowed_statuses`: `[]` |
| Status is `publishing` | `409 invalid_transition`, `details.reason`: `publishing_in_progress` |

### `GET /content-items/{id}/events/`

Filters: `type` (comma-separated). Ordering: newest first. Page size default 50.

```json
{
  "count": 3,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 9003,
      "type": "edited",
      "from_status": null,
      "to_status": null,
      "actor": null,
      "message": "Brief v1 written",
      "data": {"brief_id": 88, "version": 1},
      "created_at": "2026-11-22T09:21:40Z"
    },
    {
      "id": 9002,
      "type": "job_started",
      "from_status": null,
      "to_status": null,
      "actor": null,
      "message": "Started brief.generate",
      "data": {"job_id": "5d0c7f6a-2b1e-4c7b-8a55-0f6f2f1f9b10", "kind": "brief.generate"},
      "created_at": "2026-11-22T09:20:13Z"
    },
    {
      "id": 9001,
      "type": "status_changed",
      "from_status": null,
      "to_status": "selected",
      "actor": {"id": 5, "name": "Sara"},
      "message": "Selected for the reel slot on Sat 28 Nov, 19:00",
      "data": {"candidate_id": 540, "slot_id": 101, "rank": 1, "total_score": "77.80"},
      "created_at": "2026-11-22T09:20:11Z"
    }
  ]
}
```

## Background work

None of its own. `advance` runs in the process that committed the transition (API worker or Celery task) and only enqueues jobs; it does no long work itself.

## AI

None.

## Panel

### `/content` — pipeline

- `PageContainer` titled "Content", description "Every piece of content and where it stands."
- **Toolbar:** plan select (default: current plan; option "All plans"), status multi-select, format multi-select, role select, switch "Needs attention", search box, and a `Segmented` control "List | Board" whose choice is stored in local storage. Filters are mirrored in the query string so a view can be shared.
- **List view:** `ProTable`, 20 per page.

  | Column | Content |
  | --- | --- |
  | (thumbnail) | 48 px preview in the format's aspect ratio, or a format icon when `thumbnail_url` is null |
  | Title | `ContentText` link to `/content/{id}`; under it the `hold_reason` in secondary text when set |
  | Format | Format tag and production mode in small text |
  | Role | Role label or "Not set" |
  | Slot | `DateTime`; "No slot" when null |
  | Status | `StatusTag`; a small spinner and the job message when `active_job` is set |
  | Updated | Relative time |
  | Actions | "Open"; "Cancel" when allowed |

- **Board view:** read-only columns in workflow order. Each column shows its count and its cards sorted by slot time.

  | Column | Statuses |
  | --- | --- |
  | Selected | `selected` |
  | Briefed | `briefed` |
  | Scripted | `scripted` |
  | In production | `in_production`, `needs_revision` |
  | In check | `in_check`, `in_review` |
  | Ready and scheduled | `approved`, `scheduled`, `publishing`, `failed` |
  | Published | `published` |

  A card shows title, format tag, slot time, `StatusTag` (so the exact status inside a shared column is visible), a spinner when a job runs, and a left border in the `colorWarning` token when `needs_attention`. Clicking a card opens the workspace. Cancelled items are hidden unless the status filter includes them, in which case an eighth column "Cancelled" appears. The board loads up to 100 items for the chosen plan and shows "Showing the first 100 items — narrow the filters" beyond that.
- **Refresh:** both views refetch every 10 seconds while any visible item has an active job, and on window focus.
- **States:** skeleton while loading; `Empty` "No content yet. Confirm a selection to create this week's items." with button "Go to selection"; inline error `Result` with Retry; no-account prompt.

### `/content/:id` — item workspace shell

- **Header (`PageContainer`):** title (`ContentText`), `StatusTag`, format tag, role tag, slot time (`DateTime`) or "No slot". Extra actions on the right: "Cancel item" (when `cancel` is in `allowed_actions`) and "Open review task" (when `open_review_task` is set, linking to `/review/{taskId}`).
- **Alerts under the header, in this order:** `JobProgress` when `active_job` is set; a warning alert with `hold_reason` when it is set and no job is active; an error alert "Cancelled: {cancelled_reason}" for cancelled items.
- **Step indicator:** Ant Design `Steps`, horizontal, small: Selected → Brief → Script → Production → Check → Schedule → Published. Mapping: `selected` → Brief in progress; `briefed` → Script in progress; `scripted`, `in_production`, `needs_revision` → Production in progress; `in_check`, `in_review` → Check in progress (`in_review` and `needs_revision` shown with the warning status); `approved`, `scheduled`, `publishing` → Schedule in progress; `failed` → Schedule with error status; `published` → all finished.
- **Source card (right column, 320 px, collapsible):** candidate kind tag, rank, total score with the three sub-scores, rationale, summary, and the sources as links.
- **Tabs** bound to `?tab=`: Brief, Script, Production, Checks, Publishing, Performance, History. Each tab is its own component under `src/pages/content/workspace/tabs/` and receives the item and a `reload` function. Tabs owned by later epics render `TabPlaceholder` with one sentence, for example "The script appears here once the brief is approved."
- **Default tab** when `?tab=` is absent: `selected` → Brief; `briefed` → Script; `scripted`, `in_production`, `needs_revision` → Production; `in_check`, `in_review` → Checks; `approved`, `scheduled`, `publishing`, `failed` → Publishing; `published` → Performance; `cancelled` → History.
- **Account context:** if the item belongs to a different account than the one in the switcher, the switcher changes to the item's account and a message says "Switched to @handle".
- **Refresh:** the item is refetched every 3 seconds while `active_job` is set, and whenever a tab calls `reload`.

### History tab

- Ant Design `Timeline`, newest first, 50 per page with "Load more".
- Each entry: icon by type (status change, job, edit, check, review, publish, note), message, actor name or "System", `DateTime`. Status changes show "Selected → Briefed" with two `StatusTag`s. Failed jobs use the `colorError` token and show the error code.
- Filter chips: All, Status changes, Jobs, Edits.
- Empty state cannot occur; every item has its creation event.

### Cancel flow

- `Modal` titled "Cancel "{title}"?" with a required text area "Reason" (counter to 500) and a checkbox "Return the idea to the candidates so it can be selected again".
- Body text: "The slot on {slot time} becomes open again. This cannot be undone."
- Confirm button "Cancel item" (danger). Success message: "Item cancelled". The page reloads and shows the History tab.
- On `409` with reason `publishing_in_progress`: notification "This item is being published right now. Try again in a minute."

### States

| State | Behaviour |
| --- | --- |
| Loading | Header and tab skeletons |
| `404` | `Result` 404 with "Back to content" |
| Job running | Step indicator shows the current step as in progress; actions that conflict are hidden because the server omits them from `allowed_actions` |
| Cancelled or published | Tabs are read-only; the header shows no destructive actions |
| Error loading events | Inline `Result` in the History tab with Retry; the rest of the page still works |

## Acceptance criteria

1. Given a new item created by `create_item`, when I read its events, then there is one `status_changed` event with `to_status` `selected`.
2. Given an item in `selected`, when code calls `transition(item, "scripted")`, then `InvalidTransition` is raised, the status is unchanged and no event is written.
3. Given an item in `selected`, when `transition(item, "briefed", actor=user)` commits, then the status is `briefed`, `hold_reason` is empty, an event records the actor, and the handler registered for `briefed` was called once.
4. Given a transition inside a transaction that rolls back, when the rollback happens, then no handler was called.
5. Given a handler that raises, when `advance` runs, then the caller sees no exception, the item keeps its status, `hold_reason` starts with "Automatic step failed", and a `job_failed` event exists.
6. Given an item with a running `active_job`, when `ensure_idle` is called, then `JobInProgress` is raised and the API maps it to `409 job_in_progress` with the job in `details`.
7. Given items in several statuses, when I list with `status=in_review,failed`, then only those items are returned; with `needs_attention=true`, items in `needs_revision`, `in_review`, `failed`, and idle items with a hold reason are returned.
8. Given two items, one with a slot tomorrow and one without a slot, when I list with the default ordering, then the item with the slot comes first.
9. Given an item in `briefed` with a reserved future slot, when I cancel it with a reason, then its status is `cancelled`, its slot is null, the slot's status is `open`, and the candidate is still `selected`.
10. Given the same case with `release_candidate: true`, when I cancel, then the candidate's status is `candidate` and the feed item behind it is `eligible` again.
11. Given an item in `publishing`, when I cancel it, then the API returns `409 invalid_transition` with reason `publishing_in_progress`.
12. Given an item with a running job, when I cancel it, then the job's status is `cancelled` and `active_job` is null.
13. Given the board view, when items exist in `in_check` and `in_review`, then both appear in the "In check" column with their own status tags.
14. Given `/content/42` for an item in `selected` without `?tab=`, when the page opens, then the Brief tab is active and the step indicator shows Brief in progress.
15. Given an item that belongs to another account than the one selected, when I open its URL, then the account switcher changes to the item's account and the page loads.
16. Given an item with an active job, when the job finishes, then within a few seconds the header's progress bar disappears and the status updates without a manual reload.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E03-S04-BE1 | Models and migration | Create app `content` with `ContentItem` and `ContentEvent`, indexes and `on_delete` rules from the Data section, admin registration with events inline. | 0.25 |
| E03-S04-BE2 | Pipeline service | `content/services/pipeline.py`: `create_item`, `ALLOWED_TRANSITIONS`, `transition`, `advance` with handler and cancel-hook registries, active-job helpers, `log_event`, exceptions and their mapping in `core.errors`. Unit tests for every allowed and one disallowed move per status. | 0.5 |
| E03-S04-BE3 | List and detail API | Viewset with all filters and orderings (pipeline-order `status` via a `Case` annotation), summary and detail serializers with reserved null fields, `needs_attention` annotation, `allowed_actions` registry (`content.actions.register`), `openapi.yaml`. | 0.5 |
| E03-S04-BE4 | Cancel and events | `pipeline.cancel(item, reason, release_candidate, actor)` implementing rule 15, `POST …/cancel/`, `GET …/events/` with type filter. | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E03-S04-FE1 | Services, types and routes | `src/services/socialhub/content.ts`, TypeScript types for summary, detail and events, routes `/content` and `/content/:id`, sidebar entry, item status labels and pipeline order in `StatusTag`. | 0.25 |
| E03-S04-FE2 | List view | Toolbar with filters mirrored to the query string, table with the columns above, thumbnail or format icon, job spinner. | 0.75 |
| E03-S04-FE3 | Board view | Seven-column board with counts, cards, attention border, cancelled column on demand, 100-item notice, view toggle persistence. | 0.75 |
| E03-S04-FE4 | Workspace shell | Header, alerts, step indicator mapping, source card, tab container with `?tab=` binding and default-tab rule, `TabPlaceholder`, account auto-switch. | 0.75 |
| E03-S04-FE5 | History tab and cancel flow | Timeline with type icons, filter chips and paging; cancel modal with reason, release checkbox and error handling. | 0.25 |
| E03-S04-FE6 | Refresh, states and tests | Polling rules, loading, empty, 404 and error states; component tests for the default-tab rule, step mapping and board grouping. | 0.25 |

### Test

None beyond the tests inside each subtask.

## Test notes

- **Pipeline unit tests** are generated from `ALLOWED_TRANSITIONS`: every listed move succeeds and writes exactly one event; every unlisted pair raises. Separate tests cover on-commit behaviour (handler called after commit, not after rollback), handler failure isolation, and hold-reason clearing.
- **Registry tests:** registering two handlers for one status raises at startup; a status without a handler is a no-op.
- **API tests:** each filter alone and two combined; default ordering with null slots; `status` ordering follows the pipeline; detail returns the reserved fields as null; `404` for unknown IDs.
- **Cancel tests:** each status (allowed and refused), future and past slot, with and without `release_candidate` for each candidate kind, active job cancelled, cancel hooks called once.
- **Panel tests:** board grouping table, default tab per status, step indicator per status, list refetch stops when no job is active.
- **Fixtures:** a factory `make_item(status=…)` in `content/tests/factories.py` that builds the account, plan, slot and candidate an item needs; later epics reuse it.

## Later

- Drag to reschedule or reassign on the board once E08 exists: the board already groups client-side.
- Notes and comments: add `POST /content-items/{id}/events/` for type `note`; the timeline already renders it.
- Live updates: replace polling with server-sent events on the item channel; the `reload` contract between shell and tabs stays.
- A general audit log can copy `ContentEvent`'s shape with a generic target.
