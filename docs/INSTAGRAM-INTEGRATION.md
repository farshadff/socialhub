# Instagram integration

The MVP uses Meta's official Instagram Platform API: the **Instagram API with Instagram Login** (also called Business Login for Instagram). Everything Instagram-specific sits behind one provider interface, so a `manual` fallback or the Facebook Login variant of the API can be used per account without touching the rest of the product.

Facts in this document come from Meta's developer documentation as of November 2026. Items marked **(confirm in setup)** could not be checked against the live documentation while this plan was written; E00-S04's setup spike confirms each one on a real account and records the result before dependent stories start.

## 1. What the workflow needs from Instagram

| Need | Step | Official API (Instagram Login) | Manual provider |
| --- | --- | --- | --- |
| Publish a single-image feed post | 08 | Yes: image container, then publish | Operator posts by hand and pastes the link |
| Publish a Reel with cover and caption | 08 | Yes: `REELS` container with video URL and cover | Same |
| Publish an image or video Story | 08 | Yes: `STORIES` container | Same |
| Check whether a post is live before retrying | 08 | Yes: container status, recent media list, active stories list | Operator confirms |
| Reach, views, likes, comments, saves, shares per post | 09 | Yes: media insights | Operator types the numbers |
| Follower count per account | 09 | Yes: account fields | Operator types the number |
| Public trend signals from hashtags and other accounts | 02 | **No.** Hashtag search and business discovery exist only in the Facebook Login variant | Operator adds signals by hand |

Public Instagram trend signals (E02-S03) are therefore out of the MVP. Research uses web search, RSS feeds and manual signals. Section 8 describes how to add them later.

## 2. Why Instagram Login

| | Instagram Login (chosen) | Facebook Login for Business |
| --- | --- | --- |
| Account requirement | Instagram professional account (Business or Creator) | Professional account linked to a Facebook Page, managed in a Meta Business portfolio |
| Connect flow | Account owner signs in on Instagram and approves the app | Admin signs in with Facebook, picks Pages and Instagram accounts |
| Host | `graph.instagram.com` | `graph.facebook.com` |
| Permissions | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` | `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `business_management` |
| Publishing, insights, follower count | Yes | Yes |
| Hashtag search, business discovery | No | Yes (hashtag search limited to 30 unique hashtags per account per rolling 7 days) |
| Resumable video upload (no public URL needed) | Not documented for this path **(confirm in setup)** | Yes |

Instagram Login needs the least setup per account and covers every MVP need. Its costs are the missing research features and the need to host media at a public URL (section 5).

## 3. Meta app and access

One Meta app serves every account. E00-S04's spike sets it up in week 1:

1. A Meta developer account and a Meta app of type Business, owned by the company.
2. Add the Instagram product with "API setup with Instagram business login". Register the redirect URI `https://{SOCIALHUB_DOMAIN}/api/v1/instagram/oauth/callback/` (plus `http://localhost:8000/...` for development).
3. Request the three permissions in section 2.
4. **Access level.** Every app starts with Standard Access. In development mode the app works for Instagram accounts whose owners have a role on the app (administrator, developer or Instagram tester). Because Social Hub manages only company accounts, the plan is to give each connected account a tester role and stay on Standard Access **(confirm in setup)**. If that is not possible, Advanced Access needs App Review, and usually Business Verification, which takes days to weeks. Start it in week 1 if needed.
5. Record in the spike notes: app ID, app mode, granted permissions, the pinned Graph API version, and the result of each capability check in E00-S04.

### Eligibility and network

- **Developer eligibility.** Meta may not allow developer accounts, apps or Business Verification for people or companies in sanctioned countries. Confirm that the company can hold a Meta developer account and app **before** building on this integration. This is the first go/no-go item of the spike.
- **Server egress.** Workers must reach `graph.instagram.com`, `api.instagram.com` and `www.instagram.com`. Host the backend where these are reachable, or route Instagram traffic through `SOCIALHUB_IG_HTTP_PROXY`.
- **Admin browser.** The person connecting an account must be able to open `www.instagram.com` in their browser for the sign-in step.
- **Media reachability.** Meta's servers download each media file from our storage (section 5), so the bucket must be on the public internet over HTTPS.

## 4. Connecting an account and keeping the token

### Connect (OAuth)

