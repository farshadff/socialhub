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
- The `media_insights` method of the `instagrapi` adapter and the mapping from provider fields to snapshot columns; the `fake` provider scenarios.
- The collector: selection of due publications, grouping by account, pacing, sharing the account lock with publishing, error handling.
- Recording skipped checkpoints with a reason.
- The snapshot writer service used by the collector, the refresh job and manual entry (E09-S03).
- The sync status service that E09-S03 and the overview (E11-S01) read.

**Out (later)**

- Checkpoints beyond 7 days, hourly curves, audience demographics, profile visits, link clicks.
- Per-story frame navigation metrics (taps forward, exits).
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
4. **Stories are final after 24 hours.** A story disappears at 24 hours and its numbers stop changing, so no checkpoint is scheduled after `23h`. The one-hour margin before expiry is why the final story checkpoint is `23h`. A `23h` capture taken after expiry is still valid as the story's final numbers. If the provider cannot return insights for the expired story (raises `NotFound` or `NotSupported`), the checkpoint is recorded as skipped with reason `expired`.
5. **Pointer moves.** After a capture or a skip, `next_metrics_checkpoint` becomes the next checkpoint in the format's list and `next_metrics_at = published_at + that checkpoint's age`. After the final checkpoint both fields are set to null; collection for that post is complete.
6. **Several checkpoints passed at once.** When the collector visits a post whose age has passed several checkpoints (after an outage), it walks the list in order: every non-final checkpoint past its skip age is skipped (rule 2); the first checkpoint that is due and not past its skip age is captured; one visit produces at most one capture. Example: a reel at age 50 hours with the pointer at `1h` gets `1h`, `6h` and `24h` skipped and the pointer set to `72h` at `published_at + 72 h`, because 72 hours have not passed yet.
7. **On time.** Every snapshot stores its real `age_minutes`. The API derives `on_time = age_minutes <= checkpoint age + max(20, 10% of checkpoint age)`. The tolerance covers the 10-minute collector interval plus pacing. `on_time` is informational; a late but not skipped capture still counts as that checkpoint.

### Collector

8. Celery Beat runs `analytics.collect_due_metrics` every 10 minutes on the `default` queue. A Redis lock `analytics:collect_due` (expiry 9 minutes) makes an overlapping run exit immediately.
9. It selects publications with `status = published`, `next_metrics_checkpoint` not null and `next_metrics_at <= now`, whose account has `status = active`, ordered by `next_metrics_at`. It groups them by account and enqueues one `analytics.collect_account_metrics(account_id, publication_ids)` task per account with a random countdown of 0–60 seconds, so accounts do not start at the same moment.
10. An account is not visited this cycle when any of these holds:

    | Condition | Why |
    | --- | --- |
    | A publication of the account is `publishing` or `verifying` | Publishing has priority over reading |
    | A provider-delivered publication of the account is `scheduled` with `scheduled_at` within the next 5 minutes | Leave the lock free for the send |
    | The cache key `analytics:backoff:{account_id}` is set | A rate limit was hit recently (rule 17) |
    | The connection status is not `connected` | Session problems are already on the overview; calling would fail |

    A skipped account keeps its pointers; the next cycle tries again. The late-capture rule applies as time passes, so nothing is ever captured at the wrong checkpoint.
11. **No provider calls for metrics-by-hand accounts.** When the account's `AccountConnection.provider` is `manual`, or its `capabilities.insights` is false, the collector does not call the provider. For each due checkpoint it records a skip with reason `insights_unavailable` and moves the pointer (rule 5). The operator fills those checkpoints through manual entry (E09-S03), which replaces the skipped row. The `connected` condition in rule 10 does not apply to these accounts.
12. Inside `collect_account_metrics`, publications are processed one at a time, oldest due first, at most `SOCIALHUB_METRICS_MAX_POSTS_PER_ACCOUNT_CYCLE` (default 10) per cycle. The rest wait for the next cycle.
13. Every provider call goes through `apps.instagram.session.account_session(account, wait_seconds=SOCIALHUB_METRICS_LOCK_WAIT_SECONDS)` from E00-S04, which takes the per-account Instagram lock (Redis key `ig:lock:{account_id}`, the same lock publishing uses), loads and saves the session, and pauses a random 2–6 seconds before releasing. The collector waits at most `SOCIALHUB_METRICS_LOCK_WAIT_SECONDS` (default 10) for the lock. If it cannot get it, it stops processing that account for this cycle without recording anything. The lock is taken per post, not for the whole batch, so a due publication can interleave.
14. Before each provider call the collector re-reads the publication and recomputes which checkpoint is due (rule 6), because a manual entry or a refresh may have moved the pointer in the meantime.
15. One call per post per visit: `media_insights(state, remote_media_pk, format)`. The result is written with the snapshot writer (rules 22–25).

### Provider results and errors

16. **Mapping.** The adapter returns an `InsightsResult` with `metrics` (a dict of `Metric` to integer or null), `unavailable` (applicable metrics the provider could not return) and `raw` (trimmed payload). The adapter normalizes provider field names; the spike in E00-S04 records the exact names for the pinned `instagrapi` version. Expected mapping:

    | Snapshot column | Provider fields (first present wins; confirm in the spike) | Applies to |
    | --- | --- | --- |
    | `reach` | `reach` | reel, feed_post, story |
    | `views` | `views`, `plays`, `video_views`, `impressions` | reel, feed_post, story |
    | `likes` | `likes`, `like_count` | reel, feed_post |
    | `comments` | `comments`, `comment_count` | reel, feed_post |
    | `saves` | `saved`, `saves` | reel, feed_post |
    | `shares` | `shares` | reel, feed_post, story |
    | `replies` | `replies` | story |

    Metrics that do not apply to a format are stored as null and are **not** listed in `unavailable`; `unavailable` lists only applicable metrics the provider did not return. Fields the provider returns beyond these go to `extra` (for example `profile_visits`, `follows`, `total_interactions`). Values are non-negative integers; a negative or non-numeric value is treated as unavailable and logged.
17. **Errors.** Adapters raise only the errors in INSTAGRAM-INTEGRATION.md. The collector reacts as follows:

    | Error | Snapshot | Pointer | Other effects | Rest of the account's batch |
    | --- | --- | --- | --- | --- |
    | `SessionRequired`, `ChallengeRequired` | None | Unchanged | `report_session_error(account, error)` (E00-S04) | Stop |
    | `RateLimited` | None | Unchanged | Cache key `analytics:backoff:{account_id}` for max(suggested wait, 15 minutes) | Stop |
    | `TransientError` | None | Unchanged | Failure counter +1 | Continue with the next post; stop after 3 consecutive transient errors |
    | `NotFound` (media deleted, or story expired) | Skip with reason `media_not_found` (reel, feed_post) or `expired` (story) for the due checkpoint and every remaining one | Null | `ContentEvent` note "Post no longer found on Instagram; metrics stopped" | Continue |
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

Provider types added to `apps/instagram/providers/base.py`:

```python
@dataclass(frozen=True)
class InsightsResult:
    metrics: dict[str, int | None]   # keys are Metric values that apply to the format
    unavailable: list[str]           # applicable metrics not returned
    extra: dict[str, int]            # other numeric fields
    raw: dict                        # trimmed payload, at most 8 KB
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
9. Given the provider raises `SessionRequired`, then no snapshot is written, the pointer is unchanged, `report_session_error` is called, and the account's remaining posts are not processed this cycle.
10. Given the provider raises `RateLimited` with a 5-minute wait, then the account is not visited again for 15 minutes.
11. Given a publication of the account is `publishing`, when the collector runs, then the account is not visited this cycle.
12. Given 14 due publications on one account, when one cycle runs, then 10 are processed and 4 remain due for the next cycle.
13. Given the same account task is delivered twice, then each checkpoint still has one row and the pointer moved once.
14. Given a published post whose `next_metrics_at` was 90 minutes ago, then `sync_status` reports `metrics_overdue = 1` with that time as `metrics_oldest_overdue_at`.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E09-S01-BE1 | Model and checkpoint service | `MetricSnapshot` model with `status` and `skip_reason`, constraints and indexes; publication index; `apps/analytics/services/checkpoints.py` with `CHECKPOINTS`, `next_checkpoint`, `due_action(publication, now)` implementing rules 2–7; unit tests with a frozen clock for every row of the schedule and the 50-hour example | 0.75 |
| E09-S01-BE2 | Insights adapter and fake scenarios | `InsightsResult` type; `media_insights` in the `instagrapi` adapter using the spike's method names, field normalization per rule 16, error translation (`NotFound`, `NotSupported`, `RateLimited`, `TransientError`, session errors); `fake` provider scenarios: full, partial (`shares` missing), session error, rate limit, transient, not found, outage window; tests for the mapping per format | 0.75 |
| E09-S01-BE3 | Collector tasks | `collect_due_metrics` and `collect_account_metrics` in `apps/analytics/tasks.py`; selection query, grouping, countdown, the four skip conditions of rule 10, metrics-by-hand path, per-cycle cap, `account_session` with short lock wait, per-post re-read, error table of rule 17, backoff key, health record, time limits; Beat entry; tests per error row and for publishing priority | 1 |
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
- A real-provider check on the throwaway account (one feed post, one reel, one story through all checkpoints) is part of E11-S03.

## Later

- More checkpoints (for example `14d`) are one row in `CHECKPOINTS`; the skip and give-up columns already generalize.
- Re-reading the final checkpoint a week later to catch Instagram's late corrections would be an `adhoc` capture driven by a second pointer.
- The `graph_api` adapter returns the same metrics under official names; only the mapping in rule 16 changes.
- Moving the health record from the cache to a table if operators need its history.
