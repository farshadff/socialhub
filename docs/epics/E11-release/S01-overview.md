# E11-S01 — Overview page and attention list

| | |
| --- | --- |
| Epic | E11 Release |
| Priority | Must |
| Estimate | BE 1.5 d · FE 2.5 d |
| Depends on | E00-S02, E00-S06, E01-S01, E01-S02, E03-S04, E07-S06, E08-S02, E08-S05, E09-S03, E09-S04 |
| Needed by | E11-S03 |

## User story

As an operator, I want one page that shows this week's progress, what is waiting for me and what is broken, so that I can start my day without opening every screen to find out.

## Context

The workflow is automated; people are needed for escalations, approvals, posting each item by hand when it is due, and typing in the numbers from the Instagram app. Those live on different pages: the review queue, the calendar, the item workspace, analytics. The Overview page collects them for the current account. It is the landing page after sign-in and the target of the attention count in the top bar (see [DESIGN-SYSTEM.md](../../DESIGN-SYSTEM.md), section 4).

The page is read-only. Every entry links to the page where the work is done.

## Scope

**In**

- `GET /overview/` returning everything the page needs in one call.
- Attention entries for: open review tasks, failed jobs, publications due or overdue to be posted by hand, metrics to enter at an evaluation checkpoint, and the weekly follower count to enter.
- The `/overview` page, with a "Metrics entry" card built from `analytics.services.sync_status`.
- The attention count in the top bar, fed by the same endpoint.

**Out (later)**

- Dismissing or snoozing attention entries; they disappear when the cause is fixed.
- Email or chat notifications.
- A cross-account overview. The page shows the account chosen in the account switcher.
- Charts. The page shows counts and short lists; charts live in Analytics.

## Behaviour and rules

### General

1. The endpoint is scoped to one account (`?account=` is required) and available to operators and admins.
2. "Now" and "today" are evaluated in UTC for comparisons and in the account's timezone for anything described as a day or a week.
3. The response is cached per account for 30 seconds (Django cache on Redis, key `overview:{account_id}`). `?fresh=1` bypasses the cache; the page's Refresh button uses it.
4. The endpoint makes no external calls and starts no jobs. It reads the database only and must answer in under 300 ms for an account with 500 content items.

### Plan block

5. `plan` is the plan with `status = active` whose week contains today in the account timezone. If there is none, it is the `draft` plan for the current week. If there is none of either, `plan` is `null`.
6. `plan.slots` counts the plan's slots by `PlanSlot.status`. `total` excludes nothing; `skipped` is included in the counts and in `total`.
7. `plan.goals` lists each `PlanGoal` with scope `week_total`, with `actual` and `attainment`:
   - for content metrics (`reach`, `views`, `likes`, `comments`, `saves`, `shares`, `replies`): `actual` is the sum, over the plan's published publications matching the goal's `format` (or all formats when null), of the metric in each publication's most recent captured `MetricSnapshot` (any checkpoint, including `adhoc`); a null metric counts as 0 and sets `partial = true`;
   - for `follower_growth`: `actual` is the latest `AccountSnapshot.followers` minus the followers of the last snapshot dated on or before `week_start`; `null` when either snapshot is missing;
   - `attainment` = `actual / target_value`, rounded to two decimals, `null` when `actual` is null.
   `per_post` goals are not listed here; they are evaluated per post in E10-S01.

### Items by status

8. `items_by_status` counts the `ContentItem`s of the plan in rule 5, for every status in the enum, including zeros. When `plan` is null, all counts are zero. (`publishing` and `failed` are in the enum but are always zero in Phase 1.)
9. `items_waiting` gives two extra counts that tell the operator a person is the next actor: `brief_approval` (status `selected` with a current brief in `draft`) and `script_approval` (status `briefed` with a current script in `draft` and no `active_job`).

### Attention list

