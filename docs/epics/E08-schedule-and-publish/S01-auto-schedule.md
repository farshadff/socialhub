# E08-S01 — Automatic scheduling and sequencing

| | |
| --- | --- |
| Epic | E08 Schedule and publish |
| Priority | Must |
| Estimate | BE 2.5 d · FE 0 d · QA 0 d |
| Depends on | E01-S02, E03-S04, E04-S01, E06-S07, E07-S01 |
| Needed by | E08-S02, E08-S03, E08-S04, E11-S01 |

## User story

As an operator, I want an item that passes its checks to be put on the calendar by the system at the right time, so that I do not schedule every post by hand and the account never posts too often or too close together.

## Context

The workflow says "Pass — schedule automatically" and "Sequence posts across slots". Every content item was given a slot when it was selected (E03-S03). In the normal case the item is approved well before its slot and simply takes that time. Production and revisions can overrun, though, so the system needs a rule for what to do when the slot is gone. This story is that rule, plus the `Publication` record that the rest of E08 works on. It has no screen of its own; the result is visible on the calendar (E08-S02).

## Scope

**In:**

- `Publication` model and migration.
- `schedule_item(item)`: called by the pipeline in the transaction that sets an item to `approved`.
- The time search: own slot, then next open slot of the same format, then the earliest free time allowed by the sequencing rules, then a review task.
- `withdraw(item)`: takes a failed item's publication off the schedule when a reviewer sends it back for changes, and is used by cancellation.
- Caption assembly and the caption fingerprint, computed when the publication is created.

**Out (later):**

- Choosing times from past performance.
- Ordering rules between formats (for example "story teaser one hour before the reel").
- Per-account posting windows; the MVP has one setting for all accounts.

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
3. `schedule_item` is idempotent. If the item already has a publication in status `scheduled`, `publishing`, `verifying` or `published`, it returns that publication unchanged.
4. A publication is one-to-one with its item. If the item has a `cancelled` publication from an earlier `withdraw`, that row is reused: its `content_version`, `scheduled_at`, `slot`, `delivery`, `caption_fingerprint` are replaced, `attempt_count` is reset to 0, `blocked_reason` and `next_attempt_at` are cleared, `remote_container_id`, `container_status` and `container_created_at` are cleared (a container holds the media of one version, so the new version needs its own), and `status` becomes `scheduled`. `PublishAttempt` rows from before are kept as history.

### Preconditions

5. The item's `current_version` must have `status = passed`, `render_status = ready` and a `final_asset`. Otherwise `schedule_item` raises `SchedulingError("version_not_ready")`.
6. The item's `format` must be publishable according to the format registry (E04-S01). Unknown formats raise `SchedulingError("unsupported_format")`.

### Choosing the time

`now` is the transaction time. `lead` is `SOCIALHUB_PUBLISH_MIN_LEAD_MINUTES`. Counting "per day" always uses the calendar date in the account's timezone.

7. **Own slot.** If `item.slot` exists, its status is `reserved`, and `slot.scheduled_at >= now + lead`, the publication takes `slot.scheduled_at`. No sequencing check is applied here: a time a person put in the plan is trusted. The minimum gap and daily limit are still enforced when the post is sent (E08-S03).
8. **Next open slot.** Otherwise the search uses the *target plan*: the item's plan if its status is `active`; if not, the account's `active` plan whose week contains `now`; if there is none, go to rule 10. Take slots of the target plan with `format = item.format`, `status = open`, `scheduled_at >= now + lead`, ordered by `scheduled_at`. The first one that passes the sequencing check (rules 11–13) is used. The item's old slot, if it had one, is released (rule 15).
9. **Earliest free time.** If no open slot fits, compute a time with `find_time` (rule 14), bounded by the end of the target plan's week (`week_end` 23:59:59 in the account timezone). The publication gets that time with `slot = null`. The item's old slot is released.
10. **No time.** If rules 7–9 produce nothing, no publication is created. The item moves `approved → in_review` with `hold_reason = "No free time left in this week's plan"`, and a `ReviewTask` is created with `reason = no_slot` and a `detail` that names the format, the week and the rule that blocked it (for example "Daily limit of 2 feed posts reached on every remaining day"). Resolving that task with `approve` calls `schedule_item(item, at=…)` again (rule 16).

### Sequencing check

Two groups are counted separately: the **feed group** (`reel` and `feed_post` together) and the **story group** (`story`).

11. **Daily limit.** For a candidate time `t` on local date `d`, count the account's publications in the same group whose effective time falls on `d` and whose status is `scheduled`, `publishing`, `verifying` or `published`. Effective time is `published_at` when published, otherwise `scheduled_at`. The candidate fails when the count is already `posting_rules.max_feed_per_day` (feed group) or `posting_rules.max_stories_per_day` (story group).
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
    - `Publication` is created or reused with `status = scheduled`, `scheduled_at`, `slot`, `content_version = item.current_version`, `format`, `delivery` (rule 17), `caption_fingerprint` (rule 19), `attempt_count = 0`.
    - The chosen slot, if any: `status → scheduled`; `item.slot` points to it.
    - A released slot: `status → open`.
    - The item: `approved → scheduled` through the pipeline service, with `hold_reason = ""`.
    - One `ContentEvent` of type `status_changed` with `data = {"publication_id", "scheduled_at", "slot_id", "rule": "own_slot" | "next_open_slot" | "earliest_free_time" | "explicit"}`.
16. `schedule_item(item, at=datetime)` and `schedule_item(item, slot=PlanSlot)` skip the search and use the given time or slot. They still require `time >= now + lead` and run the sequencing check; a failure raises `SchedulingError` with `code` `too_soon`, `daily_limit` or `min_gap`. These forms are used by the reschedule endpoint (E08-S02) and by the review-task resolution for `no_slot` (E07-S06).

