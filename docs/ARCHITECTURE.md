# Architecture

The MVP is one Django application with background workers. It keeps the scaffold that already exists in this repository and adds one Django app per part of the workflow. Nothing here needs a second service, a message bus or a new database.

## 1. Stack

| Area | Choice | Notes |
| --- | --- | --- |
| API | Python, Django 6.1, Django REST framework | Already in `backend/`. Session authentication with CSRF. |
| Database | PostgreSQL 17 | The only source of truth. JSON columns hold AI-produced documents. |
| Background work | Celery with Redis as broker, one Celery Beat scheduler | Already in `compose.yaml`: `worker`, `render-worker`, `scheduler`. |
| Rendering | Headless Chromium (Playwright for Python) and FFmpeg in the `render-worker` image | HTML templates to PNG; PNG frames and clips to MP4. `ffmpeg`/`ffprobe` is also in the backend image for upload probing (E06-S01) and the format check (E07-S02). |
| Panel | React 19, TypeScript, Umi Max 4, Ant Design 6, Pro Components | Already in `frontend/`. English, left-to-right. |
| AI | `anthropic` and `openai` Python SDKs behind one gateway module | See [AI-INTEGRATION.md](AI-INTEGRATION.md). |
| Instagram | Meta's official Instagram API with Instagram Login (Graph API), called with `httpx` behind a provider interface | No third-party Instagram SDK. See [INSTAGRAM-INTEGRATION.md](INSTAGRAM-INTEGRATION.md). |
| Media storage | Django storage API; local volume in development, S3-compatible bucket when hosted | Chosen by one setting. The hosted bucket must be reachable from the internet (section 6). |
| Secrets | Environment variables; Instagram access tokens encrypted in the database with a key from the environment | No secrets in the repository. |

## 2. Backend apps

Each app owns its models, serializers, views, services and Celery tasks. Apps call each other through service functions, never by reaching into another app's models from a view. The one exception is two signals from `planning.signals`, sent after commit: `plan_activated(plan)` and `plan_closed(plan, forced, automatic)`. E10-S02 subscribes to `plan_closed`.

```text
backend/apps/
  core/         existing: errors, request IDs, pagination; adds JobRun and core.jobs, IdempotencyKey and the
                idempotency.idempotent decorator, permissions (IsAdmin, IsAdminOrReadOnly), clock, storage
                helpers, the bundled font registry (core/fonts/), overview and attention services, and
                http.safe_fetch (outbound HTTP with timeout, size cap, blocked private and listed domains)
  accounts/     InstagramAccount, BrandProfile, AccountConnection, auth endpoints
  ai/           AI gateway: provider clients, prompt registry, AIRun log
  instagram/    provider interface and adapters (graph_api, manual, fake), OAuth connect and token
                refresh, account session and lock helper, signed media URLs
  planning/     WeeklyPlan, PlanGoal, SlotTemplate, PlanSlot, signals.py      step 01
  research/     ResearchSource, ResearchRun, TrendSignal, TrendTopic          step 02
  selection/    FeedSource, FeedItem, feed readers/, Candidate, RepurposeTask step 03
  content/      ContentItem, Brief, ScriptVersion, Asset, ContentVersion,
                ContentEvent, formats.py (registry incl. script_rules and
                frame_templates), services/pipeline.py, services/scripts.py   steps 03–06
  production/   render templates, renderers, FFmpeg assembly, normalisation,
                rights resolver, production tasks                             step 06
  quality/      QCRun, QCResult, ReviewTask, the five checkers, catalogue.py  step 07
  publishing/   Publication, PublishAttempt, scheduler, publish worker,
                verification and recovery                                     step 08
  analytics/    MetricSnapshot, AccountSnapshot, PerformanceEvaluation,
                WeeklyReport                                                  steps 09–10
```

Inside an app:

```text
models.py        tables only, no business logic beyond simple properties
services.py      state changes and rules; the only place that mutates status fields
tasks.py         Celery tasks; thin wrappers that load records and call services
serializers.py   request and response shapes
views.py         DRF viewsets; validate, call a service, return
urls.py
tests/
```

## 3. The content pipeline

`ContentItem` is the record that moves through steps 03 to 08. Its `status` field is the single place that says where an item is.

Main path:

```text
selected ─► briefed ─► scripted ─► in_production ─► in_check ─┬─► approved ─► scheduled ─► publishing ─► published
   03          04         05            06             07     │                  08            08            08
                                         ▲                    ├─► needs_revision ─┘ (back to production, then recheck)
                                         └────────────────────┘
                                                              └─► in_review (human) ─► approved | needs_revision | cancelled
```

Every allowed move. The authoritative table is `ALLOWED_TRANSITIONS` in `content/services/pipeline.py` (E03-S04 rule 3).

```text
selected       ─► briefed                     brief approved (E04-S03)
briefed        ─► scripted                    script approved (E05-S02)
briefed        ─► selected                    brief superseded by a format, media kind or role change (E04-S02)
briefed        ─► in_production               operator uploads a finished file without a script (E06-S07)
scripted       ─► in_production               production starts (E06-S07)
scripted       ─► briefed | selected          script or brief superseded (E04-S02)
in_production  ─► in_check                    a version is submitted (E06-S07)
in_check       ─► approved | needs_revision | in_review   check outcome Pass, Revise or Escalate (E07-S01)
needs_revision ─► in_production               revise job starts (E07-S05), a revision is opened by hand (E06-S07),
                                              a script is re-approved (E05-S02), or a reviewer chose manual rework
in_review      ─► approved | needs_revision | cancelled   reviewer decision (E07-S06)
in_review      ─► in_check                    manual recheck; back to in_review unless it passes (E07-S01)
approved       ─► scheduled                   publication created (E08-S01)
approved       ─► in_review                   no publish time is left: review task no_slot (E08-S01)
scheduled      ─► publishing                  the worker claims it (E08-S03)
scheduled      ─► in_review                   the lateness gate finds no time: no_slot (E08-S03)
scheduled      ─► published                   marked published by hand (E08-S04)
scheduled      ─► failed                      send-time defensive check finds the version changed (`version_changed`);
                                              opens a publish_failed review task (E08-S03 gate 5)
publishing     ─► published                   sent, or found live by verification (E08-S03, E08-S04)
publishing     ─► scheduled                   claim released, connection or rate-limit interruption, waiting to retry (E08-S03, E08-S04)
publishing     ─► failed                      retries exhausted or a fatal error; opens a review task (E08-S04)
failed         ─► scheduled                   retry (E08-S04)
failed         ─► published                   marked published by hand (E08-S04)
failed         ─► needs_revision              reviewer requests changes on a publish_failed task (E07-S06 through the E08-S04 hook)
any state except published, publishing, cancelled ─► cancelled
```

There is no move out of `scheduled` back into production: after approval there are no edits in the MVP.

| Status | Set when | Leaves when |
| --- | --- | --- |
| `selected` | Selection is confirmed and the item is created with a slot | Its brief is approved |
| `briefed` | Brief approved (by a person, or automatically if `autopilot.brief`) | Its script is approved, a finished file is uploaded, or the brief is superseded |
| `scripted` | Script approved (by a person, or automatically if `autopilot.script`) | Production starts (automatic), or the script is superseded |
| `in_production` | Production job starts, a revision restarts it, a newly approved script restarts it, or the operator uploads a finished file from `briefed` | The operator or the pipeline submits a version for checking |
| `in_check` | A quality-check run starts | The run finishes |
| `needs_revision` | Outcome is Revise, a reviewer requests changes, or a reviewer requests changes after a failed publication | The revise job starts (→ `in_production`), or a reviewer chose manual rework (→ `in_production` at once, with the instructions as hold reason) |
| `in_review` | Outcome is Escalate, the revise limit is reached, or no publish time is left (`no_slot`) | A reviewer decides, or a manual recheck starts (→ `in_check`) |
| `approved` | Outcome is Pass, or a reviewer approves | The E08-S01 handler creates its publication right after approval commits (→ `scheduled`), or no time is found (→ `in_review`) |
| `scheduled` | A publication exists with a time | The worker claims it (→ `publishing`), it is marked published by hand, the lateness gate finds no time (→ `in_review`), the send-time check finds the version changed (→ `failed`, review task `publish_failed`), or it is cancelled |
| `publishing` | The worker is sending or verifying | Success or live verification finds the post (→ `published`); the claim is released or a retry is waiting (→ `scheduled`); retries exhausted or fatal (→ `failed`). The item stays `publishing` while the publication is `verifying` |
| `published` | The post is confirmed live | Terminal |
| `failed` | Retries are exhausted, the error is fatal, or the send-time version check fails | Retry (→ `scheduled`), mark as published (→ `published`; a back-dated post follows E08-S04 rule 34 for metric checkpoints), reviewer requests changes (→ `needs_revision`), cancel |
| `cancelled` | An operator cancels | Terminal |

