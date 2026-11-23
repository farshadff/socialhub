# E08-S04 — Verify before retry and publish failures

> **Phase 2 — not built in Phase 1.** Phase 1 sends nothing to Instagram, so there is no uncertain send to verify and nothing to retry; the operator posts by hand and pastes the link ([E08-S05](S05-post-by-hand.md)). The manual-delivery rules that used to be here moved to E08-S05; in Phase 2 this story extends that route instead of defining it.

| | |
| --- | --- |
| Epic | E08 Schedule and post |
| Priority | Phase 2 |
| Estimate | BE 3 d · FE 1.5 d · QA 0 d |
| Depends on | E08-S03, E08-S02, E08-S05, E00-S04, E07-S06 |
| Needed by | E09-S01, E11-S01, E11-S03 |

## User story

As an operator, I want the system to check Instagram before it ever sends a post a second time, to tell me clearly when a post could not go out, and to let me post by hand when automation is not available, so that the account never shows a duplicate and a broken connection never stops the week.

## Context

The workflow says "Verify live posts before retrying". With Meta's container flow (see [INSTAGRAM-INTEGRATION.md](../../INSTAGRAM-INTEGRATION.md) section 5) the dangerous case is a `media_publish` call that times out: the post may be live although the worker saw an error, and publishing again would post it twice. The container makes the check reliable: E08-S03 stores its ID before waiting or publishing, and its `status_code` says whether it was published. Only when the container says `PUBLISHED` (or cannot be read) does the system look for the post in the account's recent media or active stories.

This story makes the rule absolute: no second publish and no new container without first reading the container and, where needed, the account. It also continues the slow-container waits that E08-S03 parks, defines the end of the road (a failed publication and a review task), and extends the manual route of E08-S05, where a person posts and tells the system, to failed publications and to a lookup of the posted media on Instagram.

## Scope

**In:**

- Verification built on the container: container status first, then the account's recent media or active stories.
- Continuing parked attempts while Instagram processes a container.
- The retry state machine: three counted sends, waits of 2 and 10 minutes between them, a last check 30 minutes after the third.
- Recovery of publications whose lease expired.
- Failure: publication and item `failed`, review task `publish_failed`.
- `POST /publications/{id}/retry/`.
- Extensions to E08-S05's manual route: when a publication switches to `delivery = manual`, mark-published for `failed` and `verifying` publications, and a lookup of the media ID by shortcode.
- Panel: why a publication is posted by hand, retry, verifying, processing and failed states.

**Out (later):**

- Deleting a duplicate post from the panel.
- Notifications outside the panel.
- Automatic switch of an account to the `manual` provider after repeated failures.

## Behaviour and rules

### Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `SOCIALHUB_PUBLISH_MAX_ATTEMPTS` | 3 | Counted sends per publication |
| `SOCIALHUB_PUBLISH_RETRY_BACKOFF_MINUTES` | `2,10,30` | Wait after the 1st, 2nd and 3rd counted attempt. The first two lead to another send; the third leads to a final check only |
| `SOCIALHUB_PUBLISH_VERIFY_SETTLE_SECONDS` | 30 | Pause before the first check after an uncertain send, so Instagram has time to update the container and list the post |
| `SOCIALHUB_PUBLISH_VERIFY_LOOKBACK_SECONDS` | 120 | How far before the attempt's start the search window opens |
| `SOCIALHUB_PUBLISH_LIVE_MATCH_MAX_MINUTES` | 30 | How long the lookup continues for a container that reads `PUBLISHED` while its post is not listed yet (rule 13a) |

The container wait settings (`SOCIALHUB_PUBLISH_CONTAINER_RECHECK_SECONDS`, `SOCIALHUB_PUBLISH_CONTAINER_MAX_WAIT_MINUTES`) are defined in E08-S03.

### The one rule

1. A publication that has a `PublishAttempt` row from the last 48 hours is never sent again (no `publish_container` call and no new container) until a verification has run after its latest attempt and found no live post. A container that reads `PUBLISHED` blocks every further send of the publication, including Retry. This holds for automatic retries, for recovery after a crash, and for the retry button. Continuing a parked attempt (E08-S03 rule 20) is not a second send: its container has never been published.

### Live verification

`publishing.services.verification.verify(publication)` returns one of:

| Result | Meaning | What follows |
| --- | --- | --- |
| `found(remote)` | The post is live and identified | Published (rule 12) |
| `live_unmatched` | The container reads `PUBLISHED`, but the post is not in the account's lists yet | Look again; never send (rule 13a) |
| `processing` | The container reads `IN_PROGRESS` | Wait for it (rule 11) |
| `not_found` | No post exists: the container reads `FINISHED` or `EXPIRED`, or it cannot be read and the lists show no match | Retry with backoff (rule 13) |
| `rejected(message)` | The container reads `ERROR` | Fatal (rule 9) |
| `unknown` | The check itself could not be done | Look again later; never send (rule 7) |

