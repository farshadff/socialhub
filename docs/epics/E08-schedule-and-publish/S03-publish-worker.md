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

A `Publication` in status `scheduled` has a time, an exact content version and a delivery mode. This story adds the machinery that turns it into a live post: a dispatcher that wakes every minute, gates that decide whether sending is allowed right now, and a send task that runs Meta's container flow through the account's Instagram provider (see [INSTAGRAM-INTEGRATION.md](../../INSTAGRAM-INTEGRATION.md) section 5). The send task checks the live publishing quota, gives Instagram signed URLs of the media, creates a container, waits until Instagram has processed it, publishes it and reads the post back. The worker never uploads a file: Meta fetches the media from our storage.

This story covers the path where Instagram answers clearly: success, or a clean error. What happens when the answer is uncertain, when retries are needed, and when a person has to post by hand is E08-S04; this story leaves well-defined hand-over points for it.

## Scope

**In:**

- `PublishAttempt` model.
- `publishing.dispatch_due` (every minute): selection, gates, lease, one send per account.
- `publishing.send`: lease check, account lock, live quota check, media check and signed URLs, one container per format, waiting for the container, publish, read-back, result handling.
- Waiting for a slow container without holding a worker (`sending.continue_attempt`, run by E08-S04's verify task).
- Success handling: publication, slot, item, first metric checkpoint.
- `blocked_reason` handling and the lateness rule.
- `POST /publications/{id}/publish-now/`.
- Attempt timeline and "Publish now" in the panel.

**Out (later):**

- Verification, retry backoff, expired-lease recovery, failure to review task, manual delivery (all E08-S04).
- A dedicated worker pool for the `publish` queue.
- Rate planning across accounts.
- Creating containers ahead of the slot. Containers expire 24 hours after creation, so the MVP creates them at send time.
- Carousels and feed videos.

## Behaviour and rules

### Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `SOCIALHUB_PUBLISH_BATCH_SIZE` | 20 | Publications examined per dispatcher run |
| `SOCIALHUB_PUBLISH_LEASE_SECONDS_IMAGE` | 360 | Lease length for image sends |
| `SOCIALHUB_PUBLISH_LEASE_SECONDS_VIDEO` | 480 | Lease length for video sends. Shorter than an upload would need, because Meta fetches the file itself and long container waits are parked (rule 20) |
| `SOCIALHUB_PUBLISH_MAX_LATENESS_MINUTES` | 120 | Older than this, a never-attempted publication is rescheduled, not sent |
| `SOCIALHUB_PUBLISH_MAX_ATTEMPTS` | 3 | Sends that count against the budget (used by E08-S04) |
| `SOCIALHUB_PUBLISH_CONTAINER_POLL_IMAGE` | `3,30` | Inline polling of an image container: every 3 seconds, for at most 30 seconds |
| `SOCIALHUB_PUBLISH_CONTAINER_POLL_VIDEO` | `10,60` | Inline polling of a video container: every 10 seconds, for at most 60 seconds |
| `SOCIALHUB_PUBLISH_CONTAINER_RECHECK_SECONDS` | 60 | Interval of later container checks once the inline budget is used. Meta recommends checking about once a minute |
| `SOCIALHUB_PUBLISH_CONTAINER_MAX_WAIT_MINUTES` | 15 | A container still `IN_PROGRESS` this long after `container_created_at` is given up (rule 20) |
| `SOCIALHUB_PUBLISH_QUOTA_RECHECK_MINUTES` | 60 | Wait after Instagram's publishing quota is found exhausted |

Instagram settings used here (`SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS` and the provider timeouts) are defined in INSTAGRAM-INTEGRATION.md sections 8 and 9.

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

3. At most one publication per account is claimed per run. An account is skipped when it already has a publication in `publishing` or `verifying` with an unexpired lease, or a publication parked while Instagram processes its container (rule 20). Remaining due publications of that account wait for the next minute.
4. For each selected publication the gates below run in order. The first gate that does not pass decides the result; later gates are not evaluated.

### Send-time gates

The gates read the database only. The live publishing quota needs a provider call, so the send task reads it (rule 14).

| # | Gate | Passes when | If it does not pass |
| --- | --- | --- | --- |
| 1 | Stop switch | `account.publishing_enabled` is true | `blocked_reason = publishing_paused`; stays `scheduled` |
| 2 | Connection | `AccountConnection.status` is `connected`, or `expiring` with `token_expires_at` still in the future | `blocked_reason = connection_problem`; stays `scheduled` |
| 3 | Capability | The capability for the format (`publish_feed`, `publish_reel`, `publish_story`) is true | `delivery` is switched to `manual` (E08-S04 takes over); a `ContentEvent` notes the switch |
| 4 | Lateness | `attempt_count > 0`, or `now - scheduled_at <= 120 min` | The publication is moved with the scheduling search of E08-S01 (next open slot, else earliest free time, starting from now). If no time exists: publication `cancelled`, item `in_review`, `ReviewTask` with reason `no_slot` |
| 5 | Version | `content_version.status = passed`, it is the item's `current_version`, and the item's status is `scheduled` | Defensive only: in the MVP nothing changes an item after approval, so this should never fire. If it does, the publication goes to E08-S04's failure handling with `error_code = "version_changed"`: publication `failed`, item `scheduled → failed`, `ReviewTask` with reason `publish_failed` and detail "The approved version is no longer the item's current version". No provider call is made |
| 6 | Daily limit | Publications of the same group already `published` today (account timezone) plus those in flight are below `max_feed_per_day` or `max_stories_per_day` | `blocked_reason = daily_limit`; stays `scheduled` |
| 7 | Minimum gap | Feed group only: the account's latest feed-group `published_at` is at least `min_gap_minutes` ago | `next_attempt_at = latest published_at + min_gap`; stays `scheduled`; no `blocked_reason` |

5. A blocked publication is re-examined every minute. When its gate passes later, `blocked_reason` is cleared. Because the lateness gate comes after the stop switch and the connection gate, switching publishing back on (or reconnecting the account) after a long pause never fires a backlog at once: anything more than two hours late is moved to a new time instead.
6. When a `blocked_reason` is set or cleared, one `ContentEvent` of type `note` is written. Repeated checks that find the same reason write nothing.

### Claim and lease

7. A publication that passes all gates is claimed in the same transaction: `status = publishing`, `lease_owner = "<hostname>:<uuid4>"`, `lease_expires_at = now + lease`, `blocked_reason = null`. The lease is 480 seconds when the final asset is a video, otherwise 360. The item moves `scheduled → publishing` through the pipeline service. A `JobRun` of kind `publish.send` is created (`target_type = "publication"`, `account` set, `created_by = null`) and stored as the item's `active_job`.
8. After the transaction commits, `publishing.send(publication_id, lease_owner, job_id)` is enqueued on the `publish` queue. Enqueueing after commit means a task never sees an unclaimed row.

### Send task

9. The task's soft time limit is the lease minus 60 seconds; the hard limit is the lease minus 30 seconds. A task can therefore never still be sending when its lease runs out. No step sleeps longer than one poll interval (10 seconds).
10. First step: reload the publication and stop silently unless `status = publishing` and `lease_owner` matches the argument. A duplicate delivery of the Celery message does nothing.
11. Open `apps.instagram.session.account_session(account, wait_seconds=60)` (E00-S04). It takes the per-account Redis lock `ig:lock:{account_id}` (the same lock every Instagram call uses), decrypts the token and yields `(provider, token)`; every provider call below uses that pair and happens inside this block. If it raises `AccountBusy`, release the claim: `status = scheduled`, `next_attempt_at = now + 1 minute`, lease cleared, item back to `scheduled`, job `cancelled`. No attempt is recorded.
12. Re-check gate 1 (stop switch) immediately before the first provider call. If publishing was switched off in the meantime, release the claim as in rule 11 with `blocked_reason = publishing_paused`.
13. **Pre-send check.** When the publication has a `PublishAttempt` from the last 48 hours, E08-S04's verification runs here, before anything is sent (E08-S04 rule 14). It reads the existing container, if any, and decides whether the task continues, and whether the container is reused (rule 17) or, after rules 14 and 15, the task goes straight to waiting for it (rule 19).
14. **Live quota.** Call `publishing_quota(token)`. When `usage >= total`, nothing is sent: release the claim as in rule 11 with `blocked_reason = daily_limit` and `next_attempt_at = now + SOCIALHUB_PUBLISH_QUOTA_RECHECK_MINUTES` (60), and write one `note` event: "Instagram's publishing limit for @{handle} is reached ({usage} of {total} in 24 hours)." Errors from this call also release the claim without an attempt row: `TokenInvalid` or `PermissionMissing` → `report_connection_error(account, error)` and `blocked_reason = connection_problem`; `RateLimited` → `next_attempt_at = now + max(retry_after_seconds, 15 minutes)`. A `TransientError` is logged and the task continues, because `create_container` and `publish_container` refuse with `QuotaExceeded` anyway when the limit is reached.
15. **Attempt row.** Create the `PublishAttempt`: `number` = existing rows + 1, `provider` = the connection's provider name, `started_at = now`, `outcome` left empty until the attempt finishes. For stories, the task then calls `list_active_stories(token)` and stores the returned media IDs in `verification.pre_story_ids`; E08-S04 uses them to recognise the new story. The job message becomes "Preparing the media on Instagram".
16. **Media and caption.** Before a container is created:
    - The final asset, and the cover asset of a reel when the version has one, must exist in storage with the size recorded in `Asset.bytes` (a metadata request to the storage backend; nothing is downloaded). A missing or different object is a fatal error with `error_code = "asset_missing"`. Without this check Meta would fail the container with a vague error a few seconds later.
    - The final asset's MIME type must be one Instagram accepts: `image/jpeg` for images, `video/mp4` or `video/quicktime` for videos. Anything else is a fatal error with `error_code = "unsupported_media"`. The renderer exports JPEG and MP4, so this check is defensive.
    - For feed posts and reels, build the caption with `full_caption` (E08-S01). If it is longer than the format's caption limit in the format registry (E04-S01), the attempt is a fatal error with `error_code = "caption_too_long"`; the format check in E07-S02 should have caught it. Stories have no caption.
    - Get the URLs from `apps.instagram.media.public_url(asset)`: `media_url` for the final asset and, for a reel with a cover, `cover_url` for the cover asset. Each is a signed HTTPS URL valid for `SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS` (7,200). The worker never downloads or uploads the files.
17. **Container.** If the pre-send check (rule 13) found the publication's existing container `FINISHED` or `IN_PROGRESS`, that container is reused and no new one is created. Otherwise call `create_container(token, spec)` with the `ContainerSpec` for the format:

    | Format | Media kind | `kind` | `media_url` | `caption` | `cover_url` | `share_to_feed` |
    | --- | --- | --- | --- | --- | --- | --- |
    | `feed_post` | image | `feed_image` | Final image | Full caption | null | false |
    | `reel` | video | `reel` | Final video | Full caption | Cover image, or null when the version has no cover asset (Instagram then uses its default frame) | true |
    | `story` | image | `story_image` | Final image | null | null | false |
    | `story` | video | `story_video` | Final video | null | null | false |

    `ai_generated` is true when the version needs an AI disclosure under E06-S06 rule 4a (the brand profile's `ai_disclosure` setting and the version's input assets from `version_input_assets`), otherwise false. The `graph_api` adapter sends the flag only if E00-S04's spike confirmed the parameter for the pinned API version; otherwise it ignores the field, and the caption line from E06-S06 is the only disclosure.
18. **Store the container first.** As soon as `create_container` returns, in its own transaction, with a conditional update that requires `lease_owner` to still match: `remote_container_id` = the returned ID, `container_created_at = now`, `container_status = IN_PROGRESS`. Only after this commit does the task wait or publish. The container ID is the idempotency key: E08-S04 reads it to decide what any later attempt may do. If the conditional update finds the lease lost, the task stops without publishing; the unused container expires on its own after 24 hours.
19. **Wait.** Poll `container_status(token, remote_container_id)` and store each answer in `Publication.container_status`. Images are polled every 3 seconds for at most 30 seconds, videos every 10 seconds for at most 60 seconds. The job message is "Waiting for Instagram to process the video" (or "the image").
    - `FINISHED` → publish (rule 21).
    - `ERROR` → `MediaRejected`: a fatal error with `error_code = "media_rejected"` and `error_message` = the container's `message`.
    - `EXPIRED` → cannot happen to a fresh container, and the pre-send check never hands over an expired one; it is handled as a transient error (rule 25).
    - `PUBLISHED` → cannot happen before this task publishes; it is handled as ambiguous (rule 25), so E08-S04 looks for the post instead of publishing again.
    - Still `IN_PROGRESS` when the inline budget is used → park (rule 20).
20. **Park instead of sleeping.** A slow container never holds a worker for minutes. In one transaction, conditional on `lease_owner`: the attempt stays open (`outcome` and `finished_at` null); the publication moves to `status = verifying` with the lease cleared and `next_attempt_at = now + SOCIALHUB_PUBLISH_CONTAINER_RECHECK_SECONDS` (60); the item stays `publishing`; the job ends `succeeded` with `result = {"publication_id": …, "waiting_for": "container"}`. The account lock is released when the task leaves the `account_session` block.
    - From then on the `publishing.verify` task (E08-S04 rule 11) reads the container once a minute. When it reads `FINISHED`, it calls `publishing.services.sending.continue_attempt(publication)`, which runs rules 21–24 for the same open attempt inside the verify task's own lease and lock.
    - A container still `IN_PROGRESS` `SOCIALHUB_PUBLISH_CONTAINER_MAX_WAIT_MINUTES` (15) after `container_created_at` is given up: the attempt closes with `outcome = retryable_error`, `error_code = "container_timeout"`, `attempt_count += 1`, and E08-S04 sends the publication to failure with a review task. A second container is never created while the first is still processing.
21. **Publish.** Call `publish_container(token, remote_container_id)`; it returns the media ID. The job message is "Publishing". From the moment this call starts, an error that is not a clear refusal from Instagram is ambiguous (rule 25): the post may exist.
22. **Read back.** Call `get_media(token, media_id)` and keep `id`, `shortcode`, `permalink` and `timestamp`. If it fails, it is tried once more after 3 seconds. If that also fails, the post is live but its link is unknown: the attempt closes with `outcome = success` and `error_code = "read_back_failed"`, `attempt_count += 1`, the publication keeps `remote_media_id` and `container_status = PUBLISHED` and moves to `verifying` with `next_attempt_at = now + 1 minute`, the job ends `succeeded` with `permalink` null, and E08-S04's verify task finishes the read-back (E08-S04 rule 12) and then applies rule 24. Nothing is ever sent again for it.
23. When the `account_session` block ends, whatever the outcome, the Instagram lock is released.

### Result handling

24. **Success** (read-back returned). In one transaction, with a conditional update that requires `lease_owner` to still match:
    - Attempt: `outcome = success`, `finished_at = now`.
    - Publication: `status = published`, `container_status = PUBLISHED`, `remote_media_id`, `remote_shortcode` and `permalink` from the read-back, `published_at` = the media's `timestamp` (now when absent); `published_via = provider`; `attempt_count += 1`; lease, `next_attempt_at` and `blocked_reason` cleared.
    - Metrics hand-over for E09-S01: `next_metrics_checkpoint = "1h"`, `next_metrics_at = published_at + 1 hour`.
    - Slot, if any: `status = published`.
    - Item: `publishing → published` through the pipeline service; `active_job` cleared; `ContentEvent` of type `publish_attempt` with `data = {"attempt": n, "outcome": "success", "permalink": …}`.
    - Job: `succeeded`, `result = {"publication_id", "permalink"}`.
25. **Errors.** Every error closes the open attempt with `finished_at = now` and the `outcome` and `error_code` below; the job ends `failed` with the same `error_code`. A container that was already created stays on the publication, so a later attempt can reuse it if it is still `FINISHED` (E08-S04 rule 14).

    | Error | Raised by | `outcome` / `error_code` | Counted | Publication and item |
    | --- | --- | --- | --- | --- |
    | `TokenInvalid`, `PermissionMissing` | Any call | `retryable_error` / `token_invalid` or `permission_missing` | No | `report_connection_error(account, error)` sets the connection `needs_attention` (and recomputes capabilities for a missing permission). Publication `scheduled`, `blocked_reason = connection_problem`, lease cleared; item back to `scheduled`. Instagram refused the call, so this is never ambiguous, even during `publish_container` |
    | `RateLimited` | Any call | `retryable_error` / `rate_limited` | No | `scheduled`, `next_attempt_at = now + max(retry_after_seconds, 15 minutes)`; item back to `scheduled`. Never ambiguous |
    | `QuotaExceeded` | `create_container`, `publish_container` | `retryable_error` / `quota_exceeded` | No | `scheduled`, `blocked_reason = daily_limit`, `next_attempt_at = now + 60 minutes`, one note event as in rule 14; item back to `scheduled` |
    | `NotSupported` | Any call (the `manual` provider, or a capability that turned false after the gate ran) | `retryable_error` / `not_supported` | No | `delivery = manual`, `scheduled`, lease cleared, `ContentEvent` note "Switched to posting by hand"; item back to `scheduled`. E08-S04's manual delivery takes over |
    | `MediaRejected` (create call, or container `ERROR`), `asset_missing`, `unsupported_media`, `caption_too_long` | `create_container`, `container_status`, rule 16 | `fatal_error` / `media_rejected` or the rule 16 code; `error_message` holds Instagram's message | Yes | Handed to E08-S04's failure handling (publication `failed`, item `failed`, review task). No retry |
    | `TransientError`, a soft time limit or any unexpected exception **before** `publish_container` started; container `EXPIRED` during the wait | `create_container`, `container_status`, `list_active_stories` (a failed quota read only skips the check, rule 14) | `retryable_error` / `transient_error` | Yes | Handed to `publishing.services.recovery.after_attempt(publication, attempt)` (E08-S04) |
    | `AmbiguousResult`, `TransientError` during `publish_container`, a soft time limit or unexpected exception **after** `publish_container` started, container `PUBLISHED` before publishing | `publish_container`, rule 19 | `ambiguous` / `timeout` (or `transient_error` for a 5xx answer) | Yes | Handed to `recovery.after_attempt` (E08-S04), which verifies before anything else happens |
    | Container still `IN_PROGRESS` after 15 minutes | E08-S04's verify task (rule 20) | `retryable_error` / `container_timeout` | Yes | Handed to `recovery.after_attempt`, which sends it to failure |

    This story's deliverable for the last three rows is the hand-over call `recovery.after_attempt`; until E08-S04 lands, that function marks the publication `failed`.
26. If a conditional update finds that the lease no longer matches (the lease expired and recovery took over), the task writes nothing to the publication and only closes its attempt row with what it observed. Recovery in E08-S04 reads the container and finds the post by verification.

`attempt_count` counts sends that used the budget. `PublishAttempt.number` counts rows, including the uncounted interruptions in the table of rule 25.

### Publish now

27. `POST /publications/{id}/publish-now/` is allowed when `publish_now` is in `allowed_actions` (status `scheduled`, not leased, `delivery = provider`).
28. It checks gates 1, 2 and 6 synchronously and returns an error instead of leaving the publication silently blocked:

| Gate | Response |
| --- | --- |
| Stop switch off | `409 publishing_disabled` |
| Connection not usable (gate 2) | `409 instagram_permission_missing` when the connection is `needs_attention` with `last_error_code = permission_missing`; otherwise `409 instagram_not_connected` |
| Daily limit reached | `409 invalid_transition` with `details.reason = "daily_limit"` |

29. When those pass: `scheduled_at = now`, `next_attempt_at = null`. If the minimum gap is not yet satisfied, `next_attempt_at` is set to the earliest allowed time and returned as `earliest_send_at`; "as soon as rules allow" never bypasses the gap. The slot link is kept; the slot's own time is not changed. The live Instagram quota is not read here; the send task reads it (rule 14).
30. The endpoint then triggers `publishing.dispatch_due` once (in addition to the every-minute schedule), so the send normally starts within seconds.
31. `Idempotency-Key` is honoured: the same key within 24 hours returns the first response and does nothing else.
32. Operators and admins may call it.

## Data

`Publication`, `PublishAttempt` ([DATA-MODEL.md](../../DATA-MODEL.md) section 9). This story writes `remote_container_id`, `container_status`, `container_created_at`, `remote_media_id`, `remote_shortcode`, `permalink` and `published_at`. `PublishAttempt.finished_at` and `outcome` are nullable while an attempt is running or parked. `JobRun` kind `publish.send`.

`PublishAttempt.verification` for story attempts starts as:

```json
{"pre_story_ids": ["18011122233344455", "18011122233344466"]}
```

For feed posts and reels it stays null until E08-S04 records a check.

Attempt error codes written by this story: `token_invalid`, `permission_missing`, `rate_limited`, `quota_exceeded`, `not_supported`, `media_rejected`, `asset_missing`, `unsupported_media`, `caption_too_long`, `transient_error`, `timeout`, `container_timeout`, `read_back_failed`, `version_changed`. No new fields.

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
    "code": "instagram_not_connected",
    "message": "The Instagram connection for this account needs attention.",
    "fields": [],
    "request_id": "5c0f6d1e-8a51-4c6e-9d8f-0b7a4f1f2a10",
    "retryable": false,
    "details": {"account": 1, "connection_status": "needs_attention"}
  }
}
```

| Case | Response |
| --- | --- |
| Status is not `scheduled`, or `delivery = manual` | `409 invalid_transition`, `details: {"status", "delivery", "allowed_actions"}` |
| Being sent right now | `409 job_in_progress`, `details.job` |
| Stop switch off | `409 publishing_disabled` |
| Connection `disconnected`, `needs_attention`, or `expiring` past its expiry | `409 instagram_not_connected`, `details: {"account", "connection_status"}` |
| Connection `needs_attention` because a permission is missing | `409 instagram_permission_missing`, `details: {"account", "connection_status"}` |
| Daily limit reached | `409 invalid_transition`, `details.reason = "daily_limit"` |
| Not found | `404 not_found` |

`GET /publications/{id}/` (E08-S02) returns the attempts written by this story, for example:

```json
"attempts": [
  {
    "id": 64,
    "number": 1,
    "provider": "graph_api",
    "started_at": "2026-11-23T15:30:04Z",
    "finished_at": "2026-11-23T15:30:58Z",
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
| `publishing.send` | `publish` | Enqueued by the dispatcher after commit | Lease owner check before any work and on every write; `remote_container_id` committed before waiting or publishing | No Celery auto-retry. Retrying is a product rule handled by E08-S04 |
| `sending.continue_attempt` (a service, not a task) | `publish` | Called by `publishing.verify` (E08-S04) when a parked container reads `FINISHED` | Runs under the verify task's lease and lock; publishes only a container whose attempt is still open | None |

Celery settings for `publishing.send`: `acks_late = True`, `reject_on_worker_lost = True`, so a killed worker returns the message; the lease-owner check makes the second delivery harmless, and E08-S04's expired-lease recovery handles the half-finished attempt by reading the container.

Worker concurrency for the `publish` queue is 2 in the MVP. In production a dedicated `publish-worker` service consumes only `publish` (E11-S02), so long AI jobs on `default` cannot delay the dispatcher; locally the single `worker` consumes `default,publish`. The per-account lock keeps each account serial. Because slow containers are parked (rule 20), a send occupies a worker slot for about a minute at most in normal operation.

## AI

None.

## Panel

Additions to the Publishing tab of `/content/:id` and the calendar entry drawer (E08-S02).

**Attempts timeline** (`ProCard` "Attempts", below the schedule card; hidden when there are no attempts): an Ant Design `Timeline`, newest first. Each entry shows:

| Element | Content |
| --- | --- |
| Dot colour | Green for `success` and `verified_live`, orange for `retryable_error` and `ambiguous`, red for `fatal_error`, blue while running or parked |
| Title | From the label map below |
| Time | `DateTime` of `started_at`, and the duration (or "running") |
| Detail | `error_message` when present, in secondary text |

| `outcome` and `error_code` | Title |
| --- | --- |
| No outcome, publication `publishing` | "Attempt {n} — Sending" |
| No outcome, publication `verifying` | "Attempt {n} — Instagram is processing the video" ("the image" for images) |
| `success` | "Attempt {n} — Published" |
| `success` + `read_back_failed` | "Attempt {n} — Published, link not read yet" |
| `retryable_error` + `token_invalid` or `permission_missing` | "Attempt {n} — Interrupted: connection problem" |
| `retryable_error` + `rate_limited` | "Attempt {n} — Interrupted: Instagram rate limit" |
| `retryable_error` + `quota_exceeded` | "Attempt {n} — Interrupted: Instagram's publishing limit" |
| `retryable_error` + `not_supported` | "Attempt {n} — Switched to posting by hand" |
| `retryable_error` + `container_timeout` | "Attempt {n} — Instagram did not finish processing" |
| `fatal_error` + `media_rejected` | "Attempt {n} — Rejected by Instagram" |
| `fatal_error` + `asset_missing` | "Attempt {n} — Media file missing in storage" |
| `fatal_error` + `unsupported_media` | "Attempt {n} — File type not accepted by Instagram" |
| `fatal_error` + `caption_too_long` | "Attempt {n} — Caption too long" |

E08-S04 adds the labels for `ambiguous`, `transient_error`, `lease_expired` and `verified_live`.

**Publish now** button (shown when `publish_now` is allowed): `Modal.confirm` titled "Publish now?" with body "“{title}” will be sent to @handle as soon as the posting rules allow." Confirm button "Publish now". After success: when `waiting_for` is null, `message.success("Sending to Instagram")`; when it is `min_gap`, `message.info("Queued. It will be sent at {earliest_send_at} to keep the gap between posts.")`. Error texts by code:

| Code | Text |
| --- | --- |
| `publishing_disabled` | "Publishing is off for this account. An admin can turn it on in the top bar." |
| `instagram_not_connected` | "The Instagram connection needs attention. An admin can reconnect the account in Settings → Connection." |
| `instagram_permission_missing` | "Instagram has not granted permission to publish for this account. An admin must reconnect it and approve every permission." |
| `invalid_transition` with reason `daily_limit` | "Today's limit for this kind of post is already reached." |

**In flight:** while `in_flight` is true the tab shows `JobProgress` for the item's `active_job` with the message from the job ("Preparing the media on Instagram", "Waiting for Instagram to process the video", "Publishing", "Reading the post back"), polls the job every two seconds, and reloads the publication when the job ends. A parked publication is not in flight; E08-S04 shows its processing state.

**Published:** the schedule card shows "Published at {time}" and a button "View on Instagram" that opens the permalink in a new tab. While the permalink is still null (read-back pending), the button is replaced by the text "Link not available yet".

**Blocked:** an `Alert` at the top of the tab, by `blocked_reason`: "Waiting: publishing is off for this account.", "Waiting: the Instagram connection needs attention.", "Waiting: a daily posting limit is reached (the account's rules or Instagram's own limit). It will be sent when the limit allows."

## Acceptance criteria

1. Given a `scheduled` publication whose time has come and all gates pass, when the dispatcher runs, then within two minutes the publication is `published` with `remote_container_id`, `container_status = PUBLISHED`, `remote_media_id`, `remote_shortcode`, `permalink` and `published_at` from the read-back, the slot and item are `published`, one attempt with outcome `success` exists, and `next_metrics_checkpoint` is `1h`.
2. Given each of the four format and media combinations, when it is sent with the fake provider, then `create_container` is called once with the `ContainerSpec` of rule 17: signed HTTPS URLs from `public_url`, the full caption for feed posts and reels and no caption for stories, a cover URL and `share_to_feed = true` for a reel with a cover; and no asset is downloaded by the worker.
3. Given two due publications of one account, when the dispatcher runs once, then only the earlier one is claimed.
4. Given `publishing_enabled` is false, when the dispatcher runs, then nothing is sent, `blocked_reason` is `publishing_paused`, and exactly one note event is written however many minutes pass.
5. Given publishing was off for three hours and is switched on, when the dispatcher runs, then publications more than 120 minutes late are moved to a new time and not sent in that run.
6. Given the connection status is `needs_attention`, then `blocked_reason` is `connection_problem` and no attempt row is created; given it is `expiring` with a token that has not expired, then the publication is sent.
7. Given a scheduled item whose content version is no longer its current version when its time comes, then nothing is sent, the publication and item are `failed`, and a review task with reason `publish_failed` says the approved version is no longer current.
8. Given the daily feed limit is reached, then `blocked_reason` is `daily_limit`; given the latest reel went out 30 minutes ago with a 120-minute gap, then `next_attempt_at` is 90 minutes later and no `blocked_reason` is set.
9. Given the fake provider scenario `token_invalid` on `create_container`, then `attempt_count` is unchanged, the connection is `needs_attention`, the publication is `scheduled` with `blocked_reason = connection_problem`, and the attempt row has `error_code = "token_invalid"`.
10. Given the scenario `media_rejected` (container ends `ERROR`), then the attempt has outcome `fatal_error`, `error_code = "media_rejected"` and Instagram's message, and the publication is handed to failure handling without another send.
11. Given the same `publishing.send` message is delivered twice, then `create_container` and `publish_container` are each called once.
12. Given a final asset whose object is missing from storage, then no container is created and the attempt is a fatal error with `asset_missing`.
13. Given a scheduled publication for tomorrow, when "Publish now" is confirmed, then it is sent within two minutes; with publishing off the same call returns `409 publishing_disabled` and nothing changes.
14. Given two publish-now requests with the same `Idempotency-Key`, then the second returns the first response and the publication is sent once.
15. Given the scenario `quota_exceeded` (usage equals total), when the send task runs, then no container is created, no attempt row is written, the publication is `scheduled` with `blocked_reason = daily_limit` and `next_attempt_at` 60 minutes later, and one note event names the quota.
16. Given the scenario `container_slow` with `delay_seconds` 300 on a reel, then the send task ends after about 60 seconds, the publication is `verifying` with an open attempt and no lease, and after the container reads `FINISHED` a verify run publishes it; `create_container` and `publish_container` are each called once and the attempt ends `success`.
17. Given the send task is stopped right after `create_container` returns, then `remote_container_id`, `container_created_at` and `container_status = IN_PROGRESS` are already committed.
18. Given the provider raises `NotSupported` for a story, then the attempt is not counted, the publication is `scheduled` with `delivery = manual`, and a note event records the switch.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S03-BE1 | Attempt model and dispatcher | `PublishAttempt` model and migration; `apps/publishing/tasks.py::dispatch_due` with the Redis run lock, the `SKIP LOCKED` selection, one-per-account rule including parked containers, claim and lease, `JobRun` creation, enqueue on commit; Beat entry; `publish` queue routing in `config/celery.py` and `compose.yaml` | 1 d |
| E08-S03-BE2 | Send task and container flow | `apps/publishing/services/sending.py` and `tasks.py::send`: lease-owner check, `account_session` lock, stop-switch re-check, pre-send hook, live quota, attempt row and story pre-list, storage and MIME checks, signed URLs from `public_url`, `ContainerSpec` per format with `ai_generated`, container committed in its own transaction, inline polling, park and `continue_attempt`, publish, read-back with one retry, time limits | 1 d |
| E08-S03-BE3 | Gates and blocked reasons | `apps/publishing/services/gates.py`: the seven gates as small functions returning pass or an action; connection gate with `expiring`; capability switch to manual; lateness move using E08-S01; defensive version gate handing over to failure handling; event de-duplication of rule 6; unit tests per gate | 0.5 d |
| E08-S03-BE4 | Result handling | Success transaction of rule 24 with the conditional lease update, metric hand-over, slot and item transitions, events, job result; every row of the error table in rule 25 (connection, rate limit, quota, manual switch, fatal, transient, ambiguous, container timeout); `recovery.after_attempt` hand-over stub | 0.5 d |
| E08-S03-BE5 | Publish-now endpoint | View, synchronous gate checks and error mapping (`instagram_not_connected`, `instagram_permission_missing`), minimum-gap answer, dispatcher trigger, idempotency key handling through the shared helper, `openapi.yaml` | 0.25 d |
| E08-S03-BE6 | Fake-provider tests | Task-level tests for every acceptance criterion using the fake provider's scenarios (`ok`, `token_invalid`, `permission_missing`, `rate_limited`, `quota_exceeded`, `media_rejected`, `container_slow`); duplicate-delivery test; lease-lost test; container-committed-before-wait test | 0.25 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S03-FE1 | Attempts, publish now, live state | `AttemptsTimeline` component with the label map; "Publish now" confirmation and error texts in the shared publication actions component; `JobProgress` and polling while in flight; blocked alerts; "View on Instagram" and the pending-link text | 0.5 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- Tests call the dispatcher and send task functions directly with Celery in eager mode and a fixed clock. Container polling uses an injected sleep, so tests advance the clock instead of waiting.
- The fake provider (E00-S04) keeps containers, posts and call counts; tests assert on `create_container`, `container_status`, `publish_container` and `get_media` counts.
- The lease-lost test: claim a publication, change `lease_owner` in the database before the task writes its result, and assert the publication row is untouched while the attempt row is closed. A second variant changes it before rule 18's commit and asserts that `publish_container` is never called.
- The duplicate-delivery test: run `send` twice with the same arguments; assert one container and one publish call.
- The parked-container test uses `container_slow`: run `send`, assert the publication is `verifying` with an open attempt, advance the clock past `delay_seconds`, call `continue_attempt` as the verify task would, assert `success`.
- `public_url` is stubbed to return `https://media.example.test/…?X-Amz-Signature=…`; tests assert the URLs in the `ContainerSpec`, never a local path.
- Gate tests are unit tests on `gates.py` with plain objects; no database needed for most.
- Panel test: timeline labels for each `outcome` and `error_code`; publish-now error texts.
- A manual check against the real provider on the pilot account, once per format, is part of E11-S03.

## Later

- A separate worker container for the `publish` queue: only `compose.yaml` changes.
- Create the container a few minutes before the slot so the post lands exactly on time. Containers live 24 hours and the lease model already separates claim from send; the gates would then run twice.
- Carousels: one parent container with child containers, counted as one post against the quota; the same create, wait, publish and read-back steps apply.
- Resumable video upload through the Facebook Login variant (`graph_api_fb`, INSTAGRAM-INTEGRATION.md section 8) would remove the need for a public bucket; only the URL step of rule 16 changes.
