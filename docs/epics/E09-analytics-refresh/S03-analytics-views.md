# E09-S03 — Analytics views, manual refresh and manual entry

| | |
| --- | --- |
| Epic | E09 Analytics refresh |
| Priority | Must |
| Estimate | BE 1.5 d · FE 4 d |
| Depends on | E00-S02, E00-S06, E03-S04, E09-S01, E09-S02 |
| Needed by | E10-S01, E10-S02, E11-S01 |

## User story

As an operator, I want to see each post's numbers at every age, the account's follower curve and how fresh the data is, to pull fresh numbers when I need them, and to type numbers in when Instagram does not provide them, so that I can judge the week and the evaluation step always has data.

## Context

E09-S01 and E09-S02 collect snapshots in the background. This story makes them visible and fills the gaps: the post metrics list, a post detail page with the metric curve, the followers page, and the Performance tab of the item workspace. It adds the "Refresh metrics" job and manual entry, which is the only metrics source for accounts on the `manual` provider or without insights.

E10-S01 builds on these pages: it adds a verdict column and filter to the post list, and an evaluation card below the chart on the post page and the Performance tab.

## Scope

**In**

- Endpoints: refresh job, post list, post detail, manual post snapshot, follower series, manual follower snapshot, sync status.
- Panel pages `/analytics/posts`, `/analytics/posts/:publicationId`, `/analytics/account`, and the Performance tab of `/content/:id`.
- Shared components: `MetricCell`, `CheckpointTable`, `MetricCurve`, `SyncStatusLine`, `ManualSnapshotModal`.

**Out (later)**

- Exports (CSV, PDF).
- Comparing several posts on one chart.
- Editing or deleting provider snapshots other than by replacement.

## Behaviour and rules

### Metrics status of a post

1. Every published post has a derived `metrics_status`, checked in this order:

   | Value | Condition |
   | --- | --- |
   | `overdue` | `next_metrics_at` is more than 60 minutes in the past (`SOCIALHUB_METRICS_OVERDUE_MINUTES`) |
   | `needs_manual_entry` | A checkpoint that E10-S01 evaluates (`24h`, `7d`, `23h`) is skipped with reason `insights_unavailable` and has no captured row |
   | `collecting` | `next_metrics_checkpoint` is not null |
   | `complete` | Pointer is null and the final checkpoint is captured |
   | `incomplete` | Pointer is null and the final checkpoint is skipped |

2. Each checkpoint of a post has a derived status on the detail endpoint: `captured`, `skipped` (with `skip_reason`), `due` (its time has passed by at most 60 minutes and it is the pointer), `overdue` (passed by more than 60 minutes and it is the pointer), `upcoming` (its time is in the future).
3. "Latest metrics" of a post means the most recent `captured` snapshot by `captured_at`, including `adhoc` and manual ones.

### Refresh

4. `POST /analytics/refresh/` starts a job of kind `analytics.refresh`. With `publication` it targets that post (`target_type = publication`); without it, the whole account (`target_type = account`).
5. **Publication refresh.** If a checkpoint of the post is due (E09-S01 rule 6), the job captures it as that checkpoint. Otherwise it captures an `adhoc` snapshot, unless the post has an `adhoc` snapshot younger than 15 minutes, in which case it captures nothing and reports `recent`.
6. **Account refresh.** In order: (a) every due checkpoint of the account's published posts, at most 30; (b) an `adhoc` snapshot for each post published in the last 7 days whose latest captured snapshot is older than 60 minutes, at most 20; (c) today's follower snapshot if none exists (E09-S02, `snapshot_followers`).
7. The job uses `apps.instagram.session.account_session(account, wait_seconds=60)` (E00-S04) per post, the normal 60-second lock wait, and calls the provider with the `(provider, token)` it yields; publishing therefore keeps priority. It updates `progress` as `processed / total × 100` and `message`, for example "Reading 3 of 8 posts".
8. Errors inside the job follow E09-S01 rule 17, with these job results: `TokenInvalid` ends the job `failed` with `token_invalid` and `PermissionMissing` with `permission_missing` (both after `report_connection_error`); `RateLimited`, and `AccountBusy` when the lock is not free within 60 seconds, end it `failed` with `rate_limited` (`RateLimited` also sets the backoff key); per-post transient errors are listed in `result.errors` and the job succeeds when at least one read succeeded, otherwise it fails with `provider_error`.
9. Limits: one active `analytics.refresh` job per account (`409 job_in_progress`). An account refresh may start at most once every 10 minutes per account (`429 rate_limited` with `Retry-After`). Refresh is refused with `409 insights_unavailable` for metrics-by-hand accounts (provider `manual` or `insights` false) and with `409 instagram_not_connected` when the connection is `disconnected` or `needs_attention`.