2. **Container first.** When the publication has a `remote_container_id`, read `container_status(token, remote_container_id)` and store the answer in `Publication.container_status`:
   - `FINISHED`: the publish did not happen. → `not_found`; the next send publishes the same container (E08-S03 rule 17). No list call is needed.
   - `IN_PROGRESS` → `processing`.
   - `PUBLISHED`: the post exists. Find its media ID with rules 3–6 → `found`, or `live_unmatched` when nothing matches.
   - `EXPIRED`: the container was not published within 24 hours. → `not_found`; the next send creates a new container.
   - `ERROR` → `rejected` with the container's `message`.
   - The container cannot be read (`NotFound`, or `TransientError` on this call), or the publication has no container: rules 3–6 alone decide. A match → `found`; none → `not_found`, and the next send creates a new container.
3. The search window opens at `first_attempt.started_at - 120 seconds`, where `first_attempt` is the publication's earliest `PublishAttempt` started within the last 48 hours. Using the earliest attempt, and not the latest, covers a post that came from any earlier send, including sends made before an operator pressed Retry. Attempts older than 48 hours belong to an earlier scheduling of the item and are ignored.
4. **Feed posts and reels with a fingerprint.** Call `list_recent_media(token, since=window_start, limit=25)`. A remote item matches when all are true:
   - its `product_type` matches the format (`feed_post` → `feed` with `media_kind = image`; `reel` → `reels`);
   - `caption_fingerprint(remote.caption)` equals `Publication.caption_fingerprint`;
   - `remote.timestamp >= window_start`.

   If several match, the earliest is taken and the check records how many candidates there were.
5. **Stories, and feed posts or reels whose fingerprint is empty** (caption shorter than 10 normalized characters). There is no caption to match, so the check uses the product type and the time window:
   - Stories: call `list_active_stories(token)`. Candidates are items whose `id` is not in the `verification.pre_story_ids` of the first attempt of rule 3 (E08-S03 rule 15; the stories that were live before any send), whose `media_kind` matches the version's media kind, and whose `timestamp` lies between `window_start` and now.
   - Feed posts and reels without a fingerprint: call `list_recent_media` as in rule 4; candidates are items of the matching product type with `timestamp` in the window.
   - Exactly one candidate → match. More than one → the earliest, with the candidate count recorded. None → no match.
