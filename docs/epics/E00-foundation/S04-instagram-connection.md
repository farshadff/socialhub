# E00-S04 — Connect an Instagram account (Meta app setup, OAuth, provider layer)

> **Phase 2 — not built in Phase 1.** Phase 1 accounts have no Instagram connection ([E00-S03](S03-accounts-and-brand.md)): the operator posts by hand from the posting pack (E08-S05) and types the numbers in (E09-S03, E09-S04), so where this spec says E00-S03 creates `AccountConnection` or exposes `publishing_enabled`, Phase 2 adds that part.

| | |
| --- | --- |
| Epic | E00 Foundation |
| Priority | Phase 2 |
| Estimate | BE 4 d · FE 1.5 d · QA 0 d |
| Depends on | E00-S03 (account and connection rows), E00-S06 (jobs, `JobButton`, `JobProgress`, `media_url`). The setup spike (BE1) and the `graph_api` adapter (BE2) depend on nothing and start on day 1 |
| Needed by | E04-S01 (format limits and the JPEG rule from the spike), E08-S03 and E08-S04 (publishing), E09-S01 and E09-S02 (metrics and followers), E11-S01 (connection attention items), E11-S03 (fake provider hooks) |

## User story

As an admin, I want to connect each Instagram account through Instagram's own sign-in and see whether the connection is healthy and what it is allowed to do, so that publishing and analytics run on Meta's official API without anyone handing Instagram credentials to Social Hub.

## Context

Social Hub talks to Instagram through Meta's official Instagram API with Instagram Login, behind one interface, `InstagramProvider` ([INSTAGRAM-INTEGRATION.md](../../INSTAGRAM-INTEGRATION.md)). One company-owned Meta app serves every account. An admin connects an account once: Instagram asks the account owner to sign in and approve three permissions, and Social Hub keeps a long-lived access token (60 days), encrypted, and renews it every week. Publishing later creates a media container from a public URL of the file, waits until it is ready and publishes it.

The largest risk is access, not code. The company must be allowed to hold a Meta developer account and app, the managed accounts must be able to use the app (as testers, or after App Review), and Meta's servers must be able to download our files. So this story starts with a week-1 setup spike on a test account and the planned media bucket, with a go or no-go per item, before anything depends on it.

The story then builds the provider layer, the OAuth connect flow, token storage and renewal, daily verification and the Connection tab. The `graph_api` adapter's publishing and insight methods are built here only as far as the spike needs them; E08-S03 finishes publishing and listing, and E09-S01 finishes insights with the metric map the spike records. The `fake` provider implements the whole interface here, so E08 and E09 can be built and tested before then.

The scaffold's publisher guard in `backend/config/settings.py` is already removed in Phase 1 by E00-S05 (rule 35 there).

## Scope

**In**

- Week-1 setup spike: Meta app, access, test publishes from the planned bucket, insights, follower count; spike notes with a go or no-go per item; pinned Graph API version.
- `apps/instagram`: interface, result types, errors, registry; `graph_api` (connection methods and account stats complete; publishing, listing and insight methods to spike level), `manual` (complete), `fake` (complete).
- Token encryption with Fernet and key rotation; the `account_session` lock; `report_connection_error`; `apps.instagram.media.public_url`.
- Connection endpoints, the public OAuth callback, verify and refresh jobs, daily token refresh and daily verification.
- Panel: the Connection tab on the account page.

**Out (later)**

- Container publishing with the quota guard, the AI flag and status polling (E08-S03); verify-before-retry matching (E08-S04); the metric map and checkpoint handling (E09-S01).
- The Facebook Login adapter (`graph_api_fb`) for hashtag search and business discovery (E02-S03).
- Removing the app on Instagram's side from Social Hub; Meta's deauthorize and data-deletion callbacks.
- Alerts outside the panel.

## Behaviour and rules

### Setup spike (week 1)

1. **Who and when.** A backend developer runs the spike with the product owner, who holds the company's Meta business details and access to the pilot and test Instagram accounts. Time box: 1 day of work spread over the first week, because container expiry and the story insight window need more than 24 hours of elapsed time. Rows 1–5 need no code and start on day 1, while BE2 builds the adapter the later rows call.
2. **Tooling.** `python manage.py ig_spike <step>` (`apps/instagram/management/commands/ig_spike.py`) calls the `graph_api` adapter directly. Steps: `authorize`, `exchange <code>`, `me`, `refresh`, `quota`, `make-media`, `upload`, `publish <kind> [--ai-flag]`, `container <id>`, `media <id>`, `list`, `insights <media_id> <format> [--metric <name>]`, `stats`. The long-lived token lives in `~/.socialhub-spike/token.json` (file mode 600), never in the repository or the database. Each step prints the request and the response with the token removed and appends both to `~/.socialhub-spike/log.jsonl`. Settings come from the `SOCIALHUB_META_*`, `SOCIALHUB_IG_*` and `SOCIALHUB_S3_*` environment variables.
3. **Test media.** `make-media` produces the files with Pillow and FFmpeg: a 1080 × 1350 JPEG with Persian text; the same image as PNG; a 15-second 1080 × 1920 H.264/AAC MP4 with the `moov` atom at the start and a JPEG cover; a 1080 × 1920 story JPEG; a 10-second story MP4; a reel and a story video at E04-S01's planned maximum durations; an MP4 with the `moov` atom at the end. `upload` puts them under `spike/` in the **planned hosted bucket** with boto3 and prints presigned HTTPS URLs valid for 7,200 seconds. The spike does not wait for E00-S06's storage layer, and it never uses another public file host in place of the bucket.
4. **Checklist.** Each row is run and recorded with date, result, IDs returned, and any error `code`, `error_subcode`, message and `fbtrace_id`. Rows marked † answer an item marked "(confirm in setup)" in INSTAGRAM-INTEGRATION.md.

