# E00-S04 — Connect an Instagram account (provider layer and spike)

| | |
| --- | --- |
| Epic | E00 Foundation |
| Priority | Must |
| Estimate | BE 4 d · FE 1.5 d · QA 0 d |
| Depends on | E00-S03 (account and connection rows), E00-S06 (jobs, `JobButton`, `JobProgress`). The spike (BE1) depends on nothing and starts on day 1 |
| Needed by | E02-S03 (public Instagram signals), E08-S03 and E08-S04 (publishing), E09-S01 and E09-S02 (metrics and followers) |

## User story

As an admin, I want to connect an Instagram account to Social Hub once and see whether the connection is healthy and what it can do, so that publishing and analytics can run without anyone logging in again.

## Context

The product talks to Instagram through one interface, `InstagramProvider`, described in [INSTAGRAM-INTEGRATION.md](../../INSTAGRAM-INTEGRATION.md). The default implementation uses the unofficial `instagrapi` library, as requested. That choice carries the largest risk in the roadmap, so this story begins with a time-boxed spike on a throwaway account and only then builds the production layer.

This story delivers the provider layer, the session store and the connection flow (login, challenge, verify, disconnect). The publishing methods of the `instagrapi` adapter are implemented in E08-S03, insights in E09-S01 and research in E02-S03, each starting from the calls the spike proved. The `fake` provider implements the whole interface here, so those stories can be built and tested before the real adapter methods exist.

The current `backend/config/settings.py` refuses to start unless the publisher is `disabled`. This story replaces that guard.

## Scope

**In**

- Spike: script, capability checklist, written report with a go or no-go per capability.
- `apps/instagram`: interface, result types, errors, provider registry; `fake` (complete), `manual` (complete), `graph_api` (stub), `instagrapi` (`login`, challenge, `verify`).
- Encrypted session storage, per-account proxy, one-request-at-a-time lock, request pacing.
- Connection endpoints and their background jobs; daily verification.
- Panel: the Connection tab on the account page.

**Out (later)**

- `instagrapi` publishing, insights and research methods (E08-S03, E09-S01, E02-S03).
- The research account's session (E02-S03 uses the same encryption helpers).
- The real `graph_api` adapter and its OAuth flow.
- Storing Instagram passwords, automatic re-login, automatic challenge solving.

## Behaviour and rules

### Spike (week 1)

1. **Setup.** A throwaway Instagram account, switched to a professional (creator or business) account so insights exist, and a second throwaway account for research. One fixed proxy if the pilot will use one. The script runs outside the web app: `python manage.py ig_spike <step>` in `apps/instagram/management/commands/ig_spike.py`, reading credentials from environment variables. Nothing from the spike account is committed.
2. **Library pin.** Choose one `instagrapi` release, pin it in `backend/pyproject.toml` and the lock file, and record the exact method names used for each step. Every later story uses those names.
3. **Checklist.** Each row is run and recorded with date, result, identifiers returned and any error text.

| # | Capability | Step | Pass when |
| --- | --- | --- | --- |
| 1 | Login | Username and password through the proxy; again with two-factor authentication enabled | A session is obtained in both cases |
| 2 | Session reuse | Serialize the session, start a new process, load it, call a read endpoint | Works without a new login, on three separate days |
| 3 | Challenge | Trigger a verification challenge (new device or address) and answer it with the emailed or texted code | The session becomes valid; note whether the library needs a blocking callback or can resume |
| 4 | Feed post | Publish a 1080 × 1350 JPEG with a Persian caption and five hashtags | Media identifier and shortcode returned; post visible |
| 5 | Reel | Publish a 15-second 1080 × 1920 H.264/AAC MP4 with a cover image and caption | As above |
| 6 | Story | Publish one image story and one 10-second video story | Both visible in the story tray |
| 7 | Live check | List the account's recent media and active stories right after each publish | Each new item is found within 2 minutes, with caption text and timestamp |
| 8 | Interrupted upload | Cut the network during an upload, then run the live check | The check gives a definite answer (present or absent) |
| 9 | Post insights | One hour and 24 hours after publishing, read insights for the feed post and the reel | `reach`, `saves`, `shares`, `likes`, `comments` (and `views` for the reel) are returned; list any that are not |
| 10 | Story insights | Read insights for a story before it expires | `reach` and `replies` returned; list any that are not |
| 11 | Account stats | Read followers, following and media count | Returned |
| 12 | Public research | With the research account, read top media for one hashtag (20 items) and recent media for one public account (12 items) | Items returned with caption, counts and link |
| 13 | Stability | Ten publishes over three days at gaps of two hours or more, plus a daily verify | No restriction notice; at most one challenge in the period |

