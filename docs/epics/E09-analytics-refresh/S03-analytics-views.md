# E09-S03 — Analytics views and manual entry

| | |
| --- | --- |
| Epic | E09 Analytics refresh |
| Priority | Must |
| Estimate | BE 1 d · FE 3.5 d |
| Depends on | E00-S02, E03-S04, E08-S05, E09-S04 |
| Needed by | E10-S01, E10-S02, E11-S01 |

## User story

As an operator, I want to type each post's numbers and the account's follower count in from the Instagram app, and to see every post's numbers by age and the follower curve, so that I can judge the week and the evaluation step always has data.

## Context

Phase 1 has no Instagram API. Every number in Social Hub is read from the Instagram app's insights and typed in by a person. E09-S04 decides when numbers are due, reminds the operator and records a checkpoint as missed when its window closes. This story provides the entry forms and the pages that show what was entered: the post metrics list, a post detail page with the checkpoint table and the metric curve, the followers page, and the Performance tab of the item workspace. It also owns the follower change calculation that E10-S02 uses for the weekly report.

E10-S01 builds on these pages: it adds a verdict column and filter to the post list, and an evaluation card below the chart on the post page and the Performance tab.

## Scope

**In**

- Endpoints: post list, post detail, manual post snapshot, follower series, manual follower snapshot.
- The follower service `analytics.services.followers` (`record`, change recomputation, `follower_change(account, from_date, to_date)`).
- Panel pages `/analytics/posts`, `/analytics/posts/:publicationId`, `/analytics/account`, and the Performance tab of `/content/:id`.
- Shared components: `MetricCell`, `CheckpointTable`, `MetricCurve`, `ManualSnapshotModal`, and the label maps for statuses, checkpoints and skip reasons.

**Out (later)**

- Exports (CSV, PDF).
- Comparing several posts on one chart.
- Deleting an entry; numbers are corrected by entering them again.

## Behaviour and rules

### Metrics status of a post

1. Every published post has a derived `metrics_status`, checked in this order:

   | Value | Condition | Label |
   | --- | --- | --- |
   | `entry_due` | Due for entry (E09-S04 rule 5): the pointer is set and `next_metrics_at` has passed | Metrics to enter (warning) |
   | `waiting` | The pointer is set and `next_metrics_at` is in the future | Waiting (default) |
   | `complete` | The pointer is null and the final checkpoint is captured | Complete (success) |
   | `incomplete` | The pointer is null and the final checkpoint is skipped | Incomplete (default) |

2. The detail endpoint lists the post's evaluation checkpoints (E09-S04 rule 2) always, and its optional checkpoints (`1h`, `6h`, `72h`) only when they have a row. Each has a derived status: `captured`; `skipped` (with `skip_reason`); `due` (the checkpoint the pointer names, and its time has passed; the entry carries `due_until` from E09-S04 rule 6); `upcoming` (an evaluation checkpoint whose time has not come, or that the pointer has not reached).
3. "Latest metrics" of a post means the most recent `captured` snapshot by `captured_at`, including `adhoc` ones.
4. `enterable_checkpoints` on the detail endpoint lists the format's checkpoints whose entry window (E09-S04 rules 1 and 3) is open now, in age order, followed by `adhoc`. A checkpoint that already has numbers is still listed; entering it again replaces them (rule 11).

### Applicable metrics

5. The metrics a person can enter per format are code constants (`APPLICABLE_METRICS` in `apps/analytics/services/snapshots.py`):

   | Format | Metrics |
   | --- | --- |
   | `reel`, `feed_post` | `reach`, `views`, `likes`, `comments`, `saves`, `shares` |
   | `story` | `reach`, `views`, `shares`, `replies` |

   These are the numbers the Instagram app shows under "View insights" for each format **(confirm with the pilot posts in R2)**.

### Manual post snapshot

