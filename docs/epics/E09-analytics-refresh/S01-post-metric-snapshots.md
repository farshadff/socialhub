# E09-S01 — Post metric snapshots at fixed ages

| | |
| --- | --- |
| Epic | E09 Analytics refresh |
| Priority | Must |
| Estimate | BE 3 d · FE 0 d |
| Depends on | E00-S04, E00-S06, E04-S01, E08-S03, E08-S04 |
| Needed by | E09-S03, E10-S01, E10-S02, E11-S01 |

## User story

As an operator, I want every live post's reach, saves, shares and other numbers recorded automatically at the same ages, so that posts can be compared fairly and I never have to collect numbers by hand when Instagram provides them.

## Context

Workflow step 09 starts the moment a publication becomes `published`. E08-S03 (provider send) and E08-S04 (verification and `mark-published`) both hand over by setting `next_metrics_checkpoint = "1h"` and `next_metrics_at = published_at + 1 hour`. From there this story owns the pointer: a collector running every 10 minutes captures the due checkpoint, stores a `MetricSnapshot` and moves the pointer to the next checkpoint until the last one is done.

The numbers matter mostly at the evaluation checkpoints that E10-S01 reads (`24h` and `7d` for reels and feed posts, `23h` for stories). A number captured at the wrong age would make those comparisons unfair, so this story is strict about ages: it stores the real age of every capture, and it records an early checkpoint as skipped instead of storing it hours late.

This story has no panel work. E09-S03 shows the snapshots, offers manual entry and the refresh button.

## Scope

**In**

- The checkpoint schedule per format and the rules that move the pointer.
- The `media_insights` method of the `graph_api` adapter (`GET /{media_id}/insights`), the per-format metric map in `apps/instagram/metrics.py`, and the `fake` provider's insight values.
- The collector: selection of due publications, grouping by account, sharing the account lock with publishing, error handling.
- Recording skipped checkpoints with a reason.
- The snapshot writer service used by the collector, the refresh job and manual entry (E09-S03).
- The sync status service that E09-S03 and the overview (E11-S01) read.

**Out (later)**

- Checkpoints beyond 7 days, hourly curves, audience demographics, link clicks.
- Showing or evaluating the metrics kept in `extra` (profile visits, follows, watch time, story navigation), and story navigation broken down by action (taps forward, exits).
- Re-reading old checkpoints to correct numbers Instagram revises later.

## Behaviour and rules

### Checkpoint schedule

1. Checkpoints per format are code constants in `apps/analytics/services/checkpoints.py` (`CHECKPOINTS`), aligned with the format registry (E04-S01):

   | Checkpoint | Age in minutes | Formats | Final for | Skip if still not captured at age | Give up at age |
   | --- | --- | --- | --- | --- | --- |
   | `1h` | 60 | reel, feed_post, story | — | 90 | — |
   | `6h` | 360 | reel, feed_post, story | — | 540 | — |
   | `23h` | 1,380 | story | story | never skipped for lateness | 4,260 (48 h after due) |
   | `24h` | 1,440 | reel, feed_post | — | 2,160 | — |
   | `72h` | 4,320 | reel, feed_post | — | 6,480 | — |
   | `7d` | 10,080 | reel, feed_post | reel, feed_post | never skipped for lateness | 20,160 (7 days after due) |