| # | Check | How | Pass when |
| --- | --- | --- | --- |
| 1 | Company eligibility | The product owner confirms with the company's legal or admin contact, against Meta's developer and platform terms, that the company (its country of registration and its owners) may hold a Meta developer account, a Business app and, if needed, Business Verification. The developer account is created on a company-controlled login | Eligibility is confirmed in writing and the developer account exists |
| 2 | App creation | Create a Meta app of type Business owned by the company. Add the Instagram product with "API setup with Instagram business login". Request `instagram_business_basic`, `instagram_business_content_publish` and `instagram_business_manage_insights`. Note which app settings Meta requires before wider access (privacy policy URL, deauthorize callback, data deletion URL) | The app exists; app ID and mode are recorded; the app secret is only in the team's secret store and the environment |
| 3 | Redirect URIs | Register `https://{SOCIALHUB_DOMAIN}/api/v1/instagram/oauth/callback/` and `http://localhost:8000/api/v1/instagram/oauth/callback/` | Both accepted. If the `http` localhost URI is refused, that is recorded and local `graph_api` testing uses an HTTPS tunnel URI |
| 4 † | Access level | Invite the pilot account and the test account as Instagram testers on the app; each accepts the invite in its Instagram settings | Both can authorize the app in development mode on Standard Access. If not, App Review for the three permissions and Business Verification are started the same day and their dates recorded |
| 5 | Network | From a worker container in the hosting environment, reach `graph.instagram.com`, `api.instagram.com` and `www.instagram.com` over HTTPS; from the admin's browser, open `www.instagram.com` | All reachable, directly or through `SOCIALHUB_IG_HTTP_PROXY` |
| 6 † | Authorize URL | `ig_spike authorize` prints the URL from `authorize_url`; open it, sign in to the test account and approve. Also try the optional parameter that makes Instagram ask which account to use (`force_reauth` in current documentation) | The consent screen lists the three permissions, and Instagram redirects with `code` and the same `state`. The exact URL and parameter names are recorded |
| 7 | Token exchange | Copy `code` from the browser's address bar (the page may show an error until the callback exists); `ig_spike exchange <code>` | A short-lived token, then a long-lived token with `expires_in` of about 60 days. Both response shapes are recorded, including where the granted permissions appear |
| 8 | Profile | `ig_spike me` | `user_id`, `username` and `account_type` (`BUSINESS` or `MEDIA_CREATOR`) returned |
| 9 | Reading permissions later | Look for a way to read a stored token's granted permissions after the exchange | Recorded. If there is none, `verify` keeps the scopes stored at connect (rule 34) |
| 10 | Token in a header | Call `/me` with `Authorization: Bearer {token}` instead of the `access_token` query parameter | Recorded. If the header is refused, the adapter sends the query parameter and redacts it (rule 12) |
| 11 | Refresh | `ig_spike refresh` on day 2 or later; once more on a token less than 24 hours old | The older token gets a new 60-day expiry; the error for the young token is recorded |
| 12 | Quota | `ig_spike quota` before the first publish | `quota_usage`, `config.quota_total` and `config.quota_duration` returned; `quota_total` recorded |
| 13 | Feed image | `publish feed_image` with the 1080 × 1350 JPEG, a Persian caption and five hashtags | Container `FINISHED`; publish returns a media ID; `get_media` returns permalink and shortcode; the post is visible |
| 14 | Reel with cover | `publish reel` with the 15-second MP4, `cover_url`, caption and `share_to_feed=true` | As row 13; the cover shows on the profile grid; the time from create to `FINISHED` is recorded |
| 15 | Image story | `publish story_image` | Visible in the story tray |
| 16 | Video story | `publish story_video` with the 10-second MP4 | Visible in the story tray |
| 17 † | Stories and the quota | `quota` again after rows 15 and 16 | Recorded whether `quota_usage` went up for stories |
| 18 † | JPEG rule | Create a feed container from the PNG | Recorded whether it is rejected, and how (create error or container `ERROR`, with codes) |
| 19 | Video limits | Read Meta's current limits for Reels and story video (duration, file size, frame rate, resolution, codecs); publish the reel and the story video at E04-S01's planned maximum durations | Both publish; the limits are recorded for E04-S01 |
| 20 † | AI-content flag | `publish feed_image --ai-flag` sets the AI-generated flag on the container (`is_ai_generated` in earlier documentation) | Recorded whether it is accepted, rejected or ignored, its current name, and whether the post shows an AI label |
| 21 † | Upload without a public URL | Check whether the Instagram Login path offers a resumable or direct video upload | Recorded. If not, public URLs stay required |
| 22 | Failed container | Create a container whose `image_url` points at a deleted object, and a reel from the MP4 with the `moov` atom at the end | For each: `status_code` `ERROR` with its `status` text, or the create error with code and subcode |
| 23 | Expired container | Create a feed container and do not publish it; read it after 24 hours, then try to publish it | `status_code` is `EXPIRED`; the publish error is recorded |
| 24 | Listing | `list` right after each publish | Each new item appears in `list_recent_media` (feed, reels) or `list_active_stories` (stories) with product type, timestamp and caption; the delay is recorded |
| 25 † | Publishing-limit error | Not forced live (it needs 50–100 posts). Check Meta's error reference for the publishing-limit error | Code and subcode recorded (assumed today: code 9, subcode 2207042) |
| 26 † | Feed and reel insights | 1 hour and 24 hours after publishing, request each metric from INSTAGRAM-INTEGRATION.md section 6 for the format, one name at a time, then all together | Each name recorded as returned, rejected (with the error) or empty |
| 27 † | Story insights | Request each story metric about 1, 23 and 25 hours after posting | Recorded as in row 26, plus the hour after which story insights stop returning |
| 28 | Followers | `ig_spike stats` | `followers_count`, `follows_count` and `media_count` returned |
| 29 | API version | Pick the newest Graph API version on spike day; repeat rows 8, 12, 13 and 26 on it if earlier rows ran on another | The version is recorded with its end-of-life date and set as `SOCIALHUB_IG_API_VERSION` in `.env.example` and the hosted environment |

5. **Go or no-go.** The official integration is **go** when rows 1–8 pass. Each format (rows 13–16), insights (rows 26–28) and verify-before-retry (rows 22–24) then go or not on their own:

| Result | Consequence |
| --- | --- |
| Row 1 fails | No official integration. Hosted defaults become `SOCIALHUB_IG_DEFAULT_PROVIDER=manual` and `SOCIALHUB_IG_ALLOWED_PROVIDERS=manual`; the pilot posts by hand and types metrics (E08 manual delivery, E09 manual entry). The rest of the spike and the adapter's publishing and insight methods are dropped, and their days go back to the roadmap |
| Row 4 fails | App Review and Business Verification run from week 1. Development continues with any account that can hold a role on the app; the pilot account uses `manual` until access is granted, then switches (disconnect, choose the official API, connect) |
| Rows 2, 3, 6, 7 or 8 fail for another reason | Blocker for the official integration; the product owner escalates with Meta support, and the pilot starts on `manual` until it is solved |
| Row 5 fails | Set `SOCIALHUB_IG_HTTP_PROXY` or move the workers; hosted publishing is no-go until row 5 passes |
| Rows 13–16 fail because Meta cannot fetch the file | Fix the bucket (public HTTPS endpoint, no IP allow-list or private network); hosted publishing is no-go until a feed image and a reel publish from it |
| One of rows 13–16 fails for another reason | That format's capability is forced false with `SOCIALHUB_IG_CAPABILITY_OVERRIDES`; E08 delivers it by hand |
| Row 17: stories count | Recorded for E08; the scheduler's daily limits sit far below the quota either way |
| Row 18: PNG accepted | No change; the renderer still exports JPEG |
| Row 19 | E04-S01's registry keeps the stricter of Meta's limits and its own defaults |
| Row 20: flag not accepted | The publisher never sends it; the caption disclosure (E06-S06) carries the label |
| Rows 22–24 give no definite answer | E08-S04 cannot trust verify-before-retry for this provider: automatic retries are off (one attempt, then review) |
| A metric in rows 26–27 is rejected or empty | Removed from that format in E09's metric map for the pinned version and recorded as unavailable; E09 offers manual entry. If every metric fails, `insights` is forced false |
| Row 27: window shorter than 23 hours | E09 moves the last story checkpoint inside the observed window |

6. **Notes.** Results go to `docs/spikes/E00-S04-meta-setup.md`: app ID, app mode, access level, granted permissions, redirect URIs, the pinned version, every checklist row, a metric table per format, the video limits, the error codes seen, and the decisions from rule 5. No token, secret or OAuth code goes in it. The notes feed E04-S01's format registry (video limits, JPEG rule), E09-S01's metric map (`apps/instagram/metrics.py`), and E08-S03 (quota, AI flag, error codes). Each "(confirm in setup)" mark in INSTAGRAM-INTEGRATION.md is replaced with the observed result.

### Provider layer

7. The interface, result types and errors are exactly those in INSTAGRAM-INTEGRATION.md section 7, in `apps/instagram/providers/base.py`. No exception from `httpx` or any other library leaves an adapter. Errors carry a safe `message` and, from `graph_api`, the Graph `code`, `error_subcode` and `fbtrace_id`; `RateLimited` also carries `retry_after_seconds` when known. No error text contains a token, the app secret or an OAuth code.
8. `get_provider(name)` in `apps/instagram/providers/registry.py` returns `graph_api`, `manual` or `fake`. Allowed names come from `SOCIALHUB_IG_ALLOWED_PROVIDERS` (local default `fake,manual,graph_api`; hosted `graph_api,manual`). A default provider outside the allowed set fails startup with `ImproperlyConfigured`; an admin choosing a disallowed name gets `400 validation_error`.
9. **`graph_api`** (`apps/instagram/providers/graph_api.py`) makes plain HTTPS calls with one `httpx.Client` per process: base URL `https://graph.instagram.com/{SOCIALHUB_IG_API_VERSION}/`, timeout 15 s per call (60 s for container creation), `SOCIALHUB_IG_HTTP_PROXY` as the proxy when set, and no automatic retries (callers retry). No third-party Instagram SDK.
10. Methods and how far this story builds them:

| Method | Call | Built here |
| --- | --- | --- |
| `authorize_url` | `https://www.instagram.com/oauth/authorize` with `client_id`, `redirect_uri`, `response_type=code`, `scope` (the three permissions, comma-separated), `state`, and the account-choice parameter if row 6 confirms it | Complete |
| `exchange_code` | `POST https://api.instagram.com/oauth/access_token` (form fields `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`), then `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`. Returns `TokenGrant` with the long-lived token, `expires_at = now + expires_in`, `user_id` and `scopes` | Complete; reads the response shapes recorded in row 7 |
| `refresh_token` | `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` | Complete |
| `verify` | `GET /me?fields=user_id,username,account_type,name,profile_picture_url`, plus the permission read from row 9 if one exists; `scopes` is null when there is none | Complete |
| `account_stats` | `GET /me?fields=followers_count,follows_count,media_count` | Complete |
| `publishing_quota`, `create_container`, `container_status`, `publish_container`, `get_media` | INSTAGRAM-INTEGRATION.md section 5 | Request building and error mapping for the four container kinds, enough for rows 12–23. E08-S03 adds validation, the AI flag, polling and the quota guard |
| `list_recent_media`, `list_active_stories` | Section 5, "Verifying before a retry" | Plain listing for row 24. E08-S04 adds matching |
| `media_insights` | `GET /{media_id}/insights?metric=…` | Requests the names it is given and returns `raw` for rows 26–27. E09-S01 adds the metric map, `metrics`, `unavailable` and `extra` |

11. **Error mapping.** The adapter reads Graph's error body (`error.code`, `error.error_subcode`, `error.message`, `error.fbtrace_id`) and raises:

| Graph response | Error |
| --- | --- |
| Code 190 | `TokenInvalid` |
| Code 10, or 200–299 | `PermissionMissing` |
| Codes 4, 17, 32, 613 | `RateLimited`, with `retry_after_seconds` from `estimated_time_to_regain_access` in the usage headers when present |
| Code 9 with the subcode recorded in row 25 | `QuotaExceeded` |
| A media error on container creation (codes and subcodes recorded in rows 18 and 22), or a container read with `status_code = ERROR` | `MediaRejected` |
| Code 100 with subcode 33 (object does not exist), or HTTP 404 | `NotFound` |
| Codes 1 and 2, HTTP 5xx, connect errors | `TransientError` |
| Read timeout or connection loss after the request was sent, in `publish_container` only | `AmbiguousResult` |
| A rejected code or token on the OAuth and token endpoints (`api.instagram.com/oauth/access_token`, `access_token`, `refresh_access_token`) | `TokenInvalid` |
| Anything else | `TransientError` with the code attached, logged at warning level |

12. **Secrets in transit.** The token goes in the `Authorization: Bearer` header, or in the `access_token` query parameter if row 10 shows the header is refused. The app secret is sent only to the token endpoints. An `httpx` event hook logs method, host, path, status and duration, never query strings or bodies. The Sentry scrubber removes `access_token`, `client_secret` and `code` from captured URLs.
13. **`fake`** (`apps/instagram/providers/fake.py`) implements every method deterministically and never sleeps; delays are measured on the clock, which tests freeze. It keeps a remote account per Social Hub account (containers with status; published media with ID, shortcode, permalink, product type, caption and timestamp; active stories; follower counts; issued tokens) and call counts per method, so tests can assert that a post exists exactly once. Per-account scenarios are set with `FakeProvider.script([...])` in-process, or through the E11-S03 test hooks:

| Scenario | Behaviour |
| --- | --- |
| `ok` | Default; every call succeeds |
| `token_invalid` | The next call raises `TokenInvalid` |
| `permission_missing` | The next call raises `PermissionMissing`; from then on `verify` reports `instagram_business_manage_insights` as not granted |
| `rate_limited` | The next call raises `RateLimited` with `retry_after_seconds = 60` |
| `quota_exceeded` | `publishing_quota` reports `usage = total`; `publish_container` raises `QuotaExceeded` |
| `media_rejected` | The container goes to `ERROR` |
| `container_slow` (`delay_seconds`) | The container stays `IN_PROGRESS` for `delay_seconds` |
| `container_expired` | The container reads `EXPIRED` |
| `timeout_after_publish` | The post is created, then `AmbiguousResult` is raised; the container reads `PUBLISHED` |
| `timeout_before_publish` | `AmbiguousResult` is raised and nothing is posted; the container still reads `FINISHED` |
| `story_timeout_after_publish` | As `timeout_after_publish`, for stories |
| `fail_n_times(n)` | The next `n` calls raise `TransientError` without side effects |
| `appears_late` (`delay_seconds`) | The post exists, but listing methods hide it until `delay_seconds` have passed |
| `values` | Fixed numbers for `media_insights` and `account_stats` |

14. **Fake OAuth.** The fake's `authorize_url` skips Instagram: it points straight at the callback (`SOCIALHUB_META_REDIRECT_URI`) with the same `state` and the account's scripted OAuth code, `fake-ok` by default. A developer can also open the callback URL by hand with another code.

| Code | What the callback sees |
| --- | --- |
| `fake-ok` | Exchange succeeds; `verify` returns the account's handle, `BUSINESS` and all three scopes |
| `fake-denied` | Instagram's decline: `error=access_denied` and `error_reason=user_denied` in place of `code` |
| `fake-mismatch` | Exchange succeeds; `verify` returns the username `someone.else` |
| `fake-personal` | Exchange succeeds; `verify` returns `account_type = PERSONAL` |

Fake tokens look like `fake-token-{account_id}-{n}`, last 60 days and refresh like real ones. With `SOCIALHUB_TESTING_HOOKS=true`, scripts, OAuth codes and the remote account live in Redis under `fake:ig:`, so the API process and every worker share them; otherwise they live in process memory.

15. **`manual`** needs no token. Choosing it connects at once with every capability false. Its connection methods are never called; its publishing and analytics methods raise `NotSupported`, which makes the rest of the product use the manual flows.
16. **Capabilities.** The connection service computes them from the granted scopes and the account type (INSTAGRAM-INTEGRATION.md section 10): `publish_feed`, `publish_reel` and `publish_story` are true when `instagram_business_content_publish` is granted and the account is professional; `insights` is true when `instagram_business_manage_insights` is granted. `manual` has every capability false. `SOCIALHUB_IG_CAPABILITY_OVERRIDES` (for example `{"graph_api": {"publish_story": false}}`) is applied last.

### Tokens, lock and errors

17. **Encryption.** The long-lived token is stored in `AccountConnection.access_token_encrypted`, encrypted with Fernet by `apps/core/crypto.py` (`encrypt`, `decrypt`). `SOCIALHUB_ENCRYPTION_KEY` holds one key or a comma-separated list: the first key encrypts and every key decrypts (`MultiFernet`). Startup fails when the setting is missing or any key is not a valid Fernet key.
18. **Key rotation.** Put the new key first and deploy; run `python manage.py reencrypt_secrets`, which re-encrypts every stored token with the first key, is idempotent and prints the count; then remove the old key and deploy again. A token that no key can decrypt is treated as `TokenInvalid` (rule 21).
19. **Never exposed.** Tokens, the app secret and OAuth codes never appear in API responses, `JobRun` fields, `error_detail`, logs, the Django admin or the spike notes. The API exposes only `has_token`.
20. **`account_session(account, wait_seconds=60)`** in `apps/instagram/session.py` is the only way to call Instagram for a brand account. It takes the Redis lock `ig:lock:{account_id}` (waits up to `wait_seconds`, then raises `AccountBusy`; held at most 300 s), loads the connection, decrypts the token, yields `(provider, token)` and releases the lock, also on exceptions. With `manual` it yields `(provider, None)`. When the connection holds no token it raises `TokenInvalid` without calling Instagram. Nothing pauses between calls.
21. **`report_connection_error(account, error)`** in `apps/instagram/services.py` is the only code that changes the connection status in reaction to an error. Under a row lock:
    - `TokenInvalid`: status `needs_attention`, `last_error_code = token_invalid`.
    - `PermissionMissing`: status `needs_attention`, `last_error_code = permission_missing`, and an `instagram.verify` job is started (skipped when a connection job is already active) to recompute scopes and capabilities.
    - Any other error: no status change.
    - On a `disconnected` connection it changes nothing; a disconnect won the race.

    It sets `last_error_at` together with the code. E08, E09 and this story's tasks call it; none of them sets the status in reaction to an error themselves.
22. **`apps.instagram.media.public_url(asset)`** returns `media_url(asset.file, ttl=SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS)` from E00-S06: a presigned HTTPS URL (default 7,200 s) that Meta's servers download the file from. It raises `ImproperlyConfigured` when the result is not an `https://` URL (the `local` storage backend), because Meta cannot reach such a file. E08-S03 calls it for the final asset and the reel cover.

### Connecting

