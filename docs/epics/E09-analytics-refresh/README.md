# E09 — Analytics refresh

## Goal

Workflow step 09: "Pull reach, saves, and shares. Track follower change by account." Phase 1 has no Instagram API, so the numbers come from the Instagram app and a person types them in. After a post is marked as published, the panel asks for its numbers at the evaluation checkpoints (24 h and 7 d for reels and feed posts, 23 h for stories), so that posts can later be compared at the same age (E10). On the first day of each plan week it asks for the account's follower count. The operator sees what was entered, what is due and what was missed.

## Scope

**In Phase 1**

- A checkpoint pointer per publication over the evaluation checkpoints: reels and feed posts `24h` then `7d`; stories `23h`. Each checkpoint is due for entry from its time until the next one's time; the last one stays due for three more days. A checkpoint nobody enters is recorded as missed.
- Optional checkpoints (`1h`, `6h`, `72h`) and ad hoc readings can be entered inside their window but are never asked for.
- Manual entry of post metrics and follower counts. Every row has `source = manual`.
- Reminders: "Metrics to enter" and "Follower count to enter" on the overview attention list (E11-S01), and a status line on every analytics page.
- Follower change over any period from the counts entered; the weekly change compares the counts dated `week_start` and the next `week_start`.
- Panel: post metrics list, post detail with the checkpoint table and the metric curve, followers page, the Performance tab of the item workspace.

**Left for later**

- Automatic collection from Instagram (Phase 2, see below).
- Reminders by email or chat.
- Metrics beyond the seven snapshot columns (profile visits, follows, watch time, story navigation); audience demographics; link clicks.
- Follower attribution to posts.
- Exports and scheduled email reports.
- Competitor benchmarks.
- Any judgement about the numbers: verdicts, goals and baselines belong to E10.

## Stories

| ID | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E09-S01](S01-post-metric-snapshots.md) | Collect post metrics from Instagram at fixed ages | Phase 2 | (3) | (0) | |
| [E09-S02](S02-follower-tracking.md) | Collect follower counts from Instagram daily | Phase 2 | (1) | (0) | |
| [E09-S03](S03-analytics-views.md) | Analytics views and manual entry | Must | 1 | 3.5 | |
| [E09-S04](S04-entry-checkpoints.md) | Metric entry checkpoints and reminders | Must | 1 | 0.5 | |
| | **Phase 1 total** | | **2** | **4** | |

Figures in brackets are Phase 2 estimates and are not in the total.

## Flow

1. When the operator marks a publication as published (E08-S05), E09-S04's `start_metrics_pointer` sets `next_metrics_checkpoint` to the first evaluation checkpoint (`24h`, or `23h` for a story) and `next_metrics_at = published_at` + that age.
2. Once that time has passed, the post is due for entry: it shows "Metrics to enter" in Post metrics, a `metrics_entry_due` entry appears on the overview, and `sync_status` counts it (S04).
3. The operator opens the post's insights in the Instagram app and enters the numbers (S03). They are stored as a `captured` `MetricSnapshot`, and the pointer moves to the next evaluation checkpoint at once.
4. Every 10 minutes `analytics.advance_entry_checkpoints` records a checkpoint whose window has closed without numbers as `skipped` with reason `missed`, and moves the pointer on. After the last checkpoint the pointer is cleared (S04).
5. On the first day of each plan week, the account is "followers due" until a count for that date is entered (S04). The count is stored as an `AccountSnapshot` and the change is computed (S03).
6. E10 reads the snapshots at the evaluation checkpoints and the follower change for the week.

```text
published ─► 24h ─────────────► 7d ─────────────► done      (reel, feed_post)
             due until 7d opens   due for 3 days
published ─► 23h ─────────────► done                        (story)
             due for 3 days
              │
              └─ each evaluation checkpoint: captured (entered) | skipped (missed)

optional: 1h, 6h, 72h and ad hoc readings, entered by choice, never asked for
```

## Owns

| Kind | Items |
| --- | --- |
| Tables | `MetricSnapshot`, `AccountSnapshot` ([DATA-MODEL.md](../../DATA-MODEL.md) section 10) |
| Endpoints | `GET /analytics/posts/`, `GET /analytics/posts/{publication_id}/`, `POST /analytics/posts/{publication_id}/snapshots/`, `GET /analytics/account/`, `POST /analytics/account/snapshots/`, `GET /analytics/sync-status/`. Phase 2: `POST /analytics/refresh/` |
| Panel | `/analytics/posts`, `/analytics/posts/:publicationId`, `/analytics/account`; the Performance tab of `/content/:id` |
| Background tasks | `analytics.advance_entry_checkpoints` (every 10 minutes) |
| Services | `analytics.services.checkpoints` (`CHECKPOINTS`, `entry_window`, `start_metrics_pointer`, `advance`), `analytics.services.snapshots`, `analytics.services.followers` (`follower_change(account, from_date, to_date)`), `analytics.services.reminders` (`metrics_entry_due`, `followers_entry_due`), `analytics.services.sync_status(account)` |
| Settings | `SOCIALHUB_METRICS_ENTRY_GRACE_DAYS` (3) |
| AI tasks | None |
| Job kinds | None in Phase 1 |

## Depends on / needed by

| Depends on | Why |
| --- | --- |
| E00-S02 | Panel shell, `StatusTag`, `DateTime`, page states |
| E00-S03 | Accounts with timezone and `week_start_day` |
| E00-S06 | Celery Beat for the entry task |
| E03-S04 | Item workspace shell that hosts the Performance tab |
| E04-S01 | Format registry |
| E08-S01 | `Publication` with the metric pointer fields |
| E08-S05 | Publications marked as published with `published_at` and `permalink`; calls `start_metrics_pointer` |

| Needed by | Why |
| --- | --- |
| E10-S01 | Snapshots at evaluation checkpoints; same-age baselines; the posts table and Performance tab it extends |
| E10-S02 | Weekly totals and `follower_change` |
| E11-S01 | `metrics_entry_due` and `followers_entry_due` attention entries; "Metrics entry" from `sync_status` |

## Done when

1. A reel marked as published on the test account shows "Metrics to enter" 24 hours later, on the overview and in Post metrics. After the operator types its `24h` numbers it is no longer due, and `7d` is its next checkpoint.
2. A checkpoint nobody enters is recorded as missed when its window closes, and no numbers are invented. The final checkpoint can still be entered afterwards.
3. On the first day of each plan week the overview asks for the follower count until it is entered. The followers page shows the counts and the change over the selected period.
4. Numbers entered for any checkpoint appear in the checkpoint table, the curve and the Performance tab, and numbers at an evaluation checkpoint lead to an evaluation (E10-S01).
5. Every analytics page states how many posts have metrics to enter and when numbers were last entered.

## Phase 2

Phase 2 collects the numbers automatically through Meta's official Instagram API. E09-S01 adds a collector that reads insights at every checkpoint (`1h` to `7d`) every 10 minutes, and E09-S02 reads each account's follower count once a day. Both write the same `MetricSnapshot` and `AccountSnapshot` rows with `source = provider`, so the views in E09-S03 and the evaluation in E10 do not change. Phase 2 also adds "Refresh metrics" (`POST /analytics/refresh/`) and the collector's fields in `sync_status`. Manual entry and the reminders stay for accounts whose insights are not available.

## Later

- More checkpoints (for example `14d`) are one row in `CHECKPOINTS`.
- Additional metrics are columns on `MetricSnapshot` or keys in `extra`.
- A time-series store is unnecessary at MVP volume (a few rows per post); the tables can be partitioned by date if volume grows.
