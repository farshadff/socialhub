# E08-S01 — Automatic scheduling and sequencing

| | |
| --- | --- |
| Epic | E08 Schedule and post |
| Priority | Must |
| Estimate | BE 2 d · FE 0 d · QA 0 d |
| Depends on | E01-S02, E03-S04, E04-S01, E06-S07, E07-S01 |
| Needed by | E08-S02, E08-S05, E11-S01 |

## User story

As an operator, I want an item that passes its checks to be put on the calendar by the system at the right time, so that I do not schedule every post by hand and the account never posts too often or too close together.

## Context

The workflow says "Pass — schedule automatically" and "Sequence posts across slots". Every content item was given a slot when it was selected (E03-S03). In the normal case the item is approved well before its slot and simply takes that time. Production and revisions can overrun, though, so the system needs a rule for what to do when the slot is gone. This story is that rule, plus the `Publication` record that the rest of E08 works on. In Phase 1 every publication is posted by hand (`delivery = manual`, E08-S05). It has no screen of its own; the result is visible on the calendar (E08-S02).

## Scope

**In:**

- `Publication` model and migration.
- `schedule_item(item)`: called by the pipeline in the transaction that sets an item to `approved`.
- The time search: own slot, then next open slot of the same format, then the earliest free time allowed by the sequencing rules, then a review task.
- `withdraw(item, reason)`: takes a publication off the schedule when it is cancelled.
- `full_caption`, the single caption builder used by the posting pack and the checks.

**Out (later):**

- Choosing times from past performance.
- Ordering rules between formats (for example "story teaser one hour before the reel").
- Per-account posting windows; the MVP has one setting for all accounts.
- Sending to Instagram, send-time checks and the caption fingerprint (Phase 2, E08-S03 and E08-S04).

## Behaviour and rules

### Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `SOCIALHUB_PUBLISH_MIN_LEAD_MINUTES` | 10 | A time closer than this is treated as already gone |
| `SOCIALHUB_PUBLISH_WINDOW` | `09:00-22:00` | Local hours in which the system may invent a time. Slot times set by a person are not limited by it |
| `SOCIALHUB_PUBLISH_GRID_MINUTES` | 15 | Invented times are rounded up to this grid |

### When scheduling runs

1. `content.services.pipeline` calls `publishing.services.scheduling.schedule_item(item)` inside the same database transaction that changes the item to `approved`. If scheduling raises, the approval is rolled back and the quality-check job fails with `error_code = "scheduling_failed"`; the item stays `in_check` or `in_review`.
2. `schedule_item` locks the `InstagramAccount` row with `SELECT … FOR UPDATE` first, so two items of one account are never scheduled at the same moment against stale counts.
3. `schedule_item` is idempotent. If the item already has a publication in status `scheduled` or `published`, it returns that publication unchanged.
4. A publication is one-to-one with its item. In Phase 1 a `cancelled` publication always belongs to a cancelled item, which is never approved again, so `schedule_item` always creates a new row.

### Preconditions

5. The item's `current_version` must have `status = passed`, `render_status = ready` and a `final_asset`. Otherwise `schedule_item` raises `SchedulingError("version_not_ready")`.
6. The item's `format` must be publishable according to the format registry (E04-S01). Unknown formats raise `SchedulingError("unsupported_format")`.

### Choosing the time

`now` is the transaction time. `lead` is `SOCIALHUB_PUBLISH_MIN_LEAD_MINUTES`. Counting "per day" always uses the calendar date in the account's timezone.