### Delivery

17. `Publication.delivery` (new field, see Data) is decided at scheduling time and checked again at send time: `manual` when the account's `AccountConnection.provider` is `manual`, or when the capability for the format (`publish_feed`, `publish_reel`, `publish_story`) is false; otherwise `provider`. Capabilities come from the connection's `verify` (E00-S04): the publish capabilities are true when `instagram_business_content_publish` is granted and the account is professional, and `SOCIALHUB_IG_CAPABILITY_OVERRIDES` can turn one off. An account with no connection row, status `disconnected` or `needs_attention` still gets `provider`; the send-time gate blocks it with `blocked_reason = connection_problem` until an admin reconnects it, so a temporary connection problem never turns a week into posting by hand.

### Caption and fingerprint

18. `publishing.services.captions.full_caption(version, format)` is the single caption builder. Publishing uses it at send time, the panel shows its output, and E06-S06 and E07-S02 use it for caption length and hashtag counting (hashtags typed inside the caption count together with the list). No other code assembles a caption.
    - `story`: empty string.
    - `reel`, `feed_post`: `caption.strip()`; if there are hashtags, append a blank line and the hashtags joined by single spaces, each prefixed with `#`.

    ```text
    سه اشتباه رایج در خرید خانه اول که می‌شود از آن‌ها دور ماند.

    #خانه_اول #مشاوره_املاک #سرمایه_گذاری
    ```

19. `caption_fingerprint(text)`: normalize to Unicode NFC, replace every run of whitespace with one space, strip, apply `casefold()`, take the first 100 characters, and store the first 32 hex characters of the SHA-256. Verification (E08-S04) uses it to recognise the post in the account's recent media list (`list_recent_media`) when the container reports `PUBLISHED` or cannot be read. When the normalized text is shorter than 10 characters, and for every story, the fingerprint is the empty string, which tells verification to match on product type and time window instead.
20. The full caption is not stored on the publication. It is rebuilt from the content version at send time; the version is immutable once `passed`, so the result is the same.

### Taking an item off the schedule

21. `withdraw(item, reason)` has exactly two callers: the review-decision hook for `publish_failed` tasks (E08-S04 rule 17, `request_changes`) and cancellation (rule 22). In the MVP an item cannot change after approval, so a `scheduled` item never receives a new version. `withdraw` requires the publication to be `scheduled` or `failed` and not leased; it sets `Publication.status = cancelled`, clears `next_attempt_at` and `blocked_reason`, and writes a `ContentEvent`. For `request_changes` the slot goes back to `reserved` (the item keeps its slot); when the item is approved again, rule 4 reuses the row.
22. Cancelling an item (E03-S04) or a publication (E08-S02) calls `withdraw` and then releases the slot by the E03-S04 rule: `open` if its time is still in the future, otherwise `skipped`; `item.slot` is cleared.

## Data

Uses `Publication`, `PlanSlot`, `ContentItem`, `ContentVersion`, `ReviewTask`, `ContentEvent`, `InstagramAccount.posting_rules`, `AccountConnection` as defined in [DATA-MODEL.md](../../DATA-MODEL.md).

New field, to be added to DATA-MODEL.md section 9:

| Table | Field | Type | Notes |
| --- | --- | --- | --- |
| `Publication` | `delivery` | enum | `provider` (sent by the worker) or `manual` (posted by hand, see E08-S04). Default `provider` |

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
8. Given an account using the `manual` provider, when an item is approved, then the publication has `delivery = manual`; given a `graph_api` account whose `publish_story` capability is false, then a story gets `delivery = manual` and a reel gets `provider`; given a `graph_api` account in `needs_attention`, then the publication gets `provider`.
9. Given `schedule_item` is called twice for the same approved item, then exactly one publication exists.
10. Given a failed publication whose review task is resolved with `request_changes`, when `withdraw` runs and a new version of the item is later approved, then the same publication row is `scheduled` again with the new version, `attempt_count` 0 and no `remote_container_id`.
11. Given a caption with trailing spaces and three hashtags, then `full_caption` returns the caption, one blank line and `#a #b #c`, and two captions that differ only in whitespace or letter case have the same fingerprint.
12. Given a time on a day when the account's clocks change, then `find_time` returns a time inside the posting window in local time.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S01-BE1 | Publication model | `apps/publishing/models.py`: `Publication` with all fields in DATA-MODEL.md plus `delivery`; indexes; migration; Django admin list with filters by status and account | 0.5 d |
| E08-S01-BE2 | `schedule_item`, own-slot path | `apps/publishing/services/scheduling.py`: account lock, idempotency, preconditions, rule 7, effects of rule 15, row reuse of rule 4; hook in `content.services.pipeline` on `approved`; unit tests | 0.5 d |
| E08-S01-BE3 | Sequencing check and `find_time` | Rules 8, 9, 11–14 as pure functions that take the account, rules and a list of existing publication times; table-driven tests including gap, daily limits, window edges, week end, timezone change | 0.75 d |
| E08-S01-BE4 | No-slot path and withdraw | Rule 10 (review task, item to `in_review`), explicit `at`/`slot` forms of rule 16 with `SchedulingError` codes, `withdraw` of rule 21, slot release of rule 22 | 0.25 d |
| E08-S01-BE5 | Captions and delivery | `apps/publishing/services/captions.py`: `full_caption`, `caption_fingerprint`; delivery decision of rule 17; tests with Persian and Latin captions | 0.25 d |
| E08-S01-BE6 | Integration tests | End-to-end test from a `passed` content version to a `scheduled` publication for each format; concurrency test that approves two items of one account in parallel and asserts the gap holds | 0.25 d |

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
