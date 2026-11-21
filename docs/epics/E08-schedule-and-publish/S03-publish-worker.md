# E08-S03 — Publish worker for each format

| | |
| --- | --- |
| Epic | E08 Schedule and publish |
| Priority | Must |
| Estimate | BE 3.5 d · FE 0.5 d · QA 0 d |
| Depends on | E08-S01, E08-S02, E00-S04, E00-S06, E06-S07 |
| Needed by | E08-S04, E09-S01, E11-S01 |

## User story

As an operator, I want scheduled publications to be sent to Instagram on time without my involvement, each format in the right way, so that the calendar is what actually happens on the account.

## Context

A `Publication` in status `scheduled` has a time, an exact content version and a delivery mode. This story adds the machinery that turns it into a live post: a dispatcher that wakes every minute, gates that decide whether sending is allowed right now, and a send task that calls the Instagram provider (see [INSTAGRAM-INTEGRATION.md](../../INSTAGRAM-INTEGRATION.md)). It covers the path where the provider answers clearly: success, or a clean error. What happens when the answer is uncertain, when retries are needed, and when a person has to post by hand is E08-S04; this story leaves well-defined hand-over points for it.

## Scope

**In:**

- `PublishAttempt` model.
- `publishing.dispatch_due` (every minute): selection, gates, lease, one send per account.
- `publishing.send`: lease check, asset download, provider call per format, result handling.
- Success handling: publication, slot, item, first metric checkpoint.
- `blocked_reason` handling and the lateness rule.
- `POST /publications/{id}/publish-now/`.
- Attempt timeline and "Publish now" in the panel.

**Out (later):**

- Verification, retry backoff, expired-lease recovery, failure to review task, manual delivery (all E08-S04).
- A dedicated worker pool for the `publish` queue.
- Rate planning across accounts.

## Behaviour and rules

### Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `SOCIALHUB_PUBLISH_BATCH_SIZE` | 20 | Publications examined per dispatcher run |
| `SOCIALHUB_PUBLISH_LEASE_SECONDS_IMAGE` | 300 | Lease length for image sends |
| `SOCIALHUB_PUBLISH_LEASE_SECONDS_VIDEO` | 900 | Lease length for video sends |
| `SOCIALHUB_PUBLISH_MAX_LATENESS_MINUTES` | 120 | Older than this, a never-attempted publication is rescheduled, not sent |
| `SOCIALHUB_PUBLISH_MAX_ATTEMPTS` | 3 | Sends that count against the budget (used by E08-S04) |

### Dispatcher

1. Celery Beat runs `publishing.dispatch_due` every minute on the `publish` queue. A Redis lock `publish:dispatch` with a 55-second expiry makes overlapping runs exit immediately.
2. Selection, inside one transaction:

   ```sql
   SELECT … FROM publishing_publication
   WHERE status = 'scheduled'
     AND delivery = 'provider'
     AND scheduled_at <= now()
     AND (next_attempt_at IS NULL OR next_attempt_at <= now())
   ORDER BY scheduled_at
   LIMIT 20
   FOR UPDATE SKIP LOCKED
   ```

3. At most one publication per account is claimed per run. An account is skipped when it already has a publication in `publishing` or `verifying` with an unexpired lease. Remaining due publications of that account wait for the next minute.
4. For each selected publication the gates below run in order. The first gate that does not pass decides the result; later gates are not evaluated.

### Send-time gates

| # | Gate | Passes when | If it does not pass |
| --- | --- | --- | --- |
| 1 | Stop switch | `account.publishing_enabled` is true | `blocked_reason = publishing_paused`; stays `scheduled` |
| 2 | Connection | `AccountConnection.status = connected` | `blocked_reason = session_problem`; stays `scheduled` |
| 3 | Capability | The capability for the format is true | `delivery` is switched to `manual` (E08-S04 takes over); a `ContentEvent` notes the switch |
| 4 | Lateness | `attempt_count > 0`, or `now - scheduled_at <= 120 min` | The publication is moved with the scheduling search of E08-S01 (next open slot, else earliest free time, starting from now). If no time exists: publication `cancelled`, item `in_review`, `ReviewTask` with reason `no_slot` |
| 5 | Version | `content_version.status = passed`, it is the item's `current_version`, and the item's status is `scheduled` | Defensive only: in the MVP nothing changes an item after approval, so this should never fire. If it does, the publication goes to E08-S04's failure handling with `error_code = "version_changed"`: publication `failed`, item `scheduled → failed`, `ReviewTask` with reason `publish_failed` and detail "The approved version is no longer the item's current version". No provider call is made |
| 6 | Daily limit | Publications of the same group already `published` today (account timezone) plus those in flight are below `max_feed_per_day` or `max_stories_per_day` | `blocked_reason = daily_limit`; stays `scheduled` |
| 7 | Minimum gap | Feed group only: the account's latest feed-group `published_at` is at least `min_gap_minutes` ago | `next_attempt_at = latest published_at + min_gap`; stays `scheduled`; no `blocked_reason` |