Rules that keep this safe:

1. **One writer.** Only `content.services.pipeline` changes `ContentItem.status`. It checks the allowed transition, writes a `ContentEvent`, and registers `advance(item_id)` to run after the surrounding transaction commits. `pipeline.set_hold_reason(item, text)` changes only `hold_reason`, with no status change and no event.
2. **`advance(item)` decides what happens next.** It looks at the status and the account's `autopilot` switches and either enqueues the next job or stops and waits for a person. Apps register one handler per status (`pipeline.register_handler`) and cancel hooks (`pipeline.register_cancel_hook`). A handler error never propagates: it writes a `job_failed` event and sets the hold reason. Every step calls `advance`, so automation is one function, not logic spread over views.
3. **Jobs are idempotent.** A job is keyed by item, step and input version. Running it twice produces the same record, not a second one.
4. **AI documents are immutable versions.** Brief, script and content version rows are never edited in place. An edit or regeneration creates version n+1. Checks and publications point at one exact version.
5. **A step that is working sets `active_job`.** The panel shows a spinner from that field and the API blocks conflicting actions with `409 job_in_progress`. When a job finishes, `core.jobs` sends the `job_finished` signal; the pipeline listens to it and calls `advance(item)`.

## 4. Background work

| Queue | Worker | What runs there |
| --- | --- | --- |
| `default` | `worker` | AI calls, research, ranking, checks, analytics collection |
| `render` | `render-worker` | Chromium rendering and FFmpeg assembly, concurrency 1 per worker |
| `publish` | `worker` locally; `publish-worker` in production | Publishing and verification |

Locally, one `worker` service consumes `default,publish`. In production (E11-S02) a separate `publish-worker` runs `--queues=publish --concurrency=2` and the `worker` consumes `default` only, so long AI jobs never delay the per-minute dispatcher. Celery's default queue is `default`; tasks use late acknowledgement, prefetch 1 and a 7,200-second broker visibility timeout.

Celery task names are dotted `<app>.<verb>`, matching the job kind where there is one.

| Queue | Tasks |
| --- | --- |
| `render` | `production.render_frames`, `production.export_final_image` (E06-S02); `production.assemble_motion` (E06-S03); `production.assemble_footage` (E06-S04); `production.normalise_media` (E06-S03) |
| `default` | `production.generate_frame_image` (E06-S05), `production.generate_copy` (E06-S06); `quality.run_checks` (E07-S01); `quality.revise_plan`, `quality.revise_script`, `quality.revise_copy`, `quality.revise_finalise` (E07-S05); `analytics.collect_due_metrics`, `analytics.dispatch_follower_snapshots` (E09); `analytics.evaluate_due`, `analytics.run_evaluations` (E10-S01); `analytics.generate_weekly_report` (E10-S02); `selection.suggest_repurpose`, `selection.expire_repurpose_tasks` (E10-S04); `core.sweep_stale_jobs` (E00-S06); `core.tasks.beat_heartbeat` (E11-S02) |
| `publish` | `publishing.dispatch_due`, `publishing.send` (E08-S03); `publishing.verify` (E08-S04) |

### Job timeouts