23. **Connection type.** The connection's `provider` changes through `PATCH`, admin only and only while the status is `disconnected`. Choosing `manual` connects at once (rule 15). Choosing the current provider again changes nothing.
24. **Start.** `POST …/connection/connect/` works for `graph_api` and `fake` connections in any status, except on archived accounts. It creates a random 32-byte URL-safe `state`, stores `{account_id, user_id, provider}` under `ig:oauth:{state}` in Redis for 10 minutes, and returns `authorize_url` and `expires_at`. For `graph_api` it first checks that `SOCIALHUB_META_APP_ID`, `SOCIALHUB_META_APP_SECRET`, `SOCIALHUB_META_REDIRECT_URI` and `SOCIALHUB_IG_API_VERSION` are set.
25. **Callback.** `GET /instagram/oauth/callback/` is public (it needs no session) and always answers with a `302` redirect, never JSON. Steps run in this order; the first failing step decides the code:

| Step | Failure | Code |
| --- | --- | --- |
| 1. Read and delete `ig:oauth:{state}` (single use). The account must exist and not be archived, the user who started must still be an active admin, and the connection's provider must equal the one in the state | Missing, unknown, expired or used state; any other mismatch | `oauth_state_invalid` |
| 2. Look for an `error` parameter from Instagram | Present (the user declined) | `oauth_denied` |
| 3. `exchange_code(code)`: short-lived, then long-lived token, server-side with the app secret | Code missing, rejected or expired; unexpected response; the new token fails on its first call | `oauth_exchange_failed` |
| 4. `verify(token)`: `/me` and, if possible, the granted permissions | `PermissionMissing` | `permission_missing` |
| 5. `username` equals the account's `handle` (case-insensitive), and no other account's connection holds the same `ig_user_id` | Different | `account_mismatch` |
| 6. `account_type` is `BUSINESS` or `MEDIA_CREATOR` | Anything else | `not_professional` |
| 7. `instagram_business_basic` is among the granted scopes | Missing | `permission_missing` |
| Steps 3–7 | `RateLimited` | `rate_limited` |
| Steps 3–7 | `TransientError`, or anything unexpected | `provider_error` |

26. **Outcome.** On success, under a row lock, the callback stores the provider, `status = connected`, `ig_user_id`, `username`, `account_type`, the encrypted token, `token_expires_at`, `token_refreshed_at = now`, `scopes`, `capabilities` (rule 16) and `last_verified_at = now`, and clears `last_error_code` and `last_error_at`. It then redirects to `{SOCIALHUB_PANEL_URL}/settings/accounts/{id}?tab=connection&connect=success`. On failure it stores nothing, leaves the connection as it was, logs the code with the `fbtrace_id` when there is one, and redirects to `…&connect=error&code={code}`. When the state is unknown, so is the account: the redirect goes to `{SOCIALHUB_PANEL_URL}/settings/accounts?connect=error&code=oauth_state_invalid`.
27. **Partial permissions.** A missing permission other than `instagram_business_basic` does not fail the connect. The connection is `connected`, the matching capabilities are false, and the panel names the missing permission. Connecting again and approving every permission fixes it.
28. **Response headers.** Callback responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, so the code ends up neither in caches nor in the panel's referrer.
29. **Connecting again.** Connecting while `connected`, `expiring` or `needs_attention` replaces the token and recomputes everything; the old token is not revoked, because the API offers no revoke call. Connecting never changes `publishing_enabled`.

### Token lifecycle

30. A long-lived token lasts 60 days. It can be refreshed once it is at least 24 hours old and not yet expired; the refresh returns a new 60-day token, which replaces the old one together with `token_expires_at` and `token_refreshed_at`.
31. **Daily refresh.** Celery Beat runs `instagram.refresh_tokens` at 02:15 UTC. For each active account whose connection is `connected` or `expiring`, holds a token and is not `manual`:
    - if `token_expires_at` has passed: status `needs_attention`, `last_error_code = token_invalid`, no call;
    - if `token_refreshed_at` is older than `SOCIALHUB_IG_TOKEN_REFRESH_AFTER_DAYS` (default 7): it starts `instagram.refresh_token` as a system job.

    Weekly refresh keeps every token about 53 days from expiry. Archived accounts are skipped; a restored account whose token expired in the meantime must be connected again.
32. **Refresh outcome.** Success: the new token is stored, `expiring` becomes `connected`, and `verify` runs in the same job. `TokenInvalid`: rule 21. Any other failure: the status stays, `last_error_code` and `last_error_at` are set, and the next daily run tries again; when `token_expires_at` is within 7 days, the status becomes `expiring`.
33. **Daily verification.** Celery Beat runs `instagram.verify_all` at 03:00 UTC. For each active, non-manual account whose connection holds a token, it starts `instagram.verify` with a random delay of up to 30 minutes.
34. **Verify outcome.** `verify` updates `username`, `account_type`, `scopes` (kept as stored when the API cannot report them), `capabilities` and `last_verified_at`. The status becomes `connected` when the token works, `ig_user_id` and `username` still match, the account is professional and `instagram_business_basic` is granted; an `expiring` connection stays `expiring` until a refresh succeeds. A changed `ig_user_id`, or a username that no longer equals the handle (the account was renamed on Instagram), gives `needs_attention` with `account_mismatch`: the admin disconnects, updates the handle and connects again. A personal account gives `needs_attention` with `not_professional`. Errors go through rule 21.
35. **Statuses and transitions** of `AccountConnection.status`:

| From | Event | To |
| --- | --- | --- |
| `disconnected` | Callback succeeds | `connected` |
| `disconnected` | `PATCH` to `manual` | `connected`, every capability false |
| `connected`, `expiring`, `needs_attention` | Callback succeeds (connect again) | `connected` |
| `connected` | Refresh fails with an error other than `TokenInvalid`, and the token expires within 7 days | `expiring` |
| `expiring` | Refresh succeeds | `connected` |
| `connected`, `expiring` | `TokenInvalid` from any call, or the token passed its expiry | `needs_attention` |
| `connected`, `expiring` | `PermissionMissing` from any call | `needs_attention`; a verify follows |
| `connected`, `expiring` | Verify finds an account mismatch, a personal account, or no `instagram_business_basic` | `needs_attention` |
| `needs_attention` | Verify succeeds (rule 34) | `connected`, or `expiring` when the token expires within 7 days |
| any | Disconnect | `disconnected` |

36. **What each status allows.** `connected` and `expiring` allow publishing. `disconnected` and `needs_attention` block it: E08 holds publications with `blocked_reason = connection_problem`. Only disconnect changes `publishing_enabled`; publishing resumes by itself once the connection is `connected` or `expiring` again.
37. **Attention.** E11-S01 turns statuses into attention items: `connection_needs_attention` (high), `connection_expiring` (medium), and `connection_disconnected` (high, only when the account has scheduled publications).

### Disconnecting, jobs and permissions

38. **Disconnect** deletes the token; clears `ig_user_id`, `username`, `account_type`, `token_expires_at`, `token_refreshed_at`, `scopes`, `last_verified_at`, `last_error_code` and `last_error_at`; sets every capability false, the status `disconnected` and the account's `publishing_enabled` false; and cancels a queued `instagram.verify` or `instagram.refresh_token` job with `cancel_queued_job`. The provider choice is kept. A running connection job re-reads the connection under a row lock before writing and stops without changes when it finds it `disconnected`. Disconnect does not remove the app on Instagram's side; the runbook explains how (Instagram → Settings → Apps and websites).
39. Only one connection job (`instagram.verify`, `instagram.refresh_token`) may be active per account; the two kinds list each other in `conflicts_with` (E00-S06). A second request returns `409 job_in_progress` with the active job.
40. Connection jobs end with `result = {"connection_status": "<status>"}`; refresh adds `token_expires_at`. `JobRun.error_code` is one of `token_invalid`, `permission_missing`, `account_mismatch`, `not_professional`, `rate_limited`, `provider_error`. `error_detail` is a safe one-line text.
41. **Permissions.** Connect, `PATCH`, refresh-token and disconnect are admin-only. Any signed-in user may read the connection and run verify. The callback is public and protected by the single-use `state`.
42. **Startup checks.** `SOCIALHUB_ENCRYPTION_KEY` must be valid (rule 17). With `DJANGO_DEBUG=false` and `graph_api` allowed, the four Meta settings must be set, `SOCIALHUB_META_REDIRECT_URI` must start with `https://`, `SOCIALHUB_IG_API_VERSION` must match `^v\d+\.\d+$`, and `SOCIALHUB_MEDIA_BACKEND` must be `s3`. Locally, missing Meta settings only make `graph_api` unavailable: `GET /system/status/` lists them and connect returns `503 provider_not_configured`.