6. `POST /analytics/posts/{publication_id}/snapshots/` records numbers typed by a person, with `source = manual`. The publication must be `published`.
7. `checkpoint` is one of the post format's checkpoints (E09-S04 rule 1) or `adhoc`.
8. `captured_at` is when the numbers were read in the Instagram app; default now. It may not be more than 5 minutes in the future, nor before `published_at`. `age_minutes = floor((captured_at − published_at) / 60 s)`.
9. For a scheduled checkpoint, `captured_at` must fall inside the checkpoint's entry window (`entry_window`, E09-S04 rule 3): the age must be at least the checkpoint's age (`checkpoint_not_reached`) and, for a non-final checkpoint, below its closing age (`checkpoint_passed`). So `24h` numbers can be entered from 24 hours after posting until the `7d` numbers are due; the final checkpoints (`7d`, `23h`) have no upper limit. The operator can back-date `captured_at` if the numbers were noted earlier.
10. At least one metric must be given. Each value is an integer from 0 to 2,000,000,000. A metric that does not apply to the format (rule 5) is rejected with `not_applicable`. Applicable metrics left out are stored as null and listed in `unavailable`.
11. Existing row for a scheduled checkpoint:

    | Existing row | Result |
    | --- | --- |
    | None | Created, `201` |
    | `skipped` | Replaced: `status = captured`, `skip_reason` null; `200`, `replaced: true` |
    | `captured` | Replaced; `200`, `replaced: true` |

    An `adhoc` entry always creates a new row.
12. In the same transaction the request calls `advance(publication, now)` (E09-S04 rule 7). An entry for the pointer's checkpoint moves the pointer on at once; any other entry leaves it where it is.
13. If a `PerformanceEvaluation` exists for this publication and checkpoint, it is deleted in the same transaction, so E10-S01's scheduled evaluation recomputes it within 15 minutes. The response reports `evaluation_reset: true`.
14. A `ContentEvent` of type `note` is written: "24 h metrics entered by Sara" (or "replaced by Sara").
15. `on_time` is derived for every scheduled snapshot: `age_minutes <= checkpoint age + max(20, 10% of checkpoint age)`. It is informational; a late entry inside the window still counts as that checkpoint.

### Manual follower snapshot

16. `POST /analytics/account/snapshots/` records a follower count for a local date, with `source = manual` and `captured_at = now`. `date` must be today or earlier in the account's timezone and not older than 400 days. `followers` is required (0–2,000,000,000); `following` and `media_count` are optional.
17. An existing row for that date is replaced (`200`, `replaced: true`).
18. A row dated D stands for the count at the start of D. The panel asks for the count on the first day of each plan week (E09-S04 rule 13), so the weekly change compares the rows dated `week_start` and the next `week_start`.

### Follower change

19. The follower change rules are E09-S02 rules 11–14. They apply in Phase 1 to the manual rows and are built in this story (`apps/analytics/services/followers.py`). In short:
    - `follower_change` on a row is its `followers` minus the `followers` of the row dated the previous calendar day, or null when that day has no row. It is computed when the row is written, and when a row is written or replaced, the next day's row, if it exists, is recomputed in the same transaction.
    - `follower_change(account, from_date, to_date)` returns the change over whole local days. Candidate rows are dated from `from_date` to `to_date + 1` inclusive; `start` is the earliest, `end` the latest; `change = end.followers − start.followers`, or null with fewer than two rows; `exact` is true when `start.date = from_date` and `end.date = to_date + 1`; `missing_dates` lists the dates in that range without a row.
20. E10-S02 calls `follower_change(account, plan.week_start, plan.week_end)` for the weekly totals.

### Follower series

21. `GET /analytics/account/` returns the rows dated `from` to `to` inclusive (local dates). Defaults: `to` = today, `from` = `to` − 29 days. `from <= to`, at most 366 days.
22. `period` is `follower_change(account, from, to − 1 day)`, which compares the earliest and latest rows dated `from` to `to`.

### Permissions

23. All endpoints in this story are open to both roles. Entering numbers is an operational action, not a setting.

## Data