### Manual post snapshot

10. `POST /analytics/posts/{publication_id}/snapshots/` records numbers typed by a person, with `source = manual`. The publication must be `published`.
11. `checkpoint` is one of the post format's checkpoints or `adhoc`.
12. `captured_at` is when the numbers were read; default now. It may not be more than 5 minutes in the future, nor before `published_at`. `age_minutes` is computed from it.
13. For a scheduled checkpoint, the age at `captured_at` must be at least the checkpoint's age (`checkpoint_not_reached`). For a non-final checkpoint it must not exceed the skip age from E09-S01 rule 1 (`checkpoint_passed`): numbers read three days after posting are not 24-hour numbers. The operator can back-date `captured_at` if the numbers were noted earlier. The final checkpoint has no upper limit.
14. At least one metric must be given. Each value is an integer from 0 to 2,000,000,000. A metric that does not apply to the format (E09-S01 rule 16) is rejected with `not_applicable`. Applicable metrics left out are stored as null and listed in `unavailable`.
15. Existing row for a scheduled checkpoint:

    | Existing row | Result |
    | --- | --- |
    | None | Created, `201` |
    | `skipped` (any reason) | Replaced: `status = captured`, `skip_reason` null, `source = manual`; `200` |
    | `captured`, `source = manual` | Replaced; `200` |
    | `captured`, `source = provider` | `409 state_conflict` with `details.reason = "snapshot_exists"`, unless `replace: true`, then replaced and the old values kept in `extra.replaced`; `200` |

16. When the checkpoint is the one the pointer names, the pointer moves on (E09-S01 rule 24). A checkpoint behind the pointer leaves it unchanged.
17. If a `PerformanceEvaluation` exists for this publication and checkpoint, it is deleted in the same transaction, so E10-S01's scheduled evaluation recomputes it within 15 minutes. The response reports `evaluation_reset: true`.
18. A `ContentEvent` of type `note` is written: "24 h metrics entered by Sara" (or "replaced").

### Manual follower snapshot

19. `POST /analytics/account/snapshots/` records a follower count for a local date, with `source = manual` and `captured_at = now`. `date` must be today or earlier in the account's timezone and not older than 400 days. `followers` is required (0–2,000,000,000); `following` and `media_count` are optional.
20. An existing provider row for that date returns `409 state_conflict` with `details.reason = "snapshot_exists"` unless `replace: true`. A manual row is replaced. `follower_change` is recomputed for that date and the next (E09-S02 rules 11–12).

### Follower series

21. `GET /analytics/account/` returns the rows dated `from` to `to` inclusive (local dates). Defaults: `to` = today, `from` = `to` − 29 days. `from <= to`, at most 366 days.
22. `period` is `follower_change(account, from, to − 1 day)` from E09-S02, which compares the earliest and latest rows dated `from` to `to`. The weekly report (E10-S02) uses the plan-week form instead, because a snapshot describes the start of its day.

### Permissions

23. All endpoints in this story are open to both roles. Manual entry and refresh are operational actions, not settings.

## Data

