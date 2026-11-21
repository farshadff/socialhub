# E11-S01 — Overview page and attention list

| | |
| --- | --- |
| Epic | E11 Release |
| Priority | Must |
| Estimate | BE 1.5 d · FE 2.5 d |
| Depends on | E00-S02, E00-S04, E00-S06, E01-S01, E01-S02, E03-S04, E07-S06, E08-S02, E08-S04, E09-S01, E09-S02 |
| Needed by | E11-S03 |

## User story

As an operator, I want one page that shows this week's progress, what is waiting for me and what is broken, so that I can start my day without opening every screen to find out.

## Context

The workflow is automated; people are needed for escalations, approvals and broken connections. Those live on different pages: the review queue, the calendar, account settings, analytics. The Overview page collects them for the current account. It is the landing page after sign-in and the target of the attention count in the top bar (see [DESIGN-SYSTEM.md](../../DESIGN-SYSTEM.md), section 4).

The page is read-only. Every entry links to the page where the problem is fixed.

## Scope

**In**

- `GET /overview/` returning everything the page needs in one call.
- Attention entries for: open review tasks, failed jobs, connection problems, publishing switched off, blocked or overdue publications, metrics sync gaps.
- The `/overview` page.
- The attention count and "Publishing on/off" indicator in the top bar, fed by the same endpoint.

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
4. The endpoint makes no provider calls and starts no jobs. It reads the database only and must answer in under 300 ms for an account with 500 content items.

### Plan block

5. `plan` is the plan with `status = active` whose week contains today in the account timezone. If there is none, it is the `draft` plan for the current week. If there is none of either, `plan` is `null`.
6. `plan.slots` counts the plan's slots by `PlanSlot.status`. `total` excludes nothing; `skipped` is included in the counts and in `total`.
7. `plan.goals` lists each `PlanGoal` with scope `week_total`, with `actual` and `attainment`:
   - for content metrics (`reach`, `views`, `likes`, `comments`, `saves`, `shares`, `replies`): `actual` is the sum, over the plan's published publications matching the goal's `format` (or all formats when null), of the metric in each publication's most recent `MetricSnapshot` (any checkpoint, including `adhoc`); a null metric counts as 0 and sets `partial = true`;
   - for `follower_growth`: `actual` is the latest `AccountSnapshot.followers` minus the followers of the last snapshot dated before `week_start`; `null` when either snapshot is missing;
   - `attainment` = `actual / target_value`, rounded to two decimals, `null` when `actual` is null.
   `per_post` goals are not listed here; they are evaluated per post in E10-S01.

### Items by status

8. `items_by_status` counts the `ContentItem`s of the plan in rule 5, for every status in the enum, including zeros. When `plan` is null, all counts are zero.
9. `items_waiting` gives two extra counts that tell the operator a person is the next actor: `brief_approval` (status `selected` with a current brief in `draft`) and `script_approval` (status `briefed` with a current script in `draft` and no `active_job`).

### Attention list

10. Attention entries are built by independent builder functions, one per type, each returning zero or more entries. The endpoint concatenates them, sorts by severity (`high`, `medium`, `low`), then oldest `since` first, and returns at most 20. `attention_count` is the total before truncation.