5. A blocked publication is re-examined every minute. When its gate passes later, `blocked_reason` is cleared. Because the lateness gate comes after the stop switch and the connection gate, switching publishing back on after a long pause never fires a backlog at once: anything more than two hours late is moved to a new time instead.
6. When a `blocked_reason` is set or cleared, one `ContentEvent` of type `note` is written. Repeated checks that find the same reason write nothing.

### Claim and lease

7. A publication that passes all gates is claimed in the same transaction: `status = publishing`, `lease_owner = "<hostname>:<uuid4>"`, `lease_expires_at = now + lease`, `blocked_reason = null`. The lease is 900 seconds when the final asset is a video, otherwise 300. The item moves `scheduled → publishing` through the pipeline service. A `JobRun` of kind `publish.send` is created (`target_type = "publication"`, `account` set, `created_by = null`) and stored as the item's `active_job`.
8. After the transaction commits, `publishing.send(publication_id, lease_owner, job_id)` is enqueued on the `publish` queue. Enqueueing after commit means a task never sees an unclaimed row.

### Send task

9. The task's soft time limit is the lease minus 60 seconds; the hard limit is the lease minus 30 seconds. A task can therefore never still be sending when its lease runs out.
10. First step: reload the publication and stop silently unless `status = publishing` and `lease_owner` matches the argument. A duplicate delivery of the Celery message does nothing.
11. Acquire the per-account Instagram lock through E00-S04's helper `apps.instagram.session.account_session(account, wait_seconds=60)` (Redis key `ig:lock:{account_id}`, the same lock every Instagram call uses). If it cannot be acquired, release the claim: `status = scheduled`, `next_attempt_at = now + 1 minute`, lease cleared, item back to `scheduled`, job `cancelled`. No attempt is recorded.
12. Re-check gate 1 (stop switch) immediately before the provider call. If publishing was switched off in the meantime, release the claim as in rule 11 with `blocked_reason = publishing_paused`.
13. Create the `PublishAttempt`: `number` = existing rows + 1, `provider` = the connection's provider name, `started_at = now`, `outcome` left empty until the attempt finishes. For stories, the task first calls `list_active_stories` and stores the returned media identifiers in `verification.pre_story_pks`; E08-S04 uses them to recognise the new story.
14. Download the final asset, and the cover asset for a reel when present, from storage to a fresh temporary directory. Verify each file's SHA-256 against `Asset.checksum`; a mismatch is a fatal error with `error_code = "asset_corrupt"`. The directory is deleted when the task ends, whatever the outcome.
15. Build the caption with `full_caption` (E08-S01). If it is longer than the format's caption limit in the format registry (E04-S01), the attempt is a fatal error with `error_code = "caption_too_long"`; the format check in E07-S02 should have caught it.
16. Call the provider method for the format:

| Format | Media kind | Provider call |
| --- | --- | --- |
| `feed_post` | image | `publish_feed_image(state, image_path, caption)` |
| `reel` | video | `publish_reel(state, video_path, cover_path, caption)`; `cover_path` is `None` when the version has no cover asset |
| `story` | image | `publish_story_image(state, image_path)` |
| `story` | video | `publish_story_video(state, video_path)` |

17. After the call returns or raises, the refreshed session state is saved by the provider wrapper (E00-S04). The Instagram lock is released.

### Result handling

18. **Success** (`PublishResult` returned). In one transaction, with a conditional update that requires `lease_owner` to still match:
    - Attempt: `outcome = success`, `finished_at = now`.
    - Publication: `status = published`, `remote_media_pk`, `remote_media_code`, `permalink` from the result, `published_at` = the provider's `taken_at` when present, else now; `published_via = provider`; `attempt_count += 1`; lease, `next_attempt_at`, `blocked_reason` cleared.
    - Metrics hand-over for E09-S01: `next_metrics_checkpoint = "1h"`, `next_metrics_at = published_at + 1 hour`.
    - Slot, if any: `status = published`.
    - Item: `publishing → published` through the pipeline service; `active_job` cleared; `ContentEvent` of type `publish_attempt` with `data = {"attempt": n, "outcome": "success", "permalink": …}`.
    - Job: `succeeded`, `result = {"publication_id", "permalink"}`.