1. An admin clicks "Connect with Instagram" on the account's Connection tab. `POST /api/v1/accounts/{id}/connection/connect/` creates a random `state`, stores `{account_id, user_id}` under it in Redis for 10 minutes, and returns the authorize URL: `https://www.instagram.com/oauth/authorize` with `client_id`, `redirect_uri`, `response_type=code`, `scope` (the three permissions) and `state` **(confirm the exact URL in setup)**.
2. The browser opens the URL. The account owner signs in to that Instagram account and approves.
3. Instagram redirects to `GET /api/v1/instagram/oauth/callback/?code=…&state=…`. This endpoint is public. It:
   - rejects an unknown or expired `state` (`oauth_state_invalid`);
   - exchanges the code for a short-lived token (`POST https://api.instagram.com/oauth/access_token`), then exchanges that for a long-lived token (`GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`). Both calls happen server-side with the app secret;
   - reads `GET /me?fields=user_id,username,account_type,name,profile_picture_url` and the granted permissions;
   - requires the username to equal the account's `handle` (`account_mismatch`) and the account type to be professional (`not_professional`);
   - stores the token encrypted, with its expiry and scopes, sets the connection `connected` and records capabilities (section 7);
   - redirects the browser to `/settings/accounts/{id}?tab=connection&connect=success`, or `&connect=error&code={code}` on failure.
4. A user who declines on Instagram's page comes back with an `error` parameter; the callback redirects with `code=oauth_denied`.

### Token lifecycle

- A long-lived token is valid for 60 days. `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…` returns a new 60-day token, but only for a token that is at least 24 hours old and not yet expired. A token that is not refreshed within 60 days expires and the account must be connected again.
- Celery Beat runs `instagram.refresh_tokens` daily at 02:15 UTC. It refreshes every connected `graph_api` token whose `token_refreshed_at` is more than `SOCIALHUB_IG_TOKEN_REFRESH_AFTER_DAYS` (default 7) days old. Refreshing weekly keeps every token about 53 days from expiry.
- A refresh that fails with `TokenInvalid` sets the connection `needs_attention`. Any other failure is retried the next day; when the token is within 7 days of expiry the status becomes `expiring` and the overview shows it.
- Changing the Instagram password, removing the app from the account, or revoking permissions invalidates the token. The next call raises `TokenInvalid`.
- `instagram.verify_all` (daily 03:00 UTC, random delay up to 30 minutes) calls `verify` for every connected, non-manual, active account and updates status and capabilities.
- Disconnecting deletes the stored token, sets every capability false and turns `publishing_enabled` off. It does not revoke the app on Instagram's side; the runbook says how to do that in the Instagram app.

### Connection statuses

| Status | Meaning | Publishing |
| --- | --- | --- |
| `disconnected` | No token | Blocked (`connection_problem`) |
| `connected` | Valid token | Allowed |
| `expiring` | Token expires within 7 days and refresh keeps failing | Allowed until expiry; admin should reconnect |
| `needs_attention` | Token invalid or revoked, or a required permission is missing | Blocked (`connection_problem`) |

## 5. Publishing

Every post is a two- or three-step container flow. All calls go to `https://graph.instagram.com/{version}/` with the account's token.

| Step | Call | Notes |
| --- | --- | --- |
| Quota | `GET /{ig_user_id}/content_publishing_limit?fields=quota_usage,config` | `config.quota_total` and `config.quota_duration` (86,400 s). Meta's guide states 100 API-published posts per rolling 24 hours, a carousel counts as one, while some reference pages still say 50; always read the live `quota_total`. Whether stories count **(confirm in setup)** |
| Create container | `POST /{ig_user_id}/media` | Feed image: `image_url`, `caption`. Reel: `media_type=REELS`, `video_url`, `caption`, `cover_url` (or `thumb_offset`), `share_to_feed=true`. Story: `media_type=STORIES` with `image_url` or `video_url`; captions are ignored for stories. Returns the container `id` |
| Wait | `GET /{container_id}?fields=status_code,status` | `status_code` is `IN_PROGRESS`, `FINISHED`, `ERROR`, `EXPIRED` (not published within 24 hours) or `PUBLISHED`. Publish only when `FINISHED` |
| Publish | `POST /{ig_user_id}/media_publish` with `creation_id={container_id}` | Returns the media `id` |
| Read back | `GET /{media_id}?fields=id,media_type,media_product_type,permalink,shortcode,timestamp,caption` | Stores permalink and shortcode |

Rules that follow from this flow (E08-S03 and E08-S04 own the details):