| `type` | Condition | Severity | Entries | `link` |
| --- | --- | --- | --- | --- |
| `review_task_open` | `ReviewTask.status = open` for the account | `high` | One per task, at most 10; beyond that one aggregated entry "{n} more review tasks" | `/review/{task_id}` (aggregate: `/review`) |
| `connection_problem` | `AccountConnection.status` is `challenge_required`, `needs_attention` or `disconnected` | `high` | One | `/settings/accounts/{account_id}?tab=connection` |
| `publication_blocked` | A `Publication` with `delivery = provider`, `status = scheduled` and a non-null `blocked_reason`; or `delivery = provider`, `status = scheduled`, `scheduled_at` more than 10 minutes in the past and `next_attempt_at` null | `high` | One per publication, at most 5, then an aggregate | `/calendar?focus={publication_id}` |
| `publication_due_by_hand` | A `Publication` with `delivery = manual`, `status = scheduled` and `scheduled_at` in the past (E08-S04 rule 25) | `high` | One per publication, at most 5, then an aggregate. Title "Post by hand: {item title}", detail "Due {time}. Download the asset, post it, then mark it as published." | `/content/{content_item_id}?tab=publishing` |
| `publishing_off` | `publishing_enabled = false` and at least one publication is `scheduled` within the next 7 days | `high` if one is due within 24 hours, else `medium` | One, with the count and the earliest time | `/settings/accounts/{account_id}?tab=automation` |
| `job_failed` | A `JobRun` for the account with `status = failed`, finished in the last 48 hours, and no later `succeeded` or active job with the same `kind`, `target_type` and `target_id` | `medium` | One per job, at most 5, then an aggregate | For `target_type = content_item`: `/content/{id}?tab={tab}` where `tab` comes from the job kind prefix (`brief` → Brief, `script` → Script, `production`/`copy`/`image` → Production, `qc` → Checks, `publish` → Publishing); for `target_type = publication` (`publish.send`, `publish.verify`): `/calendar?focus={target_id}`; otherwise the page that owns the job (`research.*` → `/research?tab=runs`, `feeds.*` → `/selection?tab=feed-sources`, `selection.*` and `repurpose.*` → `/selection`, `analytics.*`/`evaluation.*` → `/analytics/posts`, `report.*` → `/reports`); any other kind → `/settings/system?tab=jobs` |
| `metrics_sync_gap` | (a) published publications with `next_metrics_at` more than `SOCIALHUB_METRICS_OVERDUE_MINUTES` (60) minutes in the past; or (b) the account has published publications and no `AccountSnapshot` dated today or yesterday (account timezone) | `medium` | One for (a) with the count and the oldest due time; one for (b) | (a) `/analytics/posts`, (b) `/analytics/account` |

11. A publication that has `status = failed` is not listed on its own: E08-S04 opens a review task with reason `publish_failed`, which appears as `review_task_open`.
12. A `publication_blocked` entry whose `blocked_reason` is `publishing_paused` is suppressed when a `publishing_off` entry exists, and one whose reason is `session_problem` is suppressed when a `connection_problem` entry exists, so one cause is not reported twice.
13. Every entry has a stable `id` (`"{type}:{object_id}"`, or `"{type}:aggregate"`), a `title` and `detail` in English, `since` (when the condition began: task `created_at`; job `finished_at`; blocked or due-by-hand publication `scheduled_at`; connection `last_error_at`; the oldest overdue time for metrics; for `publishing_off`, the creation time of the earliest affected publication), and `count` (1 unless aggregated).
14. Admin-only fixes are still listed for operators (they need to know), with `requires_admin: true` so the panel can say "Ask an admin".

### Next publications and sync

15. `next_publications` lists up to 5 publications with `status` in `scheduled`, `publishing`, `verifying`, ordered by `scheduled_at`, from now minus 1 hour onward (so an overdue one stays visible).
16. `sync` reports: `metrics_last_snapshot_at` (latest `MetricSnapshot.captured_at` with `source = provider` for the account), `metrics_overdue` (count from rule 10a), `followers_last_snapshot_date`, `connection_status`, `connection_last_verified_at`, `feeds_last_synced_at` (latest `FeedSource.last_synced_at` among active sources, or null).
17. `followers` reports `current` (latest snapshot) and `change_7d` (latest minus the snapshot from 7 days earlier, or the nearest earlier one within 10 days; null if none).

## Data