19. **Session problem** (`SessionRequired`, `ChallengeRequired`). The connection status is updated by E00-S04's wrapper. The attempt is closed with `outcome = retryable_error` and `error_code` `session_required` or `challenge_required`. `attempt_count` is **not** increased. Publication: `status = scheduled`, `blocked_reason = session_problem`, lease cleared. Item back to `scheduled`. Job `failed` with `error_code = "instagram_session_required"` or `"instagram_challenge_required"`.
20. **Rate limited** (`RateLimited`). Attempt closed with `outcome = retryable_error`, `error_code = "rate_limited"`. `attempt_count` is not increased. Publication: `status = scheduled`, `next_attempt_at = now + max(suggested wait, 15 minutes)`. Item back to `scheduled`.
21. **Fatal** (`MediaRejected`, `NotSupported`, `asset_corrupt`, `caption_too_long`). Attempt closed with `outcome = fatal_error`, `attempt_count += 1`. The publication is handed to E08-S04's failure handling (publication `failed`, item `failed`, review task). No retry.
22. **Transient** (`TransientError`) and **ambiguous** (`AmbiguousResult`, a soft time limit, or any unexpected exception after the provider call started). Attempt closed with `outcome = retryable_error` or `ambiguous`, `attempt_count += 1`. The publication is handed to E08-S04's verification and retry flow. This story's deliverable is the hand-over call `publishing.services.recovery.after_attempt(publication, attempt)`; until E08-S04 lands, that function marks the publication `failed`.
23. If the conditional update of rule 18 finds that the lease no longer matches (the lease expired and recovery took over), the task writes nothing to the publication and only closes its attempt row with what it observed. Recovery in E08-S04 will find the post by verification.

`attempt_count` counts sends that used the budget. `PublishAttempt.number` counts rows, including the uncounted interruptions of rules 19 and 20.

### Publish now

24. `POST /publications/{id}/publish-now/` is allowed when `publish_now` is in `allowed_actions` (status `scheduled`, not leased, `delivery = provider`).
25. It checks gates 1, 2 and 6 synchronously and returns an error instead of leaving the publication silently blocked:

| Gate | Response |
| --- | --- |
| Stop switch off | `409 publishing_disabled` |
| Connection not `connected` | `409 instagram_session_required` (or `instagram_challenge_required` when the status is `challenge_required`) |
| Daily limit reached | `409 invalid_transition` with `details.reason = "daily_limit"` |

26. When those pass: `scheduled_at = now`, `next_attempt_at = null`. If the minimum gap is not yet satisfied, `next_attempt_at` is set to the earliest allowed time and returned as `earliest_send_at`; "as soon as rules allow" never bypasses the gap. The slot link is kept; the slot's own time is not changed.
27. The endpoint then triggers `publishing.dispatch_due` once (in addition to the every-minute schedule), so the send normally starts within seconds.
28. `Idempotency-Key` is honoured: the same key within 24 hours returns the first response and does nothing else.
29. Operators and admins may call it.

## Data

`Publication`, `PublishAttempt` ([DATA-MODEL.md](../../DATA-MODEL.md) section 9). `PublishAttempt.finished_at` and `outcome` are nullable while an attempt is running. `JobRun` kind `publish.send`.

`PublishAttempt.verification` for story attempts starts as:

```json
{"pre_story_pks": ["3498700000000000001", "3498700000000000002"]}
```

No new fields.

## API

### `POST /publications/{id}/publish-now/`

Permission: signed in. Header `Idempotency-Key` optional. Body: empty object.

Response `200`:

```json
{
  "publication": {
    "id": 31,
    "status": "scheduled",
    "scheduled_at": "2026-11-22T11:02:17Z",
    "next_attempt_at": null,
    "blocked_reason": null,
    "in_flight": false,
    "attempt_count": 0,
    "allowed_actions": ["reschedule", "cancel", "publish_now", "mark_published"],
    "…": "remaining fields as in GET /publications/{id}/"
  },
  "earliest_send_at": "2026-11-22T11:02:17Z",
  "waiting_for": null
}
```

When the minimum gap delays the send:

```json
{
  "publication": {"id": 31, "status": "scheduled", "scheduled_at": "2026-11-22T11:02:17Z", "next_attempt_at": "2026-11-22T12:30:41Z", "…": "…"},
  "earliest_send_at": "2026-11-22T12:30:41Z",
  "waiting_for": "min_gap"
}
```

Errors:

```json
{
  "error": {
    "code": "publishing_disabled",
    "message": "…",
    "fields": [],
    "request_id": "5c0f6d1e-8a51-4c6e-9d8f-0b7a4f1f2a10",
    "retryable": false,
    "details": {"account": 1}
  }
}
```

