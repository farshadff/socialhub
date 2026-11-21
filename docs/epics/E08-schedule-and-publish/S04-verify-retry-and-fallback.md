# E08-S04 — Verify before retry, failures and manual fallback

| | |
| --- | --- |
| Epic | E08 Schedule and publish |
| Priority | Must |
| Estimate | BE 3 d · FE 1.5 d · QA 0 d |
| Depends on | E08-S03, E08-S02, E00-S04, E07-S06 |
| Needed by | E09-S01, E11-S01, E11-S03 |

## User story

As an operator, I want the system to check Instagram before it ever sends a post a second time, to tell me clearly when a post could not go out, and to let me post by hand when automation is not available, so that the account never shows a duplicate and a blocked connection never stops the week.

## Context

The workflow says "Verify live posts before retrying". With an unofficial Instagram client the dangerous case is a request that times out after the upload: the post may be live although the worker saw an error. Sending again would publish it twice. This story makes the rule absolute: no second send without first looking at the account. It also defines the end of the road (a failed publication and a review task) and the manual route, where a person posts and tells the system.

## Scope

**In:**

- Live verification for feed posts, reels and stories.
- The retry state machine: three counted sends, waits of 2 and 10 minutes between them, a last live check 30 minutes after the third.
- Recovery of publications whose lease expired.
- Failure: publication and item `failed`, review task `publish_failed`.
- `POST /publications/{id}/retry/`.
- Manual delivery: "post by hand", `POST /publications/{id}/mark-published/`.
- Panel: post-by-hand card, mark-as-published dialog, retry, verifying and failed states.

**Out (later):**

- Deleting a duplicate post from the panel.
- Notifications outside the panel.
- Automatic switch of an account to the `manual` provider after repeated failures.

## Behaviour and rules

### Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `SOCIALHUB_PUBLISH_MAX_ATTEMPTS` | 3 | Counted sends per publication |
| `SOCIALHUB_PUBLISH_RETRY_BACKOFF_MINUTES` | `2,10,30` | Wait after the 1st, 2nd and 3rd counted attempt. The first two lead to another send; the third leads to a final live check only |
| `SOCIALHUB_PUBLISH_VERIFY_SETTLE_SECONDS` | 30 | Pause before the first live check after an uncertain send, so Instagram has time to list the post |
| `SOCIALHUB_PUBLISH_VERIFY_LOOKBACK_SECONDS` | 120 | How far before the attempt's start the search window opens |

### The one rule

1. A publication that has a `PublishAttempt` row from the last 48 hours is never sent again until a live verification has run after its latest attempt and found nothing. This holds for automatic retries, for recovery after a crash, and for the retry button.

### Live verification

`publishing.services.verification.verify(publication)` returns `found(remote)`, `not_found` or `unknown` (the check itself could not be done).

2. The window opens at `first_attempt.started_at - 120 seconds`, where `first_attempt` is the publication's earliest `PublishAttempt` started within the last 48 hours. Using the earliest attempt, and not the latest, covers a post that came from any earlier send, including sends made before an operator pressed Retry. Attempts older than 48 hours belong to an earlier scheduling of the item and are ignored.
3. **Feed posts and reels with a fingerprint.** Call `list_recent_media(state, since=window_start, limit=20)`. A remote item matches when all are true:
   - its media kind matches the format (`feed_post` → image post; `reel` → reel/clip);
   - `caption_fingerprint(remote.caption_text)` equals `Publication.caption_fingerprint`;
   - `remote.taken_at >= window_start`.

   If several match, the earliest is taken and `verification.candidates` records how many there were.
4. **Stories, and feed posts or reels whose fingerprint is empty** (caption shorter than 10 normalized characters). There is no caption to match, so the check uses the time window and the count delta:
   - Stories: call `list_active_stories(state)`. Candidates are items whose identifier is not in the attempt's `verification.pre_story_pks`, whose media kind matches the version's `media_kind`, and whose `taken_at` lies between `window_start` and now.
   - Feed posts and reels without a fingerprint: call `list_recent_media` as in rule 3; candidates are items of the matching kind with `taken_at` in the window that are not already recorded as `remote_media_pk` of another publication of this account.
   - Exactly one candidate → `found`. More than one → `found` with the earliest, and `verification.candidates` set. None → `not_found`.
