# E09-S04 — Metric entry checkpoints and reminders

| | |
| --- | --- |
| Epic | E09 Analytics refresh |
| Priority | Must |
| Estimate | BE 1 d · FE 0.5 d |
| Depends on | E00-S03, E00-S06, E08-S01 |
| Needed by | E08-S05, E09-S03, E10-S01, E11-S01 |

## User story

As an operator, I want the panel to tell me when a post's numbers or the account's follower count need to be typed in, and to stop asking once the moment has passed, so that every post has numbers at the ages the evaluation uses and nothing waits on me forever.

## Context

Phase 1 has no Instagram API. Every number in Social Hub is read from the Instagram app and typed in by a person (E09-S03). E10-S01 evaluates a post only at its evaluation checkpoints: `24h` and `7d` for reels and feed posts, `23h` for stories. So those are the only numbers the system asks for.

This story owns the timing: the checkpoint table, the pointer on each publication that names the next checkpoint to ask for, the task that records a checkpoint as missed when its window closes, the weekly follower reminder, the conditions behind the two reminder entries on the overview (E11-S01) and the `sync_status` summary. E08-S05 starts the pointer when the operator marks a publication as published. E09-S03 has the entry forms and calls this story's `advance` after each entry.

## Scope

**In**

- The checkpoint table with entry windows, in `apps/analytics/services/checkpoints.py`.
- The `MetricSnapshot` and `AccountSnapshot` models, and the skip writer.
- The pointer rules: `start_metrics_pointer(publication)` (called by E08-S05) and `advance(publication, now)` (called by the task and by E09-S03).
- Task `analytics.advance_entry_checkpoints`.
- The follower reminder on the first day of each plan week.
- `metrics_entry_due(account)` and `followers_entry_due(account)`, which E11-S01 turns into attention entries.
- `analytics.services.sync_status(account)` and `GET /analytics/sync-status/`.
- Panel: `SyncStatusLine`, the "Metrics to enter" quick filter and the deep links that open the entry forms.

**Out (later)**

- Reminders by email or chat (Phase 1 reminds only inside the panel).
- Asking for the optional checkpoints (`1h`, `6h`, `72h`).
- Automatic collection from Instagram (Phase 2, E09-S01 and E09-S02).

## Behaviour and rules

### Checkpoints

1. Checkpoints per format are code constants in `apps/analytics/services/checkpoints.py` (`CHECKPOINTS`), aligned with the format registry (E04-S01):

   | Checkpoint | Age in minutes | Formats | Asked for | Final for | Entry window closes at age |
   | --- | --- | --- | --- | --- | --- |
   | `1h` | 60 | reel, feed_post, story | No | — | 90 |
   | `6h` | 360 | reel, feed_post, story | No | — | 540 |
   | `23h` | 1,380 | story | Yes | story | Never |
   | `24h` | 1,440 | reel, feed_post | Yes | — | 10,080 (when `7d` opens) |
   | `72h` | 4,320 | reel, feed_post | No | — | 6,480 |
   | `7d` | 10,080 | reel, feed_post | Yes | reel, feed_post | Never |

2. **Evaluation checkpoints.** The checkpoints marked "Asked for" are the evaluation checkpoints, in this order: reel and feed_post `24h` then `7d`; story `23h`. They are the same as `EVALUATION_CHECKPOINTS` in E10-S01. The optional checkpoints (`1h`, `6h`, `72h`) and `adhoc` can be entered by hand inside their window (E09-S03), but they are never asked for, never due, never skipped and never move the pointer.
3. **Entry window.** A checkpoint can be entered from the moment the post reaches the checkpoint's age until the closing age in rule 1. The final checkpoints (`7d`, `23h`) have no closing age: late final numbers are still the most complete numbers the post has. The optional checkpoints close at 150% of their age, because numbers read later would not describe the post at that age. E09-S03 validates every entry against this window with `entry_window(publication, checkpoint)`, which returns `(opens_at, closes_at)` with `closes_at` null for a final checkpoint.

### The pointer