Reads `Publication`, `MetricSnapshot`, `AccountSnapshot`, `ContentItem`, `ContentVersion`, `Asset`, `AccountConnection`; deletes `PerformanceEvaluation` rows (rule 17); writes `MetricSnapshot`, `AccountSnapshot`, `ContentEvent`, `JobRun`. No new fields beyond E09-S01 and E09-S02.

`thumbnail_url` of a post is the signed URL of the version's `cover_asset`, else its `final_asset` when that is an image, else the first frame asset, else null.

## API

### `POST /api/v1/analytics/refresh/`

```json
{"account": 3, "publication": 57}
```

`publication` is optional. Response `202`:

```json
{
  "job": {
    "id": "5d1f6a3c-2b9e-4f7d-8a61-0e4c9b2f7a10",
    "kind": "analytics.refresh",
    "status": "queued",
    "progress": 0,
    "message": "",
    "target_type": "publication",
    "target_id": "57",
    "result": null,
    "error_code": null,
    "error_detail": null,
    "created_at": "2026-11-29T16:20:04Z",
    "started_at": null,
    "finished_at": null
  }
}
```

Result of a finished account refresh:

```json
{
  "checkpoints_captured": 2,
  "checkpoints_skipped": 1,
  "adhoc_captured": 5,
  "recent": 1,
  "followers": "created",
  "errors": [{"publication": 61, "code": "transient"}]
}
```

`followers` is `created`, `exists`, `skipped` (metrics-by-hand) or `failed`.

| Case | Response |
| --- | --- |
| `account` missing | `400 validation_error`, field `account`, code `required` |
| Publication not found, not in the account, or not `published` | `400 validation_error`, field `publication`, code `does_not_exist` or `not_published` |
| A refresh job is active for the account | `409 job_in_progress`, `details.job` |
| Account refresh within 10 minutes of the last one | `429 rate_limited`, header `Retry-After` in seconds |
| Provider `manual` or `insights` false | `409 insights_unavailable` |
| Connection `disconnected` or `needs_attention` | `409 instagram_not_connected` |

### `GET /api/v1/analytics/posts/?account={id}`

Filters: `plan`, `format` (comma-separated), `published_after`, `published_before` (dates, account timezone, inclusive), `metrics_status` (comma-separated). E10-S01 adds `verdict`. Ordering: `published_at`, `-published_at` (default), and `reach`, `views`, `saves`, `shares`, `likes`, `comments` with a minus sign for descending; ordering by a metric uses the latest metrics, nulls last.

```json
{
  "count": 1,
  "next": null,
  "previous": null,
  "results": [
    {
      "publication": 57,
      "content_item": {"id": 88, "title": "Three ways to style a small entryway"},
      "plan": 12,
      "format": "reel",
      "published_at": "2026-11-28T15:31:10Z",
      "published_via": "provider",
      "permalink": "https://www.instagram.com/reel/DC0aBcDeFgH/",
      "thumbnail_url": "/media/accounts/3/2026/11/412-cover.png",
      "age_minutes": 1489,
      "latest": {
        "snapshot": 733,
        "checkpoint": "24h",
        "captured_at": "2026-11-29T15:40:02Z",
        "age_minutes": 1448,
        "source": "provider",
        "reach": 8412,
        "views": 13950,
        "likes": 611,
        "comments": 37,
        "saves": 184,
        "shares": 92,
        "replies": null,
        "unavailable": []
      },
      "next_metrics_checkpoint": "72h",
      "next_metrics_at": "2026-12-01T15:31:10Z",
      "metrics_status": "collecting"
    }
  ]
}
```

`latest` is null when nothing has been captured yet. E10-S01 adds `latest_evaluation` to each row.

### `GET /api/v1/analytics/posts/{publication_id}/`