4. **Go or no-go.** A capability is **go** when it passes three times out of three on at least two different days without an account restriction. Decisions that follow:

| Result | Consequence |
| --- | --- |
| Rows 1–3 and 13 are go | `instagrapi` is the default provider for the pilot |
| Rows 1–3 or 13 fail (repeated challenges on a fixed proxy, or the account is restricted or disabled) | The pilot starts on the `manual` provider; the product owner decides before R2 whether to schedule the `graph_api` adapter |
| A publishing row (4–6) fails | That format's capability is forced false with `SOCIALHUB_IG_CAPABILITY_OVERRIDES`; E08 uses the manual flow for it |
| Rows 7–8 fail | E08-S04's verify-before-retry cannot be trusted; automatic retries are disabled for the provider (one attempt, then review) |
| Rows 9–10 fail or return partial metrics | E09 records the missing metrics as unavailable and relies on manual entry for them |
| Row 12 fails | E02-S03 is deferred; research uses web search, RSS and manual signals |

5. **Report.** `docs/spikes/E00-S04-instagram-provider.md` with the pinned version, the checklist results, the challenge mechanics observed (rule 17), observed pacing or limits, and the decisions from rule 4. The time box is 1.5 days of work spread over the first week, because rows 2, 9 and 13 need elapsed time.

### Provider layer

6. The interface, result types and error classes are exactly those in INSTAGRAM-INTEGRATION.md section 2, in `apps/instagram/providers/base.py`. Adapters translate every library exception into one of the provider errors in INSTAGRAM-INTEGRATION.md section 2; no library exception type leaves the adapter.
7. `get_provider(name)` in `apps/instagram/providers/registry.py` returns the adapter. Allowed names come from `SOCIALHUB_IG_ALLOWED_PROVIDERS` (local default `fake,manual,instagrapi`; hosted default `instagrapi,manual`). `graph_api` is registered but every method raises `NotSupported`, and the login endpoint rejects it.
8. **`fake`** implements every method deterministically, stores a small JSON state, and never sleeps. Its login outcome is driven by the password so the panel can be exercised by hand:

| Password | Outcome |
| --- | --- |
| `bad` | `bad_credentials` |
| `2fa` | `two_factor_required` unless `verification_code` is `654321` |
| `challenge` | `challenge_required`; code `123456` succeeds, any other code is invalid |
| `timeout` | `TransientError` |
| anything else | Connected, all capabilities true |

   Tests can also script it directly with `FakeProvider.script([...])` to return a sequence of results or errors for any method.

   Beyond login, the fake keeps a **remote account** per handle (published media with `pk`, `code`, type, caption and `taken_at`; active stories; follower counts) and **call counts** per method, so tests can assert that a post exists exactly once. Per-account **scenarios** change how publishing, verification and analytics behave:

   | Scenario | Behaviour |
   | --- | --- |
   | `ok` | Default; every call succeeds |
   | `timeout_after_publish` | The post is added to the remote account, then `AmbiguousResult` is raised |
   | `story_timeout_after_publish` | Same, for stories |
   | `fail_transient` / `fail_n_times(n)` | The next call (or next n calls) raise `TransientError` without posting |
   | `appears_late` (`delay_seconds`) | The post is added, but listing methods hide it until `delay_seconds` have passed on the clock |
   | `media_rejected` | `MediaRejected` |
   | `session_required` | `SessionRequired` |
   | `challenge_required` | `ChallengeRequired` |
   | `rate_limited` | `RateLimited` with `retry_after_seconds` |
   | `session_lost_during_verify` | Publishing succeeds; the next listing call raises `SessionRequired` |
   | `values` | Fixed numbers returned by `media_insights` and `account_stats` |

   When `SOCIALHUB_TESTING_HOOKS=true`, scripts, scenarios and the remote account are stored in Redis (keys under `fake:ig:`), so the API process and every worker see the same state; the E11-S03 test hooks read and set them. Otherwise they live in process memory, as unit tests need.