5. A candidate whose identifier already belongs to another publication of the account is never matched.
6. If the provider raises `SessionRequired`, `ChallengeRequired`, `RateLimited` or `TransientError` during verification, the result is `unknown`. An `unknown` result never leads to a send. The publication stays `verifying`, `next_attempt_at` is set to 5 minutes later (or the rate limit's suggested wait if longer), and `blocked_reason = session_problem` is set for session errors.
7. Every verification writes what it did into the latest attempt's `verification` JSON:

```json
{
  "pre_story_pks": [],
  "checks": [
    {
      "at": "2026-11-23T15:36:44Z",
      "method": "caption_fingerprint",
      "window_start": "2026-11-23T15:28:04Z",
      "listed": 20,
      "candidates": 0,
      "result": "not_found"
    },
    {
      "at": "2026-11-23T15:38:50Z",
      "method": "caption_fingerprint",
      "window_start": "2026-11-23T15:28:04Z",
      "listed": 20,
      "candidates": 1,
      "result": "found",
      "remote_media_pk": "3499001112223334445",
      "remote_media_code": "DC0aBcDeFgH",
      "taken_at": "2026-11-23T15:30:58Z"
    }
  ]
}
```

`method` is `caption_fingerprint`, `active_stories` or `time_window`.

### After an attempt

`publishing.services.recovery.after_attempt(publication, attempt)` is called by the send task (E08-S03 rules 21 and 22).

8. **Fatal** (`fatal_error`): go to failure (rule 15). No verification, no retry: Instagram answered and said no.
9. **Ambiguous or transient** (`ambiguous`, `retryable_error` from `TransientError`): the publication moves to `status = verifying`, the lease is cleared, `next_attempt_at = now + 30 seconds`, and the item stays `publishing`. A transient error is treated like an ambiguous one on purpose: the adapter's judgement that "nothing was sent" is not trusted with a duplicate at stake.

### The verify task

`publishing.verify(publication_id)` runs on the `publish` queue. The dispatcher enqueues it for every publication with `status = verifying` and `next_attempt_at <= now` and no active lease; it takes a 120-second lease and the per-account Instagram lock. A `JobRun` of kind `publish.verify` tracks it.

10. `found` → the publication is published: `status = published`, `remote_media_pk`, `remote_media_code`, `permalink` and `published_at = remote.taken_at` from the match, `published_via = provider`; the latest attempt's `outcome` is changed to `verified_live`; slot and item become `published`; the metric hand-over of E08-S03 rule 18 is applied; a `ContentEvent` of type `publish_attempt` says "Found live on Instagram after an uncertain send".
11. `not_found` and `attempt_count < 3` → wait, then send again: `status = scheduled`, `next_attempt_at = latest_attempt.finished_at + backoff[attempt_count]` (2 minutes after the first counted attempt, 10 after the second), item `publishing → scheduled`. When that time comes the dispatcher treats it like any due publication, with one addition (rule 13).
12. `not_found` and `attempt_count = 3`:
    - If the final check has not been done: stay `verifying`, `next_attempt_at = latest_attempt.finished_at + 30 minutes`, and mark `verification.final_check_pending = true`.
    - If this was the final check: go to failure (rule 15).
13. **Pre-send check.** In the send task, when the publication has an attempt from the last 48 hours, `verify` runs first, inside the same lease and lock, before the asset is downloaded. `found` → rule 10, nothing is sent. `unknown` → the claim is released back to `verifying` (rule 6). Only `not_found` lets the send proceed. This is the last line of defence when a post appeared on Instagram during the wait.
14. Uncounted interruptions (session problem, rate limit: E08-S03 rules 19 and 20) do not enter this flow; nothing was sent, by the provider's explicit answer before upload. The pre-send check of rule 13 still runs on the next try because an attempt row exists.

### Failure

15. Failure, in one transaction: `Publication.status = failed`, lease and `next_attempt_at` cleared; slot stays `scheduled` (the operator decides); item `publishing → failed` through the pipeline service with `hold_reason` set to the short reason; `active_job` cleared; a `ReviewTask` is created with `reason = publish_failed`, `publication` set, and `detail` built from the attempts, for example: "3 attempts. Last error: timeout while waiting for Instagram (ambiguous). The post was not found on the account 30 minutes after the last attempt. Check the profile before retrying." For a fatal error: "Instagram rejected the media: {error_message}. The version needs to change before it can be sent."
16. An open `publish_failed` review task for the same publication is reused, not duplicated.
17. Resolving a `publish_failed` review task (E07-S06) calls `publishing.services.recovery.on_review_decision(task, decision)`, which runs in the resolve transaction and is the only place these decisions touch publishing:

    | Decision | Publication | Slot | Item |
    | --- | --- | --- | --- |
    | `approve` | The retry service of rule 19 (including its rule 21 refusal: a `fatal_error` with an unchanged version raises `invalid_transition` with `details.reason = "version_rejected"`, so the reviewer must request changes or post by hand) | Unchanged (`scheduled`) | `failed → scheduled` |
    | `request_changes` | `withdraw` (E08-S01 rule 21): `cancelled` | Back to `reserved`; the item keeps it | `failed → needs_revision`; the revise flow (E07-S05) uses the reviewer's instructions. When the new version passes, E08-S01 rule 4 reuses this publication row |
    | `reject` | `withdraw`: `cancelled` | Released by the E03-S04 cancel rule (`open` if in the future, otherwise `skipped`) | `failed → cancelled` |

    The hook never resolves the task itself; E07-S06 does that after the hook returns.

### Expired leases

18. Each dispatcher run also looks for publications in `publishing` or `verifying` whose `lease_expires_at` is in the past:
    - `publishing`: the worker died or hung mid-send. The open attempt is closed with `outcome = ambiguous`, `error_code = "lease_expired"`, `finished_at = lease_expires_at`; `attempt_count += 1`; then rule 9 applies. It is never re-enqueued for sending directly.
    - `verifying`: the verify task died. The lease is cleared and `next_attempt_at = now`; the next run enqueues verification again.

### Retry

19. `POST /publications/{id}/retry/` is allowed when `status = failed`. It sets `status = scheduled`, `attempt_count = 0`, `scheduled_at = now`, `next_attempt_at = now`, clears `blocked_reason`, moves the item `failed → scheduled`, resolves the open `publish_failed` review task with `decision = approve` and `decision_note = "Retried by {user}"`, and triggers the dispatcher once.
20. Because recent attempt rows exist, rule 13 verifies before sending. If the post is found, the publication simply becomes `published`.
21. A publication whose last attempt was `fatal_error` and whose content version has not changed returns `409 invalid_transition` with `details.reason = "version_rejected"`: sending the same rejected file again is pointless. The operator must request changes or post by hand.
22. The stop switch and connection are checked as in publish-now (E08-S03 rule 25) and return the same errors.
23. `Idempotency-Key` is honoured.

### Manual delivery

24. A publication has `delivery = manual` when the account's provider is `manual` or the capability for the format is false (E08-S01 rule 17, E08-S03 gate 3). The dispatcher never claims it. It keeps `status = scheduled` and no attempts are created.
25. A manual publication whose `scheduled_at` has passed is **due by hand**. It is not moved by the lateness rule. It appears on the overview attention list as type `publication_due_by_hand` (E11-S01) and is flagged on the calendar.
26. The stop switch does not apply to manual delivery: a person is posting, the system sends nothing.
27. `POST /publications/{id}/mark-published/` records a post made by hand. It is allowed for `status` `scheduled`, `failed`, or `verifying` without an active lease, for either delivery mode (an operator may post by hand after a failure).
28. `permalink` is required and must be an Instagram link to one post:

| Format | Accepted paths on `instagram.com` or `www.instagram.com` (https only; query string and trailing slash ignored) |
| --- | --- |
| `feed_post` | `/p/{code}/` and `/{username}/p/{code}/` |
| `reel` | `/reel/{code}/`, `/reels/{code}/`, `/{username}/reel/{code}/`, and `/p/{code}/` |
| `story` | `/stories/{username}/{media_pk}/` |

    `code` matches `[A-Za-z0-9_-]{5,40}`; `media_pk` is digits. When a username is present it must equal the account's handle, case-insensitive. A link that fails returns `400 validation_error` on `permalink` with code `invalid`, or code `wrong_account` for a handle mismatch.
29. `remote_media_code` is the code from the link. `remote_media_pk` is derived from the code with the helper `instagram.utils.media_pk_from_code` (Instagram's shortcode is a base-64 encoding of the numeric identifier); for stories it is the number in the link. The stored `permalink` is normalized to `https://www.instagram.com/p/{code}/`, `…/reel/{code}/` or the story link.
30. A permalink whose code or media identifier is already stored on another publication returns `400 validation_error` on `permalink` with code `unique`.
31. `published_at` is optional. Default is now. It may not be in the future and may not be more than 30 days in the past.
32. `verify` is optional, default `true`. When true and the connection is `connected` with a provider other than `manual`, the service looks the post up with `list_recent_media` (or `list_active_stories`) and, if it finds the code, replaces `published_at` with the real `taken_at` and confirms `remote_media_pk`. The outcome is returned in `verification`. Not finding it does not block the request: the operator's statement stands, and the response says `found: false` so the panel can warn.
33. Effects: `status = published`, `published_via = manual`, `blocked_reason`, `next_attempt_at` and lease cleared; slot and item become `published` (item from `scheduled`, `failed` or `publishing`); metric hand-over as in rule 34; open `publish_failed` review task resolved with `decision = approve` and note "Marked as published by {user}"; `ContentEvent` of type `publish_attempt` with `data.via = "manual"`. No `PublishAttempt` row is written.
34. **Metric hand-over for a back-dated post.** `published_at` may be up to 30 days ago, so some checkpoints of the format may already have passed. The hand-over applies E09-S01's rules at once instead of leaving them for the collector: every non-final checkpoint already past its skip age (E09-S01 rule 2) gets a `MetricSnapshot` row with `status = skipped`, `skip_reason = missed`; `next_metrics_checkpoint` is the first remaining checkpoint and `next_metrics_at = max(now, published_at + its age)`. When only the final checkpoint remains and it is already due, `next_metrics_at = now`, so the collector captures it on its next cycle (E09-S01 rule 3) or records `gave_up` if the give-up age has passed. No pointer is ever left in the past, so the overview raises no `metrics_sync_gap` for a back-dated post. A post marked published at the current time simply gets the first checkpoint (`1h`).

## Data

`Publication`, `PublishAttempt`, `ReviewTask`, `ContentItem`, `PlanSlot`, `ContentEvent` as in [DATA-MODEL.md](../../DATA-MODEL.md). `Publication.delivery` from E08-S01. `JobRun` kind `publish.verify`.

`PublishAttempt.verification` shape is the JSON in rule 7, plus `final_check_pending` (bool) on the third attempt.

## API

### `POST /publications/{id}/retry/`

Permission: signed in. Header `Idempotency-Key` optional. Body: empty object.

Response `200`: the publication as in `GET /publications/{id}/`.

```json
{
  "id": 33,
  "status": "scheduled",
  "delivery": "provider",
  "scheduled_at": "2026-11-24T09:12:40Z",
  "attempt_count": 0,
  "max_attempts": 3,
  "next_attempt_at": "2026-11-24T09:12:40Z",
  "blocked_reason": null,
  "in_flight": false,
  "allowed_actions": ["reschedule", "cancel", "publish_now", "mark_published"],
  "attempts": [
    {"id": 70, "number": 1, "provider": "instagrapi", "started_at": "2026-11-24T08:00:05Z", "finished_at": "2026-11-24T08:04:35Z", "outcome": "ambiguous", "error_code": "timeout", "error_message": "No response from Instagram after upload", "verification": {"checks": [{"at": "2026-11-24T08:05:06Z", "method": "caption_fingerprint", "window_start": "2026-11-24T07:58:05Z", "listed": 20, "candidates": 0, "result": "not_found"}]}},
    {"id": 71, "number": 2, "provider": "instagrapi", "started_at": "2026-11-24T08:06:40Z", "finished_at": "2026-11-24T08:11:10Z", "outcome": "ambiguous", "error_code": "timeout", "error_message": "No response from Instagram after upload", "verification": {"checks": [{"at": "2026-11-24T08:11:41Z", "method": "caption_fingerprint", "window_start": "2026-11-24T07:58:05Z", "listed": 20, "candidates": 0, "result": "not_found"}]}},
    {"id": 72, "number": 3, "provider": "instagrapi", "started_at": "2026-11-24T08:21:15Z", "finished_at": "2026-11-24T08:25:45Z", "outcome": "ambiguous", "error_code": "timeout", "error_message": "No response from Instagram after upload", "verification": {"final_check_pending": false, "checks": [{"at": "2026-11-24T08:26:16Z", "method": "caption_fingerprint", "window_start": "2026-11-24T07:58:05Z", "listed": 20, "candidates": 0, "result": "not_found"}, {"at": "2026-11-24T08:55:50Z", "method": "caption_fingerprint", "window_start": "2026-11-24T07:58:05Z", "listed": 20, "candidates": 0, "result": "not_found"}]}}
  ],
  "…": "remaining fields as in GET /publications/{id}/"
}
```

| Case | Response |
| --- | --- |
| Status is not `failed` | `409 invalid_transition`, `details: {"status", "allowed_actions"}` |
| Last attempt was fatal and the version is unchanged | `409 invalid_transition`, `details.reason = "version_rejected"` |
| Stop switch off | `409 publishing_disabled` |
| Connection problem | `409 instagram_session_required` or `409 instagram_challenge_required` |
| Not found | `404 not_found` |

### `POST /publications/{id}/mark-published/`

Permission: signed in. Request:

```json
{
  "permalink": "https://www.instagram.com/reel/DC0aBcDeFgH/?igsh=abc123",
  "published_at": "2026-11-23T15:41:00Z",
  "verify": true
}
```

Response `200`:

```json
{
  "publication": {
    "id": 31,
    "status": "published",
    "delivery": "manual",
    "published_via": "manual",
    "permalink": "https://www.instagram.com/reel/DC0aBcDeFgH/",
    "remote_media_code": "DC0aBcDeFgH",
    "remote_media_pk": "3499001112223334445",
    "published_at": "2026-11-23T15:40:12Z",
    "next_metrics_checkpoint": "1h",
    "next_metrics_at": "2026-11-23T16:40:12Z",
    "allowed_actions": [],
    "…": "remaining fields as in GET /publications/{id}/"
  },
  "verification": {"checked": true, "found": true, "taken_at": "2026-11-23T15:40:12Z"}
}
```

When the check could not be made (manual provider, or connection not healthy): `"verification": {"checked": false, "found": null, "taken_at": null}`.

| Case | Response |
| --- | --- |
| `permalink` missing, not https, not an Instagram post link, or wrong link type for the format | `400 validation_error`, field `permalink`, code `invalid` |
| Link belongs to another handle | `400 validation_error`, field `permalink`, code `wrong_account` |
| Link already recorded on another publication | `400 validation_error`, field `permalink`, code `unique` |
| `published_at` in the future or older than 30 days | `400 validation_error`, field `published_at`, code `max_value` or `min_value` |
| Being sent or verified right now | `409 job_in_progress`, `details.job` |
| Already published or cancelled | `409 invalid_transition` |

## Background work

| Task | Queue | Trigger | Idempotency | Retries |
| --- | --- | --- | --- | --- |
| `publishing.verify` | `publish` | Dispatcher, for `verifying` publications that are due | 120-second lease; conditional writes on lease owner; result written to the attempt's `verification.checks` | `unknown` results reschedule themselves 5 minutes later; no Celery auto-retry |
| Expired-lease sweep | `publish` | Part of `publishing.dispatch_due`, every minute | Conditional update on `lease_expires_at < now` | — |

Timeline of the worst case for one publication, with defaults:

```text
T+0      attempt 1 (uncertain) → verify at +30 s → not found
T+2 min  pre-send verify → not found → attempt 2 (uncertain) → verify → not found
T+12 min pre-send verify → not found → attempt 3 (uncertain) → verify → not found
T+42 min final verify → not found → failed + review task
```

(Times are measured from the end of each attempt, so real elapsed time is longer by the attempts' own duration.)

## AI

None.

## Panel

Additions to the Publishing tab of `/content/:id`, the calendar drawer and the calendar cards.

### Post by hand

Shown when `delivery = manual` and the status is `scheduled`, as a `ProCard` titled "Post by hand" with an info `Alert`: "This account is posted by hand. Post the file below on Instagram, then paste the link here." When the scheduled time has passed, the alert is a warning: "Due since {time}."

| Element | Behaviour |
| --- | --- |
| "Download video" / "Download image" | Downloads the final asset with a readable file name (`{handle}-{format}-{item id}.{ext}`) |
| "Download cover" | Reels with a cover asset only |
| Caption box | `full_caption` through `ContentText`, read-only, with "Copy caption". Hidden for stories |
| Checklist | Three plain lines: "1. Post it on @handle as a {format}." "2. Open the post and copy its link." "3. Paste the link below." |
| "Mark as published" | Opens the dialog below |

Calendar cards and list rows show the tag "Post by hand"; when due, the tag is in warning colour and reads "Post by hand — due".

### Mark as published

`ModalForm` titled "Mark as published". Also reachable from a failed publication ("I posted it myself").

| Field | Control | Rules |
| --- | --- | --- |
| Link to the post | `Input`, placeholder `https://www.instagram.com/reel/…` | Required. Client-side check that it starts with `https://www.instagram.com/` or `https://instagram.com/` |
| Posted at | Date-time picker in account timezone, default now | Not in the future |

Submit button "Mark as published". Field error texts: `invalid` → "This does not look like a link to a single Instagram {format}."; `wrong_account` → "This link belongs to another account."; `unique` → "This post is already recorded for another item." After success: `message.success("Marked as published")`; when the response has `verification.checked = true` and `found = false`, a `notification.warning`: "Saved, but the post was not found on the account yet. Metrics will start once Instagram lists it."

### Retrying, verifying and failed

| Publication state | Tab and drawer | Calendar card |
| --- | --- | --- |
| `scheduled` with `attempt_count > 0` | Info alert: "Attempt {n} did not go through. The account will be checked and the post retried at {next_attempt_at}." | Tag "Retry {n+1} of 3" |
| `verifying` | Info alert: "Checking Instagram for this post before trying again." With `final_check_pending`: "Last check at {next_attempt_at}." `JobProgress` when a verify job is active | Spinner, tag "Verifying" |
| `failed` | Error `Result` card: title "Could not publish", the review task's `detail`, buttons "Retry" (when `retry` is allowed), "Mark as published", "Open review task" (to `/review/:taskId`), "Cancel publication" | `StatusTag` Failed |
| `published` with the latest attempt `verified_live` | Timeline entry "Attempt {n} — Found live after an uncertain send" in green | — |

**Retry** (`Modal.confirm`, title "Retry publishing?"): body "The account is checked first. If the post is already live, nothing is sent." Confirm "Retry". Error text for `version_rejected`: "Instagram rejected this file. Request changes in the review task, or post it by hand."

Timeline labels added to the map of E08-S03: `ambiguous` + `timeout` → "No answer from Instagram"; `ambiguous` + `lease_expired` → "Worker stopped during the send"; `retryable_error` → "Temporary error"; `verified_live` → "Found live after an uncertain send". Each attempt's verification checks are listed under it in small text: "Checked 15:36 — not found", "Checked 15:38 — found".

## Acceptance criteria

1. Given the fake provider publishes the post and then times out, when the send finishes, then the publication becomes `published` after the first verification, the attempt outcome is `verified_live`, the provider's publish method was called once, and the remote account has one post.
2. Given the fake provider fails three times without posting, then sends happen at about 0, +2 and +10 minutes, a final check runs 30 minutes after the third, the publication and item end `failed`, and one review task with reason `publish_failed` is open.
3. Given an uncertain first attempt whose post appears on Instagram only during the 2-minute wait, when the retry time comes, then the pre-send check finds it and no second send happens.
4. Given a story send that times out after upload, when verification runs, then the new story is recognised because its identifier is not in `pre_story_pks`, and the publication becomes `published`.
5. Given a feed post with a five-character caption, then verification uses the time-window method and does not match a post already linked to another publication.
6. Given verification raises `SessionRequired`, then the result is `unknown`, nothing is sent, the publication stays `verifying` with `blocked_reason = session_problem`, and it is checked again after the connection is healthy.
7. Given `MediaRejected` on the first attempt, then the publication is `failed` at once with a review task, and `POST …/retry/` returns `409` with reason `version_rejected`.
8. Given a worker killed mid-send, when the lease expires, then the open attempt is closed as `ambiguous` with `lease_expired`, the publication goes to `verifying`, and it is not sent again unless verification finds nothing.
9. Given a failed publication, when the operator clicks Retry and the post is in fact live, then the publication becomes `published` without a send and the review task is resolved.
10. Given an account on the `manual` provider and a due publication, then the dispatcher never claims it, the calendar shows "Post by hand — due", and the tab offers the asset download and caption copy.
11. Given a manual reel publication, when `mark-published` is called with `https://www.instagram.com/reel/DC0aBcDeFgH/?igsh=x`, then the publication is `published` with `published_via = manual`, the stored permalink has no query string, `remote_media_code` is `DC0aBcDeFgH`, `remote_media_pk` is derived, and `next_metrics_checkpoint` is `1h`.
12. Given a link to another handle's story, a profile link, or a link already used, then `mark-published` returns `400` with the matching field code and nothing changes.
13. Given `mark-published` with `verify = true` on a connected account where the post is not listed, then the response is `200` with `verification.found = false` and the panel shows the warning.
14. Given a `publish_failed` review task resolved with `request_changes`, then `on_review_decision` cancels the publication, the slot is `reserved`, and the item moves `failed → needs_revision`; resolved with `reject`, the publication and item are `cancelled` and the slot is released; resolved with `approve` after a `fatal_error` on an unchanged version, the request fails with `409 invalid_transition` and `details.reason = "version_rejected"`.
15. Given a feed post marked published with `published_at` 50 hours ago, then `1h`, `6h` and `24h` are recorded `skipped` with reason `missed`, and `next_metrics_checkpoint` is `72h` at `published_at + 72 h`.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S04-BE1 | Verification service | `apps/publishing/services/verification.py`: window, fingerprint matching, story and time-window matching, exclusion of already-linked media, `unknown` handling, `verification.checks` log; unit tests with fake remote media lists | 0.75 d |
| E08-S04-BE2 | Retry state machine | `services/recovery.py::after_attempt`, `tasks.py::verify`, dispatcher branch for `verifying`, backoff schedule, final check, pre-send check inside the send task, failure transaction and review task creation or reuse | 0.75 d |
| E08-S04-BE3 | Expired-lease sweep | Dispatcher step for `publishing` and `verifying` rows with expired leases; closing the open attempt; tests that kill a send mid-way | 0.25 d |
| E08-S04-BE4 | Manual delivery and mark-published | Dispatcher exclusion and due-by-hand flag in serializers; permalink parser and normalizer per format; `media_pk_from_code` use; uniqueness check; optional verification; effects of rule 33; endpoint, `openapi.yaml`, API tests for every row of the error table | 0.75 d |
| E08-S04-BE5 | Retry endpoint and review hooks | `POST /publications/{id}/retry/` with gates, `version_rejected` rule, idempotency key, review-task resolution; `recovery.on_review_decision(task, decision)` called by E07-S06 for `approve`, `request_changes`, `reject` on `publish_failed` tasks (rule 17 table); back-dated metric hand-over of rule 34 | 0.25 d |
| E08-S04-BE6 | Failure-injection tests | Scenario tests with the fake provider: `timeout_after_publish`, `fail_n_times(3)`, `appears_late`, `story_timeout_after_publish`, `media_rejected`, `session_lost_during_verify`; assert provider call counts and final states | 0.25 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S04-FE1 | Post by hand and mark as published | `PostByHandCard` (downloads, caption copy, checklist, due state); `MarkPublishedModal` with validation, error texts and the not-found warning; calendar tags | 0.75 d |
| E08-S04-FE2 | Retry, verifying, failed | State alerts, failed `Result` card with actions, retry confirmation and error text, verification lines and new labels in the attempts timeline, calendar "Retry n of 3" and "Verifying" tags | 0.5 d |
| E08-S04-FE3 | Shared wiring | Extend the shared publication actions component and `src/services/publishing.ts` with `retry` and `markPublished`; conflict handling; unit tests for label maps | 0.25 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- The fake provider (E00-S04) must support these scenarios per account: publish succeeds but raises `AmbiguousResult`; publish fails N times with `TransientError` and posts nothing; the post becomes visible in `list_recent_media` only after a configurable delay; `list_active_stories` returning a controllable list; `MediaRejected`; `SessionRequired` on the next call. It keeps an in-memory "remote account" so tests can assert how many posts exist.
- Every scenario test asserts three things: final statuses, number of provider publish calls, number of remote posts. The second and third are the duplicate guard.
- Use a fixed clock and advance it between dispatcher runs to walk through the backoff schedule without sleeping.
- Permalink parser: a table test with valid and invalid links per format, including mobile share links with query strings, links with a username prefix, upper- and lower-case handles, and non-Instagram hosts.
- Panel tests: the post-by-hand card renders the right download buttons per format; the mark-as-published form maps each field code to its text; the failed card shows only allowed actions.

## Later

- Matching by media hash or duration when Instagram exposes enough to do so, to make caption-less verification stronger.
- An account-level circuit breaker: after N failed publications in a row, switch the account to manual delivery and raise one attention item.
- A "delete duplicate" action if a duplicate ever appears despite the guard.
- For the `graph_api` provider, verification maps to the container status and media list endpoints; `verification.py` only needs the provider's two list methods.