## Data

- `AccountConnection` as in [DATA-MODEL.md](../../DATA-MODEL.md) section 2: `provider`, `status`, `ig_user_id`, `username`, `account_type`, `access_token_encrypted` (never serialized), `token_expires_at`, `token_refreshed_at`, `scopes`, `capabilities` (`publish_feed`, `publish_reel`, `publish_story`, `insights`), `last_verified_at`, `last_error_code`, `last_error_at`. E00-S03 creates the table; this story adds no fields.
- `JobRun` kinds: `instagram.verify` and `instagram.refresh_token`, target `account_connection`, timeout 5 minutes, each in the other's `conflicts_with`, `prunable=True`.
- Redis keys: `ig:oauth:{state}` (10 minutes), `ig:lock:{account_id}` (at most 300 s), `fake:ig:*` (testing hooks only).
- Settings added: every row of INSTAGRAM-INTEGRATION.md section 9, plus `SOCIALHUB_PANEL_URL`, where the callback sends the browser back (default `http://localhost:5173`; hosted `https://{SOCIALHUB_DOMAIN}`).
- Settings removed: none. `SOCIALHUB_PUBLISHER_PROVIDER`, `SOCIALHUB_PUBLISHING_ENABLED`, the startup guard and `DisabledPublisher` are removed in Phase 1 by E00-S05 (rule 35 there). The per-account `publishing_enabled` switch takes their role in Phase 2.
- New dependencies: `httpx` and `cryptography`; `respx` for tests. No Instagram SDK.
- New document: `docs/spikes/E00-S04-meta-setup.md` (rule 6).

## API

Conventions and error shape: [API.md](../../API.md). `{id}` is the account ID.

### `GET /api/v1/accounts/{id}/connection/`

Any signed-in user. A connected account:

```json
{
  "account": 1,
  "provider": "graph_api",
  "provider_configured": true,
  "allowed_providers": ["graph_api", "manual"],
  "status": "connected",
  "ig_user_id": "17841405822304914",
  "username": "greenhome.ir",
  "account_type": "BUSINESS",
  "has_token": true,
  "token_expires_at": "2027-01-21T02:15:07Z",
  "token_refreshed_at": "2026-11-22T02:15:07Z",
  "scopes": [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights"
  ],
  "capabilities": {
    "publish_feed": true,
    "publish_reel": true,
    "publish_story": true,
    "insights": true
  },
  "last_verified_at": "2026-11-24T03:12:09Z",
  "last_error_code": null,
  "last_error_at": null,
  "active_job": null,
  "updated_at": "2026-11-24T03:12:09Z"
}
```

An account whose token is about to expire, connected without the insights permission, with a refresh running:

```json
{
  "account": 2,
  "provider": "graph_api",
  "provider_configured": true,
  "allowed_providers": ["graph_api", "manual"],
  "status": "expiring",
  "ig_user_id": "17841452201983377",
  "username": "greenhome.shop",
  "account_type": "MEDIA_CREATOR",
  "has_token": true,
  "token_expires_at": "2026-11-29T09:40:00Z",
  "token_refreshed_at": "2026-09-30T09:40:00Z",
  "scopes": [
    "instagram_business_basic",
    "instagram_business_content_publish"
  ],
  "capabilities": {
    "publish_feed": true,
    "publish_reel": true,
    "publish_story": true,
    "insights": false
  },
  "last_verified_at": "2026-11-24T03:21:40Z",
  "last_error_code": "provider_error",
  "last_error_at": "2026-11-24T02:15:31Z",
  "active_job": {
    "id": "c41f7a2e-8d3b-4e90-a6c5-2b7d1e9f0a34",
    "kind": "instagram.refresh_token",
    "status": "running",
    "progress": 40,
    "message": "Renewing the access token"
  },
  "updated_at": "2026-11-24T09:31:02Z"
}
```

A new account that has not been connected:

```json
{
  "account": 3,
  "provider": "graph_api",
  "provider_configured": true,
  "allowed_providers": ["graph_api", "manual"],
  "status": "disconnected",
  "ig_user_id": null,
  "username": null,
  "account_type": null,
  "has_token": false,
  "token_expires_at": null,
  "token_refreshed_at": null,
  "scopes": [],
  "capabilities": {
    "publish_feed": false,
    "publish_reel": false,
    "publish_story": false,
    "insights": false
  },
  "last_verified_at": null,
  "last_error_code": null,
  "last_error_at": null,
  "active_job": null,
  "updated_at": "2026-11-23T08:12:40Z"
}
```

- `provider_configured` is false for `graph_api` while a Meta setting is missing (rule 42); it is always true for `manual` and `fake`.
- `active_job` is computed with `active_job_for("account_connection", id, ["instagram.verify", "instagram.refresh_token"])` (E00-S06).
- Unknown account: `404 not_found`.

### `PATCH /api/v1/accounts/{id}/connection/` — admin

Request:

```json
{ "provider": "manual" }
```

Response `200`, the connection after the change:

```json
{
  "account": 3,
  "provider": "manual",
  "provider_configured": true,
  "allowed_providers": ["graph_api", "manual"],
  "status": "connected",
  "ig_user_id": null,
  "username": null,
  "account_type": null,
  "has_token": false,
  "token_expires_at": null,
  "token_refreshed_at": null,
  "scopes": [],
  "capabilities": {
    "publish_feed": false,
    "publish_reel": false,
    "publish_story": false,
    "insights": false
  },
  "last_verified_at": null,
  "last_error_code": null,
  "last_error_at": null,
  "active_job": null,
  "updated_at": "2026-11-24T10:05:12Z"
}
```

Choosing `graph_api` or `fake` only stores the choice; the status stays `disconnected` until the callback succeeds.

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| Operator calls it | 403 | `permission_denied` | |
| `provider` missing or not in `allowed_providers` | 400 | `validation_error` | `provider` / `required` or `invalid` |
| Status is not `disconnected` | 409 | `invalid_transition` | `details.status` is the current status; `details.reason` is `"connection_not_disconnected"` |
| Account is archived | 409 | `invalid_transition` | `details.reason` is `"account_archived"` |

### `POST /api/v1/accounts/{id}/connection/connect/` — admin

No body. Response `200`:

```json
{
  "authorize_url": "https://www.instagram.com/oauth/authorize?client_id=1234567890123456&redirect_uri=https%3A%2F%2Fsocial.example.com%2Fapi%2Fv1%2Finstagram%2Foauth%2Fcallback%2F&response_type=code&scope=instagram_business_basic%2Cinstagram_business_content_publish%2Cinstagram_business_manage_insights&state=q8Xw2mT0bH5vLr9cN1yZ4kJ7pD3sF6aE0uG2iO8wQ1M",
  "expires_at": "2026-11-24T09:25:00Z"
}
```

With the `fake` provider:

```json
{
  "authorize_url": "http://localhost:8000/api/v1/instagram/oauth/callback/?code=fake-ok&state=Zk1rT9wq3VbN7cX2mL5pY8sH0dJ4fG6aR1eU3iO7tW2",
  "expires_at": "2026-11-24T09:25:00Z"
}
```

Error example, Meta app not configured:

```json
{
  "error": {
    "code": "provider_not_configured",
    "message": "The Meta app is not configured on the server.",
    "fields": [],
    "details": { "provider": "graph_api", "missing": ["SOCIALHUB_META_APP_SECRET"] },
    "request_id": "6b2d9e41-0f7c-4a58-b3e1-9c4a7d2f5e80",
    "retryable": false
  }
}
```

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| Operator calls it | 403 | `permission_denied` | |
| Provider is `manual` | 409 | `invalid_transition` | `details.reason` is `"manual_provider"` |
| Account is archived | 409 | `invalid_transition` | `details.reason` is `"account_archived"` |
| `graph_api` and a Meta setting is missing | 503 | `provider_not_configured` | `details.missing` lists the setting names |

### `GET /api/v1/instagram/oauth/callback/` — public

Instagram sends the browser here. Success:

```http
GET /api/v1/instagram/oauth/callback/?code=AQBx7Rk2mP9fT3wLqZ8vN1cY5hJ0dG4sE6aU2iO7&state=q8Xw2mT0bH5vLr9cN1yZ4kJ7pD3sF6aE0uG2iO8wQ1M HTTP/1.1
Host: social.example.com

HTTP/1.1 302 Found
Location: https://social.example.com/settings/accounts/1?tab=connection&connect=success
Cache-Control: no-store
Referrer-Policy: no-referrer
```

The user signed in to a different Instagram account:

```http
HTTP/1.1 302 Found
Location: https://social.example.com/settings/accounts/1?tab=connection&connect=error&code=account_mismatch
Cache-Control: no-store
Referrer-Policy: no-referrer
```

The user declined on Instagram:

```http
GET /api/v1/instagram/oauth/callback/?error=access_denied&error_reason=user_denied&error_description=The+user+denied+your+request.&state=q8Xw2mT0bH5vLr9cN1yZ4kJ7pD3sF6aE0uG2iO8wQ1M HTTP/1.1
Host: social.example.com

HTTP/1.1 302 Found
Location: https://social.example.com/settings/accounts/1?tab=connection&connect=error&code=oauth_denied
Cache-Control: no-store
Referrer-Policy: no-referrer
```

An unknown, expired or used `state`:

```http
HTTP/1.1 302 Found
Location: https://social.example.com/settings/accounts?connect=error&code=oauth_state_invalid
Cache-Control: no-store
Referrer-Policy: no-referrer
```

Every failure and its code is in rule 25. The endpoint never returns an error body.

### `POST /api/v1/accounts/{id}/connection/verify/`

Any signed-in user. No body. Response `202`:

```json
{
  "job": {
    "id": "b8e2f0c4-5a1d-4e7b-9c3f-1d2e6a7b8c90",
    "kind": "instagram.verify",
    "status": "queued",
    "progress": 0,
    "message": "",
    "account": 1,
    "queue": "default",
    "target_type": "account_connection",
    "target_id": "1",
    "result": null,
    "error_code": null,
    "error_detail": null,
    "created_by": { "id": 2, "name": "Sara" },
    "request_id": "e7c3a1f9-2b4d-4f60-8a9e-5d1c7b3f2a68",
    "created_at": "2026-11-24T09:15:00Z",
    "started_at": null,
    "finished_at": null
  }
}
```

A verify from the daily schedule that found a revoked token, as returned by `GET /jobs/{id}/`:

```json
{
  "id": "0f6a2c8e-4b1d-4d97-b3a5-7e9c1f2d6b40",
  "kind": "instagram.verify",
  "status": "failed",
  "progress": 40,
  "message": "Checking the account on Instagram",
  "account": 1,
  "queue": "default",
  "target_type": "account_connection",
  "target_id": "1",
  "result": { "connection_status": "needs_attention" },
  "error_code": "token_invalid",
  "error_detail": "Instagram no longer accepts this account's access token.",
  "created_by": null,
  "request_id": null,
  "created_at": "2026-11-25T03:00:02Z",
  "started_at": "2026-11-25T03:17:44Z",
  "finished_at": "2026-11-25T03:17:45Z"
}
```

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| Connection holds no token (`disconnected`) | 409 | `instagram_not_connected` | |
| Provider is `manual` | 409 | `invalid_transition` | `details.reason` is `"manual_provider"` |
| Account is archived | 409 | `invalid_transition` | `details.reason` is `"account_archived"` |
| Another connection job is active | 409 | `job_in_progress` | `details.job` |

### `POST /api/v1/accounts/{id}/connection/refresh-token/` — admin

No body. Response `202` with a job of kind `instagram.refresh_token`, shaped like the verify job above. The finished job:

```json
{
  "id": "c41f7a2e-8d3b-4e90-a6c5-2b7d1e9f0a34",
  "kind": "instagram.refresh_token",
  "status": "succeeded",
  "progress": 100,
  "message": "Done",
  "account": 2,
  "queue": "default",
  "target_type": "account_connection",
  "target_id": "2",
  "result": { "connection_status": "connected", "token_expires_at": "2027-01-23T09:31:12Z" },
  "error_code": null,
  "error_detail": null,
  "created_by": { "id": 1, "name": "Mina" },
  "request_id": "9a4e1c7b-3f2d-4b68-a0e5-6c8d2f1b7e93",
  "created_at": "2026-11-24T09:31:00Z",
  "started_at": "2026-11-24T09:31:01Z",
  "finished_at": "2026-11-24T09:31:13Z"
}
```

Error example, token renewed less than 24 hours ago:

```json
{
  "error": {
    "code": "invalid_transition",
    "message": "The token was renewed less than 24 hours ago.",
    "fields": [],
    "details": {
      "status": "connected",
      "reason": "token_refreshed_recently",
      "retry_after": "2026-11-25T02:15:07Z"
    },
    "request_id": "3d8f2b6a-1e4c-4a97-9b0d-7f5e3c1a8d26",
    "retryable": false
  }
}
```

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| Operator calls it | 403 | `permission_denied` | |
| Status is `disconnected` or `needs_attention` | 409 | `instagram_not_connected` | Connect again instead |
| Provider is `manual` | 409 | `invalid_transition` | `details.reason` is `"manual_provider"` |
| `token_refreshed_at` is less than 24 hours ago | 409 | `invalid_transition` | `details.reason` is `"token_refreshed_recently"`; `details.retry_after` |
| Another connection job is active | 409 | `job_in_progress` | `details.job` |

### `DELETE /api/v1/accounts/{id}/connection/` — admin

No body. Response `204`, with the effects in rule 38. Idempotent: deleting a `disconnected` connection returns `204` and changes nothing.

| Case | HTTP | Code |
| --- | --- | --- |
| Operator calls it | 403 | `permission_denied` |

## Background work

| Task | Queue | Trigger | Notes |
| --- | --- | --- | --- |
| `instagram.verify` | `default` | Verify endpoint; `instagram.verify_all`; `report_connection_error` after `PermissionMissing` | Runs inside `account_session`. Steps "Checking the account on Instagram" (40), "Updating capabilities" (80). `TransientError`, `RateLimited` and `AccountBusy` retry up to three times (30 s, 2 min, 10 min); then the job fails with `provider_error` or `rate_limited` and the status is unchanged. A connection verified less than 60 seconds ago succeeds without calling Instagram. |
| `instagram.refresh_token` | `default` | Refresh endpoint; `instagram.refresh_tokens` | Runs inside `account_session`, so the token never changes in the middle of another call sequence. Steps "Renewing the access token" (40), "Checking the account on Instagram" (80); the verify runs in the same job. No automatic retry: the next daily run is the retry (rule 32). |
| `instagram.refresh_tokens` | `default` | Celery Beat, daily 02:15 UTC | Rule 31. Creates jobs with `created_by` null; at most 500 per run; safe to run twice. |
| `instagram.verify_all` | `default` | Celery Beat, daily 03:00 UTC | Rule 33. Creates jobs with `created_by` null and a random countdown of up to 30 minutes. |

Both job kinds re-read the connection under a row lock before writing, so a disconnect that happens meanwhile always wins (rule 38). The OAuth callback runs in the request, not as a job: it makes three or four HTTPS calls of at most 15 s each.

## AI

None.

## Panel

### Connection tab on `/settings/accounts/:id?tab=connection`

The tab reads `GET …/connection/`. While `active_job` is set, it reloads every two seconds (the job polling tick) and disables the other actions with the tooltip "A connection task is running". Icons always come with a text label; status is never shown by colour alone. The page uses theme tokens only; the Instagram button is a normal primary button with Ant Design's `InstagramOutlined` icon, not Instagram's brand colours.

**Return from Instagram.** When the URL has `connect=success`, or `connect=error&code=…`, the tab shows an `Alert` above the cards, reloads the connection and the account model (so the header and top-bar tags update), then removes `connect` and `code` from the URL with `history.replace` so a reload does not show the alert again. The alert can be closed.