9. **`manual`** needs no session. Connecting sets the status to `connected` at once with all capabilities false. Its publishing and analytics methods raise `NotSupported`, which makes the rest of the product use the manual flows.
10. **`instagrapi`** in this story implements `login`, the challenge step and `verify`. `verify` makes one lightweight authenticated read, returns the refreshed session state, the logged-in username, whether the account is professional, and the capabilities.
11. **Capabilities** set by `verify`: for `instagrapi`, `publish_feed`, `publish_reel` and `publish_story` are true when the session is valid; `insights` is true when the account is professional; `research` is false for brand accounts. For `fake` all are true; for `manual` all are false. `SOCIALHUB_IG_CAPABILITY_OVERRIDES` (JSON, for example `{"instagrapi": {"publish_story": false}}`) is applied last.

### Sessions, proxy and pacing

12. A session is the provider's serialized state (device settings, cookies, tokens). It is encrypted with Fernet and stored in `AccountConnection.session_encrypted`. The key is `SOCIALHUB_ENCRYPTION_KEY`; a comma-separated list is accepted so a key can be rotated (first key encrypts, all keys decrypt). The application refuses to start when the key is missing or not a valid Fernet key.
13. The Instagram password is never stored. It travels from the API to the worker inside a Fernet-encrypted cache entry (`ig:login:{job_id}`, 120-second lifetime) that the task reads and deletes; the Celery message carries only the job ID. Passwords, codes, sessions and proxy URLs never appear in logs, job fields, `error_detail` or API responses.
14. The proxy URL is optional locally and required when `SOCIALHUB_IG_REQUIRE_PROXY=true` (the hosted default). Allowed schemes: `http`, `https`, `socks5`. Maximum 500 characters. It is stored encrypted in `proxy_url_encrypted`; the API exposes only `has_proxy`. Every provider call for the account uses it.
15. All provider calls for an account go through `apps.instagram.session.account_session(account, wait_seconds=60)`, a context manager that: takes the Redis lock `ig:lock:{account_id}` (waits up to `wait_seconds`, default 60, then raises `AccountBusy`; holds up to 300 seconds); decrypts the session; yields the provider and state; saves the refreshed state afterwards; and sleeps a random time within `SOCIALHUB_IG_PACING_SECONDS` (default `2,6`) before releasing. With the `fake` provider the pause is zero.
16. `apps.instagram.services.report_session_error(account, error)` is the one place that reacts to `SessionRequired` and `ChallengeRequired` raised anywhere in the product: it sets the connection status (`needs_attention` or `challenge_required`), `last_error_code` and `last_error_at`. E08 and E09 call it; they never set the status themselves.

### Connection flow

17. **Challenge mechanics.** Two mechanics are supported so the API and panel do not depend on the library's style; the spike records which one the pinned version needs.
    - *Resumable:* `login` returns `challenge_required` with a resumable state; the login job ends; submitting the code starts an `instagram.challenge` job. The `fake` provider works this way.
    - *Blocking:* the library asks for the code through a callback during login. The login job stays `running` with the message "Waiting for verification code" and polls the cache for the code for up to 10 minutes. Submitting the code writes it to the cache and returns the same job.
18. **Status transitions** of `AccountConnection.status`:

| From | Event | To |
| --- | --- | --- |
| `disconnected`, `needs_attention` | Login succeeds | `connected` |
| `disconnected`, `needs_attention` | Login asks for a code | `challenge_required` |
| `challenge_required` | Correct code | `connected` |
| `challenge_required` | Wrong code (up to 3 tries), | `challenge_required` |
| `challenge_required` | Third wrong code, or 10 minutes pass | `disconnected` |
| `connected` | Verify or any call raises `SessionRequired` | `needs_attention` |
| `connected` | Any call raises `ChallengeRequired` | `challenge_required` |
| any | Disconnect | `disconnected` |

19. Login input: `provider` (must be allowed), `username` (defaults to the account's handle and must equal it, case-insensitively), `password` (1–200 characters; not needed for `manual`), optional `verification_code` (6–8 digits, for two-factor authentication), optional `proxy_url` (rule 14). When the provider differs from the stored one, the stored session is deleted first.
20. After a successful login the job checks that the logged-in username equals the account's handle. If not, the session is discarded and the job fails with `account_mismatch`.
21. Only one connection job (`instagram.login`, `instagram.challenge`, `instagram.verify`) may be active per account. A second request returns `409 job_in_progress` with the active job in `error.details.job`.
22. A successful login or challenge runs `verify` in the same job, so the capabilities are filled before the job succeeds.
23. Disconnect deletes the session and proxy, sets the status to `disconnected` and all capabilities to false, and sets the account's `publishing_enabled` to false. The provider choice is kept. Scheduled publications are not cancelled; E08 holds them with `blocked_reason = session_problem`.
24. A status of `needs_attention` or `challenge_required` does not change `publishing_enabled`; publishing resumes by itself once the connection is `connected` again.
25. Login, challenge and disconnect are admin-only. Any signed-in user may read the connection and run verify.
26. **Daily verification.** Celery Beat runs `instagram.verify_all` at 03:00 UTC. For each active account whose connection is `connected` and whose provider is not `manual`, it enqueues `instagram.verify` with a random delay of up to 30 minutes. A transient failure retries three times with backoff and leaves the status unchanged; a session failure goes through rule 16.

### Job results and error codes

27. Connection jobs end with `result = {"connection_status": "<status>"}`. `JobRun.error_code` values used by this story: `bad_credentials`, `two_factor_required`, `challenge_code_invalid`, `challenge_expired`, `account_mismatch`, `proxy_error`, `account_restricted`, `rate_limited`, `provider_error`. `error_detail` is a safe one-line description with no secrets.

## Data

- `AccountConnection` as in [DATA-MODEL.md](../../DATA-MODEL.md) section 2.
- New field needed on `AccountConnection`: `challenge` (JSON, null) holding `{"method", "hint", "expires_at", "attempts"}` while a challenge is pending. `method` is `sms`, `email`, `totp` or `unknown`; `hint` is the masked destination Instagram reports, if any.
- `JobRun` kinds: `instagram.login`, `instagram.challenge`, `instagram.verify`.
- Settings added: `SOCIALHUB_ENCRYPTION_KEY`, `SOCIALHUB_IG_DEFAULT_PROVIDER`, `SOCIALHUB_IG_ALLOWED_PROVIDERS`, `SOCIALHUB_IG_REQUIRE_PROXY`, `SOCIALHUB_IG_PACING_SECONDS`, `SOCIALHUB_IG_CAPABILITY_OVERRIDES`, `SOCIALHUB_IG_RESEARCH_PROVIDER`.
- Settings removed: `SOCIALHUB_PUBLISHER_PROVIDER`, `SOCIALHUB_PUBLISHING_ENABLED` and the startup guard that requires them; `DisabledPublisher` in `apps/core/providers.py`. The per-account `publishing_enabled` switch replaces them. `.env.example`, `compose.yaml` comments and the root `README.md` are updated to match.
- New dependencies: `instagrapi` (pinned by the spike), `cryptography`.

## API

Conventions and error shape: [API.md](../../API.md).

### `GET /api/v1/accounts/{id}/connection/`

```json
{
  "account": 1,
  "provider": "instagrapi",
  "status": "connected",
  "username": "greenhome.ir",
  "has_session": true,
  "has_proxy": true,
  "proxy_required": true,
  "allowed_providers": ["instagrapi", "manual"],
  "capabilities": {
    "publish_feed": true,
    "publish_reel": true,
    "publish_story": true,
    "insights": true,
    "research": false
  },
  "challenge": null,
  "last_verified_at": "2026-11-24T03:12:09Z",
  "last_error_code": null,
  "last_error_at": null,
  "active_job": null,
  "updated_at": "2026-11-24T03:12:09Z"
}
```

While a challenge is pending:

```json
{
  "account": 1,
  "provider": "instagrapi",
  "status": "challenge_required",
  "username": "greenhome.ir",
  "has_session": false,
  "has_proxy": true,
  "proxy_required": true,
  "allowed_providers": ["instagrapi", "manual"],
  "capabilities": {
    "publish_feed": false,
    "publish_reel": false,
    "publish_story": false,
    "insights": false,
    "research": false
  },
  "challenge": {
    "method": "email",
    "hint": "g*******@gmail.com",
    "expires_at": "2026-11-24T09:25:00Z",
    "attempts": 0
  },
  "last_verified_at": null,
  "last_error_code": null,
  "last_error_at": null,
  "active_job": {
    "id": "7c1e3d52-4c7e-4f7b-9a0f-2f6c1a0f9b21",
    "kind": "instagram.login",
    "status": "running",
    "progress": 50,
    "message": "Waiting for verification code"
  },
  "updated_at": "2026-11-24T09:15:02Z"
}
```

### `POST /api/v1/accounts/{id}/connection/login/` — admin

Request:

```json
{
  "provider": "instagrapi",
  "username": "greenhome.ir",
  "password": "••••••••••••",
  "verification_code": "",
  "proxy_url": "http://user:pass@proxy.example.net:8080"
}
```

Response `202`:

```json
{
  "job": {
    "id": "7c1e3d52-4c7e-4f7b-9a0f-2f6c1a0f9b21",
    "kind": "instagram.login",
    "status": "queued",
    "progress": 0,
    "message": "",
    "target_type": "account_connection",
    "target_id": "1",
    "result": null,
    "error_code": null,
    "error_detail": null,
    "created_at": "2026-11-24T09:15:00Z",
    "started_at": null,
    "finished_at": null
  }
}
```

A failed job, as returned later by `GET /jobs/{id}/`:

```json
{
  "id": "7c1e3d52-4c7e-4f7b-9a0f-2f6c1a0f9b21",
  "kind": "instagram.login",
  "status": "failed",
  "progress": 30,
  "message": "Signing in",
  "target_type": "account_connection",
  "target_id": "1",
  "result": { "connection_status": "disconnected" },
  "error_code": "bad_credentials",
  "error_detail": "Instagram rejected the username or password.",
  "created_at": "2026-11-24T09:15:00Z",
  "started_at": "2026-11-24T09:15:01Z",
  "finished_at": "2026-11-24T09:15:09Z"
}
```

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| Operator calls it | 403 | `permission_denied` | |
| Provider not allowed, or `graph_api` | 400 | `validation_error` | `provider` / `invalid` |
| Username differs from the account handle | 400 | `validation_error` | `username` / `invalid` |
| Password missing for a provider that needs it | 400 | `validation_error` | `password` / `required` |
| Proxy missing when required, or bad scheme | 400 | `validation_error` | `proxy_url` / `required` or `invalid` |
| Another connection job is active | 409 | `job_in_progress` | `details.job` |
| Account is archived | 409 | `invalid_transition` | |

### `POST /api/v1/accounts/{id}/connection/challenge/` — admin

Request:

```json
{ "code": "482913" }
```

Response `202` with a job: the waiting login job (blocking mechanics) or a new `instagram.challenge` job (resumable mechanics).

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| `code` not 4–8 digits | 400 | `validation_error` | `code` / `invalid` |
| No challenge is pending | 409 | `invalid_transition` | `details.status` is the current status |
| Challenge expired | 409 | `invalid_transition` | Status is already `disconnected` |

A wrong code makes the job fail with `challenge_code_invalid` (resumable), or keeps the job waiting with the message "That code wasn't accepted. Try again." (blocking). `challenge.attempts` increases either way.

### `POST /api/v1/accounts/{id}/connection/verify/`

No body. Response `202` with a job of kind `instagram.verify`.

| Case | HTTP | Code |
| --- | --- | --- |
| Status is `disconnected` | 409 | `instagram_session_required` |
| Status is `challenge_required` | 409 | `instagram_challenge_required` |
| Another connection job is active | 409 | `job_in_progress` |

### `DELETE /api/v1/accounts/{id}/connection/` — admin

Response `204`. Idempotent. Cancels a waiting login job if one exists.

## Background work

| Task | Queue | Trigger | Notes |
| --- | --- | --- | --- |
| `instagram.login` | `default` | Login endpoint | Reads and deletes the encrypted credentials from the cache; steps reported as "Signing in" (30), "Waiting for verification code" (50), "Checking capabilities" (80). No automatic retry on any failure: a repeated login attempt is itself a risk signal to Instagram. Soft time limit 12 minutes. |
| `instagram.challenge` | `default` | Challenge endpoint (resumable mechanics) | No automatic retry. |
| `instagram.verify` | `default` | Verify endpoint, daily schedule, end of login | `TransientError` and `RateLimited` retry up to three times with backoff (30 s, 2 min, 10 min). |
| `instagram.verify_all` | `default` | Celery Beat, daily 03:00 UTC | Fans out per rule 26. Creates `JobRun` rows with `created_by` null. |

Idempotency: a job that finds the connection already in the state it was going to produce (for example verify on a session verified less than 60 seconds ago) succeeds without calling Instagram.

## AI

None.

## Panel

### Connection tab on `/settings/accounts/:id?tab=connection`

While any connection job is active, the tab reloads the connection every two seconds (the same tick as job polling) and disables its actions.

**Status card** (always shown)

| Element | Content |
| --- | --- |
| Status | `StatusTag kind="connection"`: Disconnected, Connected, Verification needed (`challenge_required`), Needs attention |
| Provider | "Instagram (unofficial client)", "Manual posting", "Fake (local testing)" |
| Username | `@username` |
| Proxy | "Configured" or "None" |
| Last checked | `DateTime` of `last_verified_at`, or "Never" |
| Last problem | English text for `last_error_code` with its `DateTime`, shown only when set |
| Capabilities | Five rows with a check or cross icon and a text label: "Publish feed posts", "Publish reels", "Publish stories", "Read insights", "Collect public signals". Under a false publishing capability: "Posts in this format are published by hand." Under false insights: "Metrics are entered by hand." |

**Connect card** — shown to admins when the status is `disconnected` or after choosing "Reconnect". A `ProForm`:

| Field | Component | Notes |
| --- | --- | --- |
| Connection type | `Radio.Group` from `allowed_providers` | Default: the stored provider |
| Username | Read-only text, the account handle | |
| Password | `Input.Password`, `autoComplete="off"` | Hidden for Manual posting |
| Two-factor code | `Input`, optional, digits only | Help: "Only if two-factor authentication is on for this account." Hidden for Manual posting |
| Proxy URL | `Input.Password`-style masked input | Required when `proxy_required`; help: "One fixed address per account. Example: http://user:pass@host:port". Hidden for Manual posting |
| Risk acknowledgement | `Checkbox`, required for the unofficial client | "I understand that Instagram may restrict accounts that use an unofficial client." |

Above the form for the unofficial client, a warning `Alert`: "This connects through an unofficial Instagram client. Try it on a test account before connecting an important one." For Manual posting, an info `Alert`: "Social Hub will prepare each post and wait for you to publish it and paste the link."

Button "Connect". On submit, the card is replaced by `JobProgress` showing the job's message.

**Verification card** — shown when the status is `challenge_required`: "Instagram sent a verification code to {hint}." (or "Enter the verification code Instagram sent you." without a hint), a six-box code input, the button "Submit code", a countdown to `expires_at`, the number of tries left, and the link "Start over" (calls disconnect after `Popconfirm`). Operators see the message "An admin needs to enter a verification code."

**Actions when connected**

- "Check connection" (`JobButton`, all roles). Success message: "Connection is healthy." 
- "Disconnect" (admins), `Modal.confirm`: "Disconnect @{handle}? The stored session is deleted and publishing is switched off. Scheduled posts will wait until the account is connected again."

**Needs attention** — an error `Alert` with the last problem text and, for admins, the button "Reconnect" that opens the Connect card.

**Text for job error codes**

| Code | Text |
| --- | --- |
| `bad_credentials` | Instagram rejected the username or password. |
| `two_factor_required` | This account uses two-factor authentication. Enter the current code and try again. |
| `challenge_code_invalid` | That code wasn't accepted. Check it and try again. |
| `challenge_expired` | The verification code expired. Start the connection again. |
| `account_mismatch` | Those credentials belong to a different Instagram account. |
| `proxy_error` | The proxy couldn't be reached. Check the proxy URL. |
| `account_restricted` | Instagram has restricted this account. Open the Instagram app to resolve it. |
| `rate_limited` | Instagram asked us to slow down. Wait a while before trying again. |
| `provider_error` | Instagram didn't respond as expected. Try again later. |

States: skeleton while loading; `PageError` on load failure; all actions disabled with the tooltip "A connection check is running" while a job is active.

## Acceptance criteria

1. Given the spike is finished, when the report is opened, then every checklist row has a result and a go or no-go, and the `instagrapi` version is pinned in the lock file.
2. Given an admin and the `fake` provider, when they connect with any normal password, then the job succeeds, the status is `connected`, and all five capabilities show as available.
3. Given the `fake` password `challenge`, when the admin connects, then the Verification card appears; submitting `123456` leads to `connected`; submitting a wrong code three times leads to `disconnected` with the text for `challenge_expired` or `challenge_code_invalid`.
4. Given the `fake` password `bad`, when the admin connects, then the job fails with `bad_credentials`, the status stays `disconnected`, and the panel shows the matching text.
5. Given a connected account, when the database row is inspected, then `session_encrypted` and `proxy_url_encrypted` are ciphertext, and no API response, log line or job field contains the password, the code, the session or the proxy URL.
6. Given `SOCIALHUB_ENCRYPTION_KEY` is missing, when the backend starts, then it fails with a clear configuration error.
7. Given `SOCIALHUB_IG_REQUIRE_PROXY=true`, when login is requested without a proxy URL for `instagrapi`, then the API returns `validation_error` on `proxy_url`.
8. Given credentials for a different Instagram account, when login succeeds at Instagram, then the job fails with `account_mismatch` and no session is stored.
9. Given a login job is running, when a second login is requested, then the API returns `409 job_in_progress` with the running job.
10. Given a connected account whose session has been invalidated (scripted in the fake provider), when the daily verification runs, then the status becomes `needs_attention`, `last_error_code` is set, and `publishing_enabled` is unchanged.
11. Given a connected account with publishing on, when an admin disconnects it, then the session and proxy are deleted, the status is `disconnected`, and `publishing_enabled` is false.
12. Given the `manual` provider, when an admin connects, then the status is `connected` immediately, all capabilities are false, and the capability notes about publishing and metrics by hand are shown.
13. Given an operator, when they open the Connection tab, then they can read the status and run "Check connection" but see no Connect, Submit code or Disconnect controls, and the admin endpoints return `403 permission_denied`.
14. Given two tasks call `account_session` for the same account at once, when they run, then the provider calls do not overlap and the second starts only after the first has saved its session.
15. Given the backend is started with the old `SOCIALHUB_PUBLISHER_PROVIDER` variables absent, when it boots, then it starts normally (the old guard is gone).

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S04-BE1 | Spike on a throwaway account | `ig_spike` management command with one sub-step per checklist row; pin `instagrapi`; run the checklist over the first week; write `docs/spikes/E00-S04-instagram-provider.md` with results, challenge mechanics, method names and decisions (rules 1–5). | 1.5 |
| E00-S04-BE2 | Provider interface, registry, fake, manual, stub | `apps/instagram/providers/base.py` (protocols, dataclasses, errors), `registry.py`, `fake.py` (all methods, password-driven outcomes, `script()`, remote account, call counts and the scenario table, with Redis-backed state when testing hooks are on), `manual.py`, `graph_api.py` stub. Contract tests that run against `fake` and that later adapters must also pass. | 0.75 |
| E00-S04-BE3 | Session store, lock, pacing and settings | `apps/instagram/session.py`: Fernet helpers with key rotation, `account_session(account, wait_seconds=60)` context manager with Redis lock, `AccountBusy` on timeout, and pacing, encrypted credential hand-off through the cache; `report_session_error`. Settings added and old guard, variables and `DisabledPublisher` removed; startup check for the key; `.env.example` and README updated. Tests for encryption round trip, rotation, lock exclusion. | 0.5 |
| E00-S04-BE4 | `instagrapi` adapter: login, challenge, verify | `apps/instagram/providers/instagrapi_provider.py` using the method names from the spike; exception translation table; capability rules and overrides (rules 10, 11, 17). Unit tests with the library mocked at the adapter boundary. | 0.5 |
| E00-S04-BE5 | Connection endpoints, jobs and daily verification | `challenge` field and migration; serializers that never expose secrets; four endpoints with the permission and conflict rules; tasks `instagram.login`, `instagram.challenge`, `instagram.verify`, `instagram.verify_all` and the Beat entry; status transition service; new error codes and messages; `openapi.yaml`. API tests for every error row and transition. | 0.75 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S04-FE1 | Service and status card | `src/services/socialhub/connection.ts` with types; Connection tab with the status card and capability list; polling while a job is active. | 0.5 |
| E00-S04-FE2 | Connect and verification flow | Connect card with provider-dependent fields, warnings and acknowledgement; job progress; Verification card with code input, countdown and tries left; job error text map. Component tests driven by mocked job sequences (success, challenge then success, bad credentials). | 0.75 |
| E00-S04-FE3 | Check, disconnect and attention states | "Check connection" with `JobButton`, disconnect confirm, needs-attention alert and reconnect, operator read-only mode; refresh the account model after status changes so the header tags update. | 0.25 |

### Test

None beyond the tests inside each subtask.

## Test notes

- **Provider contract tests** (`apps/instagram/tests/test_contract.py`): one parametrised suite asserting result types and error translation for every interface method; runs against `fake` now and against each real adapter method as later stories add them (with the library mocked).
- **Secrets tests:** assert that serializers, `JobRun` rows and captured logs contain none of: the password, the code, the proxy URL, the decrypted session.
- **Flow tests with the fake provider:** each password scenario in rule 8, each transition in rule 18, the concurrency rule, the 10-minute expiry with a frozen clock, daily verification fan-out.
- **Panel:** Playwright against the local stack with the `fake` provider: connect, challenge, disconnect; operator view.
- **Not automated:** anything against real Instagram. The spike checklist is the manual test record, and it is repeated before the pilot account is connected.

## Later

- `graph_api` adapter: implement the stub; add an OAuth callback endpoint beside the login endpoint; `AccountConnection.session_encrypted` holds the long-lived token; nothing outside `apps/instagram` changes.
- A hosted third-party posting service as another provider, if the unofficial client proves too fragile.
- Several proxies per account with health checks.
- Alerts outside the panel when a connection needs attention.
- Session storage for the research account (E02-S03) reuses the Fernet helpers and the lock with its own key name.