| Case | Response |
| --- | --- |
| Status is not `scheduled`, or `delivery = manual` | `409 invalid_transition`, `details: {"status", "delivery", "allowed_actions"}` |
| Being sent right now | `409 job_in_progress`, `details.job` |
| Stop switch off | `409 publishing_disabled` |
| Connection problem | `409 instagram_session_required` or `409 instagram_challenge_required` |
| Daily limit reached | `409 invalid_transition`, `details.reason = "daily_limit"` |
| Not found | `404 not_found` |

`GET /publications/{id}/` (E08-S02) returns the attempts written by this story, for example:

```json
"attempts": [
  {
    "id": 64,
    "number": 1,
    "provider": "instagrapi",
    "started_at": "2026-11-23T15:30:04Z",
    "finished_at": "2026-11-23T15:31:12Z",
    "outcome": "success",
    "error_code": null,
    "error_message": null,
    "verification": null
  }
]
```

## Background work

| Task | Queue | Trigger | Idempotency | Retries |
| --- | --- | --- | --- | --- |
| `publishing.dispatch_due` | `publish` | Celery Beat, every minute; also once after publish-now | Redis lock `publish:dispatch`; row locks with `SKIP LOCKED`; claim is a status change in the same transaction | None; the next minute is the retry |
| `publishing.send` | `publish` | Enqueued by the dispatcher after commit | Lease owner check before any work and on every write | No Celery auto-retry. Retrying is a product rule handled by E08-S04 |

Celery settings for `publishing.send`: `acks_late = True`, `reject_on_worker_lost = True`, so a killed worker returns the message; the lease-owner check makes the second delivery harmless, and E08-S04's expired-lease recovery handles the half-finished attempt.

Worker concurrency for the `publish` queue is 2 in the MVP. In production a dedicated `publish-worker` service consumes only `publish` (E11-S02), so long AI jobs on `default` cannot delay the dispatcher; locally the single `worker` consumes `default,publish`. The per-account lock keeps each account serial.

## AI

None.

## Panel

Additions to the Publishing tab of `/content/:id` and the calendar entry drawer (E08-S02).

**Attempts timeline** (`ProCard` "Attempts", below the schedule card; hidden when there are no attempts): an Ant Design `Timeline`, newest first. Each entry shows:

| Element | Content |
| --- | --- |
| Dot colour | Green for `success` and `verified_live`, orange for `retryable_error` and `ambiguous`, red for `fatal_error`, blue while running |
| Title | "Attempt 1 — Published", "Attempt 2 — Rejected by Instagram", "Attempt 1 — Interrupted: session problem" (label map by `outcome` and `error_code`) |
| Time | `DateTime` of `started_at`, and the duration |
| Detail | `error_message` when present, in secondary text |

**Publish now** button (shown when `publish_now` is allowed): `Modal.confirm` titled "Publish now?" with body "“{title}” will be sent to @handle as soon as the posting rules allow." Confirm button "Publish now". After success: when `waiting_for` is null, `message.success("Sending to Instagram")`; when it is `min_gap`, `message.info("Queued. It will be sent at {earliest_send_at} to keep the gap between posts.")`. Error texts by code:

| Code | Text |
| --- | --- |
| `publishing_disabled` | "Publishing is off for this account. An admin can turn it on in the top bar." |
| `instagram_session_required` | "The Instagram connection needs attention. Reconnect the account in Settings." |
| `instagram_challenge_required` | "Instagram is asking for a verification code. Enter it in Settings → Connection." |
| `invalid_transition` with reason `daily_limit` | "Today's limit for this kind of post is already reached." |

**In flight:** while `in_flight` is true the tab shows `JobProgress` for the item's `active_job` with the message from the job ("Uploading video", "Waiting for Instagram"), polls the job every two seconds, and reloads the publication when the job ends.

**Published:** the schedule card shows "Published at {time}" and a button "View on Instagram" that opens the permalink in a new tab.

**Blocked:** an `Alert` at the top of the tab, by `blocked_reason`: "Waiting: publishing is off for this account.", "Waiting: the Instagram connection needs attention.", "Waiting: today's posting limit is reached."

## Acceptance criteria