Read-only use of: `InstagramAccount`, `AccountConnection`, `WeeklyPlan`, `PlanGoal`, `PlanSlot`, `ContentItem`, `Brief`, `ScriptVersion`, `ReviewTask`, `JobRun`, `Publication`, `MetricSnapshot`, `AccountSnapshot`, `FeedSource`. See [DATA-MODEL.md](../../DATA-MODEL.md). No new tables or fields.

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
    "timezone": "Asia/Tehran",
    "publishing_enabled": false,
    "connection_status": "connected"
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
      "id": "review_task_open:31",
      "type": "review_task_open",
      "severity": "high",
      "title": "Review needed: \"Three planning mistakes\"",
      "detail": "Facts check escalated: one claim has no source.",
      "link": "/review/31",
      "since": "2026-12-01T15:42:10Z",
      "count": 1,
      "requires_admin": false
    },
    {
      "id": "publishing_off:1",
      "type": "publishing_off",
      "severity": "high",
      "title": "Publishing is off",
      "detail": "2 publications are scheduled; the next is due today at 18:00.",
      "link": "/settings/accounts/1?tab=automation",
      "since": "2026-12-01T16:05:00Z",
      "count": 2,
      "requires_admin": true
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
      "requires_admin": false
    },
    {
      "id": "metrics_sync_gap:aggregate",
      "type": "metrics_sync_gap",
      "severity": "medium",
      "title": "Metrics are overdue for 2 posts",
      "detail": "The oldest was due at 03:05. Check the Instagram connection or refresh manually.",
      "link": "/analytics/posts",
      "since": "2026-12-01T23:35:00Z",
      "count": 2,
      "requires_admin": false
    }
  ],
  "next_publications": [
    {
      "id": 18,
      "content_item": 44,
      "title": "Plan the week, not the day",
      "format": "reel",
      "scheduled_at": "2026-12-02T14:30:00Z",
      "status": "scheduled",
      "blocked_reason": "publishing_paused"
    },
    {
      "id": 19,
      "content_item": 46,
      "title": "Story: checklist reminder",
      "format": "story",
      "scheduled_at": "2026-12-03T06:00:00Z",
      "status": "scheduled",
      "blocked_reason": null
    }
  ],
  "sync": {
    "metrics_last_snapshot_at": "2026-12-01T21:05:31Z",
    "metrics_overdue": 2,
    "followers_last_snapshot_date": "2026-12-02",
    "connection_status": "connected",
    "connection_last_verified_at": "2026-12-02T01:00:07Z",
    "feeds_last_synced_at": "2026-12-02T06:00:02Z"
  },
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
PageContainer: "Overview"  ·  description "@demo_brand · Week of 28 Nov – 4 Dec"            [Refresh]
┌ This week ───────────────────────────────┐ ┌ Followers ────────────┐
│ Plan title · [Active]                    │ │ 12,840   ▲ 96 in 7 d  │
│ Objective (two lines, ContentText)       │ └───────────────────────┘
│ Slots  ██████░░░  2 of 9 published       │ ┌ Next publications ────┐
│ Goals  Reach 18,250 / 50,000  (37%)      │ │ Today 18:00  Reel …   │
│        Saves 131 / 400        (33%)      │ │ Tomorrow 09:30 Story… │
└──────────────────────────────────────────┘ └───────────────────────┘
┌ Pipeline ────────────────────────────────────────────────────────────┐
│ Plan & select 2 │ Create 1 │ Check 0 │ Needs you 1 │ Ready 2 │ Published 2 │ Problems 0 │
└──────────────────────────────────────────────────────────────────────┘
┌ Needs attention (4) ─────────────────────┐ ┌ Sync health ──────────┐
│ ● Review needed: "Three planning…"  Open │ │ Instagram  [Connected]│
│ ● Publishing is off          Ask an admin│ │ Metrics    9 h ago    │
│ ● Render failed: "Checklist reel"   Open │ │ Followers  today      │
│ ● Metrics are overdue for 2 posts   Open │ │ Feeds      30 min ago │
└──────────────────────────────────────────┘ └───────────────────────┘
```

### Components

| Card | Component | Detail |
| --- | --- | --- |
| This week | `ProCard` | Plan title linking to `/plans/{id}`, `StatusTag` for the plan status, objective in `ContentText` (clamped to two lines). Slots: `Progress` with `published / total` and a caption "{published} of {total} published · {scheduled} scheduled · {open} open". Goals: one row per goal — metric label, "{actual} / {target}" with thousands separators, `Progress` capped at 100% with the percentage as text; "—" when `actual` is null; a small "partial" tag with tooltip "Some posts have no value for this metric yet" when `partial`. |
| Followers | `StatisticCard` | Current count; change over 7 days with an up or down arrow and the words "in 7 d"; "No data yet" when null. Links to `/analytics/account`. |
| Next publications | `ProCard` + `List` | Up to five rows: `DateTime` (account time, relative day name), format tag, title in `ContentText`, `StatusTag`; a red line under the row with the blocked reason text when `blocked_reason` is set ("Waiting: publishing is off", "Waiting: Instagram connection problem", "Waiting: daily limit reached"). Footer link "Open calendar". |
| Pipeline | `ProCard` with seven `Statistic` tiles | Tiles and the statuses they sum: "Plan & select" (`selected`, `briefed`), "Create" (`scripted`, `in_production`), "Check" (`in_check`, `needs_revision`), "Needs you" (`in_review` plus `items_waiting.brief_approval` and `items_waiting.script_approval`, shown as a breakdown in the tooltip), "Ready" (`approved`, `scheduled`, `publishing`), "Published" (`published`), "Problems" (`failed`). Each tile links to `/content?plan={id}&status={comma-separated statuses}`. Tile colours follow the status colour mapping; the number always has its label. |
| Needs attention | `ProCard` + `List` | Title with the total count. Each row: severity icon with accessible name ("High", "Medium", "Low") and matching tag colour (error, warning, default), title, detail in grey, relative time from `since` with the exact time in a tooltip, and a link button "Open". Rows with `requires_admin` show "Ask an admin" instead of "Open" for operators (admins get "Open"). If `attention_count` exceeds the rows shown: a footer "Showing 20 of {n}". |
| Sync health | `ProDescriptions` | Instagram: `StatusTag` for the connection status and "verified {relative time}". Metrics: relative time of the last snapshot and, if `metrics_overdue > 0`, "{n} overdue" in warning colour. Followers: date of the last snapshot. Feeds: relative time of the last sync, or "No feed sources". |

### Top bar

- The attention count badge (a bell icon with accessible name "Attention items") shows `attention_count` and links to `/overview`. It reads the same endpoint through a shared React Query key and refetches every 60 seconds and on window focus.
- The publishing indicator shows green "Publishing on" or red "Publishing off" from `account.publishing_enabled`.

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
2. Given two published posts with reach 10,000 and 8,250 in their latest snapshots and a reach goal of 50,000, when the endpoint is called, then the reach goal shows `actual = 18250` and `attainment = 0.37`.
3. Given an open review task, when the endpoint is called, then the attention list contains a `review_task_open` entry with severity `high` linking to `/review/{id}`, and the top-bar badge count includes it.
4. Given the review task is resolved, when the page refreshes, then the entry is gone and the count is one lower.
5. Given `publishing_enabled = false` and a publication due in three hours, when the endpoint is called, then there is one `publishing_off` entry with severity `high`, and no separate `publication_blocked` entry for the same publication.
6. Given the connection status is `challenge_required`, when the endpoint is called, then there is one `connection_problem` entry with `requires_admin = true`, and an operator sees "Ask an admin" instead of "Open".
7. Given a render job failed an hour ago and a later job of the same kind for the same item succeeded, when the endpoint is called, then no `job_failed` entry is returned for it.
8. Given a published post whose `next_metrics_at` was two hours ago, when the endpoint is called, then a `metrics_sync_gap` entry reports one overdue post, and `sync.metrics_overdue = 1`.
9. Given 14 open review tasks, when the endpoint is called, then 10 single entries and one aggregated entry are returned for that type, and `attention_count` counts all 14.
10. Given no plan covers this week, when the page opens, then the plan card shows the empty state with "Create weekly plan" and the rest of the page still renders.
11. Given the operator clicks the "Needs you" tile, when the content list opens, then it is filtered to the plan and the statuses behind that tile.
12. Given two calls within 30 seconds, when neither uses `fresh=1`, then the second is served from cache; with `fresh=1` it is recomputed.
13. Given a request without `account`, when the endpoint is called, then the response is `400 validation_error` on `account`.
14. Given a publication with `delivery = manual` whose time passed 20 minutes ago, when the endpoint is called, then there is one `publication_due_by_hand` entry linking to `/content/{id}?tab=publishing` and no `publication_blocked` entry for it.
15. Given a failed `publish.verify` job (`target_type = publication`), then its `job_failed` entry links to `/calendar?focus={publication_id}`; a failed `repurpose.suggest` job links to `/selection`.
14. Given 500 content items and 200 publications in the account, when the endpoint is called without cache, then it uses at most 15 queries.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E11-S01-BE1 | Plan, pipeline and sync aggregates | `apps/core/services/overview.py`: plan selection (rule 5), slot counts, goal actuals (rule 7), `items_by_status`, `items_waiting`, `next_publications`, `sync`, `followers`. Aggregate queries only; add missing indexes in a migration. Unit tests with factories, including null metrics and missing snapshots. | 0.5 |
| E11-S01-BE2 | Attention builders | One function per type in `apps/core/services/attention.py` implementing the table in rule 10 with caps, aggregation, suppression (rule 12), stable IDs, `since`, `requires_admin`, and fixed English texts per reason and error code. Tests for each condition, its boundary (10 minutes, 60 minutes, 48 hours, 24 hours) and the suppression rules. | 0.5 |
| E11-S01-BE3 | Endpoint | `GET /overview/` view and serializer, account validation, 30-second cache with `fresh` bypass, query-count test (≤ 15), `openapi.yaml` entry. | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E11-S01-FE1 | Page, plan card and pipeline tiles | `src/pages/overview/index.tsx`, route and `/` redirect in `config/routes.ts`, `useOverview` query hook (60-second refetch, `fresh` refresh), plan card with slots and goals, followers card, pipeline tiles with links and tooltips, empty and draft states. | 1 |
| E11-S01-FE2 | Attention list, next publications, sync health | The three cards with severity icons, `DateTime`, blocked-reason lines, "Ask an admin" handling, footers and empty states; English text maps for blocked reasons. | 1 |
| E11-S01-FE3 | Top bar wiring and states | Attention badge and publishing indicator in the layout (`src/app.tsx` `actionsRender`), shared query key, error and loading states for page and badge, component tests for the main states. | 0.5 |

### Test

None beyond the tests in each subtask. The page is part of the end-to-end path in E11-S03.

## Test notes

- **Service:** freeze time; build an account with one record for every attention condition and assert the exact list, order and count. Then fix each cause in turn and assert its entry disappears.
- **Goals:** cases for a goal limited to one format, a metric that is null in the latest snapshot (`partial`), a week with no published posts (`actual = 0`), and missing follower snapshots (`actual = null`).
- **Timezones:** an account in `Asia/Tehran` just after local midnight on the first day of a week — the new week's plan must be chosen, not the previous one.
- **API:** permissions, validation, cache behaviour, query count.
- **Panel:** component tests with fixture payloads for: full data, no plan, draft plan, empty attention, operator versus admin on `requires_admin`, error.

## Later

- Notifications: call the attention builders from a periodic task and send new `high` entries to a channel; entry IDs are stable, so "new" is a set difference.
- Dismiss and snooze: a small table keyed by account and entry ID.
- All-accounts view for admins: run the same service per account and list accounts with their counts.
- More attention types (plan missing for next week, slots still open two days before their time): add a builder function; nothing else changes.