```json
{
  "publication": 57,
  "account": 3,
  "content_item": {"id": 88, "title": "Three ways to style a small entryway"},
  "format": "reel",
  "published_at": "2026-11-28T15:31:10Z",
  "published_via": "provider",
  "permalink": "https://www.instagram.com/reel/DC0aBcDeFgH/",
  "thumbnail_url": "/media/accounts/3/2026/11/412-cover.png",
  "applicable_metrics": ["reach", "views", "likes", "comments", "saves", "shares"],
  "insights_source": "provider",
  "metrics_status": "collecting",
  "checkpoints": [
    {
      "checkpoint": "1h", "target_at": "2026-11-28T16:31:10Z", "is_final": false, "status": "captured", "skip_reason": null,
      "snapshot": {"id": 701, "captured_at": "2026-11-28T16:40:05Z", "age_minutes": 68, "on_time": true, "source": "provider",
                   "reach": 1204, "views": 1890, "likes": 98, "comments": 6, "saves": 21, "shares": 9, "replies": null, "unavailable": []}
    },
    {
      "checkpoint": "6h", "target_at": "2026-11-28T21:31:10Z", "is_final": false, "status": "skipped", "skip_reason": "missed",
      "snapshot": null
    },
    {
      "checkpoint": "24h", "target_at": "2026-11-29T15:31:10Z", "is_final": false, "status": "captured", "skip_reason": null,
      "snapshot": {"id": 733, "captured_at": "2026-11-29T15:40:02Z", "age_minutes": 1448, "on_time": true, "source": "provider",
                   "reach": 8412, "views": 13950, "likes": 611, "comments": 37, "saves": 184, "shares": 92, "replies": null, "unavailable": []}
    },
    {"checkpoint": "72h", "target_at": "2026-12-01T15:31:10Z", "is_final": false, "status": "upcoming", "skip_reason": null, "snapshot": null},
    {"checkpoint": "7d", "target_at": "2026-12-05T15:31:10Z", "is_final": true, "status": "upcoming", "skip_reason": null, "snapshot": null}
  ],
  "adhoc": [
    {"id": 740, "captured_at": "2026-11-29T16:21:30Z", "age_minutes": 1490, "source": "provider",
     "reach": 8530, "views": 14120, "likes": 618, "comments": 37, "saves": 186, "shares": 93, "replies": null, "unavailable": []}
  ],
  "last_synced_at": "2026-11-29T16:21:30Z"
}
```

`adhoc` lists the 20 newest ad hoc snapshots. `last_synced_at` is the newest `captured_at` among the post's snapshots.

### `POST /api/v1/analytics/posts/{publication_id}/snapshots/`

```json
{
  "checkpoint": "24h",
  "captured_at": "2026-11-29T16:05:00Z",
  "reach": 4210,
  "views": 6900,
  "likes": 312,
  "comments": 18,
  "saves": 96,
  "shares": 41,
  "replace": false
}
```

Response `201` (or `200` when replacing):

```json
{
  "snapshot": {
    "id": 752, "checkpoint": "24h", "status": "captured", "captured_at": "2026-11-29T16:05:00Z", "age_minutes": 1473,
    "on_time": false, "source": "manual", "reach": 4210, "views": 6900, "likes": 312, "comments": 18, "saves": 96,
    "shares": 41, "replies": null, "unavailable": []
  },
  "replaced": false,
  "evaluation_reset": false,
  "next_metrics_checkpoint": "72h",
  "next_metrics_at": "2026-12-01T15:31:10Z"
}
```

| Case | Response |
| --- | --- |
| Publication not `published` | `409 invalid_transition` |
| `checkpoint` not valid for the format | `400 validation_error`, field `checkpoint`, code `invalid_choice` |
| `captured_at` in the future or before publishing | `400 validation_error`, field `captured_at`, code `out_of_range` |
| Age below the checkpoint age | `400 validation_error`, field `captured_at`, code `checkpoint_not_reached` |
| Age above the skip age of a non-final checkpoint | `400 validation_error`, field `captured_at`, code `checkpoint_passed` |
| No metric given | `400 validation_error`, code `metrics_required` |
| Metric not applicable to the format | `400 validation_error`, field such as `replies`, code `not_applicable` |
| Value outside 0–2,000,000,000 | `400 validation_error`, code `min_value` or `max_value` |
| Provider snapshot exists and `replace` is false | `409 state_conflict`, `details.reason = "snapshot_exists"`, `details.snapshot` |