7. **Own slot.** If `item.slot` exists, its status is `reserved`, and `slot.scheduled_at >= now + lead`, the publication takes `slot.scheduled_at`. No sequencing check is applied here: a time a person put in the plan is trusted.
8. **Next open slot.** Otherwise the search uses the *target plan*: the item's plan if its status is `active`; if not, the account's `active` plan whose week contains `now`; if there is none, go to rule 10. Take slots of the target plan with `format = item.format`, `status = open`, `scheduled_at >= now + lead`, ordered by `scheduled_at`. The first one that passes the sequencing check (rules 11–13) is used. The item's old slot, if it had one, is released (rule 15).
9. **Earliest free time.** If no open slot fits, compute a time with `find_time` (rule 14), bounded by the end of the target plan's week (`week_end` 23:59:59 in the account timezone). The publication gets that time with `slot = null`. The item's old slot is released.
10. **No time.** If rules 7–9 produce nothing, no publication is created. The item moves `approved → in_review` with `hold_reason = "No free time left in this week's plan"`, and a `ReviewTask` is created with `reason = no_slot` and a `detail` that names the format, the week and the rule that blocked it (for example "Daily limit of 2 feed posts reached on every remaining day"). Resolving that task with `approve` calls `schedule_item(item, at=…)` again (rule 16).

### Sequencing check

Two groups are counted separately: the **feed group** (`reel` and `feed_post` together) and the **story group** (`story`).

11. **Daily limit.** For a candidate time `t` on local date `d`, count the account's publications in the same group whose effective time falls on `d` and whose status is `scheduled` or `published`. Effective time is `published_at` when published, otherwise `scheduled_at`. The candidate fails when the count is already `posting_rules.max_feed_per_day` (feed group) or `posting_rules.max_stories_per_day` (story group).
12. **Minimum gap.** Feed group only. The candidate fails when any other feed-group publication of the account, in the statuses of rule 11, has an effective time closer than `posting_rules.min_gap_minutes` to `t`, before or after.
13. Stories have no minimum gap in the MVP.

### `find_time`

14. `find_time(account, format, not_before, not_after)` returns the earliest time that passes rules 11–13:

```text
t = round_up_to_grid(max(not_before, now + lead))
repeat at most 500 times:
    if t > not_after: return None
    local = t in account timezone
    if local.time < window.start:  t = local.date at window.start;            continue
    if local.time > window.end:    t = (local.date + 1 day) at window.start;  continue
    if daily limit reached on local.date (rule 11):
                                   t = (local.date + 1 day) at window.start;  continue
    if format is in the feed group:
        p = nearest feed-group publication with |t - p.effective_time| < min_gap (rule 12)
        if p exists:               t = round_up_to_grid(p.effective_time + min_gap); continue
    return t
return None
```

All arithmetic on local dates and times is done in the account timezone and converted back to UTC, so a daylight-saving change cannot shift a time.

### Effects

15. In one transaction, on success:
    - `Publication` is created with `status = scheduled`, `scheduled_at`, `slot`, `content_version = item.current_version`, `format`, `delivery = manual` (rule 17).
    - The chosen slot, if any: `status → scheduled`; `item.slot` points to it.
    - A released slot: `status → open`.
    - The item: `approved → scheduled` through the pipeline service, with `hold_reason = ""`.
    - One `ContentEvent` of type `status_changed` with `data = {"publication_id", "scheduled_at", "slot_id", "rule": "own_slot" | "next_open_slot" | "earliest_free_time" | "explicit"}`.
16. `schedule_item(item, at=datetime)` and `schedule_item(item, slot=PlanSlot)` skip the search and use the given time or slot. They still require `time >= now + lead` and run the sequencing check; a failure raises `SchedulingError` with `code` `too_soon`, `daily_limit` or `min_gap`. These forms are used by the reschedule endpoint (E08-S02) and by the review-task resolution for `no_slot` (E07-S06).

### Delivery

17. Every publication gets `delivery = manual`, the only value in Phase 1: the operator posts it by hand from the posting pack (E08-S05). Scheduling does not look at any Instagram connection; an account needs only its handle, timezone and posting rules.

### Caption