6. A candidate whose `id` is already the `remote_media_id` of another publication of the account is never matched.
7. **Unknown.** If verification raises `TokenInvalid`, `PermissionMissing` or `RateLimited`, or a `TransientError` on a list call, the result is `unknown`. An `unknown` result never leads to a send. The publication stays `verifying` and `next_attempt_at` is set to 5 minutes later (or the rate limit's `retry_after_seconds` if longer). For `TokenInvalid` and `PermissionMissing`, `report_connection_error(account, error)` updates the connection and `blocked_reason = connection_problem` is set. While the account's connection fails E08-S03 gate 2, the dispatcher does not enqueue verification for it; the next verification after the connection is healthy clears `blocked_reason`.
8. Every verification writes what it did into the latest attempt's `verification` JSON, one check per provider call:

```json
{
  "checks": [
    {
      "at": "2026-11-23T15:30:51Z",
      "method": "container_status",
      "container_status": "PUBLISHED",
      "result": "published"
    },
    {
      "at": "2026-11-23T15:30:52Z",
      "method": "media_list",
      "window_start": "2026-11-23T15:28:04Z",
      "listed": 4,
      "candidates": 0,
      "result": "not_found"
    },
    {
      "at": "2026-11-23T15:31:53Z",
      "method": "container_status",
      "container_status": "PUBLISHED",
      "result": "published"
    },
    {
      "at": "2026-11-23T15:31:54Z",
      "method": "media_list",
      "window_start": "2026-11-23T15:28:04Z",
      "listed": 5,
      "candidates": 1,
      "result": "found",
      "remote_media_id": "18052233445566778",
      "remote_shortcode": "DC0aBcDeFgH",
      "timestamp": "2026-11-23T15:30:19Z"
    }
  ]
}
```

`method` is `container_status`, `media_list` or `active_stories`. A container check carries `container_status` and a `result` of `not_found` (`FINISHED` or `EXPIRED`), `processing`, `published`, `rejected` or `unreadable`. A list check carries `window_start`, `listed`, `candidates` and a `result` of `found` or `not_found`, plus `remote_media_id`, `remote_shortcode` and `timestamp` on a match. Story attempts also keep `pre_story_ids` from E08-S03.

### After an attempt

`publishing.services.recovery.after_attempt(publication, attempt)` is called by the send task for the counted error rows of E08-S03 rule 25.

9. **Fatal** (`fatal_error`, or a verification that returns `rejected`): go to failure (rule 15). A `rejected` result first changes the latest attempt to `outcome = fatal_error`, `error_code = "media_rejected"`, `error_message` = the container's message. No retry: Instagram answered and said no.
10. **Ambiguous or transient** (`ambiguous`, or `retryable_error` with `transient_error`): the publication moves to `status = verifying`, the lease is cleared, `next_attempt_at = now + 30 seconds`, and the item stays `publishing`. A transient error is treated like an ambiguous one on purpose: the container read that follows is one cheap call, and the adapter's judgement that "nothing was published" is not trusted with a duplicate at stake.

    **Container timeout** (`retryable_error` with `container_timeout`, E08-S03 rule 20): go to failure (rule 15) at once. A second container must not be created while the first is still processing, so there is nothing to retry automatically.

### The verify task

`publishing.verify(publication_id)` runs on the `publish` queue. The dispatcher enqueues it for every publication with `status = verifying`, `next_attempt_at <= now` and no active lease, unless the account's connection fails E08-S03 gate 2. It takes a 240-second lease and opens `account_session(account, wait_seconds=60)`, which yields `(provider, token)`; `AccountBusy` releases the lease with `next_attempt_at = now + 1 minute`. A `JobRun` of kind `publish.verify` tracks it and is the item's `active_job` while it runs.

11. **Parked attempts and processing containers.** When the latest attempt is still open (parked by E08-S03 rule 20), the task reads the container and acts on its status:
    - `FINISHED` → `sending.continue_attempt(publication)` publishes the container and reads the post back inside this task's lease and lock (E08-S03 rules 21–24).
    - `IN_PROGRESS` → `next_attempt_at = now + SOCIALHUB_PUBLISH_CONTAINER_RECHECK_SECONDS` (60), until the container is older than `SOCIALHUB_PUBLISH_CONTAINER_MAX_WAIT_MINUTES` (15). Then the attempt closes as `retryable_error` with `container_timeout` (counted) and rule 10 sends the publication to failure.
    - `PUBLISHED` (a verify task stopped after publishing) → the attempt closes as `ambiguous` and rule 2 applies: `found` or `live_unmatched`.
    - `ERROR` → rule 9.
    - Unreadable → `unknown` (rule 7); the attempt stays open.

    After a closed (uncertain) attempt, `processing` is handled the same way: recheck every minute up to the same 15-minute limit, then failure. When the container then reads `FINISHED`, the result is `not_found` (rule 13), because the attempt's own send is over.
12. **Found** → the publication is published: `status = published`, `container_status = PUBLISHED` when a container exists, `remote_media_id`, `remote_shortcode`, `permalink` and `published_at = remote.timestamp` from the match, `published_via = provider`; the latest attempt's `outcome` is changed to `verified_live`; slot and item become `published`; the metric hand-over of E08-S03 rule 24 is applied; a `ContentEvent` of type `publish_attempt` says "Found live on Instagram after an uncertain send". Active stories return only ID, media type and time, so for a story match `get_media(token, remote.id)` fills `permalink` (and `remote_shortcode` when Instagram returns one).

    **Known media ID.** When E08-S03 rule 22 left the publication `verifying` with `remote_media_id` set (published, read-back failed), the whole check is `get_media(token, remote_media_id)`: success → the effects above, with the attempt left at `success`; `NotFound` → failure (rule 15) with detail "Instagram returned a media ID, but the post cannot be read. Check the profile."; any other error → `unknown` (rule 7).
13. **Not found:**
    - `attempt_count < 3` → wait, then send again: `status = scheduled`, `next_attempt_at = latest_attempt.finished_at + backoff[attempt_count]` (2 minutes after the first counted attempt, 10 after the second), item `publishing → scheduled`. When that time comes the dispatcher treats it like any due publication, with the pre-send check of rule 14. The next send reuses a `FINISHED` container and creates a new one only after `EXPIRED` or when none could be read.
    - `attempt_count = 3`: if the final check has not been done, stay `verifying`, `next_attempt_at = latest_attempt.finished_at + 30 minutes`, and mark `verification.final_check_pending = true`. If this was the final check, go to failure (rule 15).

13a. **Live but not matched** (`live_unmatched`) → stay `verifying`, `next_attempt_at = now + 60 seconds`. Nothing is ever sent again. When `SOCIALHUB_PUBLISH_LIVE_MATCH_MAX_MINUTES` (30) have passed since the latest attempt finished, go to failure (rule 15) with the detail "Instagram reports the post as published, but it does not appear in the account's media yet. Find it on the profile and use Mark as published."

14. **Pre-send check.** In the send task (E08-S03 rule 13), when the publication has an attempt from the last 48 hours, `verify` runs first, inside the same lease and lock, before the quota read, any container or any publish:
    - `found` → rule 12; nothing is sent.
    - `not_found` → the send proceeds: it reuses a `FINISHED` container, otherwise creates a new one.
    - `processing` → the send proceeds with the same container: after the quota read and the new attempt row (E08-S03 rules 14–15) it goes straight to the wait step (E08-S03 rule 19); no new container is created.
    - `rejected` → rule 9.
    - `live_unmatched` or `unknown` → the claim is released back to `verifying` (rules 13a and 7) without a new attempt row.

    This is the last line of defence when a post appeared on Instagram during the wait.

14a. Uncounted interruptions (connection problem, rate limit, quota, manual switch: the rows marked "No" in E08-S03 rule 25) do not enter this flow; Instagram refused the call explicitly, so nothing was published. The pre-send check still runs on the next try because an attempt row exists, and it is what finds a `FINISHED` container to reuse.

### Failure

15. Failure, in one transaction: `Publication.status = failed`, lease and `next_attempt_at` cleared; slot stays `scheduled` (the operator decides); item `publishing → failed` through the pipeline service with `hold_reason` set to the short reason; `active_job` cleared; a `ReviewTask` is created with `reason = publish_failed`, `publication` set, and `detail` built from the attempts:
    - Uncertain sends: "3 attempts. Last error: no answer from Instagram while publishing (ambiguous). 30 minutes after the last attempt the container was still unpublished and the post was not on the account. Check the profile before retrying."
    - Fatal: "Instagram rejected the media: {error_message}. The version needs to change before it can be sent."
    - Container timeout: "Instagram was still processing the {video} 15 minutes after it was handed over. Retry later, request a new render, or post it by hand."
    - Live but not matched, and known media ID not readable: the texts in rules 13a and 12.
16. An open `publish_failed` review task for the same publication is reused, not duplicated.
17. Resolving a `publish_failed` review task (E07-S06) calls `publishing.services.recovery.on_review_decision(task, decision)`, which runs in the resolve transaction and is the only place these decisions touch publishing:

    | Decision | Publication | Slot | Item |
    | --- | --- | --- | --- |
    | `approve` | The retry service of rule 19, including its refusals: a `fatal_error` with an unchanged version raises `invalid_transition` with `details.reason = "version_rejected"` (rule 21), and a container that reads `PUBLISHED` raises `details.reason = "already_live"` (rule 21a), so the reviewer must request changes or post by hand | Unchanged (`scheduled`) | `failed → scheduled` |
    | `request_changes` | `withdraw` (E08-S01 rule 21): `cancelled` | Back to `reserved`; the item keeps it | `failed → needs_revision`; the revise flow (E07-S05) uses the reviewer's instructions. When the new version passes, E08-S01 rule 4 reuses this publication row with the container fields cleared |
    | `reject` | `withdraw`: `cancelled` | Released by the E03-S04 cancel rule (`open` if in the future, otherwise `skipped`) | `failed → cancelled` |

    The hook never resolves the task itself; E07-S06 does that after the hook returns.

### Expired leases

18. Each dispatcher run also looks for publications in `publishing` or `verifying` whose `lease_expires_at` is in the past:
    - `publishing`: the worker died or hung mid-send. The open attempt is closed with `outcome = ambiguous`, `error_code = "lease_expired"`, `finished_at = lease_expires_at`; `attempt_count += 1`; then rule 10 applies. It is never re-enqueued for sending directly. The container, if one was stored, tells verification whether the publish happened.
    - `verifying`: the verify task died. The lease is cleared and `next_attempt_at = now`; the next run enqueues verification again. A parked attempt stays open, and rule 11 picks it up, including the case where the task died right after publishing.

### Retry

19. `POST /publications/{id}/retry/` is allowed when `status = failed`. It sets `status = scheduled`, `attempt_count = 0`, `scheduled_at = now`, `next_attempt_at = now`, clears `blocked_reason`, keeps `remote_container_id` (the pre-send check decides whether it can be reused), moves the item `failed → scheduled`, resolves the open `publish_failed` review task with `decision = approve` and `decision_note = "Retried by {user}"`, and triggers the dispatcher once.
20. Because recent attempt rows exist, rule 14 verifies before sending. If the post is found, the publication simply becomes `published`; if the container is still `FINISHED`, the same container is published.
21. A publication whose last attempt was `fatal_error` and whose content version has not changed returns `409 invalid_transition` with `details.reason = "version_rejected"`: sending the same rejected file again is pointless. The operator must request changes or post by hand.

21a. A publication whose `container_status` is `PUBLISHED` returns `409 invalid_transition` with `details.reason = "already_live"`: the post exists, and the operator should use Mark as published.

22. The stop switch and connection are checked as in publish-now (E08-S03 rule 28) and return the same errors: `409 publishing_disabled`, `409 instagram_not_connected` or `409 instagram_permission_missing`.
23. `Idempotency-Key` is honoured.

### Manual route (extends E08-S05)

E08-S05 defines the posting pack, the due and overdue flags, the accepted link formats and `POST /publications/{id}/mark-published/` for `scheduled` publications. This story extends that route and does not define it again. What used to be here as rules 25 and 28–31 (due by hand, link formats and normalisation, uniqueness, `published_at` limits) is now E08-S05 rules 4–13.

24. A publication has `delivery = manual` when the account's connection provider is `manual`; when the capability for the format is false, because the connection was not granted `instagram_business_content_publish` or `SOCIALHUB_IG_CAPABILITY_OVERRIDES` turns it off (E08-S01 Later, E08-S03 gate 3); or when the provider answered `NotSupported` at send time (E08-S03 rule 25). The dispatcher never claims it. It keeps `status = scheduled`, no new attempts are created, and from then on it follows E08-S05.
25. Moved to E08-S05 rules 4–8 (due and overdue).
26. The stop switch does not apply to manual delivery: a person is posting, the system sends nothing.
27. In Phase 2 `mark-published` is also allowed for `status` `failed`, or `verifying` without an active lease, for either delivery mode (an operator may post by hand after a failure, or finish a post that Instagram reports as live but the lookup could not match). `allowed_actions` lists `mark_published` in those states. A publication being sent or verified returns `409 job_in_progress`.
28. Moved to E08-S05 rules 10–13 (link formats, normalisation, uniqueness, `published_at` limits); rules 29–31 are retired with it. The Graph API media ID cannot be derived from the link, so `remote_media_id` is filled only by the lookup of rule 32.
32. `verify` is an optional request field, default `true`. When true, the connection is `connected` or `expiring`, and its provider is `graph_api` or `fake`, the service looks the post up under `account_session(account, wait_seconds=10)`:
    - Feed posts and reels: `list_recent_media(token, since=published_at - 24 hours, limit=50)`; the match is the item whose `shortcode` equals the link's code.
    - Stories: `list_active_stories(token)`; the match is the only story of the version's media kind whose `timestamp` is within 30 minutes of `published_at` and whose `id` is not linked to another publication.

    A match sets `remote_media_id`, replaces `published_at` with the real `timestamp`, and takes `permalink` from Instagram when present. No match leaves `remote_media_id` null: the operator's statement stands, and the response says `found: false` so the panel can warn. Without a media ID, provider metric collection (E09-S01) has nothing to read, and the post's metrics are entered by hand (E09-S03, E09-S04). `AccountBusy` or any provider error makes the lookup `checked: false` without failing the request; `TokenInvalid` and `PermissionMissing` also go to `report_connection_error`.
33. Effects, in addition to those of E08-S05 rule 14: `blocked_reason`, `next_attempt_at` and lease cleared; the item may also move from `failed` or `publishing`; an open `publish_failed` review task is resolved with `decision = approve` and note "Marked as published by {user}"; an open parked attempt is closed with `outcome = verified_live`. No `PublishAttempt` row is written.
34. **Metric hand-over when the lookup found the media ID.** Provider collection then applies, so E09-S01's rules replace the E09-S04 pointer of E08-S05 rule 14. `published_at` may lie up to 7 days before `scheduled_at` (E08-S05 rule 13), so some checkpoints of the format may already have passed. The hand-over applies E09-S01's rules at once instead of leaving them for the collector: every non-final checkpoint already past its skip age (E09-S01 rule 2) gets a `MetricSnapshot` row with `status = skipped`, `skip_reason = missed`; `next_metrics_checkpoint` is the first remaining checkpoint and `next_metrics_at = max(now, published_at + its age)`. When only the final checkpoint remains and it is already due, `next_metrics_at = now`, so the collector captures it on its next cycle (E09-S01 rule 3) or records `gave_up` if the give-up age has passed. No pointer is ever left in the past, so the overview raises no `metrics_sync_gap` for a back-dated post. A post marked published at the current time simply gets the first checkpoint (`1h`).

## Data

`Publication`, `PublishAttempt`, `ReviewTask`, `ContentItem`, `PlanSlot`, `ContentEvent` as in [DATA-MODEL.md](../../DATA-MODEL.md). `Publication.delivery` from E08-S01; `remote_container_id`, `container_status`, `remote_media_id`, `remote_shortcode` as written by E08-S03. `JobRun` kind `publish.verify`.

`PublishAttempt.verification` shape is the JSON in rule 8, plus `pre_story_ids` on story attempts and `final_check_pending` (bool) on the third attempt.

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
  "remote_container_id": "17970011223344556",
  "container_status": "FINISHED",
  "allowed_actions": ["reschedule", "cancel", "publish_now", "mark_published"],
  "attempts": [
    {"id": 70, "number": 1, "provider": "graph_api", "started_at": "2026-11-24T08:00:05Z", "finished_at": "2026-11-24T08:00:38Z", "outcome": "ambiguous", "error_code": "timeout", "error_message": "No answer from Instagram while publishing", "verification": {"checks": [{"at": "2026-11-24T08:01:09Z", "method": "container_status", "container_status": "FINISHED", "result": "not_found"}]}},
    {"id": 71, "number": 2, "provider": "graph_api", "started_at": "2026-11-24T08:02:40Z", "finished_at": "2026-11-24T08:02:58Z", "outcome": "ambiguous", "error_code": "timeout", "error_message": "No answer from Instagram while publishing", "verification": {"checks": [{"at": "2026-11-24T08:03:29Z", "method": "container_status", "container_status": "FINISHED", "result": "not_found"}]}},
    {"id": 72, "number": 3, "provider": "graph_api", "started_at": "2026-11-24T08:13:00Z", "finished_at": "2026-11-24T08:13:18Z", "outcome": "ambiguous", "error_code": "timeout", "error_message": "No answer from Instagram while publishing", "verification": {"final_check_pending": false, "checks": [{"at": "2026-11-24T08:13:49Z", "method": "container_status", "container_status": "FINISHED", "result": "not_found"}, {"at": "2026-11-24T08:43:20Z", "method": "container_status", "container_status": "FINISHED", "result": "not_found"}]}}
  ],
  "…": "remaining fields as in GET /publications/{id}/"
}
```

| Case | Response |
| --- | --- |
| Status is not `failed` | `409 invalid_transition`, `details: {"status", "allowed_actions"}` |
| Last attempt was fatal and the version is unchanged | `409 invalid_transition`, `details.reason = "version_rejected"` |
| The container reads `PUBLISHED` | `409 invalid_transition`, `details.reason = "already_live"` |
| Stop switch off | `409 publishing_disabled` |
| Connection not usable | `409 instagram_not_connected` |
| Connection lacks a permission | `409 instagram_permission_missing` |
| Not found | `404 not_found` |

### `POST /publications/{id}/mark-published/` — Phase 2 additions

The endpoint, its request, its validation and its errors are defined in E08-S05. Phase 2 adds the optional `verify` field (rule 32), the `failed` and `verifying` starting states (rule 27), and a `verification` object in the response. Request:

```json
{
  "permalink": "https://www.instagram.com/reel/DC0aBcDeFgH/?igsh=abc123",
  "published_at": "2026-11-23T15:41:00Z",
  "verify": true
}
```

Response `200`: the publication object of E08-S05 with `remote_media_id` filled by the lookup and the added `verification` object:

```json
{
  "id": 31,
  "status": "published",
  "delivery": "manual",
  "published_via": "manual",
  "permalink": "https://www.instagram.com/reel/DC0aBcDeFgH/",
  "remote_shortcode": "DC0aBcDeFgH",
  "remote_media_id": "18052233445566778",
  "published_at": "2026-11-23T15:40:12Z",
  "next_metrics_checkpoint": "1h",
  "next_metrics_at": "2026-11-23T16:40:12Z",
  "allowed_actions": [],
  "verification": {"checked": true, "found": true, "remote_media_id": "18052233445566778", "timestamp": "2026-11-23T15:40:12Z"},
  "…": "remaining fields as in GET /publications/{id}/"
}
```

When the lookup could not be made (manual provider, connection not usable, account busy, provider error): `"verification": {"checked": false, "found": null, "remote_media_id": null, "timestamp": null}`. When it ran without a match: `"verification": {"checked": true, "found": false, "remote_media_id": null, "timestamp": null}`.

| Case | Response |
| --- | --- |
| Validation errors on `permalink` and `published_at` | As in E08-S05 |
| Being sent or verified right now | `409 job_in_progress`, `details.job` |
| Already published or cancelled | `409 invalid_transition` |

## Background work

| Task | Queue | Trigger | Idempotency | Retries |
| --- | --- | --- | --- | --- |
| `publishing.verify` | `publish` | Dispatcher, for `verifying` publications that are due and whose connection passes gate 2 | 240-second lease; conditional writes on lease owner; results written to the attempt's `verification.checks`; `continue_attempt` publishes only a container whose attempt is still open | `unknown` results reschedule themselves 5 minutes later; container waits and unmatched live posts recheck every minute; no Celery auto-retry |
| Expired-lease sweep | `publish` | Part of `publishing.dispatch_due`, every minute | Conditional update on `lease_expires_at < now` | — |

Timeline of the worst case for one publication, with defaults:

```text
T+0      attempt 1 (publish uncertain) → container read at +30 s → FINISHED → not found
T+2 min  pre-send check → FINISHED → attempt 2 publishes the same container (uncertain) → FINISHED
T+12 min pre-send check → FINISHED → attempt 3 (uncertain) → FINISHED
T+42 min final check → FINISHED → failed + review task
```

(Times are measured from the end of each attempt, so real elapsed time is longer by the attempts' own duration. One container serves all three attempts unless it expires or cannot be read.)

## AI

None.

## Panel

Additions to the Publishing tab of `/content/:id`, the calendar drawer and the calendar cards.

### Post by hand (additions to E08-S05's card)

The card itself (downloads, caption, checklist, due and overdue alerts) and the calendar flags are defined in E08-S05 and E08-S02. In Phase 2 the card's alert also says why the publication is posted by hand (the panel reads the account's connection from `GET /accounts/{id}/connection/`):

- Connection provider `manual`: "This account is posted by hand. Post the file below on Instagram, then paste the link here."
- A publish capability is false: "Instagram has not given Social Hub permission to publish {format}s for this account, so this one is posted by hand. Post the file below, then paste the link here." Admins also see a link "Check the connection" to Settings → Connection.

### Mark as published (additions to E08-S05's dialog)

The dialog, its fields and its error texts are defined in E08-S05. In Phase 2 it is also reachable from a failed publication ("I posted it myself") and from a `verifying` publication whose container reads `PUBLISHED`. After success, when the response has `verification.checked = true` and `found = false`, a `notification.warning`: "Saved, but the post was not found on the account. Metrics for it will need to be entered by hand."

### Retrying, verifying, processing and failed

| Publication state | Tab and drawer | Calendar card |
| --- | --- | --- |
| `scheduled` with `attempt_count > 0` | Info alert: "Attempt {n} did not go through. Instagram will be checked and the post retried at {next_attempt_at}." | Tag "Retry {n+1} of 3" |
| `verifying` with an open latest attempt and `container_status = IN_PROGRESS` | Info alert: "Instagram is processing the {video}. It is published as soon as Instagram finishes (checked every minute)." | Spinner, tag "Processing" |
| `verifying` with `container_status = PUBLISHED` | Info alert: "The post is live on Instagram. Reading its link." with a link button "I have the link" that opens Mark as published | Spinner, tag "Verifying" |
| `verifying`, other cases | Info alert: "Checking Instagram for this post before trying again." With `final_check_pending`: "Last check at {next_attempt_at}." `JobProgress` when a verify job is active | Spinner, tag "Verifying" |
| `failed` | Error `Result` card: title "Could not publish", the review task's `detail`, buttons "Retry" (when `retry` is allowed), "Mark as published", "Open review task" (to `/review/:taskId`), "Cancel publication" | `StatusTag` Failed |
| `published` with the latest attempt `verified_live` | Timeline entry "Attempt {n} — Found live after an uncertain send" in green | — |

`blocked_reason = connection_problem` on a `verifying` publication adds the line "Waiting for the Instagram connection to be fixed." to its alert.

**Retry** (`Modal.confirm`, title "Retry publishing?"): body "Instagram is checked first. If the post is already live, nothing is sent." Confirm "Retry". Error texts: `version_rejected` → "Instagram rejected this file. Request changes in the review task, or post it by hand."; `already_live` → "Instagram reports this post as already published. Find it on the profile and use Mark as published."

Timeline labels added to the map of E08-S03: `ambiguous` + `timeout` → "No answer from Instagram"; `ambiguous` + `transient_error` → "Instagram error while publishing"; `ambiguous` + `lease_expired` → "Worker stopped during the send"; `retryable_error` + `transient_error` → "Temporary error"; `verified_live` → "Found live after an uncertain send". Each attempt's verification checks are listed under it in small text: "Checked 15:30 — container finished, not published", "Checked 15:31 — container published, post found".

## Acceptance criteria

1. Given the fake scenario `timeout_after_publish`, when the send finishes, then the first verification reads the container as `PUBLISHED`, finds the post in the media list, the publication becomes `published`, the attempt outcome is `verified_live`, `publish_container` was called once, and the remote account has one post.
2. Given the scenario `timeout_before_publish`, then the verification reads `FINISHED`, the second attempt 2 minutes later publishes the same container (`create_container` called once, `publish_container` twice), and the remote account has one post.
3. Given `fail_n_times(3)` on `publish_container`, then sends happen at about 0, +2 and +10 minutes with one container, a final check runs 30 minutes after the third, the publication and item end `failed`, and one review task with reason `publish_failed` is open.
4. Given the scenario `appears_late` with `delay_seconds` 150, then verification reads `PUBLISHED` but finds nothing at first (`live_unmatched`), nothing is sent again, a later check finds the post, and the publication becomes `published`.
5. Given the scenario `story_timeout_after_publish`, when verification runs, then the new story is recognised in `list_active_stories` because its ID is not in `pre_story_ids` and its timestamp is in the window, and the publication becomes `published` with a permalink from `get_media`.
6. Given a feed post with a five-character caption whose container cannot be read, then verification matches by product type and time window and does not match a post already linked to another publication.
7. Given verification raises `TokenInvalid`, then the result is `unknown`, nothing is sent, the connection is `needs_attention`, the publication stays `verifying` with `blocked_reason = connection_problem`, no verification is enqueued until the account is reconnected, and the next one after reconnecting clears the reason.
8. Given `media_rejected` (container `ERROR`) on the first attempt, then the publication is `failed` at once with a review task naming Instagram's message, and `POST …/retry/` returns `409` with reason `version_rejected`.
9. Given a worker killed mid-send after `publish_container` was called, when the lease expires, then the open attempt is closed as `ambiguous` with `lease_expired`, the publication goes to `verifying`, and it is not sent again unless the container reads `FINISHED` or `EXPIRED`.
10. Given a failed publication whose container is `FINISHED`, when the operator clicks Retry, then the pre-send check runs, the same container is published once, the publication becomes `published`, and the review task is resolved.
11. Given `container_expired` on the pre-send check, then a new container is created and published, and the remote account has one post.
12. Given a parked reel whose container stays `IN_PROGRESS` for 16 minutes (`container_slow`), then the attempt closes with `container_timeout`, the publication is `failed` with the container-timeout detail, and no second container was created.
13. Given an account on the `manual` provider and a due publication, then the dispatcher never claims it, the calendar shows "Post by hand — due", and the tab offers the asset download and caption copy; given a `graph_api` account whose `publish_story` capability is false, then a story publication shows the permission text instead.
14. Given a manual reel publication on a connected `graph_api` account, when `mark-published` is called with `https://www.instagram.com/reel/DC0aBcDeFgH/?igsh=x` and the post is in the recent media, then the publication is `published` with `published_via = manual`, the stored permalink has no query string, `remote_shortcode` is `DC0aBcDeFgH`, `remote_media_id` comes from the media list, `published_at` is Instagram's timestamp, and `next_metrics_checkpoint` is `1h`.
15. Moved to E08-S05 (acceptance criteria 8–10).
16. Given `mark-published` with `verify = true` on a connected account where the shortcode is not listed, then the response is `200` with `verification.found = false`, `remote_media_id` stays null, and the panel shows the warning.
17. Given a `publish_failed` review task resolved with `request_changes`, then `on_review_decision` cancels the publication, the slot is `reserved`, and the item moves `failed → needs_revision`; resolved with `reject`, the publication and item are `cancelled` and the slot is released; resolved with `approve` after a `fatal_error` on an unchanged version, the request fails with `409 invalid_transition` and `details.reason = "version_rejected"`.
18. Given a feed post marked published with `published_at` 50 hours ago, then `1h`, `6h` and `24h` are recorded `skipped` with reason `missed`, and `next_metrics_checkpoint` is `72h` at `published_at + 72 h`.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S04-BE1 | Verification service | `apps/publishing/services/verification.py`: container-first reading with the six results, window, fingerprint matching on `list_recent_media`, story matching on `list_active_stories` with `pre_story_ids`, time-window matching, exclusion of already-linked media, `unknown` handling, `verification.checks` log; unit tests with fake containers and media lists | 0.75 d |
| E08-S04-BE2 | Retry state machine | `services/recovery.py::after_attempt`, `tasks.py::verify` with parked attempts and `continue_attempt`, container wait limit, live-unmatched lookup, known-media-ID read-back, dispatcher branch for `verifying` with the connection check, backoff schedule, final check, pre-send check inside the send task, failure transaction and review task creation or reuse | 0.75 d |
| E08-S04-BE3 | Expired-lease sweep | Dispatcher step for `publishing` and `verifying` rows with expired leases; closing the open attempt; tests that kill a send before and after `publish_container` | 0.25 d |
| E08-S04-BE4 | Manual-route extensions | Dispatcher exclusion of `delivery = manual`; `mark-published` from `failed` and `verifying` (rule 27, `allowed_actions`, `job_in_progress`); media ID lookup by shortcode through `list_recent_media` and by time through `list_active_stories` with the `verify` flag and the `verification` response (rule 32); effects of rule 33; `openapi.yaml`; API tests. The base endpoint, link parser and uniqueness are E08-S05 | 0.75 d |
| E08-S04-BE5 | Retry endpoint and review hooks | `POST /publications/{id}/retry/` with gates, `version_rejected` and `already_live` rules, idempotency key, review-task resolution; `recovery.on_review_decision(task, decision)` called by E07-S06 for `approve`, `request_changes`, `reject` on `publish_failed` tasks (rule 17 table); back-dated metric hand-over of rule 34 | 0.25 d |
| E08-S04-BE6 | Failure-injection tests | Scenario tests with the fake provider: `timeout_after_publish`, `timeout_before_publish`, `fail_n_times(3)`, `appears_late`, `story_timeout_after_publish`, `media_rejected`, `container_expired`, `container_slow`, and `token_invalid` scripted on `container_status` during verification; assert container counts, publish counts and final states | 0.25 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S04-FE1 | Manual-route additions | Reason text by provider or capability on E08-S05's `PostingPackCard` with the admin link; "I posted it myself" on the failed card and "I have the link" on a verifying publication, both opening E08-S05's `MarkPublishedModal`; the not-found warning after a lookup; tests | 0.75 d |
| E08-S04-FE2 | Retry, verifying, processing, failed | State alerts including processing and live-but-unmatched, failed `Result` card with actions, retry confirmation and error texts, verification lines and new labels in the attempts timeline, calendar "Retry n of 3", "Processing" and "Verifying" tags | 0.5 d |
| E08-S04-FE3 | Shared wiring | Extend the shared publication actions component and `src/services/publishing.ts` with `retry` and `markPublished`; conflict handling; unit tests for label maps | 0.25 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- The fake provider (E00-S04) keeps an in-memory remote account per account (containers with their status, posts, active stories, call counts), so tests can assert how many containers and posts exist. Scenarios used: `timeout_after_publish` (container `PUBLISHED`, `AmbiguousResult`), `timeout_before_publish` (container still `FINISHED`, `AmbiguousResult`), `story_timeout_after_publish`, `fail_n_times(n)`, `appears_late` (`delay_seconds`), `container_slow` (`delay_seconds`), `container_expired`, `media_rejected`, `token_invalid`; `FakeProvider.script([...])` scripts a single method, for example `TokenInvalid` from `container_status` during one verification.
- Every scenario test asserts four things: final statuses, number of `create_container` calls, number of `publish_container` calls, number of remote posts. The last three are the duplicate guard.
- Use a fixed clock and advance it between dispatcher runs to walk through the backoff schedule, container waits and the 30-minute lookup without sleeping.
- Permalink parser tests moved to E08-S05.
- Mark-published lookup: a shortcode on the second page of recent media is not found with `limit=50` and returns `found: false`; a story within 30 minutes is found; two stories within 30 minutes give `found: false`.
- Panel tests: the post-by-hand card shows the right reason text; the failed card shows only allowed actions; the processing alert appears only for a parked attempt.

## Later

- An account-level circuit breaker: after N failed publications in a row, switch the account to manual delivery and raise one attention item.
- A "delete duplicate" action if a duplicate ever appears despite the guard.
- If Meta exposes the media ID on a published container, the list lookup of rules 4–5 becomes one direct read; `verification.py` is the only place to change.
- Resolving a missing `remote_media_id` later (for example when a manual story was marked before Instagram listed it), so provider metrics can start without manual entry.