### `GET /api/v1/analytics/account/?account={id}&from=2026-11-05&to=2026-12-04`

```json
{
  "account": 3,
  "timezone": "Asia/Tehran",
  "from": "2026-11-05",
  "to": "2026-12-04",
  "points": [
    {"date": "2026-12-02", "followers": 12655, "following": 381, "media_count": 214, "follower_change": 38, "source": "provider", "captured_at": "2026-12-01T20:42:11Z"},
    {"date": "2026-12-03", "followers": 12690, "following": null, "media_count": null, "follower_change": 35, "source": "manual", "captured_at": "2026-12-03T09:15:40Z"}
  ],
  "missing_dates": ["2026-12-04"],
  "period": {
    "start": {"date": "2026-11-05", "followers": 11902},
    "end": {"date": "2026-12-03", "followers": 12690},
    "change": 788,
    "exact": false
  },
  "current": {"date": "2026-12-03", "followers": 12690},
  "insights_source": "provider"
}
```

The example shortens `points`; a real response holds one point per existing row in the range, ordered by date. `period` is null when fewer than two rows exist. `current` is the newest row overall, or null.

| Case | Response |
| --- | --- |
| `from` after `to`, or a range over 366 days | `400 validation_error`, field `from`, code `invalid_range` |
| `to` after today (account timezone) | `400 validation_error`, field `to`, code `out_of_range` |

### `POST /api/v1/analytics/account/snapshots/`

```json
{"account": 3, "date": "2026-12-04", "followers": 12731, "following": null, "media_count": null, "replace": false}
```

Response `201` (or `200` when replacing) with the point shape plus `replaced`. Errors: `date` in the future or older than 400 days → `400 validation_error`, code `out_of_range`; `followers` missing → `required`; provider row exists and `replace` is false → `409 state_conflict`, `details.reason = "snapshot_exists"`.

### `GET /api/v1/analytics/sync-status/?account={id}`

```json
{
  "account": 3,
  "insights_source": "provider",
  "metrics_last_snapshot_at": "2026-11-29T16:21:30Z",
  "metrics_overdue": 2,
  "metrics_oldest_overdue_at": "2026-11-29T13:31:10Z",
  "needs_manual_entry": 0,
  "collector": {"last_success_at": "2026-11-29T16:21:30Z", "last_error_code": "transient", "last_error_at": "2026-11-29T15:10:03Z", "consecutive_failures": 0},
  "followers_last_snapshot_date": "2026-11-29",
  "followers_overdue": false
}
```

## Background work

| Task | Queue | Trigger | Idempotency and retries |
| --- | --- | --- | --- |
| `analytics.refresh(job_id)` | `default` | `POST /analytics/refresh/` | One active job per account; snapshot writes use the E09-S01 writer, so a re-delivered task cannot duplicate checkpoint rows; ad hoc rows are protected by the 15-minute rule; no Celery retries |

## AI

None.

## Panel

### Shared components (`src/components/analytics/`)

