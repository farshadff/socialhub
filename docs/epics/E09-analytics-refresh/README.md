# E09 — Analytics refresh

## Goal

Workflow step 09: "Pull reach, saves, and shares. Track follower change by account." After a post is live, the system records its numbers at fixed ages so that posts can later be compared at the same age (E10). Once a day it records each account's follower count and the change since the previous record. The operator sees the numbers, how fresh they are, and can enter them by hand when Instagram does not provide them.

## Scope

**In the MVP**

- Metric snapshots per publication at fixed checkpoints: reels and feed posts at 1 h, 6 h, 24 h, 72 h and 7 d; stories at 1 h, 6 h and 23 h.
- A collector that runs every 10 minutes, paced per account, tolerant of provider errors.
- Clear records of what could not be measured: metrics the provider did not return, checkpoints that were missed.
- A daily follower snapshot per account with the change since the previous one.
- Manual refresh, manual metric entry and manual follower entry.
- Panel: post metrics list, post detail with the metric curve, account followers page, the Performance tab of the item workspace.

**Left for later**

- Audience demographics, profile visits, link clicks, per-story navigation analysis.
- Hourly follower tracking, follower attribution to posts.
- Exports and scheduled email reports.
- Competitor benchmarks.
- Any judgement about the numbers: verdicts, goals and baselines belong to E10.

## Stories

| ID | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E09-S01](S01-post-metric-snapshots.md) | Post metric snapshots at fixed ages | Must | 3 | 0 | |
| [E09-S02](S02-follower-tracking.md) | Follower tracking per account | Must | 1 | 0 | |
| [E09-S03](S03-analytics-views.md) | Analytics views, manual refresh and manual entry | Must | 1.5 | 4 | |
| | **Total** | | **5.5** | **4** | |

## Flow

1. When a publication becomes `published`, E08 sets `next_metrics_checkpoint = "1h"` and `next_metrics_at = published_at + 1 hour`.
2. Every 10 minutes the collector picks the publications whose `next_metrics_at` has passed, groups them by account, and for each one asks the provider for insights once (S01).
3. The result is stored as a `MetricSnapshot` under the checkpoint that is due, with the real age in minutes and the list of metrics the provider could not return. The pointer moves to the next checkpoint. After the last one it is cleared.
4. Shortly after midnight in each account's timezone, the follower task stores an `AccountSnapshot` with the change since the previous one (S02).
5. The operator opens Analytics to see the latest numbers per post, the curve of one post over its checkpoints, and the follower series; presses "Refresh now" for fresh numbers between checkpoints; or types numbers in when the provider cannot deliver them (S03).
6. E10 reads the snapshots at the evaluation checkpoints (`24h`, `7d`, `23h`) and the follower change for the week.

```text
published ─► 1h ─► 6h ─► 24h ─► 72h ─► 7d      (reel, feed_post)
published ─► 1h ─► 6h ─► 23h                   (story)
              │
              └─ each checkpoint: captured | unavailable | skipped
```

## Owns

| Kind | Items |
| --- | --- |
| Tables | `MetricSnapshot`, `AccountSnapshot` ([DATA-MODEL.md](../../DATA-MODEL.md) section 10) |
| Endpoints | `POST /analytics/refresh/`, `GET /analytics/posts/`, `GET /analytics/posts/{publication_id}/`, `POST /analytics/posts/{publication_id}/snapshots/`, `GET /analytics/account/`, `POST /analytics/account/snapshots/`, and one addition: `GET /analytics/sync-status/` |
| Panel | `/analytics/posts`, `/analytics/posts/:publicationId`, `/analytics/account`; the Performance tab of `/content/:id` |
| Background tasks | `analytics.collect_due_metrics` (every 10 minutes), `analytics.collect_account_metrics`, `analytics.dispatch_follower_snapshots` (every 10 minutes), `analytics.snapshot_followers`, `analytics.refresh` |
| Services | `analytics.services.checkpoints`, `analytics.services.snapshots`, `analytics.services.followers` (`follower_change(account, from_date, to_date)`), `analytics.services.sync_status(account)` |
| AI tasks | None |
| Job kinds | `analytics.refresh` |

## Depends on / needed by

| Depends on | Why |
| --- | --- |
| E00-S04 | `media_insights`, `account_stats`, connection status and the `insights` capability, the per-account Instagram lock, fake provider |
| E00-S06 | `JobRun`, `JobButton`, `JobProgress` |
| E03-S04 | Item workspace shell that hosts the Performance tab |
| E04-S01 | Format registry |
| E08-S03, E08-S04 | Published publications with `remote_media_pk`, `published_at` and the first metric pointer |

| Needed by | Why |
| --- | --- |
| E10-S01 | Snapshots at evaluation checkpoints; same-age baselines |
| E10-S02 | Weekly totals and follower change |
| E11-S01 | Sync health on the overview (`sync_status`) |

## Done when

1. A post published on the test account gets a snapshot at each of its checkpoints without anyone pressing a button, and each snapshot shows reach, saves and shares or names them as unavailable.
2. With the provider failing for two hours, no wrong numbers are stored; a missed early checkpoint is recorded as skipped; the last checkpoint is still captured when the provider returns.
3. The account page shows one follower figure per day and the change over the selected period, with missing days shown as missing.
4. With the `manual` provider, the operator can type the metrics for a checkpoint and the follower count for a day, and both appear in the same views.
5. Every analytics page states when the data was last synced.

## Later

- More checkpoints (for example `14d`) are one entry in the checkpoint table.
- Additional metrics are columns on `MetricSnapshot` or keys in `extra`; the provider mapping is one function.
- The official Graph API returns the same metrics under different names; only the provider adapter changes.
- A time-series store is unnecessary at MVP volume (a few rows per post); the tables can be partitioned by date if volume grows.