10. Attention entries are built by independent builder functions, one per type, each returning zero or more entries. The endpoint concatenates them, sorts by severity (`high`, `medium`, `low`), then oldest `since` first, and returns at most 20. `attention_count` is the total before truncation.

| `type` | Condition | Severity | Entries | `link` |
| --- | --- | --- | --- | --- |
| `review_task_open` | `ReviewTask.status = open` for the account | `high` | One per task, at most 10; beyond that one aggregated entry "{n} more review tasks" | `/review/{task_id}` (aggregate: `/review`) |
| `publication_due_by_hand` | A publication returned by `publishing.services.manual.due_publications(account, now)` (E08-S05 rules 4–8): `status = scheduled` and `scheduled_at` in the past. `data.overdue` is true once `overdue_at` (`scheduled_at + SOCIALHUB_MANUAL_POST_OVERDUE_MINUTES`, default 120) has passed | `medium` while due, `high` when overdue | One per publication, at most 5, then an aggregate. Due: title "Post by hand: {item title}", detail "Due {time}. Download the posting pack, post it in the Instagram app, then mark it as published." Overdue: title "Post by hand — overdue: {item title}", detail "Was due {time}. Post it and mark it as published, or reschedule or cancel it." | `/content/{content_item_id}?tab=publishing` (aggregate: `/calendar`) |
| `metrics_entry_due` | A publication returned by `analytics.services.reminders.metrics_entry_due(account)` (E09-S04 rules 5 and 15): published, and its current checkpoint (`next_metrics_checkpoint`) is due for entry | As E09-S04 rule 16: `high` for a story's `23h`, `medium` otherwise | One per publication, at most 5, then an aggregate "{n} more posts need metrics". Title and detail as E09-S04 rule 16 ("Metrics to enter: {title}") | `/analytics/posts/{publication_id}?enter={checkpoint}` (aggregate: `/analytics/posts?metrics_status=entry_due`) |
| `followers_entry_due` | `analytics.services.reminders.followers_entry_due(account)` is not null (E09-S04 rule 13: today is the account's plan-week start day and there is no `AccountSnapshot` for today) | `medium` | One. Title and detail as E09-S04 rule 16 ("Follower count to enter") | `/analytics/account?enter=followers` |
| `job_failed` | A `JobRun` for the account with `status = failed`, finished in the last 48 hours, and no later `succeeded` or active job with the same `kind`, `target_type` and `target_id` | `medium` | One per job, at most 5, then an aggregate | For `target_type = content_item`: `/content/{id}?tab={tab}` where `tab` comes from the job kind prefix (`brief` → Brief, `script` → Script, `production`/`copy`/`image` → Production, `qc` → Checks); otherwise the page that owns the job (`research.*` → `/research?tab=runs`, `feeds.*` → `/selection?tab=feed-sources`, `selection.*` and `repurpose.*` → `/selection`, `analytics.*`/`evaluation.*` → `/analytics/posts`, `report.*` → `/reports`); any other kind → `/settings/system?tab=jobs` |

11. A publication has at most one `publication_due_by_hand` entry. When it becomes overdue, the same entry (same `id`) changes severity, title and `data.overdue`; it is not listed twice. Marking the publication published, rescheduling it to a future time or cancelling it removes the entry.
12. A publication has at most one `metrics_entry_due` entry, for its current checkpoint. When E09-S04 writes a `skipped` row and moves the pointer on, the entry follows the new checkpoint once that one is due; checkpoints that are never asked for (`1h`, `6h`, `72h`, `adhoc`) never produce an entry.
13. Every entry has a stable `id` (`"{type}:{object_id}"`, or `"{type}:aggregate"`; for `metrics_entry_due` the object is the publication, for `followers_entry_due` the account), a `title` and `detail` in English, `since` (when the condition began: task `created_at`; job `finished_at`; due-by-hand publication `scheduled_at`; `metrics_entry_due`: the publication's `next_metrics_at`; `followers_entry_due`: the local start of today, as returned by E09-S04), `count` (1 unless aggregated) and `data` (type-specific values: `{"overdue": true|false, "publication_id"}` for `publication_due_by_hand`; `{"publication_id", "checkpoint", "due_at", "due_until"}` for `metrics_entry_due`; `{"date"}` for `followers_entry_due`; `{}` for the others and for aggregates).
14. Entries carry `requires_admin` so the panel can say "Ask an admin" for fixes only an admin can make. Every Phase 1 type can be handled by an operator, so it is false for all of them.

### Next publications and metrics entry

15. `next_publications` lists up to 5 publications with `status = scheduled`, ordered by `scheduled_at`, from now minus 24 hours onward (so a due or overdue one stays visible). Each carries `due_state` from `publishing.services.manual.due_state` (E08-S05): `upcoming`, `due` or `overdue`.
16. `metrics_entry` is the result of `analytics.services.sync_status(account)` (E09-S04): `metrics_due`, `metrics_missed_7d`, `followers_due`, `last_entry_at`. `feeds_last_synced_at` is the latest `FeedSource.last_synced_at` among active sources, or null.
17. `followers` reports `current` (latest snapshot) and `change_7d` (latest minus the snapshot from 7 days earlier, or the nearest earlier one within 10 days; null if none). With follower counts entered once per plan week, `change_7d` compares this week's entry with last week's.

## Data

Read-only use of: `InstagramAccount`, `WeeklyPlan`, `PlanGoal`, `PlanSlot`, `ContentItem`, `Brief`, `ScriptVersion`, `ReviewTask`, `JobRun`, `Publication`, `MetricSnapshot`, `AccountSnapshot`, `FeedSource`. See [DATA-MODEL.md](../../DATA-MODEL.md). No new tables or fields.

Indexes this story adds if they do not exist yet: `ReviewTask(account, status)`, `JobRun(account, status, finished_at)`, `Publication(account, status, scheduled_at)`, `Publication(account, next_metrics_at)`.

## API

### `GET /overview/?account={id}`

Permission: operator or admin. Query: `account` (required), `fresh` (optional, `1`).

Response `200`:

```json
{
  "generated_at": "2026-12-02T06:30:12Z",
  "account": {
    "id": 1,
    "handle": "demo_brand",
    "timezone": "Asia/Tehran"
  },
  "plan": {
    "id": 7,
    "title": "Week of 2026-11-28",
    "status": "active",
    "week_start": "2026-11-28",
    "week_end": "2026-12-04",
    "objective": "Grow saves with practical planning tips.",
    "slots": {"total": 9, "open": 1, "reserved": 4, "scheduled": 2, "published": 2, "skipped": 0},
    "goals": [
      {"metric": "reach", "scope": "week_total", "format": null, "target_value": 50000, "actual": 18250, "attainment": 0.37, "partial": false},
      {"metric": "saves", "scope": "week_total", "format": null, "target_value": 400, "actual": 131, "attainment": 0.33, "partial": false},
      {"metric": "follower_growth", "scope": "week_total", "format": null, "target_value": 200, "actual": 64, "attainment": 0.32, "partial": false}
    ]
  },
  "items_by_status": {
    "selected": 1, "briefed": 1, "scripted": 0, "in_production": 1, "in_check": 0,
    "needs_revision": 0, "in_review": 1, "approved": 0, "scheduled": 2, "publishing": 0,
    "published": 2, "failed": 0, "cancelled": 0
  },
  "items_waiting": {"brief_approval": 1, "script_approval": 1},
  "attention_count": 4,
  "attention": [
    {
      "id": "publication_due_by_hand:17",
      "type": "publication_due_by_hand",
      "severity": "high",
      "title": "Post by hand — overdue: \"Three planning mistakes\"",
      "detail": "Was due today at 06:30. Post it and mark it as published, or reschedule or cancel it.",
      "link": "/content/43?tab=publishing",
      "since": "2026-12-02T03:00:00Z",
      "count": 1,
      "requires_admin": false,
      "data": {"overdue": true, "publication_id": 17}
    },
    {
      "id": "review_task_open:31",
      "type": "review_task_open",
      "severity": "high",
      "title": "Review needed: \"Desk setup in five minutes\"",
      "detail": "Facts check escalated: one claim has no source.",
      "link": "/review/31",
      "since": "2026-12-01T15:42:10Z",
      "count": 1,
      "requires_admin": false,
      "data": {}
    },
    {
      "id": "metrics_entry_due:15",
      "type": "metrics_entry_due",
      "severity": "medium",
      "title": "Metrics to enter: \"Plan the week, not the day\"",
      "detail": "24 h metrics are due. Read them in the Instagram app and enter them by 7 Dec, 21:05.",
      "link": "/analytics/posts/15?enter=24h",
      "since": "2026-12-01T17:35:00Z",
      "count": 1,
      "requires_admin": false,
      "data": {"publication_id": 15, "checkpoint": "24h", "due_at": "2026-12-01T17:35:00Z", "due_until": "2026-12-07T17:35:00Z"}
    },
    {
      "id": "job_failed:5f0c2a7e-2f61-4f3b-9d0e-7a1f3c8b4e10",
      "type": "job_failed",
      "severity": "medium",
      "title": "Render failed: \"Checklist reel\"",
      "detail": "The render worker stopped while assembling the video.",
      "link": "/content/45?tab=production",
      "since": "2026-12-02T05:10:44Z",
      "count": 1,
      "requires_admin": false,
      "data": {}
    }
  ],
  "next_publications": [
    {
      "id": 17,
      "content_item": 43,
      "title": "Three planning mistakes",
      "format": "feed_post",
      "scheduled_at": "2026-12-02T03:00:00Z",
      "status": "scheduled",
      "due_state": "overdue"
    },
    {
      "id": 18,
      "content_item": 44,
      "title": "Plan the week, not the day",
      "format": "reel",
      "scheduled_at": "2026-12-02T14:30:00Z",
      "status": "scheduled",
      "due_state": "upcoming"
    }
  ],
  "metrics_entry": {
    "metrics_due": 1,
    "metrics_missed_7d": 0,
    "followers_due": false,
    "last_entry_at": "2026-12-01T19:12:40Z"
  },
  "feeds_last_synced_at": "2026-12-02T06:00:02Z",
  "followers": {"current": 12840, "change_7d": 96}
}
```

`detail` texts are produced by the builders from the underlying records (for `job_failed`, from a fixed text per `error_code`, never from raw provider messages).

Errors:

| Case | HTTP | Code |
| --- | --- | --- |
| `account` missing or not a number | 400 | `validation_error` (`fields[0].path = "account"`) |
| Account not found or archived | 404 | `not_found` |
| Not signed in | 403 | `authentication_required` |

## Background work

None. The endpoint computes on request and caches for 30 seconds.

## AI

None.

## Panel

Route `/overview`, sidebar item "Overview", the default route after sign-in (`/` redirects here). File `src/pages/overview/index.tsx`.

### Layout

```text
PageFrame: "Overview"  ·      description "@demo_brand · Week of 28 Nov – 4 Dec"            [Refresh]
┌ This week ───────────────────────────────┐ ┌ Followers ────────────┐
│ Plan title · [Active]                    │ │ 12,840   ▲ 96 in 7 d  │
│ Objective (two lines, ContentText)       │ └───────────────────────┘
│ Slots  ██████░░░  2 of 9 published       │ ┌ Next publications ────┐
│ Goals  Reach 18,250 / 50,000  (37%)      │ │ Today 06:30 Post … ⚠  │
│        Saves 131 / 400        (33%)      │ │ Today 18:00  Reel …   │
└──────────────────────────────────────────┘ └───────────────────────┘
┌ Pipeline ─────────────────────────────────────────────────────────────┐
│ Plan & select 2 │ Create 1 │ Check 0 │ Needs you 1 │ Ready 2 │ Published 2 │
│ Feeds synced 30 min ago                                                │
└────────────────────────────────────────────────────────────────────────┘
┌ Needs attention (4) ─────────────────────┐ ┌ Metrics entry ────────┐
│ ● Post by hand — overdue: "Three…"  Open │ │ Metrics to enter  1   │
│ ● Review needed: "Desk setup…"      Open │ │ Missed (7 days)   0   │
│ ● Metrics to enter: "Plan the w…"   Open │ │ Followers   Entered   │
│ ● Render failed: "Checklist reel"   Open │ │ Last entry  11 h ago  │
└──────────────────────────────────────────┘ └───────────────────────┘
```

### Components

| Card | Component | Detail |
| --- | --- | --- |
| This week | `Card` | Plan title linking to `/plans/{id}`, `StatusTag` for the plan status, objective in `ContentText` (clamped to two lines). Slots: `Progress` with `published / total` and a caption "{published} of {total} published · {scheduled} scheduled · {open} open". Goals: one row per goal — metric label, "{actual} / {target}" with thousands separators, `Progress` capped at 100% with the percentage as text; "—" when `actual` is null; a small "partial" tag with tooltip "Some posts have no value for this metric yet" when `partial`. |
| Followers | `StatisticCard` | Current count; change over 7 days with an up or down arrow and the words "in 7 d"; "No data yet" when null. Links to `/analytics/account`. |
| Next publications | `Card` + `List` | Up to five rows: `DateTime` (account time, relative day name), format tag, title in `ContentText`, `StatusTag`. When `due_state` is `due`, a warning tag "Post by hand — due"; when `overdue`, an error tag "Post by hand — overdue"; each such row links to `/content/{content_item}?tab=publishing`. Footer link "Open calendar". |
| Pipeline | `Card` with six `Statistic` tiles | Tiles and the statuses they sum: "Plan & select" (`selected`, `briefed`), "Create" (`scripted`, `in_production`), "Check" (`in_check`, `needs_revision`), "Needs you" (`in_review` plus `items_waiting.brief_approval` and `items_waiting.script_approval`, shown as a breakdown in the tooltip), "Ready" (`approved`, `scheduled`), "Published" (`published`). Each tile links to `/content?plan={id}&status={comma-separated statuses}`. Tile colours follow the status colour mapping; the number always has its label. Footer in secondary text: "Feeds synced {relative time}" linking to `/selection?tab=feed-sources`, or "No feed sources". |
| Needs attention | `Card` + `List` | Title with the total count. Each row: severity icon with accessible name ("High", "Medium", "Low") and matching tag colour (error, warning, default), title, detail in grey, relative time from `since` with the exact time in a tooltip, and a link button "Open". Rows with `requires_admin` show "Ask an admin" instead of "Open" for operators (admins get "Open"). If `attention_count` exceeds the rows shown: a footer "Showing 20 of {n}". |
| Metrics entry | `Descriptions` | "Metrics to enter": `metrics_due`, in warning colour with the tag "Due for entry" when above 0, linking to `/analytics/posts?metrics_status=entry_due`. "Missed (7 days)": `metrics_missed_7d`, with the tooltip "Checkpoints skipped because nobody entered the numbers in time". "Followers": "Due today" (warning tag) when `followers_due`, otherwise "Entered", linking to `/analytics/account`. "Last entry": relative time of `last_entry_at`, or "Nothing entered yet". |

### Top bar

- The attention count badge (a bell icon with accessible name "Attention items") shows `attention_count` and links to `/overview`. It reads the same endpoint through a shared React Query key and refetches every 60 seconds and on window focus.

### Behaviour

- The page refetches every 60 seconds while visible. "Refresh" calls the endpoint with `fresh=1` and shows a short loading state on the button only.
- Changing the account in the switcher reloads the page for the new account.

### States

| State | What is shown |
| --- | --- |
| Loading | Skeletons in each card |
| No account selected | The standard prompt to pick or create an account |
| No plan for this week | The "This week" card shows `Empty`: "No plan covers this week." with the button "Create weekly plan" (to `/plans?create=1`). Pipeline tiles show zeros. Other cards still render. |
| Draft plan | The plan card shows the draft with an `Alert` (info): "This plan is a draft. Activate it to start the week." and a link to the plan. |
| Nothing needs attention | The attention card shows `Empty` with a check icon: "Nothing needs you right now." |
| No publications scheduled | "Nothing is scheduled." with a link to the calendar |
| Error | Inline `Result` with the text for the code, Retry, and the small `request_id`. The top-bar badge shows no number and a tooltip "Could not load attention items". |

## Acceptance criteria

1. Given an account with an active plan for this week, when the operator opens `/overview`, then the plan title, status, slot progress and each `week_total` goal with actual and percentage are shown.
2. Given two published posts with reach 10,000 and 8,250 in their latest entered snapshots and a reach goal of 50,000, when the endpoint is called, then the reach goal shows `actual = 18250` and `attainment = 0.37`.
3. Given an open review task, when the endpoint is called, then the attention list contains a `review_task_open` entry with severity `high` linking to `/review/{id}`, and the top-bar badge count includes it.
4. Given the review task is resolved, when the page refreshes, then the entry is gone and the count is one lower.
5. Given a scheduled publication whose time passed 20 minutes ago, when the endpoint is called, then there is one `publication_due_by_hand` entry with severity `medium` and `data.overdue = false`, linking to `/content/{id}?tab=publishing`. Given 121 minutes have passed (default setting), then the same entry `id` has severity `high` and `data.overdue = true`. Given the operator marks it published, then the entry is gone.
6. Given a reel published 25 hours ago with no captured `24h` snapshot, when the endpoint is called, then there is one `metrics_entry_due` entry with severity `medium` and `data.checkpoint = "24h"` linking to `/analytics/posts/{publication_id}?enter=24h`, and `metrics_entry.metrics_due = 1`. Given the operator enters the 24-hour numbers, then the entry is gone and `metrics_due = 0`.
7. Given a render job failed an hour ago and a later job of the same kind for the same item succeeded, when the endpoint is called, then no `job_failed` entry is returned for it.
8. Given today is the account's plan-week start day and no follower count exists for today, when the endpoint is called, then there is one `followers_entry_due` entry linking to `/analytics/account?enter=followers` and `metrics_entry.followers_due` is true; after a follower count is entered for today, the entry is gone. Given a story whose `23h` checkpoint is due, its `metrics_entry_due` entry has severity `high`.
9. Given 14 open review tasks, when the endpoint is called, then 10 single entries and one aggregated entry are returned for that type, and `attention_count` counts all 14.
10. Given no plan covers this week, when the page opens, then the plan card shows the empty state with "Create weekly plan" and the rest of the page still renders.
11. Given the operator clicks the "Needs you" tile, when the content list opens, then it is filtered to the plan and the statuses behind that tile.
12. Given two calls within 30 seconds, when neither uses `fresh=1`, then the second is served from cache; with `fresh=1` it is recomputed.
13. Given a request without `account`, when the endpoint is called, then the response is `400 validation_error` on `account`.
14. Given an overdue publication among the next publications, when the page renders, then its row shows the error tag "Post by hand — overdue" and links to the item's Publishing tab; an upcoming one shows no tag.
15. Given a failed `repurpose.suggest` job, then its `job_failed` entry links to `/selection`; a failed `qc.run` job on an item links to `/content/{id}?tab=checks`.
16. Given 500 content items and 200 publications in the account, when the endpoint is called without cache, then it uses at most 15 queries.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E11-S01-BE1 | Plan, pipeline and metrics-entry aggregates | `apps/core/services/overview.py`: plan selection (rule 5), slot counts, goal actuals (rule 7), `items_by_status`, `items_waiting`, `next_publications` with `due_state`, `metrics_entry` from `sync_status`, `feeds_last_synced_at`, `followers`. Aggregate queries only; add missing indexes in a migration. Unit tests with factories, including null metrics and missing snapshots. | 0.5 |
| E11-S01-BE2 | Attention builders | One function per type in `apps/core/services/attention.py` implementing the table in rule 10, calling E08-S05's `due_publications` and E09-S04's `metrics_entry_due` and `followers_entry_due` instead of repeating their rules; caps, aggregation, rules 11–12, stable IDs, `since`, `data`, `requires_admin`, and fixed English texts per type and error code (the metric and follower texts are E09-S04's). Tests for each condition and its boundary (scheduled time, the overdue setting, 48 hours, plan-week start day in the account timezone). | 0.5 |
| E11-S01-BE3 | Endpoint | `GET /overview/` view and serializer, account validation, 30-second cache with `fresh` bypass, query-count test (≤ 15), `openapi.yaml` entry. | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E11-S01-FE1 | Page, plan card and pipeline tiles | `src/pages/overview/index.tsx` (replacing the local-development overview), route and `/` redirect in `src/App.tsx`, `useOverview` query hook (60-second refetch, `fresh` refresh), plan card with slots and goals, followers card, pipeline tiles with links, tooltips and the feeds footer, empty and draft states. | 1 |
| E11-S01-FE2 | Attention list, next publications, metrics entry | The three cards with severity icons, `DateTime`, "Post by hand — due / overdue" tags, "Ask an admin" handling, footers and empty states. | 1 |
| E11-S01-FE3 | Top bar wiring and states | Attention badge in the layout (`src/app.tsx` `actionsRender`), shared query key, error and loading states for page and badge, component tests for the main states. | 0.5 |

### Test

None beyond the tests in each subtask. The page is part of the end-to-end path in E11-S03.

## Test notes

- **Service:** freeze time; build an account with one record for every attention condition and assert the exact list, order and count. Then fix each cause in turn (mark published, enter metrics, enter followers, resolve the task, rerun the job) and assert its entry disappears.
- **Due and overdue:** a publication 1 minute past its time (due), exactly at the overdue boundary, and 1 minute past it (overdue); a rescheduled one disappears.
- **Goals:** cases for a goal limited to one format, a metric that is null in the latest snapshot (`partial`), a week with no published posts (`actual = 0`), and missing follower snapshots (`actual = null`).
- **Timezones:** an account in `Asia/Tehran` just after local midnight on the first day of a week — the new week's plan must be chosen, not the previous one, and `followers_entry_due` appears for the new day.
- **API:** permissions, validation, cache behaviour, query count.
- **Panel:** component tests with fixture payloads for: full data, no plan, draft plan, empty attention, due and overdue publications, error.

## Later

- Notifications: call the attention builders from a periodic task and send new `high` entries to a channel; entry IDs are stable, so "new" is a set difference.
- Dismiss and snooze: a small table keyed by account and entry ID.
- All-accounts view for admins: run the same service per account and list accounts with their counts.
- More attention types (plan missing for next week, slots still open two days before their time): add a builder function; nothing else changes.
- Phase 2: the connection entries (`connection_needs_attention`, `connection_expiring`, `connection_disconnected`, with `requires_admin = true`), `publishing_off`, `publication_blocked` and its suppression rules, `metrics_sync_gap` for collector delays, failed publications surfacing as `publish_failed` review tasks, `publish.*` job links, the "Publishing on/off" tag in the top bar, a connection row in the Metrics entry card, `publishing` and `verifying` in next publications, and a "Problems" pipeline tile for `failed` items.