| Component | Behaviour |
| --- | --- |
| `MetricCell` | Shows a number with thousands separators. Null on a non-applicable metric shows "—". A metric listed in `unavailable` shows "N/A" with the tooltip "Instagram did not return this metric." A manual value has a small pencil icon with the tooltip "Entered by hand". |
| `CheckpointTable` | Rows per checkpoint: Checkpoint ("1 h", "6 h", "23 h", "24 h", "72 h", "7 d"), status `StatusTag`, Captured (`DateTime`), Age ("24 h 8 min", with "late" in warning colour when `on_time` is false), one `MetricCell` column per applicable metric, Source. Skipped rows show the reason text below. An "Enter metrics" link appears on rows that are skipped, due or overdue. Ad hoc snapshots follow under a divider headed "Ad hoc readings". |
| `MetricCurve` | `@ant-design/plots` line chart. X axis "Age (hours)", numeric; Y axis is the selected metric's name. A segmented control picks the metric (applicable metrics only, default Reach). Points are the captured checkpoints plus ad hoc readings; checkpoint points are labelled ("24 h"); skipped checkpoints leave a gap. A "Table" toggle shows the same data as a table. With fewer than two points, the chart is replaced by "The curve appears after two readings." |
| `SyncStatusLine` | One line from sync status: "Last synced 12 min ago", followed when relevant by "2 posts overdue" (warning), "1 post needs manual entry" (warning), "Metrics are entered by hand for this account" (info). Refetched every 60 seconds. |
| `ManualSnapshotModal` | `ModalForm` titled "Enter metrics". Fields: Checkpoint (select; options are reached checkpoints that are not provider-captured, plus "Now (ad hoc)"; provider-captured ones are listed disabled with "Captured"), Read at (date-time in the account timezone, default now), one number input per applicable metric with its label, and, when the chosen checkpoint already has numbers, a checkbox "Replace the numbers Instagram returned" with a warning text. Helper text under Read at: "The time you read these numbers on Instagram. 24 h numbers must be read between 24 and 36 hours after posting." Submit label "Save metrics". API field errors appear under their fields; `snapshot_exists` shows the replace checkbox and the message "Instagram numbers already exist for 24 h." |

Labels and tag colours for `metrics_status`: Overdue (warning), Needs manual entry (warning), Collecting (processing), Complete (success), Incomplete (default). Checkpoint status: Captured (success), Skipped (default), Due (processing), Overdue (warning), Upcoming (default). Skip reasons: `missed` "Not captured in time", `insights_unavailable` "Instagram metrics are not available for this account. Enter them by hand.", `media_not_found` "The post is no longer on Instagram.", `expired` "The story expired before its metrics were read.", `gave_up` "Stopped after 7 days without a reading."

### Post metrics — `/analytics/posts`