4. **Start.** `start_metrics_pointer(publication)` is called by E08-S05 in the transaction that marks the publication `published`. It sets `next_metrics_checkpoint` to the first evaluation checkpoint (`24h` for reel and feed_post, `23h` for story) and `next_metrics_at = published_at + that checkpoint's age`, then calls `advance` (rule 7). A post whose `published_at` lies days in the past is therefore brought up to date at once.
5. **Due for entry.** A publication is due for entry when its status is `published`, its account is `active`, `next_metrics_checkpoint` is not null and `next_metrics_at <= now`. The checkpoint the pointer names is the one that is due. A publication has at most one checkpoint due at a time. Due state is derived when read; nothing is written when a checkpoint becomes due.
6. **Due until.** The pointer's checkpoint stays due until:
   - for `24h`: the time of the next evaluation checkpoint, `published_at + 7 days`;
   - for a final checkpoint (`7d`, `23h`): `SOCIALHUB_METRICS_ENTRY_GRACE_DAYS` (default 3) days after its time.

   `due_until(publication)` returns this time for the pointer's checkpoint.
7. **Advance.** `advance(publication, now)` runs with the publication row locked (`select_for_update`) and repeats while the pointer is not null:
   1. If a `captured` row exists for the pointer's checkpoint, move the pointer to the next evaluation checkpoint.
   2. Otherwise, if `now` is past `due_until`, write a skipped row (rule 11) and move the pointer to the next evaluation checkpoint.
   3. Otherwise, stop.

   Moving sets `next_metrics_checkpoint` to the next evaluation checkpoint and `next_metrics_at = published_at + its age`. Moving past the last evaluation checkpoint sets both fields to null: nothing more is asked for. `advance` only ever moves the pointer forward, and it decides from the rows, so a stale or repeated call cannot move it backwards or skip a checkpoint that has numbers.
8. **A captured row moves the pointer at once.** E09-S03 calls `advance` in the same transaction as each saved entry. An entry for the pointer's checkpoint therefore moves the pointer immediately. An entry for a later evaluation checkpoint (for example `7d` entered while the pointer still names `24h`, in the minutes before the task runs) is picked up when the pointer reaches it.
9. **Task.** Celery Beat runs `analytics.advance_entry_checkpoints` every 10 minutes. It selects publications with `status = published`, `next_metrics_checkpoint` not null and `next_metrics_at <= now` whose account is `active`, and calls `advance` for each in its own transaction. Only windows that have closed lead to writes. Publications of archived accounts keep their pointer and are not touched.

### Worked example

A reel is marked published with `published_at` 2026-11-28 15:30 UTC (19:00 in `Asia/Tehran`).

- `start_metrics_pointer`: pointer `24h`, `next_metrics_at` 29 Nov 15:30.
- From 29 Nov 15:30 the reel is due for entry; it stays due until 5 Dec 15:30.
- The operator enters the `24h` numbers on 29 Nov 18:10. `advance` moves the pointer to `7d`, `next_metrics_at` 5 Dec 15:30. The reel is no longer due.
- From 5 Dec 15:30 the `7d` checkpoint is due until 8 Dec 15:30. Nobody enters it. The task run at 8 Dec 15:40 writes a skipped `7d` row with reason `missed` and clears the pointer.
- On 9 Dec the operator enters the `7d` numbers after all. E09-S03 replaces the skipped row with the captured numbers; the pointer stays null and E10-S01 evaluates the post.

A story published 1 Dec 08:00 UTC is due for `23h` from 2 Dec 07:00 until 5 Dec 07:00.

### Snapshot rows

10. `MetricSnapshot` rows follow [DATA-MODEL.md](../../DATA-MODEL.md) section 10: at most one row per (`publication`, `checkpoint`) except `adhoc`. Every row written in Phase 1 has `source = manual`, the only Phase 1 value. `status` is `captured` or `skipped`. In Phase 1, `skip_reason` is always `missed`; the other values (`insights_unavailable`, `media_not_found`, `expired`, `gave_up`) stay in the enum for Phase 2 and are never written.
11. `analytics.services.snapshots.record_skip(publication, checkpoint, at)` writes a row with `status = skipped`, `skip_reason = missed`, all metric columns null, `unavailable = []`, `extra = {}`, `source = manual`, `captured_at = at` and `age_minutes` at that moment. It writes nothing when a row for that checkpoint already exists. It writes one `ContentEvent` of type `note` on the item: "24 h metrics were not entered in time. The checkpoint is marked as missed."
12. A skipped final checkpoint can still be filled later: E09-S03 replaces the skipped row with captured numbers. A skipped `24h` row cannot, because its window closed when it was skipped.