2. **Late-capture rule.** A non-final checkpoint that has not been captured when the post's age exceeds 150% of the checkpoint's age (the "Skip if" column) is recorded as skipped with reason `missed`. A number captured that late would not describe the post at that age.
3. **Final checkpoint.** The final checkpoint is never skipped for lateness: a late final number is still the most complete number the post has. It is captured whenever the provider succeeds. If it is still not captured at the give-up age, it is recorded as skipped with reason `gave_up`.
4. **Stories are final after 24 hours.** A story disappears at 24 hours and its numbers stop changing, so no checkpoint is scheduled after `23h`. Story insights are also available only for about 24 hours after posting **(confirm in setup)**; the one-hour margin is why the final story checkpoint is `23h`. A late `23h` capture is valid whenever the API still returns numbers. Once it no longer does (the adapter raises `NotFound`), the checkpoint is recorded as skipped with reason `expired`.
5. **Pointer moves.** After a capture or a skip, `next_metrics_checkpoint` becomes the next checkpoint in the format's list and `next_metrics_at = published_at + that checkpoint's age`. After the final checkpoint both fields are set to null; collection for that post is complete.
6. **Several checkpoints passed at once.** When the collector visits a post whose age has passed several checkpoints (after an outage), it walks the list in order: every non-final checkpoint past its skip age is skipped (rule 2); the first checkpoint that is due and not past its skip age is captured; one visit produces at most one capture. Example: a reel at age 50 hours with the pointer at `1h` gets `1h`, `6h` and `24h` skipped and the pointer set to `72h` at `published_at + 72 h`, because 72 hours have not passed yet.
7. **On time.** Every snapshot stores its real `age_minutes`. The API derives `on_time = age_minutes <= checkpoint age + max(20, 10% of checkpoint age)`. The tolerance covers the 10-minute collector interval plus the start delay and lock waits. `on_time` is informational; a late but not skipped capture still counts as that checkpoint.

### Collector

8. Celery Beat runs `analytics.collect_due_metrics` every 10 minutes on the `default` queue. A Redis lock `analytics:collect_due` (expiry 9 minutes) makes an overlapping run exit immediately.
9. It selects publications with `status = published`, `next_metrics_checkpoint` not null and `next_metrics_at <= now`, whose account has `status = active`, ordered by `next_metrics_at`. It groups them by account and enqueues one `analytics.collect_account_metrics(account_id, publication_ids)` task per account with a random countdown of 0–60 seconds, so accounts do not start at the same moment.
10. An account is not visited this cycle when any of these holds:

    | Condition | Why |
    | --- | --- |
    | A publication of the account is `publishing` or `verifying` | Publishing has priority over reading |
    | A provider-delivered publication of the account is `scheduled` with `scheduled_at` within the next 5 minutes | Leave the lock free for the send |
    | The cache key `analytics:backoff:{account_id}` is set | A rate limit was hit recently (rule 17) |
    | The connection status is `disconnected` or `needs_attention` | Connection problems are already on the overview; calling would fail. `expiring` still has a valid token and is visited |

    A skipped account keeps its pointers; the next cycle tries again. The late-capture rule applies as time passes, so nothing is ever captured at the wrong checkpoint.
11. **No provider calls for metrics-by-hand accounts.** When the account's `AccountConnection.provider` is `manual`, or its `capabilities.insights` is false (the `instagram_business_manage_insights` permission was not granted, INSTAGRAM-INTEGRATION.md section 10), the collector does not call the provider. For each due checkpoint it records a skip with reason `insights_unavailable` and moves the pointer (rule 5). The operator fills those checkpoints through manual entry (E09-S03), which replaces the skipped row. The connection condition in rule 10 does not apply to these accounts.
12. Inside `collect_account_metrics`, publications are processed one at a time, oldest due first, at most `SOCIALHUB_METRICS_MAX_POSTS_PER_ACCOUNT_CYCLE` (default 10) per cycle. The rest wait for the next cycle.
13. Every provider call goes through `apps.instagram.session.account_session(account, wait_seconds=SOCIALHUB_METRICS_LOCK_WAIT_SECONDS)` from E00-S04. It takes the per-account Instagram lock (Redis key `ig:lock:{account_id}`, the same lock publishing uses), decrypts the token and yields `(provider, token)`. The collector waits at most `SOCIALHUB_METRICS_LOCK_WAIT_SECONDS` (default 10) for the lock. If the lock is not free in time, `account_session` raises `AccountBusy` and the collector stops processing that account for this cycle without recording anything. The lock is taken per post, not for the whole batch, so a due publication can interleave.
14. Before each provider call the collector re-reads the publication and recomputes which checkpoint is due (rule 6), because a manual entry or a refresh may have moved the pointer in the meantime.
15. One call per post per visit: `provider.media_insights(token, publication.remote_media_id, format)`, which sends `GET /{media_id}/insights?metric=…` with the names from the metric map (rule 16). The result is written with the snapshot writer (rules 22–25).

### Provider results and errors

16. **Metric map.** `apps/instagram/metrics.py` holds, per Graph API version, the metric names requested for each format and the snapshot column each one fills ([INSTAGRAM-INTEGRATION.md](../../INSTAGRAM-INTEGRATION.md), section 6):

    | Snapshot column | Feed post | Reel | Story |
    | --- | --- | --- | --- |
    | `reach` | `reach` | `reach` | `reach` |
    | `views` | `views` | `views` | `views` |
    | `likes` | `likes` | `likes` | — |
    | `comments` | `comments` | `comments` | — |
    | `saves` | `saved` | `saved` | — |
    | `shares` | `shares` | `shares` | `shares` |
    | `replies` | — | — | `replies` |
    | `extra` (stored, not evaluated) | `total_interactions`, `profile_visits`, `follows` | `total_interactions`, `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time` | `navigation`, `profile_visits`, `follows` |

    Meta replaced `impressions` and `plays` with `views`; neither old name is requested. The map is keyed by the value of `SOCIALHUB_IG_API_VERSION`. `metric_map(version, fmt)` returns the entry for that version, or the newest entry for an earlier version, and a Django system check warns when the pinned version has no entry of its own. A metric renamed in a new version is one new entry. Every name is confirmed in setup (E00-S04).

    **Reading the response.** The adapter takes each returned item's `name` and lifetime value (`values[0].value`, or `total_value.value` where the API uses that shape **(confirm in setup)**), renames it through the map and returns an `InsightsResult`:

    - `metrics`: snapshot column to integer for every metric that applies to the format. Metrics that do not apply are null and are **not** listed in `unavailable`.
    - `unavailable`: applicable metrics the API rejected or left out.
    - `extra`: the extra names from the map that came back, under their API names.
    - `raw`: the trimmed response.

    If the API rejects the request because of named metrics (error code 100 naming them **(confirm in setup)**), the adapter repeats the request without those names, at most twice, and lists the rejected snapshot metrics in `unavailable`; rejected extra names are simply missing from `extra`. An insights error saying the media has too few viewers (seen on stories with very small reach) is not a missing permission: the adapter returns every applicable metric as `unavailable` instead of raising `PermissionMissing` **(confirm in setup)**. Values are non-negative integers; a negative or non-numeric value is treated as unavailable and logged. Likes and comments come from insights only; the media fields `like_count` and `comments_count` are not read.
17. **Errors.** Adapters raise only the errors in INSTAGRAM-INTEGRATION.md section 7. The collector reacts as follows:

    | Error | Snapshot | Pointer | Other effects | Rest of the account's batch |
    | --- | --- | --- | --- | --- |
    | `TokenInvalid`, `PermissionMissing` | None | Unchanged | `report_connection_error(account, error)` (E00-S04) sets the connection `needs_attention`; for `PermissionMissing` it also recomputes capabilities, so a lost insights permission turns later checkpoints into `insights_unavailable` skips (rule 11) | Stop |
    | `RateLimited` | None | Unchanged | Cache key `analytics:backoff:{account_id}` for max(`retry_after_seconds`, 15 minutes) | Stop |
    | `AccountBusy` | None | Unchanged | None; another call sequence, usually publishing, holds the lock (rule 13) | Stop |
    | `TransientError` | None | Unchanged | Failure counter +1 | Continue with the next post; stop after 3 consecutive transient errors |
    | `NotFound` (media deleted, or story insights no longer available) | Skip with reason `media_not_found` (reel, feed_post) or `expired` (story) for the due checkpoint and every remaining one | Null | `ContentEvent` note "Post no longer found on Instagram; metrics stopped" (reel, feed_post only) | Continue |
    | `NotSupported` | Skip with reason `insights_unavailable` for the due checkpoint | Next checkpoint | Logged once per account per day | Continue |
    | Any other exception | None | Unchanged | Logged with `publication_id`; failure counter +1 | Continue |

18. No error ever produces a snapshot with invented values. "No snapshot and pointer unchanged" is how a sync gap appears: E11-S01 and the sync status service flag publications whose `next_metrics_at` is more than `SOCIALHUB_METRICS_OVERDUE_MINUTES` (default 60) in the past.
19. The collector keeps per-account health in the cache (`analytics:health:{account_id}`, 7-day expiry): `last_success_at`, `last_error_code`, `last_error_at`, `consecutive_failures`. A successful capture resets `consecutive_failures` to 0.
20. The collector creates no `JobRun`; scheduled runs are visible through snapshots and sync status. The refresh job in E09-S03 creates one.
21. A failure for one account never affects another account's task.

### Snapshot writer

22. `analytics.services.snapshots.record_capture(publication, checkpoint, result, source, captured_at)` writes one `MetricSnapshot` with `status = captured`, the seven metric columns, `unavailable`, `extra`, `source` and `age_minutes = floor((captured_at - published_at) / 60 s)`. For a scheduled checkpoint it uses `update_or_create` on (`publication`, `checkpoint`), so a repeated task delivery cannot create a second row; an existing `captured` provider row is never overwritten by the collector.
23. `record_skip(publication, checkpoint, reason, at)` writes a row with `status = skipped`, `skip_reason`, all metric columns null, `unavailable = []`, `source = provider`, `captured_at = at`, `age_minutes` at that moment. It writes nothing when a row for that checkpoint already exists. It writes one `ContentEvent` of type `note` on the item, for example "24 h metrics skipped: not captured within 36 hours". Skips with reason `insights_unavailable` write no event (they are expected for metrics-by-hand accounts).
24. Both functions then move the pointer (rule 5) in the same transaction, but only if the pointer still names that checkpoint; a stale writer never moves a pointer backwards.
25. `adhoc` snapshots (from refresh or manual entry) are written with `checkpoint = adhoc`, are never unique, never move the pointer and are never evaluated.

### Sync status

26. `analytics.services.sync_status(account)` returns the account's metrics health, used by `GET /analytics/sync-status/` (E09-S03) and the overview (E11-S01):

    | Field | Definition |
    | --- | --- |
    | `metrics_last_snapshot_at` | Latest `captured_at` of a `captured` snapshot with `source = provider` |
    | `metrics_overdue` | Count of published publications whose `next_metrics_at` is more than 60 minutes in the past |
    | `metrics_oldest_overdue_at` | The oldest such `next_metrics_at`, or null |
    | `needs_manual_entry` | Count of publications with a skipped `insights_unavailable` row at an evaluation checkpoint and no captured row for it |
    | `collector` | The health record from rule 19, or nulls |
    | `insights_source` | `provider`, or `manual` when the provider is `manual` or `insights` is false |
    | `followers_last_snapshot_date`, `followers_overdue` | Filled by E09-S02 |

## Data

Uses `MetricSnapshot` and `Publication` from [DATA-MODEL.md](../../DATA-MODEL.md). New fields on `MetricSnapshot`:

| Field | Type | Notes |
| --- | --- | --- |
| `status` | enum | `captured` (default) or `skipped` |
| `skip_reason` | enum, null | `missed`, `insights_unavailable`, `media_not_found`, `expired`, `gave_up`; set only when `status = skipped` |

Constraints and indexes:

- Partial unique constraint on (`publication`, `checkpoint`) where `checkpoint <> 'adhoc'`.
- Check constraint: `status = 'skipped'` if and only if `skip_reason` is not null.
- Index on `MetricSnapshot(publication, captured_at)`.
- Partial index on `Publication(next_metrics_at)` where `next_metrics_at IS NOT NULL`.

Settings: `SOCIALHUB_METRICS_MAX_POSTS_PER_ACCOUNT_CYCLE` (10), `SOCIALHUB_METRICS_LOCK_WAIT_SECONDS` (10), `SOCIALHUB_METRICS_OVERDUE_MINUTES` (60).

Provider type in `apps/instagram/providers/base.py` (fields as in INSTAGRAM-INTEGRATION.md section 7), implemented by this story:

```python
@dataclass(frozen=True)
class InsightsResult:
    metrics: dict[str, int | None]   # snapshot columns that apply to the format
    unavailable: list[str]           # applicable metrics the API rejected or left out
    extra: dict[str, int]            # extra names from the metric map, under their API names
    raw: dict                        # trimmed Graph API response, at most 8 KB