1. Given a `scheduled` publication whose time has come and all gates pass, when the dispatcher runs, then within two minutes the publication is `published` with `remote_media_pk`, `permalink` and `published_at`, the slot and item are `published`, one attempt with outcome `success` exists, and `next_metrics_checkpoint` is `1h`.
2. Given each of the four format and media combinations, when it is sent with the fake provider, then the provider method in the table of rule 16 is called with the downloaded file paths and, for feed posts and reels, the full caption.
3. Given two due publications of one account, when the dispatcher runs once, then only the earlier one is claimed.
4. Given `publishing_enabled` is false, when the dispatcher runs, then nothing is sent, `blocked_reason` is `publishing_paused`, and exactly one note event is written however many minutes pass.
5. Given publishing was off for three hours and is switched on, when the dispatcher runs, then publications more than 120 minutes late are moved to a new time and not sent in that run.
6. Given the connection status is `needs_attention`, then `blocked_reason` is `session_problem` and no attempt row is created.
7. Given a scheduled item whose content version was replaced after approval, when its time comes, then the publication is `cancelled`, nothing is sent, and the slot is `reserved`.
8. Given the daily feed limit is reached, then `blocked_reason` is `daily_limit`; given the latest reel went out 30 minutes ago with a 120-minute gap, then `next_attempt_at` is 90 minutes later and no `blocked_reason` is set.
9. Given the provider raises `SessionRequired` during a send, then `attempt_count` is unchanged, the publication is `scheduled` with `blocked_reason = session_problem`, and the attempt row has `error_code = "session_required"`.
10. Given the provider raises `MediaRejected`, then the attempt has outcome `fatal_error` and the publication is handed to failure handling without another send.
11. Given the same `publishing.send` message is delivered twice, then the provider is called once.
12. Given a downloaded file whose checksum differs from the asset record, then nothing is sent and the attempt is a fatal error with `asset_corrupt`.
13. Given a scheduled publication for tomorrow, when "Publish now" is confirmed, then it is sent within two minutes; with publishing off the same call returns `409 publishing_disabled` and nothing changes.
14. Given two publish-now requests with the same `Idempotency-Key`, then the second returns the first response and the publication is sent once.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S03-BE1 | Attempt model and dispatcher | `PublishAttempt` model and migration; `apps/publishing/tasks.py::dispatch_due` with the Redis run lock, the `SKIP LOCKED` selection, one-per-account rule, claim and lease, `JobRun` creation, enqueue on commit; Beat entry; `publish` queue routing in `config/celery.py` and `compose.yaml` | 1 d |
| E08-S03-BE2 | Send task | `apps/publishing/services/sending.py` and `tasks.py::send`: lease-owner check, account lock, stop-switch re-check, attempt row, story pre-list, asset download with checksum, caption limit, provider call per format, time limits, temp-dir cleanup | 1 d |
| E08-S03-BE3 | Gates and blocked reasons | `apps/publishing/services/gates.py`: the seven gates as small functions returning pass or an action; capability switch to manual; lateness move using E08-S01; defensive version gate handing over to failure handling; event de-duplication of rule 6; unit tests per gate | 0.5 d |
| E08-S03-BE4 | Result handling | Success transaction of rule 18 with the conditional lease update, metric hand-over, slot and item transitions, events, job result; session, rate-limit and fatal branches; `recovery.after_attempt` hand-over stub | 0.5 d |
| E08-S03-BE5 | Publish-now endpoint | View, synchronous gate checks and error mapping, minimum-gap answer, dispatcher trigger, idempotency key handling through the shared helper, `openapi.yaml` | 0.25 d |
| E08-S03-BE6 | Fake-provider tests | Task-level tests for every acceptance criterion using the fake provider's scenarios (`ok`, `session_required`, `challenge_required`, `rate_limited`, `media_rejected`); duplicate-delivery test; lease-lost test | 0.25 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S03-FE1 | Attempts, publish now, live state | `AttemptsTimeline` component with the label map; "Publish now" confirmation and error texts in the shared publication actions component; `JobProgress` and polling while in flight; blocked alerts; "View on Instagram" | 0.5 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- Tests call the dispatcher and send task functions directly with Celery in eager mode and a fixed clock.
- The lease-lost test: claim a publication, change `lease_owner` in the database before the task writes its result, and assert the publication row is untouched while the attempt row is closed.
- The duplicate-delivery test: run `send` twice with the same arguments; assert one provider call (the fake provider counts calls).
- Gate tests are unit tests on `gates.py` with plain objects; no database needed for most.
- Panel test: timeline labels for each `outcome` and `error_code`; publish-now error texts.
- A manual check against the real provider on the throwaway account, once per format, is part of E11-S03.

## Later

- A separate worker container for the `publish` queue: only `compose.yaml` changes.
- Pre-upload a few minutes before the slot so the post lands exactly on time; the lease model already separates claim from send.
- The `graph_api` provider needs a public URL instead of a local path; `sending.py` asks storage for a signed URL when the provider declares `needs_public_url`.