| Return | Alert | Text |
| --- | --- | --- |
| `connect=success`, every permission granted | success | Connected to @{username}. Turn on publishing in the Automation tab when you're ready. |
| `connect=success`, a permission missing | warning | Connected to @{username}, but Instagram didn't grant: {permission labels}. {Consequence, e.g. "Metrics will be entered by hand."} Connect again and allow every permission to fix this. |
| `oauth_state_invalid` | error | This connection request expired or was already used. Start again. |
| `oauth_denied` | warning | The connection was cancelled on Instagram. Nothing changed. |
| `oauth_exchange_failed` | error | Instagram didn't confirm the sign-in. Try again in a few minutes. |
| `account_mismatch` | error | You signed in to a different Instagram account. Sign in to @{handle} on Instagram, or switch accounts there, then connect again. |
| `not_professional` | error | @{handle} is a personal account. Switch it to a Business or Creator account in the Instagram app, then connect again. |
| `permission_missing` | error | Instagram didn't grant access to the profile. Connect again and allow every permission. |
| `rate_limited` | error | Instagram asked us to slow down. Wait a few minutes and try again. |
| `provider_error` | error | Instagram didn't respond as expected. Try again later. |
| Any other code | error | The connection didn't finish. Try again. |

`/settings/accounts` shows the `oauth_state_invalid` alert the same way when the callback could not tell which account it was for.

**Status card** (always shown, all roles)

| Element | Content |
| --- | --- |
| Status | `StatusTag kind="connection"`: Connected, Expiring soon, Needs attention, Disconnected |
| Connection type | "Instagram (official API)", "Manual posting" or "Fake (local testing)" |
| Instagram account | `@username` and the account type ("Business" for `BUSINESS`, "Creator" for `MEDIA_CREATOR`); "—" when disconnected or manual |
| Access token | "Expires {date} ({relative})", in warning text when within 7 days, and "Renewed {relative}" from `token_refreshed_at`. Hidden for manual and while disconnected |
| Permissions | One row per requested permission, with a check or cross icon and a label: "Profile and media" (`instagram_business_basic`), "Publish content" (`instagram_business_content_publish`), "Read insights" (`instagram_business_manage_insights`). Hidden for manual and while disconnected |
| Capabilities | Four rows with a check or cross icon and a label: "Publish feed posts", "Publish reels", "Publish stories", "Read insights". Under a false publishing capability: "Posts in this format are published by hand." Under false insights: "Metrics are entered by hand." |
| Last checked | `DateTime` of `last_verified_at`, or "Never" |
| Last problem | The text for `last_error_code` (table below) with its `DateTime`; only when set |

**Disconnected.** Admins see the Connect card:

- "Connection type": `Select` with the options in `allowed_providers`, preset to the stored provider.
- With "Instagram (official API)": the text "You'll go to Instagram to sign in to @{handle} and approve Social Hub. Use that account, not a personal one, and allow every permission." and the primary button "Connect with Instagram". Clicking it sends `PATCH` first when the chosen type differs from the stored one, then `POST …/connect/` (the button shows "Opening Instagram…"), then opens `authorize_url` in the same tab with `window.location.assign`.
- With "Fake (local testing)": the same button, with the helper "Local testing: you come straight back connected as @{handle}."
- With "Manual posting": an info `Alert`, "Social Hub prepares each post and waits for someone to publish it on Instagram and paste the link. Metrics are entered by hand.", and the button "Use manual posting", which sends `PATCH {"provider": "manual"}` and shows the message "Manual posting is on for @{handle}".
- When `provider_configured` is false, "Connect with Instagram" is disabled with the tooltip "The Meta app isn't set up on the server. Check Settings → System."
- Operators see "Not connected. An admin needs to connect this account." and no controls.

**Connected (official API or fake).** Actions under the status card:

- "Check connection" (`JobButton`, all roles, kind `instagram.verify`). Success message: "Connection is healthy."
- "Refresh token" (`JobButton`, admins, kind `instagram.refresh_token`). Success message: "Token renewed until {date}." Disabled with the tooltip "Renewed less than 24 hours ago" while `token_refreshed_at` is under 24 hours old.
- "Connect again" (admins, default button), with the helper "Use this to grant missing permissions." It runs the same flow as "Connect with Instagram".
- "Disconnect" (admins, danger button) with `Modal.confirm`: title "Disconnect @{username}?", content "The stored access token is deleted and publishing is switched off for this account. Scheduled posts wait until it is connected again. To remove Social Hub's access on Instagram too, open Instagram → Settings → Apps and websites.", OK button "Disconnect".

**Expiring.** A warning `Alert` above the actions: "Access to Instagram ends {relative} and automatic renewal keeps failing ({last problem text}). Refresh the token now, or connect again." The actions are those of the connected state.

**Needs attention.** An error `Alert` titled "Connection needs attention", with the text for `last_error_code` and "Publishing to Instagram is paused for this account until this is fixed." For `account_mismatch` it adds "If the account was renamed on Instagram, disconnect it, update the handle on the Profile tab, and connect again." Admins get "Connect again" (primary), "Check connection" and "Disconnect". Operators see "Ask an admin to reconnect this account." and "Check connection".

**Manual posting.** Status Connected, type "Manual posting", the manual-posting info `Alert`, and the four capabilities crossed with their notes. Admins get "Disconnect" with the confirm "Stop manual posting for @{handle}? Publishing is switched off until the account is connected again." Disconnecting is how an admin moves the account to another connection type.

**Job running.** `JobProgress variant="inline"` under the actions shows the job's message; the other actions are disabled.

**Archived account.** Every action is disabled with the tooltip "Restore the account to change its connection."

**Text for connection codes** (Last problem, job failures through `jobErrorText`, and the alerts above):

| Code | Text |
| --- | --- |
| `token_invalid` | Instagram no longer accepts this account's access. Connect it again. |
| `permission_missing` | A permission Social Hub needs is missing on Instagram. Connect again and allow every permission. |
| `account_mismatch` | The connected Instagram account is no longer @{handle}. |
| `not_professional` | This account is no longer a Business or Creator account. |
| `rate_limited` | Instagram asked us to slow down. This is retried automatically. |
| `provider_error` | Instagram didn't respond as expected. This is retried automatically. |

States: skeleton while loading; `PageError` with Retry on load failure; the account page handles `404`.

## Acceptance criteria