18. `publishing.services.captions.full_caption(version, format)` is the single caption builder. The posting pack (E08-S05) and the panel show its output, and E06-S06 and E07-S02 use it for caption length and hashtag counting (hashtags typed inside the caption count together with the list). No other code assembles a caption.
    - `story`: empty string.
    - `reel`, `feed_post`: `caption.strip()`; if there are hashtags, append a blank line and the hashtags joined by single spaces, each prefixed with `#`.

    ```text
    سه اشتباه رایج در خرید خانه اول که می‌شود از آن‌ها دور ماند.

    #خانه_اول #مشاوره_املاک #سرمایه_گذاری
    ```

19. `full_caption` does not enforce limits. Caption length and hashtag count are checked by the format check (E07-S02) before a version can pass, so the caption of a scheduled version always fits the format registry.
20. The full caption is not stored on the publication. It is rebuilt from the content version whenever it is shown; the version is immutable once `passed`, so the result is the same.

### Taking an item off the schedule

21. `withdraw(item, reason)` has one caller in Phase 1: cancellation (rule 22). In the MVP an item cannot change after approval, so a `scheduled` item never receives a new version. `withdraw` requires the publication to be `scheduled`; it sets `Publication.status = cancelled` and writes a `ContentEvent`.
22. Cancelling an item (E03-S04) or a publication (E08-S02) calls `withdraw` and then releases the slot by the E03-S04 rule: `open` if its time is still in the future, otherwise `skipped`; `item.slot` is cleared.

## Data

Uses `Publication`, `PlanSlot`, `ContentItem`, `ContentVersion`, `ReviewTask`, `ContentEvent`, `InstagramAccount.timezone` and `InstagramAccount.posting_rules` as defined in [DATA-MODEL.md](../../DATA-MODEL.md).

Fields this story writes on `Publication`: `content_item`, `account`, `slot`, `content_version`, `format`, `scheduled_at`, `status` (`scheduled`, and `cancelled` through `withdraw`; `published` is written by E08-S05), `delivery` (`manual`, the only Phase 1 value). The status values `publishing`, `verifying` and `failed`, and the send-related fields (`blocked_reason`, `attempt_count`, `next_attempt_at`, `caption_fingerprint`, the container fields, `remote_media_id`, the lease fields), stay in the table for Phase 2 and are never written in Phase 1; `caption_fingerprint` keeps its empty default.

Indexes on `Publication`: (`status`, `scheduled_at`), (`account`, `status`), (`account`, `published_at`), (`next_metrics_at`) where not null.

## API

None. Scheduling has no endpoint of its own. Its results are read through `GET /publications/` and `GET /calendar/` (E08-S02).

## Background work

None. Scheduling runs synchronously inside the approval transaction; it reads a few rows and writes three.

## AI

None.

## Panel

None in this story. E08-S02 shows the scheduled publication on the calendar and on the item's Publishing tab, including which rule placed it ("Scheduled in its slot", "Moved to the next open slot", "Placed at the earliest free time").

## Acceptance criteria