One sweeper, `core.sweep_stale_jobs` (E00-S06), fails jobs with `stale_job`. A running job is failed when it passes `deadline_at` (`started_at` plus its kind's timeout). A queued job is failed only after six hours in the queue, because the render queue runs one job at a time. Per-kind timeouts live in code and can be overridden with `SOCIALHUB_JOB_TIMEOUT_OVERRIDES` (JSON):

| Kind | Running timeout |
| --- | --- |
| `production.start` | 45 min |
| `production.render` | 30 min |
| `qc.run` | 15 min |
| `qc.revise` | 60 min |
| `publish.send`, `publish.verify` | 20 min |
| Everything else | 30 min |

Every long action follows one pattern:

1. The API validates, creates a `JobRun` row with status `queued`, enqueues the Celery task with the job ID, and returns `202` with the job.
2. The task sets `running`, does the work, updates `progress` and `message`, then sets `succeeded` with a `result`, or `failed` with an `error_code`.
3. The panel polls `GET /api/v1/jobs/{id}/` every two seconds while a job is active and refreshes the page data when it ends.

Periodic work is driven by Celery Beat:

| Schedule | Task | What it does | Story |
| --- | --- | --- | --- |
| Every minute | `publishing.dispatch_due` | Claims due publications, enqueues due verifications, expires stale leases | E08-S03, E08-S04 |
| Every minute | `core.tasks.beat_heartbeat` | Writes the cache key `beat:last_tick` for `ops_check` | E11-S02 |
| Every 5 minutes | `core.sweep_stale_jobs` | Fails jobs past their deadline, or queued for more than six hours (`stale_job`) | E00-S06 |
| Every 10 minutes | `analytics.collect_due_metrics` | Collects metric snapshots that are due | E09-S01 |
| Every 10 minutes | `analytics.dispatch_follower_snapshots` | Records follower snapshots for accounts past 00:10 local time with no row for today | E09-S02 |
| Every 15 minutes | `analytics.evaluate_due` | Evaluates posts whose evaluation checkpoint has a captured snapshot | E10-S01 |
| Hourly at minute 0 | `feeds.sync_active_sources` | Syncs active feed sources | E03-S01 |
| Daily 02:00 UTC | `planning.close_finished_plans` | Closes plans whose week ended two days ago | E01-S03 |
| Daily 02:15 UTC | `instagram.refresh_tokens` | Refreshes connected `graph_api` tokens whose `token_refreshed_at` is older than `SOCIALHUB_IG_TOKEN_REFRESH_AFTER_DAYS` (default 7) | E00-S04 |
| Daily 02:30 UTC | `ai.prune_payloads` | Nulls `AIRun.payload` older than 30 days | E00-S05 |
| Daily 03:00 UTC | `instagram.verify_all` | Enqueues `instagram.verify` with a random delay of up to 30 min for connected, non-manual, active accounts | E00-S04 |
| Daily 03:00 UTC | `selection.expire_repurpose_tasks` | Dismisses open repurpose tasks past `expires_at` | E10-S04 |
| Daily 03:15 UTC | `core.prune_jobs` | Deletes old system jobs of prunable kinds (succeeded after 7 days, failed after 30) | E00-S06 |
| Daily 03:30 UTC | `core.prune_idempotency_keys` | Deletes idempotency rows older than 24 hours | E03-S03 |

The `plan_closed` signal starts `analytics.generate_weekly_report` (E10-S02).

Retries: transient provider errors retry inside the task with exponential backoff, at most three times. After that the job fails with a clear `error_code`, and the item shows the failure with a retry button. Stories may be stricter: `instagram.verify` waits 30 s, 2 min, 10 min; a failed scheduled token refresh is tried again by the next day's `instagram.refresh_tokens`; feed sync retries twice (10 s, 60 s); AI job tasks rely only on the gateway's own retries. Publishing has its own rule, described in E08-S04.

### Time

- Business code reads the time only through `django.utils.timezone.now()`, wrapped by `apps/core/clock.py`. A lint check bans `datetime.now(`, `datetime.utcnow(`, `time.time(` and `date.today(` in `backend/apps/` outside that module. The acceptance suite replaces the clock with a shared fake clock stored in Redis.
- Business timing never depends on Celery ETAs or countdowns. Due work is found by periodic tasks reading timestamps in PostgreSQL (`scheduled_at`, `next_attempt_at`, `next_metrics_at`, `deadline_at`).
- `apps/testing` (test hooks, fake clock control) is installed only when `SOCIALHUB_TESTING_HOOKS=true`. Related settings: `SOCIALHUB_FETCH_ALLOW_HOSTS` (hosts `safe_fetch` may reach even when they are private, such as the fixture server; honoured only when `DJANGO_DEBUG=true` or testing hooks are on) and `SOCIALHUB_E2E_PASSWORD`.

## 5. Provider adapters

Every external system sits behind an interface with a fake implementation for tests and local development. The active implementation is chosen by settings.

| Interface | Implementations | Setting |
| --- | --- | --- |
| `TextModel` (reasoning, writing, vision, web search) | `anthropic`, `fake` | `SOCIALHUB_AI_TEXT_PROVIDER` |
| `ImageModel` (image generation) | `openai`, `fake` | `SOCIALHUB_AI_IMAGE_PROVIDER` |
| `InstagramProvider` (connect, publish, verify, insights, account stats) | `graph_api` (default for real accounts), `manual`, `fake` | Per account: `AccountConnection.provider` (initial value `SOCIALHUB_IG_DEFAULT_PROVIDER`, allowed set `SOCIALHUB_IG_ALLOWED_PROVIDERS`) |
| `FeedReader` | `rss` (`feedparser`), `json_api` | Per `FeedSource.kind`; both fetch through `core.http.safe_fetch` |
| Media storage | local filesystem, S3-compatible | `SOCIALHUB_MEDIA_BACKEND` |

The existing settings file refuses to start unless every provider is `fixture` and publishing is disabled. E00-S04 and E00-S05 replace that guard with the settings above and remove `SOCIALHUB_PUBLISHER_PROVIDER`, `SOCIALHUB_PUBLISHING_ENABLED`, `SOCIALHUB_SOURCE_PROVIDER`, `SOCIALHUB_MODEL_PROVIDER` and `apps/core/providers.py`. Local development keeps the fakes as defaults. In production settings (`DJANGO_DEBUG=false`), startup refuses any `fake` provider and `SOCIALHUB_TESTING_HOOKS=true` (E11-S02).

Network: the backend and workers must reach `graph.instagram.com`, `api.instagram.com` and `www.instagram.com`. Host them where these are reachable, or route all Instagram traffic through the optional `SOCIALHUB_IG_HTTP_PROXY`. AI providers use the separate `HTTPS_PROXY` (E11-S02).

### Product settings

AI settings are in [AI-INTEGRATION.md](AI-INTEGRATION.md) section 1, Instagram settings in [INSTAGRAM-INTEGRATION.md](INSTAGRAM-INTEGRATION.md) section 9, and media settings in section 6 below. Deployment variables (`SOCIALHUB_RELEASE`, `SOCIALHUB_DOMAIN`, `SENTRY_DSN`, `LOG_LEVEL`, `HTTPS_PROXY`, `NO_PROXY`, `BACKUP_*`) are listed in E11-S02.

In brief, the Instagram settings cover the Meta app (`SOCIALHUB_META_APP_ID`, `SOCIALHUB_META_APP_SECRET`, `SOCIALHUB_META_REDIRECT_URI`), the pinned `SOCIALHUB_IG_API_VERSION`, the optional egress proxy `SOCIALHUB_IG_HTTP_PROXY`, `SOCIALHUB_IG_TOKEN_REFRESH_AFTER_DAYS`, `SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS`, the token key `SOCIALHUB_ENCRYPTION_KEY`, and the provider choices `SOCIALHUB_IG_DEFAULT_PROVIDER`, `SOCIALHUB_IG_ALLOWED_PROVIDERS` and `SOCIALHUB_IG_CAPABILITY_OVERRIDES`.

Content and fetching:

| Setting | Purpose | Default |
| --- | --- | --- |
| `SOCIALHUB_MAX_HASHTAGS` | Hashtags allowed per caption (0–30); confirm Instagram's current limit before launch | 5 |
| `SOCIALHUB_HTTP_USER_AGENT` | User agent for RSS, JSON feeds and page fetches | `SocialHubBot/1.0` |
| `SOCIALHUB_FETCH_ALLOW_HOSTS` | Hosts `safe_fetch` may reach even when private; honoured only when `DJANGO_DEBUG=true` or testing hooks are on | empty |
| `SOCIALHUB_AI_DISCLOSURE_TEXT` | JSON per language, appended to captions when AI disclosure is required (E06-S06, E07-S02) | `{"en": "Made with the help of AI.", "fa": "این محتوا با کمک هوش مصنوعی تولید شده است."}` |

Research and selection:

| Setting | Purpose | Default |
| --- | --- | --- |
| `SOCIALHUB_RESEARCH_BLOCKED_DOMAINS` | Comma-separated domains never fetched or cited | empty |
| `SOCIALHUB_RESEARCH_MAX_TOPICS` | Topics kept per research run | 8 |
| `SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS` | JSON weights for the four `evidence_breakdown` components | See E02-S04 |
| `SOCIALHUB_SELECTION_WEIGHTS` | Candidate score weights; must sum to 1.0 or startup fails | `{"evidence": 0.45, "goal_fit": 0.40, "freshness": 0.15}` |
| `SOCIALHUB_SELECTION_HALF_LIFE_DAYS` | Freshness half-life per candidate kind | `{"trend": 5, "feed_item": 10, "repurpose": 21}` |
| `SOCIALHUB_SELECTION_TOPIC_MAX_AGE_DAYS` | Oldest topic that can become a candidate | 21 |
| `SOCIALHUB_SELECTION_MAX_CANDIDATES` | Candidates kept per plan ranking | 60 |
| `SOCIALHUB_SELECTION_BATCH_SIZE` | Candidates per goal-fit AI call | 20 |
| `SOCIALHUB_SELECTION_DUPLICATE_PENALTY` | Multiplier for candidates that repeat recent content | 0.5 |
| `SOCIALHUB_SELECTION_MIN_SCORE` | Lowest total score the proposal uses | 40 |
| `SOCIALHUB_REPURPOSE_EXPIRY_DAYS` | Open repurpose tasks expire after this many days | 30 |

Checks:

| Setting | Purpose | Default |
| --- | --- | --- |
| `SOCIALHUB_QC_RUN_TIMEOUT_SECONDS` | Time limit for one check run | 600 |
| `SOCIALHUB_QC_FACTS_MAX_CLAIMS` | Claims the facts check extracts at most | 25 |
| `SOCIALHUB_QC_DESIGN_MAX_IMAGES` | Images the design check sends to vision at most | 4 |

Publishing:

| Setting | Purpose | Default |
| --- | --- | --- |
| `SOCIALHUB_PUBLISH_MIN_LEAD_MINUTES` | Minimum time between scheduling and sending | 10 |
| `SOCIALHUB_PUBLISH_WINDOW` | Local hours in which new times are chosen | `09:00-22:00` |
| `SOCIALHUB_PUBLISH_GRID_MINUTES` | Grid for chosen times | 15 |
| `SOCIALHUB_PUBLISH_BATCH_SIZE` | Publications claimed per dispatcher run | 20 |
| `SOCIALHUB_PUBLISH_LEASE_SECONDS_IMAGE` / `_VIDEO` | Worker claim length | 300 / 900 |
| `SOCIALHUB_PUBLISH_MAX_LATENESS_MINUTES` | How late a publication may still go out | 120 |
| `SOCIALHUB_PUBLISH_MAX_ATTEMPTS` | Sends per publication before it fails | 3 |
| `SOCIALHUB_PUBLISH_RETRY_BACKOFF_MINUTES` | Waits between retries | `2,10,30` |
| `SOCIALHUB_PUBLISH_VERIFY_SETTLE_SECONDS` / `_VERIFY_LOOKBACK_SECONDS` | Wait before checking live; how far before the attempt to look | 30 / 120 |

Analytics and evaluation:

| Setting | Purpose | Default |
| --- | --- | --- |
| `SOCIALHUB_METRICS_MAX_POSTS_PER_ACCOUNT_CYCLE` | Posts collected per account per 10-minute cycle | 10 |
| `SOCIALHUB_METRICS_LOCK_WAIT_SECONDS` | How long the collector waits for the account's Instagram lock | 10 |
| `SOCIALHUB_METRICS_OVERDUE_MINUTES` | When a missed checkpoint counts as overdue on the overview | 60 |
| `SOCIALHUB_EVAL_OUTPERFORM_RATIO` / `_UNDERPERFORM_RATIO` | Verdict thresholds against the baseline; validated at startup | 1.5 / 0.6 |
| `SOCIALHUB_EVAL_BASELINE_DAYS` / `_BASELINE_MIN_SAMPLES` | Baseline window and minimum sample | 60 / 5 |

Operations:

| Setting | Purpose | Default |
| --- | --- | --- |
| `SOCIALHUB_TESTING_HOOKS` | Enables the acceptance-suite hooks; refused in production | false |
| `SOCIALHUB_JOB_TIMEOUT_OVERRIDES` | JSON map of job kind to running timeout in seconds | `{}` |

## 6. Files and media

- Uploads and rendered files are `Asset` rows with a file in storage, a SHA-256 checksum, dimensions and duration. Brand logos are files on the brand profile, not assets.
- Storage keys follow `accounts/{account_id}/{yyyy}/{mm}/{asset_id}-{slug}.{ext}`; thumbnails and video posters sit next to the file as `{key}-thumb.jpg`; brand logos use `accounts/{account_id}/brand/logo-{variant}-{8 hex}.{ext}`. A filename with no ASCII letters slugs to `file`.
- `SOCIALHUB_MEDIA_BACKEND` is `local` or `s3`. Hosted environments must use `s3`; startup refuses `local` when `DEBUG` is false. A `minio` service under the Compose `s3` profile gives a local S3-compatible bucket.
- Media settings: `SOCIALHUB_S3_BUCKET`, `SOCIALHUB_S3_ENDPOINT_URL`, `SOCIALHUB_S3_REGION`, `SOCIALHUB_S3_ACCESS_KEY_ID`, `SOCIALHUB_S3_SECRET_ACCESS_KEY`, `SOCIALHUB_S3_ADDRESSING_STYLE`, `SOCIALHUB_S3_PUBLIC_BASE_URL`, `SOCIALHUB_MEDIA_URL_TTL_SECONDS` (default 21600), `SOCIALHUB_MEDIA_BASE_URL`, `SOCIALHUB_WORK_DIR` (worker temp files). Dependencies: `django-storages[s3]`, `filetype`; `moto` in tests.
- The API returns short-lived signed URLs when the bucket is private, and plain media URLs locally.
- Instagram publishing passes Meta a URL, not a file: Meta's servers download the final asset (and the reel cover) from storage. `apps.instagram.media.public_url(asset)` signs an HTTPS URL valid for `SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS` (default 7,200). The hosted bucket must therefore be publicly reachable over HTTPS. Local development uses the `fake` provider; testing real publishing locally needs a cloud bucket.

## 7. Security basics

- Session cookies are HTTP-only, `SameSite=Lax`, and `Secure` unless `DJANGO_DEBUG` is true. Sessions last 14 days of inactivity (`SESSION_SAVE_EVERY_REQUEST`). Mutating requests need the CSRF token. No public registration; users are created by an admin.
- Failed sign-ins are throttled at 5 per username and IP per 15 minutes.
- Admin-only actions: Instagram connection, account creation, archive and handle changes, publishing switch, autopilot switches, system settings.
- Instagram access tokens are encrypted with Fernet using `SOCIALHUB_ENCRYPTION_KEY`. The setting accepts a comma-separated list for rotation (the first key encrypts, all keys decrypt); startup fails without a valid key. The Meta app secret (`SOCIALHUB_META_APP_SECRET`) stays in the environment and is used only server-side, for the token exchange. Tokens and the app secret are never returned by the API or written to logs; the API exposes only `has_token`.
- The OAuth callback accepts only a `state` issued in the last 10 minutes, and connects only when the Instagram username equals the account's handle.
- Redis also backs Django's cache (`REDIS_URL`): sign-in throttle counters, OAuth `state` values (10 minutes), and per-account Instagram locks `ig:lock:{account_id}`.
- AI payload logs can contain unpublished content. They are visible to admins only and pruned after 30 days.
- Uploads are validated by MIME type, extension and size before they are stored.

## 8. Observability

- Every request carries `X-Request-ID` (already implemented). Jobs store the request ID that created them.
- Logs are JSON lines in hosted environments, with `job_id`, `account_id`, `content_item_id` where they apply.
- `AIRun` records model, tokens, cost and latency for every AI call. `PublishAttempt` records every send. `ContentEvent` records every status change. Together they answer "what happened to this item" without reading logs.
- Optional error tracking with Sentry when `SENTRY_DSN` is set: release, environment, and tags `job_id`, `account_id`, `content_item_id`. Request bodies and AI payloads are never sent (E11-S02).

## 9. How this grows after the MVP

| Later need | What changes | What stays |
| --- | --- | --- |
| More throughput | Add worker containers per queue; move rendering to bigger machines | Queue names, task code |
| Many teams | Add `Workspace` and a foreign key on `InstagramAccount`; filter by membership | Every other table already hangs off the account |
| More platforms | Add a platform field on the account model and a provider per platform | Pipeline, checks, analytics shape |
| More formats | Add an entry to the format registry, a render template and provider method | Statuses, checks framework |
| Instagram trend research | Add the `graph_api_fb` adapter (Facebook Login) for hashtag search and business discovery, then E02-S03 | Provider interface, research pipeline |
| Smarter selection and evaluation | Replace scoring functions; add embeddings | Candidate and evaluation tables |
| Split into services | The apps already talk through service functions and job IDs | API contract |