1. Given the spike is finished, when the notes file is opened, then every checklist row has a date and a result, every "(confirm in setup)" item in INSTAGRAM-INTEGRATION.md has an observed answer, the decisions from rule 5 are written down, and `SOCIALHUB_IG_API_VERSION` is set in `.env.example`.
2. Given the spike is go and BE5 is deployed to the hosted environment, when an admin connects the test account with "Connect with Instagram", then they return to the Connection tab with "Connected to @…", and the card shows the username, the account type, a token expiry about 60 days ahead, the three permissions and the capabilities; "Check connection", and a day later "Refresh token", succeed. This is a manual check recorded in the spike notes.
3. Given an admin, the `fake` provider and the code `fake-ok`, when they click "Connect with Instagram", then the browser comes back to `/settings/accounts/{id}?tab=connection`, the success alert shows, the URL no longer contains `connect`, the status is `connected`, `username` equals the handle, `account_type` is `BUSINESS`, `token_expires_at` is 60 days ahead and all four capabilities are true.
4. Given the scripted code `fake-denied`, `fake-mismatch` or `fake-personal`, when the admin connects, then the callback redirects with `oauth_denied`, `account_mismatch` or `not_professional` respectively, no token is stored, the status is unchanged, and the panel shows the matching text.
5. Given a `state` that was already used, or was created more than 10 minutes ago, when the callback receives it, then it redirects to `/settings/accounts?connect=error&code=oauth_state_invalid` and nothing is stored.
6. Given another account's connection already holds the same `ig_user_id`, when the callback finishes the exchange, then it redirects with `account_mismatch`.
7. Given the exchange grants only `instagram_business_basic` and `instagram_business_content_publish`, when the callback finishes, then the status is `connected`, `insights` is false, and the panel's warning names "Read insights".
8. Given a connected account, when its row is inspected, then `access_token_encrypted` is Fernet ciphertext; and no API response, `JobRun` row, log line or Sentry event captured during connect, verify, refresh and disconnect contains the token, the app secret or the OAuth code.
9. Given `SOCIALHUB_ENCRYPTION_KEY` is missing or is not a Fernet key, when the backend starts, then it fails with a configuration error naming the setting. Given tokens encrypted with key A and the setting `B,A`, when `reencrypt_secrets` runs and the setting is then changed to `B`, then every token still decrypts.
10. Given one connection refreshed 8 days ago and another refreshed 3 days ago, when `instagram.refresh_tokens` runs, then only the first gets a refresh job, and after that job its `token_expires_at` is 60 days ahead.
11. Given a connection whose token expires in 6 days and whose refresh fails with `rate_limited`, when the refresh job ends, then the status is `expiring`; when a later refresh succeeds, it is `connected`. Given a token whose expiry has passed, when `instagram.refresh_tokens` runs, then the status is `needs_attention` with `token_invalid`.
12. Given a connected account and the fake scenario `token_invalid`, when the daily verification runs, then the status is `needs_attention`, `last_error_code` is `token_invalid`, and `publishing_enabled` is unchanged.
13. Given a call elsewhere raises `PermissionMissing` and the fake now reports insights as not granted, when `report_connection_error` handles it, then the status becomes `needs_attention`, a verify job runs, and afterwards the status is `connected` with `insights` false.
14. Given a disconnected account, when an admin chooses "Manual posting", then the status is `connected` at once with every capability false; given a connected account, `PATCH {"provider": "manual"}` returns `409 invalid_transition`.
15. Given a connected account with publishing on and a queued verify job, when an admin disconnects, then the token and identity fields are cleared, every capability is false, the status is `disconnected`, `publishing_enabled` is false and the job is `cancelled`; a second `DELETE` returns `204`.
16. Given a token refreshed 3 hours ago, when an admin calls refresh-token, then the API returns `409 invalid_transition` with `details.reason = "token_refreshed_recently"`, and the panel's "Refresh token" button is disabled with its tooltip.
17. Given `graph_api` without `SOCIALHUB_META_APP_SECRET` in local development, when an admin calls connect, then the API returns `503 provider_not_configured` naming the setting, and the panel's "Connect with Instagram" button is disabled with its tooltip.
18. Given an operator, when they open the Connection tab, then they can read everything and run "Check connection" but see no type select, Connect, Refresh token or Disconnect controls, and the admin endpoints return `403 permission_denied`.
19. Given two tasks call `account_session` for the same account at once, when they run, then their provider calls do not overlap; given the lock stays held longer than `wait_seconds`, then the second raises `AccountBusy`.
20. Given recorded Graph error bodies for codes 190, 10, 4, 9 with the recorded subcode, 100 with subcode 33, and an HTTP 503, when the adapter receives them, then it raises `TokenInvalid`, `PermissionMissing`, `RateLimited`, `QuotaExceeded`, `NotFound` and `TransientError` respectively, and no exception text contains the token.
21. Moved to E00-S05 (acceptance criterion 14 there): the backend boots without the old publisher variables.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S04-BE1 | Meta app setup spike | Rows 1–5 with the product owner on day 1; `ig_spike` command with `make-media` and `upload` (rules 2–3); rows 6–29 over week 1; `docs/spikes/E00-S04-meta-setup.md`; the "(confirm in setup)" marks in INSTAGRAM-INTEGRATION.md replaced with results; `SOCIALHUB_IG_API_VERSION` pinned; limits handed to E04-S01 and metric names to E09-S01 (rules 1–6). | 1.0 |
| E00-S04-BE2 | `graph_api` adapter | `apps/instagram/providers/graph_api.py`: `httpx` client with version, timeouts and proxy; logging hook without query strings; connection methods and `account_stats` complete; spike-level publishing, listing and insight methods; the error mapping table (rules 9–12). Tests with `respx` on response bodies recorded in the spike, tokens replaced. | 0.75 |
| E00-S04-BE3 | Interface, registry, fake and manual | `providers/base.py` (protocol, dataclasses, errors), `registry.py`, `fake.py` (every method, remote account, call counts, scenarios, fake OAuth codes, `script()`, Redis-backed state under testing hooks), `manual.py`; capability computation with overrides (rules 7–8, 13–16). Contract tests that run against `fake` and `graph_api`. | 0.5 |
| E00-S04-BE4 | Token encryption, lock and helpers | `apps/core/crypto.py` with `MultiFernet` and the startup check; `reencrypt_secrets` command; `apps/instagram/session.py` (`account_session`); `services.report_connection_error`; `media.public_url`; the settings of INSTAGRAM-INTEGRATION.md section 9 plus `SOCIALHUB_PANEL_URL`, and the startup checks; `.env.example` and README (rules 17–22, 42). Tests for round trip, rotation, lock exclusion, `AccountBusy` and each error reaction. | 0.5 |
| E00-S04-BE5 | Connection endpoints and OAuth callback | Serializer without secrets and with `active_job`; `GET`, `PATCH` and `DELETE` connection, `connect`, and the public callback with the step table, single-use state, redirects and headers; disconnect side effects; `instagram_not_connected` and `instagram_permission_missing` in `apps/core/errors.py`; `openapi.yaml`; the `instagram` block of `GET /system/status/` (rules 23–29, 38, 41). API tests for every error row and every callback step. | 0.75 |
| E00-S04-BE6 | Token lifecycle jobs | Job kinds `instagram.verify` and `instagram.refresh_token` with conflicts and `prunable`; the verify and refresh-token endpoints; tasks `instagram.refresh_tokens` and `instagram.verify_all` with their Beat entries; the status transition service for rule 35 (rules 30–37, 39–40). Tests with a frozen clock for every transition. | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S04-FE1 | Service, status card and return handling | `src/services/socialhub/connection.ts` with types; status card with token, permissions and capabilities; return alert per code with URL clean-up; the `oauth_state_invalid` alert on `/settings/accounts`; connection code texts. Component tests for each return code. | 0.5 |
| E00-S04-FE2 | Connect card and connection types | Type select; "Connect with Instagram" (`PATCH` when needed, connect, same-tab redirect, loading state); fake helper; manual-posting flow; not-configured, archived and operator states. Component tests with mocked responses. | 0.5 |
| E00-S04-FE3 | Actions and attention states | "Check connection" and "Refresh token" `JobButton`s with polling and disabled rules; "Connect again"; the disconnect confirm naming the account; expiring, needs-attention and manual-posting states; operator read-only mode; account model refresh after changes. Playwright on the local stack with the fake provider: connect, decline (test hook), verify, refresh, disconnect, operator view. | 0.5 |

### Test

None beyond the tests inside each subtask.

## Test notes

- **Provider contract tests** (`apps/instagram/tests/test_contract.py`): one parametrised suite over every interface method, asserting result types and error translation; it runs against `fake` and against `graph_api` with `respx`.
- **Graph fixtures:** response and error bodies captured in the spike, stored under `apps/instagram/tests/fixtures/graph/` with tokens and personal data replaced; one error body per row of the mapping table.
- **Callback tests:** every step of rule 25 with each fake OAuth code; single-use state; state expiry with a frozen clock; provider changed after the start; demoted user; archived account; response headers; nothing stored on any failure.
- **Lifecycle tests:** refresh selection by age; `expiring` within 7 days; an expired token; `verify_all` fan-out skipping manual, archived and tokenless connections; every transition of rule 35; a disconnect racing a running job.
- **Secrets tests:** serializers, `JobRun` rows, captured logs, the `httpx` log hook output and exception strings contain none of the fake token value, the app secret or the OAuth code.
- **Crypto tests:** round trip, rotation, `reencrypt_secrets` run twice, an undecryptable token treated as `TokenInvalid`.
- **Lock tests:** two threads on one account never overlap; `AccountBusy` after `wait_seconds`.
- **Media URL tests** with the S3 backend mocked by `moto`: `public_url` returns an `https://` presigned URL that expires after `SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS`; with the `local` backend it raises `ImproperlyConfigured`.
- **Panel:** Vitest for each return alert, each status view and operator mode; Playwright as in FE3.
- **Fake scenarios used:** `ok`, `token_invalid`, `permission_missing`, `rate_limited`, `fail_n_times`; OAuth codes `fake-ok`, `fake-denied`, `fake-mismatch`, `fake-personal`.
- **Not automated:** anything against real Instagram. The spike checklist is the manual test record. Rows 6–8, 13 and 28 are repeated on the pilot account before it is connected for real.

## Later

- Facebook Login adapter `graph_api_fb` (hashtag search, business discovery, resumable video upload) as another provider for accounts linked to a Facebook Page; E02-S03 uses it. Nothing outside `apps/instagram` changes.
- Meta's deauthorize callback, to mark a connection `needs_attention` as soon as an account removes the app instead of at the next call; the data deletion request URL if App Review requires it.
- Alerts outside the panel (email or chat) for `needs_attention` and `expiring`.
- Instagram webhooks (comments, mentions) on the same Meta app.