- `PageContainer` titled "Post metrics", description `SyncStatusLine`, primary action `JobButton` "Refresh metrics" (account refresh). While the job runs it shows `JobProgress`; when it ends the table reloads and a message reads "Metrics refreshed: 7 readings" or, for a failure, a notification with the error text and a link to the connection page for connection errors (`token_invalid`, `permission_missing`). The button is hidden for metrics-by-hand accounts and disabled with a tooltip for 10 minutes after a refresh ("You can refresh again in 6 minutes").
- `ProTable`, 20 rows per page, server ordering. Columns: Post (thumbnail 40 px and title, linking to `/analytics/posts/{publication}`), Format, Published (`DateTime`), Age, Latest ("24 h" tag, or "Ad hoc" with its age), Reach, Views, Saves, Shares, Likes, Comments, Replies (shown only when the format filter includes stories), Metrics status. Metric columns are sortable.
- Filters in the table form: Plan (select of the account's plans, default the current plan from `GET /plans/current/`, with an "All plans" option), Format (multi-select), Published (date range), Metrics status (multi-select).
- Row action menu: "Open", "Refresh now" (publication refresh), "Enter metrics", "View on Instagram" (opens the permalink in a new tab).
- Empty state: "No published posts yet. Metrics appear here once a post is live." With filters active: "No posts match these filters." and a "Clear filters" link.

### Post detail — `/analytics/posts/:publicationId`

- Header: content item title (link to `/content/{id}`), format tag, published time, `metrics_status` tag, "View on Instagram", `JobButton` "Refresh now" (publication refresh), button "Enter metrics".
- Card "Latest": `StatisticCard` row for Reach, Saves and Shares (stories: Reach, Replies, Shares) from the latest snapshot, each with its age ("at 24 h"), plus "Last synced 4 min ago".
- Card "By checkpoint": `CheckpointTable`.
- Card "Curve": `MetricCurve`.
- Below: the evaluation card slot that E10-S01 fills.
- After a manual entry that reset an evaluation, a message reads "Metrics saved. The evaluation will update within 15 minutes."

### Followers — `/analytics/account`

- `PageContainer` titled "Followers", description `SyncStatusLine`, actions: date range picker with presets "7 days", "30 days" (default), "90 days" and a custom range; button "Enter follower count".
- `StatisticCard` row: "Followers" (current count and its date), "Change" (`period.change` with an up or down arrow; the tooltip states the span, for example "From 5 Nov (11,902) to 3 Dec (12,690)"; when `exact` is false the card adds "Some days are missing"), "Missing days" (count of `missing_dates`, warning colour when above 0).
- Line chart of followers by date with axis titles "Date" and "Followers"; missing dates are gaps, never joined. Manual points have a hollow marker and the tooltip "Entered by hand". A "Table" toggle shows Date, Followers, Change, Following, Posts, Source.
- "Enter follower count" opens a `ModalForm`: Date (default today, no future dates), Followers (required), Following and Posts (optional), and a replace checkbox when the date already has Instagram's number. Submit label "Save count".
- Empty state: "No follower counts yet. The first one is recorded tonight after midnight." For metrics-by-hand accounts: "Follower counts for this account are entered by hand." with the button "Enter follower count".

### Performance tab — `/content/:id?tab=performance`

- Before publishing: `TabPlaceholder` with "Metrics appear here once the post is live."
- After publishing: the "Latest" card, `CheckpointTable` and `MetricCurve` from the post detail page, with the "Refresh now" and "Enter metrics" actions, and a link "Open in Analytics". The evaluation card from E10-S01 follows below.

### States on every analytics view

| State | Behaviour |
| --- | --- |
| Loading | Skeletons in the statistic cards, table and chart |
| Error | Inline `Result` with the English text for the error code, Retry and the request ID |
| Job running | "Refresh" buttons show progress; "Enter metrics" stays available |
| Overdue data | `SyncStatusLine` warning plus the row tags; nothing is hidden |
| No account selected | The shell's account prompt (E00-S02) |

## Acceptance criteria

1. Given a reel with `1h` and `24h` captured and `6h` skipped, when I open its post page, then the checkpoint table shows two captured rows, one skipped row with "Not captured in time", and `72h` and `7d` as upcoming.
2. Given a post whose `next_metrics_at` was 90 minutes ago, then its row in the list has the status "Overdue" and `SyncStatusLine` reads "1 post overdue".
3. Given I press "Refresh now" on a post with no due checkpoint, then an ad hoc reading appears under "Ad hoc readings" when the job finishes; pressing it again within 15 minutes adds no reading and the job result says `recent`.
4. Given an account refresh finished 4 minutes ago, when I call the refresh endpoint for the account again, then I get `429 rate_limited` with `Retry-After` 360 or less.
5. Given an account on the `manual` provider, when I call refresh, then I get `409 insights_unavailable`, and the "Refresh metrics" button is not shown.
6. Given a reel's `24h` checkpoint is skipped with `insights_unavailable`, when I enter its metrics with `captured_at` 25 hours after publishing, then the row becomes captured with `source = manual`, the post leaves "Needs manual entry", and a note event is on the item.
7. Given I enter `24h` metrics with `captured_at` 40 hours after publishing, then I get `checkpoint_passed`; given 20 hours, then I get `checkpoint_not_reached`.
8. Given a story, when I enter `saves`, then I get `not_applicable` on `saves`.
9. Given a provider `24h` snapshot exists, when I enter `24h` numbers without `replace`, then I get `409` with `snapshot_exists`; with `replace: true` the numbers are replaced and the old values are kept in `extra.replaced`.
10. Given a `24h` evaluation exists, when I replace the `24h` numbers, then the evaluation row is deleted and the response has `evaluation_reset: true`.
11. Given follower rows exist for 5 Nov to 3 Dec except 20 Nov, when I open the followers page for 5 Nov – 4 Dec, then the chart has a gap at 20 Nov, "Missing days" shows 2 (20 Nov and 4 Dec), and the change is 12,690 − 11,902 = 788.
12. Given I enter 12,731 followers for 4 Dec, then the 4 Dec point appears with a hollow marker and its `follower_change` is computed against 3 Dec.
13. Given a published item, when I open its Performance tab, then I see the latest numbers, the checkpoint table and the curve; for an unpublished item I see the placeholder sentence.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E09-S03-BE1 | Post list and detail | Serializers and views for `GET /analytics/posts/` and `/{publication_id}/`: latest-snapshot subquery annotations, metric ordering with nulls last, filters, `metrics_status` and checkpoint status derivation, `thumbnail_url`, `on_time`; query-count test for the list | 0.5 |
| E09-S03-BE2 | Manual entry | `POST /analytics/posts/{id}/snapshots/` and `POST /analytics/account/snapshots/`: validation rules 11–14 and 19, replacement table, pointer guard, evaluation reset, event note, follower change recomputation; API tests for every error row | 0.5 |
| E09-S03-BE3 | Refresh, follower series, sync status | `analytics.refresh` task with rules 5–9, cooldown key, job progress and result; `GET /analytics/account/` with range rules and `period`; `GET /analytics/sync-status/`; `openapi.yaml` for all seven endpoints and the `insights_unavailable` code | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E09-S03-FE1 | Shared analytics components | `MetricCell`, `CheckpointTable`, `MetricCurve` (with table toggle and gaps), `SyncStatusLine`; label maps for statuses, checkpoints and skip reasons; component tests | 1 |
| E09-S03-FE2 | Post metrics page | `src/pages/analytics/posts/index.tsx`: table, filters with current-plan default, sortable metric columns, row actions, refresh `JobButton` with cooldown and hidden state, empty states | 0.75 |
| E09-S03-FE3 | Post detail and manual entry | `src/pages/analytics/posts/[publicationId].tsx`: header actions, latest card, table, curve, evaluation slot; `ManualSnapshotModal` with checkpoint options, age helper, replace flow and error mapping | 1 |
| E09-S03-FE4 | Followers page | `src/pages/analytics/account/index.tsx`: range presets, statistic cards with span tooltip, gapped line chart with manual markers, table toggle, follower entry modal, empty states | 0.75 |
| E09-S03-FE5 | Performance tab | `src/pages/content/workspace/tabs/Performance.tsx` reusing the detail cards; placeholder before publishing; reload after refresh and manual entry | 0.5 |

### Test

None beyond the tests inside each subtask.

## Test notes

- API tests with factories: a reel and a story with a mix of captured, skipped and ad hoc rows; an account with a missing day; a metrics-by-hand account.
- A test that the list's `latest` picks an ad hoc reading newer than the last checkpoint.
- A test that ordering by `saves` puts posts without metrics last in both directions.
- Panel tests: `MetricCell` renders "—", "N/A" and the manual icon correctly; `MetricCurve` breaks the line at a skipped checkpoint; `ManualSnapshotModal` disables provider-captured checkpoints and shows the replace checkbox on `snapshot_exists`; the followers chart leaves a gap for a missing date.
- The fake provider's partial scenario (`shares` missing) is used to check the "N/A" display end to end.

## Later

- CSV export of the post table and the follower series.
- Overlaying several posts' curves, aligned by age, for side-by-side comparison.
- An audit trail for replaced provider numbers beyond `extra.replaced`.
- A per-account "metrics are entered by hand" reminder sent at each evaluation checkpoint, once notifications exist.