### Follower reminder

13. An `active` account is **followers due** when today, in the account's timezone, is its plan-week start day (`InstagramAccount.week_start_day`) and no `AccountSnapshot` exists for today's date. It stops being due as soon as a row for today exists, or when the day ends. A day that ends without a row stays missing; nothing is estimated.
14. One count per week is enough: the weekly change compares the rows dated `week_start` and the next `week_start` (`follower_change(account, week_start, week_end)`, E09-S03). The operator may enter counts on other days as well; they appear in the follower series.

### Reminder entries

15. `analytics.services.reminders` provides two functions that E11-S01's attention builders call:
    - `metrics_entry_due(account)` returns one item per publication due for entry (rule 5), oldest `next_metrics_at` first: `publication`, `content_item`, `title`, `format`, `checkpoint`, `due_at` (= `next_metrics_at`) and `due_until` (rule 6).
    - `followers_entry_due(account)` returns `{"date": <today, local>, "since": <local start of today in UTC>}` when the account is followers due (rule 13), else null.
16. The attention entries built from them (E11-S01 renders them, aggregates them and applies its caps):

    | Type | Condition | Severity | Title and detail | Link |
    | --- | --- | --- | --- | --- |
    | `metrics_entry_due` | Rule 5, one per publication | `high` for a story's `23h` (the Instagram app shows story insights for a limited time), `medium` otherwise | "Metrics to enter: {title}" / "{checkpoint} metrics are due. Read them in the Instagram app and enter them by {due_until}." (checkpoint as "24 h", "7 d" or "23 h") | `/analytics/posts/{publication}?enter={checkpoint}` |
    | `followers_entry_due` | Rule 13, one per account | `medium` | "Follower count to enter" / "Enter today's follower count from the Instagram app. It is used for the weekly follower change." | `/analytics/account?enter=followers` |

    Entry IDs are `metrics_entry_due:{publication_id}` and `followers_entry_due:{account_id}`; `since` is `due_at`, or the local start of today for followers.

### Sync status

17. `analytics.services.sync_status(account)` returns the account's entry status, used by `GET /analytics/sync-status/`, `SyncStatusLine` and the overview (E11-S01):

    | Field | Definition |
    | --- | --- |
    | `metrics_due` | Number of publications due for entry (rule 5) |
    | `metrics_missed_7d` | Number of the account's `skipped` rows with `skip_reason = missed` whose `captured_at` is in the last 7 days |
    | `followers_due` | Rule 13 |
    | `last_entry_at` | The latest `updated_at` among the account's `captured` `MetricSnapshot` rows and its `AccountSnapshot` rows, or null |

18. `GET /analytics/sync-status/` is open to both roles.

## Data

This story creates the two analytics tables and their migration as defined in [DATA-MODEL.md](../../DATA-MODEL.md) section 10:

- `MetricSnapshot`, including `status` (`captured` default, `skipped`) and `skip_reason`.
- `AccountSnapshot`, with `following` and `media_count` nullable (a person may know only the follower count). E09-S03 writes its rows and computes `follower_change`.

`source` on both tables is `manual` in Phase 1. The story reads and writes `Publication.next_metrics_checkpoint` and `Publication.next_metrics_at`, and reads `InstagramAccount.week_start_day` and `InstagramAccount.timezone`.

Constraints and indexes:

- Partial unique constraint on `MetricSnapshot` (`publication`, `checkpoint`) where `checkpoint <> 'adhoc'`.
- Check constraint: `status = 'skipped'` if and only if `skip_reason` is not null.
- Index on `MetricSnapshot(publication, captured_at)`.
- Partial index on `Publication(next_metrics_at)` where `next_metrics_at IS NOT NULL`.
- Unique constraint on `AccountSnapshot` (`account`, `date`); `followers >= 0`; `following` and `media_count` null or `>= 0`.