- **Media must be at a public URL.** The publisher creates a signed HTTPS URL for the final asset (and the reel cover) valid for `SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS` (default 7,200). Hosted environments must use the `s3` storage backend with a bucket reachable from the internet. Local development uses the `fake` provider; testing real publishing locally needs a cloud bucket.
- **Images must be JPEG** **(confirm in setup)**. The renderer exports final images as JPEG.
- **Video**: MP4 or MOV, H.264 video, AAC audio, `moov` atom at the start. The exact limits for Reels and Story videos (duration, size, frame rate) are recorded by the spike and stored in the format registry (E04-S01).
- **The container ID is the idempotency key.** The publisher stores `remote_container_id` in its own transaction before waiting or publishing. A retry never creates a second container while the first is `FINISHED` or `IN_PROGRESS`.
- **Containers expire after 24 hours**, so containers are created at send time, never ahead of time.
- **AI-content disclosure.** The container may accept an AI-generated flag (named `is_ai_generated` in earlier documentation) **(confirm in setup)**. When supported, the publisher sets it according to the brand profile's `ai_disclosure` rule; the caption disclosure line (E06-S06) applies either way.

### Verifying before a retry

When a publish call times out or returns a server error, the post may or may not exist. The publisher never resends blindly:

1. Read the container's `status_code`.
   - `FINISHED`: the publish did not happen. Calling `media_publish` again with the same container is safe.
   - `IN_PROGRESS`: wait and check again.
   - `PUBLISHED`: the post exists. Find its media ID in step 2.
   - `EXPIRED`: create a new container on the next attempt.
   - `ERROR`: fatal for this version (`MediaRejected`); open a review task.
2. To find the media ID of a published container, list `GET /{ig_user_id}/media?fields=id,caption,media_product_type,timestamp,permalink,shortcode` (feed and reels) or `GET /{ig_user_id}/stories?fields=id,media_type,timestamp` (stories), and match on product type, a timestamp at or after the attempt started minus 2 minutes, and (feed and reels) the caption's fingerprint.
3. If the container cannot be read at all, fall back to step 2 alone. If nothing matches, retry with backoff; E08-S04 sets the limits.

## 6. Analytics

| Data | Call | Notes |
| --- | --- | --- |
| Media insights | `GET /{media_id}/insights?metric=…` | Needs `instagram_business_manage_insights` |
| Like and comment counts | `GET /{media_id}?fields=like_count,comments_count` | Also available as insight metrics |
| Account stats | `GET /me?fields=followers_count,follows_count,media_count` | |

Metric names requested per format. Meta replaced `impressions` and `plays` with `views` in 2025; impressions stopped returning for media created after 2 July 2024. Request only the names below, and confirm each in setup:

| Social Hub metric | Feed image | Reel | Story |
| --- | --- | --- | --- |
| `reach` | `reach` | `reach` | `reach` |
| `views` | `views` | `views` | `views` |
| `likes` | `likes` | `likes` | — |
| `comments` | `comments` | `comments` | — |
| `saves` | `saved` | `saved` | — |
| `shares` | `shares` | `shares` | `shares` |
| `replies` | — | — | `replies` |
| `extra` (stored, not evaluated) | `total_interactions`, `profile_visits`, `follows` | `total_interactions`, `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time` | `navigation`, `profile_visits`, `follows` |

The map lives in code (`apps/instagram/metrics.py`) keyed by Graph API version, so a renamed metric is a one-line change. A metric the API rejects or omits is recorded in `unavailable`. Story insights are available only for about 24 hours after posting **(confirm in setup)**, which is why the last story checkpoint is 23 hours.

## 7. Provider interface

```python
# apps/instagram/providers/base.py

class InstagramProvider(Protocol):
    name: str

    # connection
    def authorize_url(self, *, state: str, redirect_uri: str) -> str: ...
    def exchange_code(self, *, code: str, redirect_uri: str) -> TokenGrant: ...   # short-lived → long-lived
    def refresh_token(self, token: str) -> TokenGrant: ...
    def verify(self, token: str) -> VerifyResult: ...

    # publishing
    def publishing_quota(self, token: str) -> Quota: ...
    def create_container(self, token: str, spec: ContainerSpec) -> str: ...      # container id
    def container_status(self, token: str, container_id: str) -> ContainerStatus: ...
    def publish_container(self, token: str, container_id: str) -> str: ...       # media id
    def get_media(self, token: str, media_id: str) -> RemoteMedia: ...

    # verification
    def list_recent_media(self, token: str, *, since: datetime, limit: int = 25) -> list[RemoteMedia]: ...
    def list_active_stories(self, token: str) -> list[RemoteMedia]: ...

    # analytics
    def media_insights(self, token: str, media_id: str, fmt: Format) -> InsightsResult: ...
    def account_stats(self, token: str) -> AccountStats: ...
```