```

Metric map module `apps/instagram/metrics.py`:

```python
METRIC_MAPS: dict[str, dict[Format, FormatMetrics]]   # key: Graph API version, e.g. the pinned SOCIALHUB_IG_API_VERSION

@dataclass(frozen=True)
class FormatMetrics:
    columns: dict[str, str]   # API metric name -> snapshot column, e.g. {"saved": "saves"}
    extra: list[str]          # API names stored in extra

def metric_map(version: str, fmt: Format) -> FormatMetrics: ...
```

## API

None in this story. E09-S03 exposes the snapshots, sync status, manual entry and refresh.

## Background work

| Task | Queue | Trigger | Idempotency and retries |
| --- | --- | --- | --- |
| `analytics.collect_due_metrics` | `default` | Celery Beat every 10 minutes | Redis lock `analytics:collect_due`; selection only, no writes |
| `analytics.collect_account_metrics(account_id, publication_ids)` | `default` | Enqueued by the task above, countdown 0–60 s | Redis lock `analytics:collect:{account_id}` (expiry 9 minutes) so one account is never collected twice at once; writes use `update_or_create` and the pointer guard (rule 24); no Celery retries, the next cycle is the retry |

Time limits: soft 8 minutes, hard 9 minutes per account task. At the soft limit the task stops after the current post.

## AI

None.

## Panel

None. Snapshots appear in E09-S03.

## Acceptance criteria

1. Given a reel published at 12:00 with the pointer at `1h`, when the collector runs at 13:05 and the fake provider returns all metrics, then a `captured` snapshot exists for `1h` with `age_minutes` 65, `unavailable` empty, `source = provider`, and the pointer is `6h` at 18:00.
2. Given the fake provider returns no `shares` for a reel, then the snapshot has `shares` null and `unavailable = ["shares"]`, and `replies` is null but not listed.
3. Given a story, then its snapshots are `1h`, `6h` and `23h` only, and after `23h` both pointer fields are null.
4. Given a reel whose `1h` capture fails until age 100 minutes, when the collector runs at age 100, then `1h` is recorded `skipped` with reason `missed`, no metric values are stored, and the pointer is `6h`.
5. Given a reel with the provider failing for 50 hours, when the provider recovers, then `1h`, `6h` and `24h` are skipped with reason `missed`, no snapshot holds invented values, and the pointer is `72h` at `published_at + 72 h`.
6. Given a feed post whose `7d` capture fails until age 9 days, when the provider recovers, then `7d` is captured with its real `age_minutes` and `on_time` false; given it still fails at 14 days, then `7d` is skipped with reason `gave_up`.
7. Given a story whose `23h` capture fails until after expiry and the provider then raises `NotFound`, then `23h` is skipped with reason `expired` and the pointer is null.
8. Given an account on the `manual` provider, when a checkpoint is due, then no provider call is made, a skip with reason `insights_unavailable` is recorded, and the pointer moves on.
9. Given the provider raises `TokenInvalid`, then no snapshot is written, the pointer is unchanged, `report_connection_error` sets the connection `needs_attention`, and the account's remaining posts are not processed this cycle.
10. Given the provider raises `RateLimited` with a 5-minute wait, then the account is not visited again for 15 minutes.
11. Given a publication of the account is `publishing`, when the collector runs, then the account is not visited this cycle.
12. Given 14 due publications on one account, when one cycle runs, then 10 are processed and 4 remain due for the next cycle.
13. Given the same account task is delivered twice, then each checkpoint still has one row and the pointer moved once.
14. Given a published post whose `next_metrics_at` was 90 minutes ago, then `sync_status` reports `metrics_overdue = 1` with that time as `metrics_oldest_overdue_at`.
15. Given a reel, when its insights are read, then the request names exactly `reach`, `views`, `likes`, `comments`, `saved`, `shares`, `total_interactions`, `ig_reels_avg_watch_time` and `ig_reels_video_view_total_time`; the API's `saved` value is stored in `saves` and `ig_reels_avg_watch_time` in `extra`.
16. Given the Graph API rejects one metric name in the request, when the adapter reads insights, then it repeats the request without that name and the snapshot lists the metric in `unavailable`.
17. Given publishing holds the account lock longer than `SOCIALHUB_METRICS_LOCK_WAIT_SECONDS`, when the collector reaches the account, then `AccountBusy` stops the account's batch for this cycle, nothing is recorded and the pointer is unchanged.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E09-S01-BE1 | Model and checkpoint service | `MetricSnapshot` model with `status` and `skip_reason`, constraints and indexes; publication index; `apps/analytics/services/checkpoints.py` with `CHECKPOINTS`, `next_checkpoint`, `due_action(publication, now)` implementing rules 2–7; unit tests with a frozen clock for every row of the schedule and the 50-hour example | 0.75 |
| E09-S01-BE2 | Insights adapter, metric map and fake values | `InsightsResult` type; `apps/instagram/metrics.py` with the per-format map keyed by API version and the system check; `media_insights` in the `graph_api` adapter: request building, response parsing for both value shapes, `saved` → `saves`, extras, the rejected-metric repeat and the too-few-viewers case of rule 16, error translation (`TokenInvalid`, `PermissionMissing`, `RateLimited`, `NotFound`, `TransientError`); `fake` provider `values` for `media_insights` (full, partial with `shares` missing) plus the scenarios `token_invalid`, `permission_missing`, `rate_limited`, `fail_n_times(n)` and a post removed from the fake's remote account (`NotFound`); tests per format against recorded Graph API responses | 0.75 |
| E09-S01-BE3 | Collector tasks | `collect_due_metrics` and `collect_account_metrics` in `apps/analytics/tasks.py`; selection query, grouping, countdown, the four skip conditions of rule 10, metrics-by-hand path, per-cycle cap, `account_session` with the short lock wait and `AccountBusy`, per-post re-read, error table of rule 17, backoff key, health record, time limits; Beat entry; tests per error row and for publishing priority | 1 |
| E09-S01-BE4 | Snapshot writer and sync status | `apps/analytics/services/snapshots.py` (`record_capture`, `record_skip`, adhoc writer) with the pointer guard and `ContentEvent` notes; `sync_status(account)` with the fields of rule 26; idempotency tests and a test that a stale writer does not move the pointer back | 0.5 |

### Frontend

None.

### Test

None beyond the tests inside each subtask.

## Test notes

- All collector tests use the `fake` provider, Celery in eager mode and a frozen clock advanced between runs; nothing sleeps.
- One end-to-end walk per format from publish to null pointer, asserting the exact set of checkpoint rows.
- An outage test: provider fails from age 30 minutes to age 50 hours; assert skipped rows, no invented values, then captures resume.
- A concurrency test: a publication becomes `publishing` between selection and processing; the account task must not call the provider.
- Adapter tests run against recorded Graph API responses: one per format, one rejected metric, one too-few-viewers error and one expired story. No test calls Meta.
- A real-provider check on the test account (one feed post, one reel, one story through all checkpoints) is part of E11-S03; it also confirms the metric names and the story insights window.

## Later

- More checkpoints (for example `14d`) are one row in `CHECKPOINTS`; the skip and give-up columns already generalize.
- Re-reading the final checkpoint a week later to catch Instagram's late corrections would be an `adhoc` capture driven by a second pointer.
- A Graph API version that renames a metric adds one entry to `apps/instagram/metrics.py`; nothing else changes.
- Story navigation by action (taps forward, taps back, exits) would be a second request with a breakdown parameter, stored in `extra`.
- Moving the health record from the cache to a table if operators need its history.