Setting: `SOCIALHUB_METRICS_ENTRY_GRACE_DAYS` (default 3, range 1–14).

## API

### `GET /api/v1/analytics/sync-status/?account={id}`

Permission: any signed-in user.

Response `200`:

```json
{
  "metrics_due": 2,
  "metrics_missed_7d": 1,
  "followers_due": true,
  "last_entry_at": "2026-12-05T08:42:10Z"
}
```

| Case | Response |
| --- | --- |
| `account` missing | `400 validation_error`, field `account`, code `required` |
| Account not found | `404 not_found` |

## Background work

| Task | Queue | Trigger | Idempotency and retries |
| --- | --- | --- | --- |
| `analytics.advance_entry_checkpoints` | `default` | Celery Beat every 10 minutes | Redis lock `analytics:advance_entry` (expiry 9 minutes) makes an overlapping run exit at once. Each publication is advanced in its own transaction with the row locked; skips use the partial unique constraint and `record_skip` writes nothing when a row exists, so a repeated run changes nothing. No Celery retries; the next run is the retry. One failing publication is logged with its ID and the rest continue. |

## AI

None.

## Panel

### `SyncStatusLine`

`src/components/analytics/SyncStatusLine.tsx`, shown as the page description on `/analytics/posts`, `/analytics/posts/:publicationId` and `/analytics/account`. It reads `GET /analytics/sync-status/`, refetches every 60 seconds and after every entry saved in E09-S03. Parts, in this order, each shown only when relevant:

| Part | When | Display |
| --- | --- | --- |
| "Metrics to enter: 2" | `metrics_due > 0` | Warning `Tag`; links to `/analytics/posts?metrics_status=entry_due` |
| "Follower count due today" | `followers_due` | Warning `Tag`; opens the follower entry form (E09-S03) |
| "1 checkpoint missed in the last 7 days" | `metrics_missed_7d > 0` | Default text |
| "Last entry 2 h ago" | Always | Secondary text from `last_entry_at`; "No numbers entered yet" when null |

### "Metrics to enter" quick filter

On `/analytics/posts` (E09-S03), the table toolbar has a segmented control "All posts" / "Metrics to enter ({n})", where n is `metrics_due`. "Metrics to enter" sets the `metrics_status` filter to `entry_due`. The URL parameter `metrics_status=entry_due` selects it on load.

### Deep links

- `/analytics/posts/:publicationId?enter=24h` opens `ManualSnapshotModal` (E09-S03) with that checkpoint selected. If the checkpoint is not open for entry, the modal does not open and a message reads "24 h metrics can no longer be entered for this post."
- `/analytics/account?enter=followers` opens the follower entry form with today's date.
- The parameter is removed from the URL after the modal opens, so a reload does not reopen it.