| Type | Fields |
| --- | --- |
| `TokenGrant` | `access_token`, `expires_at`, `user_id`, `scopes` |
| `VerifyResult` | `status`, `ig_user_id`, `username`, `account_type`, `scopes`, `capabilities` |
| `Quota` | `usage`, `total`, `duration_seconds` |
| `ContainerSpec` | `kind` (`feed_image`, `reel`, `story_image`, `story_video`), `media_url`, `caption` (null for stories), `cover_url`, `share_to_feed`, `ai_generated` |
| `ContainerStatus` | `status_code` (`IN_PROGRESS`, `FINISHED`, `ERROR`, `EXPIRED`, `PUBLISHED`), `message` |
| `RemoteMedia` | `id`, `shortcode`, `permalink`, `media_kind` (`image`, `video`), `product_type` (`feed`, `reels`, `story`), `caption`, `timestamp` |
| `InsightsResult` | `metrics` (Social Hub metric name to int), `unavailable` (metric names), `extra`, `raw` |
| `AccountStats` | `followers`, `following`, `media_count` |

### Errors

Adapters translate Graph API errors into these. `apps.instagram.services.report_connection_error(account, error)` is the only place that changes the connection status in reaction to an error.

| Error | Graph API source | What the caller does |
| --- | --- | --- |
| `TokenInvalid` | Error code 190 (expired, revoked or invalid token) | Connection `needs_attention`; publishing is blocked with `connection_problem`; the attempt is not counted |
| `PermissionMissing` | Codes 10 and 200–299 | Connection `needs_attention`; capabilities recomputed; attempt not counted |
| `RateLimited` | Codes 4, 17, 32, 613; carries `retry_after_seconds` when known | Back off; attempt not counted |
| `QuotaExceeded` | Publishing limit reached (code 9, subcode 2207042 **(confirm in setup)**), or `quota_usage >= quota_total` before sending | Publication blocked with `daily_limit` until the window frees up |
| `MediaRejected` | Container `status_code = ERROR`, or a media error on create | Fatal for this version; review task |
| `TransientError` | Codes 1 and 2, HTTP 5xx, connection errors | Retry with backoff. During `media_publish` it is treated as ambiguous: verify first |
| `AmbiguousResult` | Timeout or connection loss during `media_publish` | Verify before any retry (section 5) |
| `NotFound` | Object does not exist (deleted post, expired story) | Metrics: checkpoint skipped (`media_not_found` or `expired`). Do not retry |
| `NotSupported` | Raised by the `manual` provider, or a capability is false | Publishing switches to manual delivery (E08-S03) |
| `AccountBusy` | Raised by `account_session` when the account lock is not free within `wait_seconds` | Publishing releases its claim and retries a minute later without counting an attempt (E08-S03); metric collection skips the account this cycle (E09-S01); interactive jobs fail with `rate_limited` |

Connection error codes returned to the panel (callback redirect `code`, or job `error_code`): `oauth_state_invalid`, `oauth_denied`, `oauth_exchange_failed`, `account_mismatch`, `not_professional`, `permission_missing`, `token_invalid`, `rate_limited`, `provider_error`.

### Helpers

- `providers.registry.get_provider(name)` returns `graph_api`, `manual` or `fake`.
- `apps.instagram.session.account_session(account, wait_seconds=60)` is the only way to call Instagram for a brand account. It takes the Redis lock `ig:lock:{account_id}` (held at most 300 s), decrypts the token, yields `(provider, token)`, and releases the lock. One call sequence per account at a time keeps publishing and metric collection from interleaving. Publishing waits 60 s; the metrics collector passes `SOCIALHUB_METRICS_LOCK_WAIT_SECONDS`.
- `apps.instagram.media.public_url(asset)` returns a signed HTTPS URL for an asset, valid for `SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS`.

## 8. Implementations

| Provider | Purpose | Notes |
| --- | --- | --- |
| `graph_api` | Default for real accounts | Plain HTTPS calls with `httpx` to the pinned Graph API version; no third-party Instagram SDK. Timeouts 15 s per call (60 s for container creation). |
| `manual` | Fallback that always works | Connecting sets the connection `connected` at once with every capability false. "Publishing" marks the publication as waiting for the operator, who downloads the asset and caption, posts by hand and pastes the link. Metrics are typed in. Publishing and analytics methods raise `NotSupported`. |
| `fake` | Local development and tests | Deterministic, scripted; described below. |

### The fake provider