Reads `Publication`, `MetricSnapshot`, `AccountSnapshot`, `ContentItem`, `ContentVersion`, `Asset`; deletes `PerformanceEvaluation` rows (rule 13); writes `MetricSnapshot`, `AccountSnapshot`, `ContentEvent`. Both analytics models are created by E09-S04; this story adds no fields.

`thumbnail_url` of a post is the signed URL of the version's `cover_asset`, else its `final_asset` when that is an image, else the first frame asset, else null.

## API

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
      "published_via": "manual",
      "permalink": "https://www.instagram.com/reel/DC0aBcDeFgH/",
      "thumbnail_url": "/media/accounts/3/2026/11/412-cover.png",
      "age_minutes": 1489,
      "latest": {
        "snapshot": 733,
        "checkpoint": "24h",
        "captured_at": "2026-11-29T16:05:00Z",
        "age_minutes": 1473,
        "source": "manual",
        "reach": 8412,
        "views": 13950,
        "likes": 611,
        "comments": 37,
        "saves": 184,
        "shares": 92,
        "replies": null,
        "unavailable": []
      },
      "next_metrics_checkpoint": "7d",
      "next_metrics_at": "2026-12-05T15:31:10Z",
      "metrics_status": "waiting"
    }
  ]
}
```

`latest` is null when nothing has been entered yet. E10-S01 adds `latest_evaluation` to each row.

### `GET /api/v1/analytics/posts/{publication_id}/`

```json
{
  "publication": 57,
  "account": 3,
  "content_item": {"id": 88, "title": "Three ways to style a small entryway"},
  "format": "reel",
  "published_at": "2026-11-28T15:31:10Z",
  "published_via": "manual",
  "permalink": "https://www.instagram.com/reel/DC0aBcDeFgH/",
  "thumbnail_url": "/media/accounts/3/2026/11/412-cover.png",
  "applicable_metrics": ["reach", "views", "likes", "comments", "saves", "shares"],
  "metrics_status": "waiting",
  "checkpoints": [
    {
      "checkpoint": "1h", "target_at": "2026-11-28T16:31:10Z", "is_final": false, "status": "captured", "skip_reason": null, "due_until": null,
      "snapshot": {"id": 701, "captured_at": "2026-11-28T16:50:00Z", "age_minutes": 78, "on_time": true, "source": "manual",
                   "reach": 1204, "views": 1890, "likes": 98, "comments": 6, "saves": 21, "shares": 9, "replies": null, "unavailable": []}
    },
    {
      "checkpoint": "24h", "target_at": "2026-11-29T15:31:10Z", "is_final": false, "status": "captured", "skip_reason": null, "due_until": null,
      "snapshot": {"id": 733, "captured_at": "2026-11-29T16:05:00Z", "age_minutes": 1473, "on_time": true, "source": "manual",
                   "reach": 8412, "views": 13950, "likes": 611, "comments": 37, "saves": 184, "shares": 92, "replies": null, "unavailable": []}
    },
    {"checkpoint": "7d", "target_at": "2026-12-05T15:31:10Z", "is_final": true, "status": "upcoming", "skip_reason": null, "due_until": null, "snapshot": null}
  ],
  "adhoc": [
    {"id": 740, "captured_at": "2026-11-30T09:12:00Z", "age_minutes": 2500, "source": "manual",
     "reach": 9530, "views": 15120, "likes": 648, "comments": 39, "saves": 201, "shares": 97, "replies": null, "unavailable": []}
  ],
  "enterable_checkpoints": ["24h", "adhoc"]
}
```

`adhoc` lists the 20 newest ad hoc snapshots. A checkpoint with status `due` carries `due_until`, for example `"status": "due", "due_until": "2026-12-05T15:31:10Z"`.

### `POST /api/v1/analytics/posts/{publication_id}/snapshots/`

```json
{
  "checkpoint": "24h",
  "captured_at": "2026-11-29T16:05:00Z",
  "reach": 8412,
  "views": 13950,
  "likes": 611,
  "comments": 37,
  "saves": 184,
  "shares": 92
}
```

Response `201` (or `200` when replacing):

```json
{
  "snapshot": {
    "id": 733, "checkpoint": "24h", "status": "captured", "captured_at": "2026-11-29T16:05:00Z", "age_minutes": 1473,
    "on_time": true, "source": "manual", "reach": 8412, "views": 13950, "likes": 611, "comments": 37, "saves": 184,
    "shares": 92, "replies": null, "unavailable": []
  },
  "replaced": false,
  "evaluation_reset": false,
  "next_metrics_checkpoint": "7d",
  "next_metrics_at": "2026-12-05T15:31:10Z"
}
```

| Case | Response |
| --- | --- |
| Publication not `published` | `409 invalid_transition` |
| `checkpoint` not valid for the format | `400 validation_error`, field `checkpoint`, code `invalid_choice` |
| `captured_at` in the future or before publishing | `400 validation_error`, field `captured_at`, code `out_of_range` |
| Age below the checkpoint age | `400 validation_error`, field `captured_at`, code `checkpoint_not_reached` |
| Age at or above the closing age of a non-final checkpoint | `400 validation_error`, field `captured_at`, code `checkpoint_passed` |
| No metric given | `400 validation_error`, code `metrics_required` |
| Metric not applicable to the format | `400 validation_error`, field such as `replies`, code `not_applicable` |
| Value outside 0–2,000,000,000 | `400 validation_error`, code `min_value` or `max_value` |

### `GET /api/v1/analytics/account/?account={id}&from=2026-11-07&to=2026-12-05`

```json
{
  "account": 3,
  "timezone": "Asia/Tehran",
  "from": "2026-11-07",
  "to": "2026-12-05",
  "points": [
    {"date": "2026-11-07", "followers": 12310, "following": 377, "media_count": 201, "follower_change": null, "source": "manual", "captured_at": "2026-11-07T05:40:12Z"},
    {"date": "2026-11-28", "followers": 12400, "following": null, "media_count": null, "follower_change": null, "source": "manual", "captured_at": "2026-11-28T06:02:51Z"},
    {"date": "2026-12-05", "followers": 12655, "following": null, "media_count": null, "follower_change": null, "source": "manual", "captured_at": "2026-12-05T05:58:03Z"}
  ],
  "missing_dates": ["2026-11-08", "2026-11-09"],
  "period": {
    "start": {"date": "2026-11-07", "followers": 12310},
    "end": {"date": "2026-12-05", "followers": 12655},
    "change": 345,
    "exact": true
  },
  "current": {"date": "2026-12-05", "followers": 12655}
}
```

The example shortens `points` and `missing_dates`; a real response holds one point per existing row in the range, ordered by date, and every date without a row. `period` is null when fewer than two rows exist. `current` is the newest row overall, or null.

| Case | Response |
| --- | --- |
| `from` after `to`, or a range over 366 days | `400 validation_error`, field `from`, code `invalid_range` |
| `to` after today (account timezone) | `400 validation_error`, field `to`, code `out_of_range` |

### `POST /api/v1/analytics/account/snapshots/`

```json
{"account": 3, "date": "2026-12-05", "followers": 12655, "following": null, "media_count": null}
```

Response `201` (or `200` when replacing) with the point shape plus `replaced`. Errors: `date` in the future or older than 400 days → `400 validation_error`, code `out_of_range`; `followers` missing → `required`; value outside 0–2,000,000,000 → `min_value` or `max_value`.

`GET /analytics/sync-status/` is in E09-S04.

## Background work

None. Pointer moves happen inside the entry request through E09-S04's `advance`; the scheduled task that records missed checkpoints is in E09-S04.

## AI

None.

## Panel

### Shared components (`src/components/analytics/`)

| Component | Behaviour |
| --- | --- |
| `MetricCell` | Shows a number with thousands separators. Null on a non-applicable metric shows "—". A metric listed in `unavailable` shows "N/A" with the tooltip "Not entered." |
| `CheckpointTable` | Rows per checkpoint from rule 2: Checkpoint ("1 h", "6 h", "23 h", "24 h", "72 h", "7 d"; evaluation checkpoints carry a small "Evaluated" tag), status `StatusTag`, Read at (`DateTime`), Age ("24 h 34 min", with "late" in warning colour when `on_time` is false), one `MetricCell` column per applicable metric. A skipped row shows its reason text below. A due row shows "Enter by {due_until}" and an "Enter metrics" button; captured rows whose checkpoint is in `enterable_checkpoints` have an "Edit" link that opens the modal with the numbers filled in. Ad hoc snapshots follow under a divider headed "Ad hoc readings". |
| `MetricCurve` | `@ant-design/plots` line chart. X axis "Age (hours)", numeric; Y axis is the selected metric's name. A segmented control picks the metric (applicable metrics only, default Reach). Points are the captured checkpoints plus ad hoc readings; checkpoint points are labelled ("24 h"); skipped checkpoints leave a gap. A "Table" toggle shows the same data as a table. With fewer than two points, the chart is replaced by "The curve appears after two readings." |
| `ManualSnapshotModal` | `Modal` form (`useModalForm`) titled "Enter metrics". Fields: Checkpoint (select of `enterable_checkpoints`; evaluation checkpoints labelled "24 h — used for evaluation", `adhoc` labelled "Now (ad hoc)"; the due checkpoint is preselected), Read at (date-time in the account timezone, default now), one number input per applicable metric with its label. Helper text at the top: "Open the post in the Instagram app and tap View insights." Helper text under Read at: "When you read these numbers. 24 h numbers can be entered from 24 hours after posting until the 7 d numbers are due." When the chosen checkpoint already has numbers, the inputs are filled with them and a note reads "These numbers replace the ones entered on {date}." Submit label "Save metrics". API field errors appear under their fields. |

Label maps (`src/components/analytics/labels.ts`): `metrics_status` from rule 1. Checkpoint status: Captured (success), Skipped (default), Due for entry (warning), Upcoming (default). Skip reason `missed`: "Not entered in time".

### Post metrics — `/analytics/posts`

- `PageFrame` titled "Post metrics", description `SyncStatusLine` (E09-S04). The toolbar has the "Metrics to enter" quick filter from E09-S04.
- `Table` (`useTable`), 20 rows per page, server ordering. Columns: Post (thumbnail 40 px and title, linking to `/analytics/posts/{publication}`), Format, Published (`DateTime`), Age, Latest ("24 h" tag, or "Ad hoc" with its age), Reach, Views, Saves, Shares, Likes, Comments, Replies (shown only when the format filter includes stories), Metrics status. Metric columns are sortable.
- Filters in the table form: Plan (select of the account's plans, default the current plan from `GET /plans/current/`, with an "All plans" option), Format (multi-select), Published (date range), Metrics status (multi-select).
- Row action menu: "Open", "Enter metrics", "View on Instagram" (opens the permalink in a new tab).
- Empty state: "No published posts yet. Metrics appear here once a post is marked as published." With filters active: "No posts match these filters." and a "Clear filters" link.

### Post detail — `/analytics/posts/:publicationId`

- Header: content item title (link to `/content/{id}`), format tag, published time, `metrics_status` tag, "View on Instagram", button "Enter metrics" (primary while a checkpoint is due).
- Card "Latest": `StatisticCard` row for Reach, Saves and Shares (stories: Reach, Replies, Shares) from the latest snapshot, each with its age ("at 24 h"), plus "Read {relative time}".
- Card "By checkpoint": `CheckpointTable`.
- Card "Curve": `MetricCurve`.
- Below: the evaluation card slot that E10-S01 fills.
- After a save: message "Metrics saved." When the save reset an evaluation: "Metrics saved. The evaluation will update within 15 minutes."

### Followers — `/analytics/account`

- `PageFrame` titled "Followers", description `SyncStatusLine`, actions: date range picker with presets "30 days" (default), "90 days", "1 year" and a custom range; button "Enter follower count".
- `StatisticCard` row: "Followers" (current count and its date), "Change" (`period.change` with an up or down arrow; the tooltip states the span, for example "From 7 Nov (12,310) to 5 Dec (12,655)"; when `exact` is false the card adds "The counts do not cover the whole range"), "Counts entered" (number of points in the range).
- Line chart of followers by date with axis titles "Date" and "Followers". Counts are entered on some days only, so the line joins the entered points in date order and every point has a marker. A "Table" toggle shows Date, Followers, Change, Following, Posts.
- "Enter follower count" opens a `Modal` form (`useModalForm`): Date (default today, no future dates), Followers (required), Following and Posts (optional). Helper text: "Read the numbers from the profile in the Instagram app. A count dated 5 Dec stands for the start of that day, so enter it early in the day." When the date already has a count, the inputs are filled and a note reads "This count replaces the one entered on {date}." Submit label "Save count".
- Empty state: "No follower counts yet. Enter one on the first day of each plan week; the overview reminds you." with the button "Enter follower count".

### Performance tab — `/content/:id?tab=performance`

- Before publishing: `TabPlaceholder` with "Metrics appear here once the post is marked as published."
- After publishing: the "Latest" card, `CheckpointTable` and `MetricCurve` from the post detail page, with the "Enter metrics" action and a link "Open in Analytics". The evaluation card from E10-S01 follows below.

### States on every analytics view

| State | Behaviour |
| --- | --- |
| Loading | Skeletons in the statistic cards, table and chart |
| Error | Inline `Result` with the English text for the error code, Retry and the request ID |
| Metrics to enter | `SyncStatusLine` warning plus the row tags; nothing is hidden |
| Saving an entry | The modal's submit button shows loading; the page reloads its data after the save |
| No account selected | The shell's account prompt (E00-S02) |

## Acceptance criteria

1. Given a reel with `1h` and `24h` captured and the pointer at `7d`, when I open its post page, then the checkpoint table shows two captured rows and `7d` as upcoming, and `6h` and `72h` are not listed.
2. Given a reel whose pointer is `24h` and whose `24h` time has passed, then its row in the list has the status "Metrics to enter", and on its post page the `24h` row reads "Due for entry" with "Enter by" and the time from `due_until`.
3. Given that reel, when I enter `24h` metrics with `captured_at` 25 hours after publishing, then the response is `201` with `source = manual`, the pointer is `7d`, the list status is "Waiting", and a note event is on the item.
4. Given I enter `24h` metrics with `captured_at` 20 hours after publishing, then I get `checkpoint_not_reached`; given 7 days and 1 hour, then I get `checkpoint_passed`; given `7d` metrics at 12 days, then they are accepted.
5. Given a story, when I enter `saves`, then I get `not_applicable` on `saves`.
6. Given `24h` numbers exist, when I enter `24h` numbers again, then the response is `200` with `replaced: true`; given a `24h` evaluation exists, then that evaluation is deleted and the response has `evaluation_reset: true`.
7. Given a reel whose `7d` row is skipped as missed, when I enter its `7d` metrics, then the row becomes captured, the pointer stays null and the post's status is "Complete".
8. Given I enter only `reach` and `saves` for a reel's `24h`, then the other applicable metrics are null and listed in `unavailable`, and the table shows "N/A" for them.
9. Given follower rows dated 7 Nov, 14 Nov, 21 Nov, 28 Nov and 5 Dec, when I open the followers page for 7 Nov – 5 Dec, then the chart joins the five points, "Counts entered" shows 5, and the change is 12,655 − 12,310 = 345 with `exact` true.
10. Given a row for 4 Dec exists, when I enter 12,655 followers for 5 Dec, then the 5 Dec point's `follower_change` is computed against 4 Dec; given 4 Dec has no row, it is null.
11. Given a count for 5 Dec exists, when I enter a new count for 5 Dec, then the row is replaced, the response has `replaced: true`, and the 6 Dec row's `follower_change`, if that row exists, is recomputed.
12. Given I enter a follower count for tomorrow, then I get `out_of_range` on `date`.
13. Given a published item, when I open its Performance tab, then I see the latest numbers, the checkpoint table and the curve; for an unpublished item I see the placeholder sentence.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E09-S03-BE1 | Post list and detail | Serializers and views for `GET /analytics/posts/` and `/{publication_id}/`: latest-snapshot subquery annotations, metric ordering with nulls last, filters, `metrics_status` and checkpoint status derivation, `due_until`, `enterable_checkpoints`, `thumbnail_url`, `on_time`; query-count test for the list | 0.25 |
| E09-S03-BE2 | Manual post entry | `POST /analytics/posts/{id}/snapshots/`: `APPLICABLE_METRICS`, validation rules 7–10 against `entry_window`, replacement table, `advance` call, evaluation reset, event note; API tests for every error row | 0.25 |
| E09-S03-BE3 | Followers | `apps/analytics/services/followers.py` with `record(account, date, values, source)`, the change recomputation and `follower_change(account, from_date, to_date)`; `POST /analytics/account/snapshots/` and `GET /analytics/account/` with range rules and `period`; `openapi.yaml` for the five endpoints; unit tests including the worked example in E09-S02 rule 14 | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E09-S03-FE1 | Shared analytics components | `MetricCell`, `CheckpointTable`, `MetricCurve` (with table toggle and gaps), label maps for statuses, checkpoints and skip reasons; component tests | 0.75 |
| E09-S03-FE2 | Post metrics page | `src/pages/analytics/posts/index.tsx`: table, filters with current-plan default, sortable metric columns, row actions, empty states | 0.5 |
| E09-S03-FE3 | Post detail and manual entry | `src/pages/analytics/posts/[publicationId].tsx`: header actions, latest card, table, curve, evaluation slot; `ManualSnapshotModal` with checkpoint options, helper texts, replace note and error mapping | 1 |
| E09-S03-FE4 | Followers page | `src/pages/analytics/account/index.tsx`: range presets, statistic cards with span tooltip, joined line chart with markers, table toggle, follower entry modal, empty state | 0.75 |
| E09-S03-FE5 | Performance tab | `src/pages/content/workspace/tabs/Performance.tsx` reusing the detail cards; placeholder before publishing; reload after an entry | 0.5 |

### Test

None beyond the tests inside each subtask.

## Test notes

- API tests with factories: a reel and a story with a mix of captured, skipped and ad hoc rows; an account with weekly follower rows.
- A test that the list's `latest` picks an ad hoc reading newer than the last checkpoint.
- A test that ordering by `saves` puts posts without metrics last in both directions.
- Entry-window tests at the exact boundaries: `24h` at 1,440 minutes (accepted), 10,079 (accepted) and 10,080 (`checkpoint_passed`).
- Panel tests: `MetricCell` renders "—" and "N/A" correctly; `MetricCurve` breaks the line at a skipped checkpoint; `ManualSnapshotModal` preselects the due checkpoint and fills existing numbers; the followers chart joins points across days without a row.

## Later

- CSV export of the post table and the follower series.
- Overlaying several posts' curves, aligned by age, for side-by-side comparison.
- Keeping replaced numbers (for example in `extra.replaced`) if operators need an audit trail.
- Phase 2: the collectors (E09-S01, E09-S02) write `source = provider` rows at the same checkpoints and dates. Manual entry then needs `replace: true` to overwrite Instagram's numbers (`409 state_conflict` with `details.reason = "snapshot_exists"` otherwise), the panel adds a Source column and an "Entered by hand" marker, and the follower chart shows days without a reading as gaps.
- Phase 2: "Refresh metrics" (`POST /analytics/refresh/`, job `analytics.refresh`) reads fresh numbers between checkpoints, refused with `insights_unavailable` or `instagram_not_connected` where it cannot work.
- Phase 2: the collector's skip reasons (`insights_unavailable`, `media_not_found`, `expired`, `gave_up`) get labels in the skip-reason map.