1. Given an item whose slot is tomorrow at 19:00 account time, when its check run ends in Pass, then a publication exists with that time, the slot is `scheduled`, the item is `scheduled`, and one `ContentEvent` records rule `own_slot`.
2. Given an item whose slot was one hour ago and an open slot of the same format later in the active plan, when it is approved, then the publication takes the open slot, that slot becomes `scheduled`, and the old slot becomes `open`.
3. Given an item whose slot is five minutes from now, when it is approved, then the slot is treated as gone and rule 8 or 9 applies.
4. Given a reel with no usable slot, and feed-group publications today at 12:00 and 18:00 with `min_gap_minutes` 120 and `max_feed_per_day` 2, when it is approved at 10:00, then the publication is placed tomorrow at 09:00 account time.
5. Given a feed post with no usable slot and one reel scheduled today at 14:00, `min_gap_minutes` 120, `max_feed_per_day` 2, when it is approved at 13:20, then the publication is placed today at 16:00.
6. Given a story with no usable slot and five stories already on every remaining day of the week, when it is approved, then no publication exists, the item is `in_review`, and a review task with reason `no_slot` is open.
7. Given an item whose plan is closed and an active plan for the current week exists, when it is approved, then the search uses the current plan's slots and week end.
8. Given any account, when an item of any format is approved, then the publication has `delivery = manual` and `status = scheduled`, and no Instagram connection is read.
9. Given `schedule_item` is called twice for the same approved item, then exactly one publication exists.
10. Given a scheduled publication, when it is cancelled, then `withdraw` sets it to `cancelled`, writes a `ContentEvent`, and its future slot becomes `open`.
11. Given a caption with trailing spaces and three hashtags, then `full_caption` returns the caption, one blank line and `#a #b #c`; for a story it returns an empty string.
12. Given a time on a day when the account's clocks change, then `find_time` returns a time inside the posting window in local time.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S01-BE1 | Publication model | `apps/publishing/models.py`: `Publication` with all fields in DATA-MODEL.md (`delivery` default `manual`; the Phase 2 fields nullable or empty by default); indexes; migration; Django admin list with filters by status and account | 0.5 d |
| E08-S01-BE2 | `schedule_item`, own-slot path | `apps/publishing/services/scheduling.py`: account lock, idempotency, preconditions, rule 7, effects of rule 15 with `delivery = manual`; hook in `content.services.pipeline` on `approved`; unit tests | 0.5 d |
| E08-S01-BE3 | Sequencing check and `find_time` | Rules 8, 9, 11–14 as pure functions that take the account, rules and a list of existing publication times; table-driven tests including gap, daily limits, window edges, week end, timezone change | 0.5 d |
| E08-S01-BE4 | No-slot path and withdraw | Rule 10 (review task, item to `in_review`), explicit `at`/`slot` forms of rule 16 with `SchedulingError` codes, `withdraw` of rule 21, slot release of rule 22 | 0.25 d |
| E08-S01-BE5 | Captions and integration tests | `apps/publishing/services/captions.py::full_caption` with tests on Persian and Latin captions; end-to-end test from a `passed` content version to a `scheduled` publication for each format; concurrency test that approves two items of one account in parallel and asserts the gap holds | 0.25 d |

### Frontend

None.

### Test

None beyond the tests inside each subtask.

## Test notes

- `find_time` and the sequencing check are pure functions; test them with tables of (existing times, rules, now) → expected time. Include: empty calendar, gap pushes forward, gap pushes over the window end to the next day, daily limit on consecutive days, nothing before week end.
- Use a fixed clock (`freezegun` or an injected `now`) in every scheduling test.
- The concurrency test needs a real PostgreSQL transaction test (`TransactionTestCase`), not the default wrapped test case, because it relies on row locks.
- Fixtures: one account in `Asia/Tehran` with default `posting_rules`, one active plan with six slots across formats, one closed plan.

## Later

- `SOCIALHUB_PUBLISH_WINDOW` and the lead time move into `posting_rules` when accounts need different hours.
- A story minimum gap can be added to rule 13 by adding one key to `posting_rules`.
- `find_time` is the single place to plug in "best time to post" logic based on E10 evaluations.
- Phase 2: `delivery` is decided at scheduling time and re-checked at send time: `provider` when the account's connection grants publishing for the format, otherwise `manual`. A connection problem leaves `provider` and is handled by the send-time gate (E08-S03), so it never turns a week into posting by hand.
- Phase 2: the publish worker re-checks the daily limit and minimum gap at send time, also for own-slot times (E08-S03 gates 6 and 7), and the sequencing check counts `publishing` and `verifying` publications too.
- Phase 2: `caption_fingerprint(text)` (NFC, collapsed whitespace, casefold, first 100 characters, first 32 hex characters of SHA-256; empty for stories and captions under 10 characters) is computed at scheduling time for verification (E08-S04).
- Phase 2: `withdraw` gains a second caller, the `publish_failed` review decision `request_changes` (E08-S04), which keeps the slot `reserved`; when the item is approved again, the `cancelled` row is reused with the container fields cleared and `attempt_count` reset.