The fake keeps a remote account (containers, posts, stories, call counts) so tests can count what was sent. Scripts are set in-process with `FakeProvider.script([...])` and, when `SOCIALHUB_TESTING_HOOKS=true`, read from Redis so the API and workers share them. Scenarios per account: `ok`, `token_invalid`, `permission_missing`, `rate_limited`, `quota_exceeded`, `media_rejected` (container `ERROR`), `container_slow` (stays `IN_PROGRESS` for `delay_seconds`), `container_expired`, `timeout_after_publish` (raises `AmbiguousResult` after the post exists; container reads `PUBLISHED`), `timeout_before_publish` (raises `AmbiguousResult`; container still `FINISHED`), `story_timeout_after_publish`, `fail_n_times(n)`, `appears_late` (listing hides the post for `delay_seconds`), and `values` for `media_insights` and `account_stats`. Its OAuth flow skips Instagram: the authorize URL points straight at the callback with code `fake-ok`, or `fake-denied`, `fake-mismatch`, `fake-personal` for the failure paths.

### Later: Facebook Login variant

Adding a second adapter, `graph_api_fb`, on `graph.facebook.com` with Facebook Login for Business brings hashtag search (`GET /ig_hashtag_search`, then `/{hashtag_id}/top_media` or `/recent_media`, at most 30 unique hashtags per account per rolling 7 days) and business discovery (public profile fields and recent media of other professional accounts), plus resumable video upload. It needs each account linked to a Facebook Page in a Meta Business portfolio. E02-S03 describes the research feature that would use it.

## 9. Settings

| Setting | Purpose | Default |
| --- | --- | --- |
| `SOCIALHUB_META_APP_ID` | Meta app ID | none |
| `SOCIALHUB_META_APP_SECRET` | Meta app secret; never logged | none |
| `SOCIALHUB_META_REDIRECT_URI` | OAuth redirect URI registered on the app | `http://localhost:8000/api/v1/instagram/oauth/callback/` |
| `SOCIALHUB_IG_API_VERSION` | Pinned Graph API version, set from the spike | none; required for `graph_api` |
| `SOCIALHUB_IG_HTTP_PROXY` | Optional egress proxy for all Instagram traffic | none |
| `SOCIALHUB_IG_TOKEN_REFRESH_AFTER_DAYS` | Refresh tokens older than this | 7 |
| `SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS` | Lifetime of signed media URLs handed to Meta | 7200 |
| `SOCIALHUB_ENCRYPTION_KEY` | Fernet key for stored tokens; a comma-separated list allows rotation (the first encrypts, all decrypt). Required | none |
| `SOCIALHUB_IG_DEFAULT_PROVIDER` | Provider given to a new connection | `fake` locally, `graph_api` hosted |
| `SOCIALHUB_IG_ALLOWED_PROVIDERS` | Providers an admin may choose | `fake,manual,graph_api` locally, `graph_api,manual` hosted |
| `SOCIALHUB_IG_CAPABILITY_OVERRIDES` | JSON applied after `verify`, for example `{"graph_api": {"publish_story": false}}` | `{}` |

## 10. Capability record

`verify` fills `AccountConnection.capabilities` from the granted permissions and account type; `SOCIALHUB_IG_CAPABILITY_OVERRIDES` is applied last. The rest of the product reads it instead of assuming:

| Capability | True when | If false |
| --- | --- | --- |
| `publish_feed`, `publish_reel`, `publish_story` | `instagram_business_content_publish` granted and the account is professional | The scheduler creates the publication with `delivery = manual` for that format. Re-checked at send time: a capability that turned false switches `delivery` to `manual` |
| `insights` | `instagram_business_manage_insights` granted | Metric collection records each checkpoint as skipped (`insights_unavailable`) and the panel offers manual entry |

## 11. Risks

| Risk | Effect | Response |
| --- | --- | --- |
| The company cannot hold a Meta developer account or app | No official integration at all | First go/no-go item of the week-1 spike; fall back to the `manual` provider for publishing and metrics |
| Accounts cannot be given tester roles, so App Review is needed | Publishing waits days to weeks for review | Start App Review and Business Verification in week 1 in parallel; run the pilot in development mode with tester accounts meanwhile |
| Meta cannot fetch our media URLs | Containers fail | Public HTTPS bucket, signed URLs with a 2-hour TTL; the spike publishes one image and one video from the planned bucket |
| Metric names change between API versions | Missing metrics | Pinned version; metric map in one module; `unavailable` recorded instead of guessing |
| Publishing quota is lower than expected | Posts wait | The scheduler's daily limits sit far below the quota; live quota read before every send |
| Token expires unnoticed | Publishing and metrics stop | Weekly refresh, daily verify, `expiring` status on the overview |
