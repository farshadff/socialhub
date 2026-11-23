# E09-S02 — Collect follower counts from Instagram daily

> **Phase 2 — not built in Phase 1.** Phase 1 has no Instagram API, so the operator types the follower count in from the Instagram app, prompted on the first day of each plan week ([E09-S04](S04-entry-checkpoints.md) reminds, [E09-S03](S03-analytics-views.md) records).
>
> The follower change rules in this file (rules 11–15, `follower_change` on a row and `follower_change(account, from_date, to_date)`) apply in Phase 1 to the manual rows and are built with E09-S03. The `AccountSnapshot` model with nullable `following` and `media_count` is built in Phase 1 by E09-S04. This story adds the daily provider reading (`source = provider`) and the follower fields of `sync_status` (rule 16).

| | |
| --- | --- |
| Epic | E09 Analytics refresh |
| Priority | Phase 2 |
| Estimate | BE 1 d · FE 0 d |
| Depends on | E00-S03, E00-S04, E09-S01 |
| Needed by | Phase 2 additions to E11-S01 |

## User story

As an operator, I want each account's follower count recorded once a day with the change since the day before, so that I can see whether the week's content grew the account.

## Context

The workflow's step 09 says "Track follower change by account". Follower growth is also a goal metric (`follower_growth`, week total only, E01-S01) and part of the weekly report's totals (E10-S02). The account fields this story reads return only the current follower count, not a history, so the product has to record it itself. One reading a day is enough for weekly planning; it is taken shortly after midnight so each reading describes the start of a local day.

## Scope

**In**

- `account_stats` in the `graph_api` adapter (`GET /me?fields=followers_count,follows_count,media_count`) and the `fake` provider.
- A daily `AccountSnapshot` per active account at 00:10 account-local time, retried through the day until it succeeds.
- `follower_change` per snapshot and the period change service used by E09-S03 and E10-S02.
- The follower fields of the sync status (E09-S01, rule 26).

**Out (later)**

- Hourly follower readings and attributing follows to posts.
- Follower demographics.
- Backfilling history from before the account was connected.

## Behaviour and rules

### When a snapshot is taken

1. Celery Beat runs `analytics.dispatch_follower_snapshots` every 10 minutes. For each account with `status = active` it computes the local date and time in the account's timezone.
2. An account is due when all of these hold: local time is 00:10 or later; no `AccountSnapshot` exists for the local date; the cache key `analytics:followers_attempt:{account_id}` is not set.
3. For a due account the dispatcher sets the attempt key (30-minute expiry) and enqueues `analytics.snapshot_followers(account_id, local_date)` with a random countdown of 0–120 seconds. A failed attempt is therefore retried about every 30 minutes for the rest of the local day.
4. Accounts whose provider is `manual` are never called. They are skipped by the dispatcher; their counts come from manual entry (E09-S03). `account_stats` reads basic account fields and needs only `instagram_business_basic`, not the insights permission, so a `graph_api` account with `capabilities.insights` false is still called.
5. An account whose connection is `disconnected` or `needs_attention` is skipped by the dispatcher (`expiring` still has a valid token and is called). If it reconnects later in the same day, the snapshot is taken then.
6. When the local date ends without a successful snapshot, that date stays missing. Missing dates are never filled with estimated values; views and calculations show them as missing.

### Taking the snapshot

7. `snapshot_followers` opens `apps.instagram.session.account_session(account, wait_seconds=60)` (E00-S04, Redis key `ig:lock:{account_id}`), which waits up to 60 seconds for the per-account lock and yields `(provider, token)`, then calls `provider.account_stats(token)`. The `graph_api` adapter sends `GET /me?fields=followers_count,follows_count,media_count` and returns `followers` (`followers_count`), `following` (`follows_count`) and `media_count`.
8. It writes the row with `update_or_create` on (`account`, `date`): `date` is the local date the task was enqueued for, `captured_at` is now, `source = provider`. A row that already exists with `source = manual` is not overwritten; the task ends without writing.
9. If the task runs after the local date has changed (a long queue delay), it still writes the date it was enqueued for only when `captured_at` is within 2 hours after that date's end; otherwise it does nothing, and the dispatcher handles the new date.
10. Errors (INSTAGRAM-INTEGRATION.md section 7):

    | Error | Effect |
    | --- | --- |
    | `TokenInvalid`, `PermissionMissing` | `report_connection_error(account, error)` sets the connection `needs_attention`; no row; retried by rule 3 after reconnection (rule 5) |
    | `RateLimited` | No row; the attempt key is extended to max(`retry_after_seconds`, 30 minutes) |
    | `AccountBusy` (lock not free within 60 seconds) | No row; retried by rule 3 |
    | `TransientError`, other exceptions | No row; logged with `account_id`; retried by rule 3 |
    | `NotSupported` (only if a manual account slipped past rule 4) | No row; logged; the attempt key is extended to the end of the local day |

### Follower change

11. `follower_change` on a row = `followers` of this row − `followers` of the row dated the previous calendar day. It is null when the previous day has no row. It is computed when the row is written.
12. When a row is written or replaced (including manual entry, E09-S03), the next day's row, if it exists, has its `follower_change` recomputed in the same transaction.
13. A snapshot dated D is taken at the start of D, so it describes the count at the end of D − 1. The period service follows from that.
14. `analytics.services.followers.follower_change(account, from_date, to_date)` returns the change over a period of whole local days:
    - Candidate rows are those with `date` from `from_date` to `to_date + 1` inclusive.
    - `start` is the earliest candidate row; `end` is the latest.
    - `change = end.followers − start.followers`, or null when fewer than two candidate rows exist.
    - `exact` is true when `start.date = from_date` and `end.date = to_date + 1`; otherwise the result covers a shorter span than asked and says so.
    - `missing_dates` lists the dates in that range without a row.

    Example: a plan week from Saturday 28 Nov to Friday 4 Dec. Rows exist for 28 Nov (12,480), 29 Nov to 3 Dec, and 5 Dec (12,731); 4 Dec is missing. Then `start` = 28 Nov, `end` = 5 Dec, `change` = 251, `exact` = true, `missing_dates` = ["2026-12-04"].