Labels for the states this story defines (the label maps live with E09-S03's components): checkpoint status `due` → "Due for entry" (warning) with "Enter by {due_until}" beneath; post `metrics_status` `entry_due` → "Metrics to enter" (warning); skip reason `missed` → "Not entered in time".

## Acceptance criteria

1. Given a reel marked published with `published_at` 28 Nov 15:30, then its pointer is `24h` with `next_metrics_at` 29 Nov 15:30; given a story, the pointer is `23h` at `published_at` + 23 hours.
2. Given that reel at 29 Nov 15:40 with no `24h` row, then `sync_status` reports `metrics_due = 1`, and `metrics_entry_due` returns the reel with checkpoint `24h` and `due_until` 5 Dec 15:30.
3. Given the operator enters the `24h` numbers on 29 Nov 18:10 (E09-S03), then in the same request the pointer becomes `7d` with `next_metrics_at` 5 Dec 15:30, and `metrics_due` is 0.
4. Given no `24h` entry by 5 Dec 15:30, when the task runs at 15:40, then a `24h` row exists with `status = skipped`, `skip_reason = missed`, `source = manual` and no metric values, a note event is on the item, and the pointer is `7d`, which is now due.
5. Given no `7d` entry by 8 Dec 15:30, when the task runs, then `7d` is skipped with reason `missed`, both pointer fields are null and `metrics_missed_7d` counts the row.
6. Given a skipped `7d` row, when the operator enters `7d` numbers (E09-S03), then the row is `captured` and the pointer stays null.
7. Given `7d` numbers are entered at 5 Dec 15:35 while the pointer still names `24h`, when the task runs at 15:40, then `24h` is skipped as missed and the pointer is null, because `7d` already has numbers.
8. Given the task runs twice over the same state, then each checkpoint has one row and the item has one note event per skip.
9. Given `1h` numbers are entered for a reel, then the pointer is unchanged, and no reminder is ever raised for `1h`, `6h` or `72h`.
10. Given an account with `week_start_day` Saturday in `Asia/Tehran`, when it is Saturday local time and no follower row exists for today, then `followers_due` is true and `followers_entry_due` returns today's date; after a count for today is saved it is false; on Sunday it is false.
11. Given an archived account with a publication whose window has closed, when the task runs, then nothing is written for it and neither reminder function returns it.
12. Given `GET /analytics/sync-status/` without `account`, then the response is `400 validation_error` on `account`.
13. In the panel, given `metrics_due = 2`, then `SyncStatusLine` shows "Metrics to enter: 2" as a warning tag that opens the post list filtered to `entry_due`; given I open `/analytics/posts/57?enter=24h` while `24h` is open, then the entry form opens with "24 h" selected.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E09-S04-BE1 | Models, checkpoints and pointer | `MetricSnapshot` and `AccountSnapshot` models and migration in `apps/analytics/models.py` with `status`, `skip_reason`, nullable `following` and `media_count`, constraints and indexes; publication index; `apps/analytics/services/checkpoints.py` with `CHECKPOINTS`, `entry_window`, `due_until`, `start_metrics_pointer`, `advance`; `record_skip` in `apps/analytics/services/snapshots.py`; setting with range check; unit tests with a frozen clock for every row of the table, the worked example and the out-of-order case of acceptance criterion 7 | 0.5 |
| E09-S04-BE2 | Task, reminders and sync status | `advance_entry_checkpoints` in `apps/analytics/tasks.py` with the lock and Beat entry; `apps/analytics/services/reminders.py` (`metrics_entry_due`, `followers_entry_due`); `sync_status(account)`; `GET /analytics/sync-status/` view and serializer; `openapi.yaml`; tests across local midnight in `Asia/Tehran` and `UTC`, archived accounts and repeated runs | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E09-S04-FE1 | Sync status line | `src/components/analytics/SyncStatusLine.tsx`, service call and types in `src/services/socialhub/analytics.ts`, 60-second refetch and invalidation after an entry, all four parts and their links; component tests | 0.25 |
| E09-S04-FE2 | Quick filter and deep links | "Metrics to enter" segmented control on `src/pages/analytics/posts/index.tsx`; `?enter=` handling on the post detail and followers pages (open, refuse with message, clear the parameter); tests | 0.25 |

### Test

None beyond the tests inside each subtask.

## Test notes

- All timing tests use a frozen clock advanced between task runs; nothing sleeps.
- One walk per format from `start_metrics_pointer` to a null pointer: once with every evaluation checkpoint entered, once with none entered, asserting the exact set of rows.
- A concurrency test: an entry and the task act on the same publication at once; the row lock makes the result one captured row and a pointer that moved once.
- A test that the evaluation checkpoints here equal `EVALUATION_CHECKPOINTS` in E10-S01, so the two lists cannot drift.
- Follower reminder tests for an account whose local week-start day begins on the previous UTC date.

## Later

- Phase 2: the collector (E09-S01) fills the same checkpoints from Instagram with `source = provider`, adds its own skip and give-up ages, and starts the pointer at `1h` for accounts whose metrics it collects; these reminders remain for accounts without insights.
- Phase 2: `sync_status` gains the collector's health and the provider fields (E09-S01 rule 26, E09-S02 rule 16).
- Reminders by email or chat once notifications exist; the attention entry IDs are stable, so "new" is a set difference.
- A reminder for optional checkpoints is one flag per row in `CHECKPOINTS`.
- A follower reminder on a day other than the week-start day would be one account setting.