15. E10-S02 calls `follower_change(account, plan.week_start, plan.week_end)` for the weekly totals.

### Sync status

16. The follower part of `sync_status(account)` (E09-S01, rule 26):
    - `followers_last_snapshot_date`: the latest row's `date`, or null.
    - `followers_overdue`: true when the account's provider is not `manual` (rule 4), it has at least one published publication, and it has no row for today or yesterday. This is the condition E11-S01 shows as a sync gap.

## Data

Uses `AccountSnapshot` from [DATA-MODEL.md](../../DATA-MODEL.md). The nullable `following` and `media_count` and the constraints (`followers >= 0`; `following` and `media_count` null or `>= 0`) moved to [E09-S04](S04-entry-checkpoints.md), which builds the model in Phase 1. This story adds the value `provider` to `source`.

Provider type in `apps/instagram/providers/base.py` (fields as in INSTAGRAM-INTEGRATION.md section 7), implemented by this story:

```python
@dataclass(frozen=True)
class AccountStats:
    followers: int
    following: int
    media_count: int
```

## API

None in this story. `GET /analytics/account/` and `POST /analytics/account/snapshots/` are in E09-S03.

## Background work

| Task | Queue | Trigger | Idempotency and retries |
| --- | --- | --- | --- |
| `analytics.dispatch_follower_snapshots` | `default` | Celery Beat every 10 minutes | Redis lock `analytics:dispatch_followers` (9-minute expiry); per-account attempt key prevents duplicate enqueues |
| `analytics.snapshot_followers(account_id, local_date)` | `default` | Enqueued by the dispatcher, by the refresh job (E09-S03) | `update_or_create` on (`account`, `date`); never overwrites a manual row; no Celery retries, the dispatcher retries after 30 minutes |

## AI

None.

## Panel

None. The follower page is in E09-S03.

## Acceptance criteria

1. Given an account in `Asia/Tehran`, when the dispatcher runs at 00:12 local time and the fake provider returns 12,480 followers, then one `AccountSnapshot` exists for today with `followers` 12,480 and `source = provider`.
2. Given the same account, when the dispatcher runs again at 00:22, then no second task is enqueued and no second row exists.
3. Given yesterday's row has 12,431 followers, then today's `follower_change` is 49; given yesterday has no row, then it is null.
4. Given the provider raises `TransientError` at 00:12, then no row is written, and another attempt is made around 00:42.
5. Given the connection is `needs_attention` all day, then no row is written for that date and no estimated value appears later.
6. Given a manual row exists for today, when the scheduled task runs, then the manual row is unchanged.
7. Given an account on the `manual` provider, then the dispatcher never enqueues a task for it.
8. Given rows for 28 Nov to 3 Dec and 5 Dec, when `follower_change` is asked for 28 Nov to 4 Dec, then it returns start 28 Nov, end 5 Dec, the difference, `exact` true and `missing_dates` ["2026-12-04"].
9. Given only one row in the range, then `change` is null.
10. Given a manual row for 3 Dec is entered after the 4 Dec row exists, then the 4 Dec row's `follower_change` is recomputed.
11. Given an account with published posts and no row for today or yesterday, then `sync_status` reports `followers_overdue` true.
12. Given a `graph_api` account with `capabilities.insights` false, when it is due, then the snapshot is still taken from the account fields.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E09-S02-BE1 | Model and change service | `AccountSnapshot` model and migration with nullable `following` and `media_count`; `apps/analytics/services/followers.py` with `record(account, date, stats, source)`, the change recomputation of rules 11–12 and `follower_change(account, from_date, to_date)`; follower fields in `sync_status`; unit tests including the worked example | 0.25 |
| E09-S02-BE2 | Provider method | `AccountStats` type; `account_stats` in the `graph_api` adapter (`GET /me?fields=followers_count,follows_count,media_count`, field mapping, error translation per rule 10) with a recorded-response test; `fake` provider `values` for `account_stats` plus the `token_invalid`, `rate_limited` and `fail_n_times(n)` scenarios | 0.25 |
| E09-S02-BE3 | Dispatcher and task | `dispatch_follower_snapshots` and `snapshot_followers` in `apps/analytics/tasks.py`; local-time due check per account, attempt key, countdown, skip rules 4–5, late-date rule 9, error table; Beat entry; tests with a frozen clock across midnight in two timezones | 0.5 |

### Frontend

None.

### Test

None beyond the tests inside each subtask.

## Test notes

- Frozen-clock tests at 00:05, 00:12 and 23:55 local time in `Asia/Tehran` and `UTC`, including an account whose local midnight falls on a different UTC date.
- A test that two dispatcher runs ten minutes apart enqueue one task.
- The worked example in rule 14 is a unit test.
- The real-provider check on the test account (one day's snapshot) is part of E11-S03.

## Later

- An hourly reading is a second schedule writing to a separate table; the daily row stays the reporting source.
- Follower demographics would be a JSON column filled from the same call when the provider supports it.
- Importing a CSV of past counts would reuse `record` with `source = manual`.
