# E11-S02 — Production deployment and operations basics

| | |
| --- | --- |
| Epic | E11 Release |
| Priority | Must |
| Estimate | BE 3 d · FE 0.5 d |
| Depends on | E00-S01, E00-S04, E00-S05, E00-S06 |
| Needed by | E11-S03 |

## User story

As the person responsible for running Social Hub, I want a repeatable way to put it on one server with HTTPS, secrets, backups and a runbook, so that the team can use it every day and I can recover it when something breaks.

## Context

The repository has a development `compose.yaml`: Django's `runserver`, the Umi dev server, bind-mounted source, local-only credentials. Nothing in it is fit for a server. This story adds the production equivalent and the minimum operations around it. The target is deliberately small: one Linux VM running Docker Compose. That is enough for a handful of accounts and a few posts a day, and every part can later move to a managed service without changing application code (see [ARCHITECTURE.md](../../ARCHITECTURE.md), section 9).

"BE" days here are backend and operations work; the same person usually does both on a team this size.

## Scope

**In**

- `compose.prod.yaml` and production images for backend, workers and a web front (nginx serving the built panel and proxying the API).
- Production Django settings and startup checks.
- TLS with Let's Encrypt.
- The environment file and the full list of secrets and settings.
- A deploy script with migrations and a smoke check; a rollback procedure.
- Daily backups of the database and media, copied off the VM, and one tested restore.
- Log rotation, optional error tracker, an `ops_check` command, and a scheduler heartbeat. Stuck jobs are failed by E00-S06's sweeper.
- `docs/operations/RUNBOOK.md` with the expected failures.
- Production build of the panel.

**Out (later)**

- A staging environment and automated deploys from CI.
- Zero-downtime deploys. A deploy restarts the API for a few seconds.
- Metrics, dashboards and paging alerts.
- High availability for Postgres or Redis.
- Rotation of `SOCIALHUB_ENCRYPTION_KEY` without re-login.

## Behaviour and rules

### Server

1. One VM: Ubuntu 24.04 LTS, at least 4 vCPU, 8 GB RAM and 80 GB SSD. The render worker (headless Chromium and FFmpeg) is the largest memory user; 8 GB allows one render at a time next to everything else.
2. The VM must be able to reach `api.anthropic.com`, `api.openai.com`, Instagram and the S3-compatible storage endpoint. Choose a hosting region where all of them are reachable. If they are not reachable directly, set `HTTPS_PROXY` and `NO_PROXY` for the backend and worker services; the Anthropic and OpenAI SDKs honour these variables. Instagram traffic uses each account's own proxy (`AccountConnection.proxy_url_encrypted`) regardless.
3. Installed on the host: Docker Engine with the Compose plugin, `certbot`, `rclone`, a non-root deploy user in the `docker` group, a firewall allowing only 22, 80 and 443, unattended security upgrades, and time synchronisation (scheduling depends on a correct clock).
4. The application lives in `/opt/socialhub` (a git checkout at a release tag). The env file is `/opt/socialhub/.env.prod`, mode `600`, owned by the deploy user, and never committed.

### Services (`compose.prod.yaml`)

| Service | Image | Command | Notes |
| --- | --- | --- | --- |
| `web` | `deploy/nginx/Dockerfile` (multi-stage: builds the panel with Node, then nginx) | nginx | Ports 80 and 443. Serves the panel, proxies `/api/` and `/admin/` to `backend:8000`, serves `/static/` from a shared volume and `/media/` from the media volume when `SOCIALHUB_MEDIA_BACKEND=local`. |
| `backend` | `backend/Dockerfile` target `prod` | `gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 180 --access-logfile -` | No bind mounts, runs as an unprivileged user, healthcheck on `/api/v1/health/ready/`. The 180-second timeout lets a 500 MB upload (E06-S01) finish. |
| `worker` | same as backend | `celery -A config worker --queues=default --concurrency=4 --hostname=worker@%h` | AI, research, checks, analytics. |
| `publish-worker` | same as backend | `celery -A config worker --queues=publish --concurrency=2 --hostname=publish@%h` | Only the `publish` queue (E08-S03), so long AI jobs cannot delay the per-minute dispatcher. Locally the single `worker` consumes `default,publish`. |
| `render-worker` | `backend/Dockerfile.render` target `prod` | `celery -A config worker --queues=render --concurrency=1 --hostname=render@%h` | `shm_size: 1gb` for Chromium; memory limit 3 GB. |
| `scheduler` | same as backend | `celery -A config beat --schedule=/data/celerybeat-schedule` | Exactly one instance, with a small named volume for its schedule file. |
| `migrate` | same as backend | `python manage.py migrate --noinput && python manage.py collectstatic --noinput` | Profile `tools`; run once per deploy, never at container start of other services. |
| `postgres` | `postgres:17-alpine` | default | Named volume; not published to the host network. |
| `redis` | `redis:7-alpine` | `redis-server --save "" --appendonly no --maxmemory 512mb --maxmemory-policy noeviction` | Broker, locks and short caches; not published. Losing it loses queued tasks only (see runbook). |

5. Every service has `restart: unless-stopped`, a healthcheck where one is meaningful, and logging options `driver: json-file`, `max-size: 20m`, `max-file: 5`.
6. `backend`, `worker`, `publish-worker`, `render-worker` and `scheduler` wait for `postgres` and `redis` to be healthy. They do not run migrations.
7. All application services read `.env.prod` through `env_file`. No secret appears in `compose.prod.yaml` or in an image.

### Django in production

8. With `DJANGO_DEBUG=false` the settings enable: `SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS = 31536000`, `SECURE_CONTENT_TYPE_NOSNIFF`, `SESSION_COOKIE_SAMESITE = "Lax"`, and JSON log formatting.
9. Startup fails with a clear message (`ImproperlyConfigured`) when `DJANGO_DEBUG=false` and any of these is true: `DJANGO_SECRET_KEY` is missing or equals the local example value; `SOCIALHUB_ENCRYPTION_KEY` is missing or not a valid Fernet key; `DJANGO_ALLOWED_HOSTS` contains `*` or is empty; a provider is set to `fake`; `SOCIALHUB_TESTING_HOOKS` is true.
10. `python manage.py check --deploy` must pass with no warnings in the production configuration; the deploy script runs it.
11. The Django admin stays at `/admin/` for creating users. nginx can restrict it to listed IP addresses through an optional include file.

### nginx

12. HTTP redirects to HTTPS, except `/.well-known/acme-challenge/`, which is served from the certbot webroot.
13. `client_max_body_size 520m` (500 MB video uploads, E06-S01), `proxy_read_timeout 75s` in general and `proxy_read_timeout 180s` plus `proxy_send_timeout 180s` for `/api/v1/assets/`, gzip for text types, `X-Forwarded-Proto` and `X-Forwarded-For` set, `X-Request-ID` passed through untouched.
14. The panel is a single-page app: unknown paths fall back to `/index.html`. Files with a content hash in their name get `Cache-Control: public, max-age=31536000, immutable`; `index.html` gets `no-cache`.
15. Security headers on the panel: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.

### TLS

16. Certificates come from Let's Encrypt with `certbot certonly --webroot`. Renewal runs from certbot's systemd timer with a deploy hook that reloads nginx (`docker compose -f compose.prod.yaml exec web nginx -s reload`). The certificate directory is mounted read-only into `web`.
17. The first deploy starts `web` with an HTTP-only configuration to obtain the certificate, then switches to the full configuration. The deploy script handles both cases by checking whether the certificate files exist.

### Configuration and secrets

`deploy/env.prod.example` lists every variable with a comment. Values marked **secret** are also stored in the team's password manager.

| Variable | Secret | Purpose |
| --- | --- | --- |
| `SOCIALHUB_DOMAIN` | | Public host name, used by nginx and certbot |
| `DJANGO_SECRET_KEY` | yes | Django signing key |
| `DJANGO_DEBUG` | | `false` |
| `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS` | | The domain, and `https://` + the domain |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT` | password | Database |
| `REDIS_URL`, `CELERY_BROKER_URL` | | Redis databases 0 and 1 |
| `ANTHROPIC_API_KEY` | yes | Claude |
| `OPENAI_API_KEY` | yes | OpenAI image generation |
| `SOCIALHUB_AI_TEXT_PROVIDER`, `SOCIALHUB_AI_IMAGE_PROVIDER` | | `anthropic`, `openai` |
| `SOCIALHUB_AI_TEXT_MODEL`, `SOCIALHUB_AI_TEXT_MODEL_OVERRIDES`, `SOCIALHUB_AI_IMAGE_MODEL`, `SOCIALHUB_AI_PRICES`, `SOCIALHUB_AI_TIMEOUT_SECONDS`, `SOCIALHUB_AI_MAX_CALLS_PER_JOB` | | See [AI-INTEGRATION.md](../../AI-INTEGRATION.md) |
| `SOCIALHUB_ENCRYPTION_KEY` | yes | Fernet key that encrypts Instagram sessions and proxy URLs. If it is lost, every account must log in again. Generate once; never change it in the MVP. |
| `SOCIALHUB_MEDIA_BACKEND` | | `local` or `s3` |
| `SOCIALHUB_S3_ENDPOINT_URL`, `SOCIALHUB_S3_REGION`, `SOCIALHUB_S3_BUCKET`, `SOCIALHUB_S3_ACCESS_KEY_ID`, `SOCIALHUB_S3_SECRET_ACCESS_KEY`, `SOCIALHUB_MEDIA_URL_TTL_SECONDS` | keys | Media bucket, when `s3` (names to match E00-S06) |
| `SOCIALHUB_IG_RESEARCH_PROVIDER`, `SOCIALHUB_IG_RESEARCH_PROXY_URL` | proxy URL | Research account (E02-S03). The research username and session are stored by `manage.py ig_research_login`, not in the env file |
| `SOCIALHUB_TESTING_HOOKS` | | Must be `false` (startup refuses `true` in production, rule 9) |
| All other `SOCIALHUB_*` tuning settings | | Every setting listed in [ARCHITECTURE.md](../../ARCHITECTURE.md), [AI-INTEGRATION.md](../../AI-INTEGRATION.md) and [INSTAGRAM-INTEGRATION.md](../../INSTAGRAM-INTEGRATION.md) appears in `deploy/env.prod.example` with its default, commented out unless production needs a different value (for example `SOCIALHUB_IG_REQUIRE_PROXY=true`) |
| `HTTPS_PROXY`, `NO_PROXY` | maybe | Outbound proxy for AI providers, only if needed. `NO_PROXY` must include `postgres,redis,backend,localhost` |
| `SOCIALHUB_DEFAULT_ACCOUNT_TIME_ZONE` | | Default for new accounts |
| `SOCIALHUB_RELEASE` | | Git tag or short commit, set by the deploy script; shown in System status and sent to the error tracker |
| `SENTRY_DSN` | yes | Optional error tracker; empty disables it |
| `LOG_LEVEL` | | `INFO` |
| `BACKUP_RCLONE_REMOTE`, `BACKUP_RETENTION_DAILY`, `BACKUP_RETENTION_WEEKLY` | | Backup destination (an rclone remote, configured in the deploy user's rclone config) and retention, default 7 and 4 |

18. Instagram account proxies and sessions are not environment variables. They are entered in the panel (E00-S04) and stored encrypted in the database.

### Deploy and rollback

19. `deploy/deploy.sh <tag>` does, in order: fetch and check out the tag; write `SOCIALHUB_RELEASE`; build images; run a pre-deploy database backup; run `migrate`; run `manage.py check --deploy`; `up -d --remove-orphans`; wait up to 120 seconds for `/api/v1/health/ready/` to return 200 through nginx; print the running release. Any failing step stops the script with a non-zero exit code and leaves the previous containers running where possible.
20. Migrations in a release must be compatible with the previous release's code (add columns as nullable or with defaults; remove columns only in a later release). This is what makes rollback a code-only operation.
21. Rollback is `deploy/deploy.sh <previous-tag>`. If a migration must be undone, the runbook's restore procedure is used instead; that is a deliberate, rare decision.
22. First-time setup additionally runs `python manage.py createsuperuser` through `docker compose run --rm backend`.

### Backups and restore

23. `deploy/backup/backup.sh` runs daily at 02:30 UTC from the deploy user's crontab:
    - `pg_dump --format=custom` of the database to `/var/backups/socialhub/db/socialhub-{YYYYMMDD-HHMM}.dump`;
    - media: when `local`, `rclone sync` of the media volume to `{remote}/media/`; when `s3`, `rclone sync` from the media bucket to a second bucket or prefix (`{remote}/media/`);
    - copy the dump to `{remote}/db/`;
    - prune local and remote dumps to the retention counts (7 daily, 4 weekly);
    - write a line to `/var/log/socialhub-backup.log` and touch `/var/backups/socialhub/last-success` on success.
24. A backup that is not copied off the VM does not count. `ops_check` reports a problem when `last-success` is older than 26 hours.
25. `.env.prod` is not in the backup. Its secrets live in the password manager; without `SOCIALHUB_ENCRYPTION_KEY` a restored database cannot use its stored Instagram sessions.
26. `deploy/backup/restore.sh <dump-file>` restores onto a stopped stack: creates an empty database, `pg_restore`, syncs media back, then starts the stack. It refuses to run if the target database has tables unless `--force` is given.
27. The restore is rehearsed once before the pilot: on a scratch VM (or a second Compose project named `socialhub-restore` with its own volumes and port), restore last night's backup, sign in, open one item with a rendered asset, and confirm the asset loads. Record the date, the dump used, how long it took and who did it in the runbook. Targets to state in the runbook: at most 24 hours of data lost, back in service within 2 hours. These are targets, to be checked against the rehearsal time.

### Operations helpers

28. `python manage.py ops_check` prints, and exits non-zero if any line is a problem: database and Redis reachable; pending migrations (none expected); queue lengths for `default`, `render`, `publish` (problem above 100); the age of the scheduler's last tick (problem above 3 minutes — see rule 29); jobs `running` longer than their limit; jobs `queued` longer than 15 minutes; publications overdue by more than 10 minutes; free disk space under 15%; age of the last successful backup; certificate days remaining (problem under 14).
29. The scheduler writes a heartbeat: a Beat entry every minute runs `core.tasks.beat_heartbeat`, which sets the cache key `beat:last_tick`. `ops_check` and `/api/v1/health/ready/` do not fail on a stale heartbeat (the API is still usable), but `ops_check` reports it and the Overview attention list can use it later.
30. Stuck jobs are handled by E00-S06's sweeper, `core.sweep_stale_jobs` (every 5 minutes, `error_code = stale_job`, per-kind running timeouts and a 6-hour limit for queued jobs). This story adds no second sweeper; it only makes sure the production Beat schedule includes it and that `ops_check` reports the same limits. Publications are not touched by the sweeper; their own lease expiry and verify-before-retry rule (E08-S04) decide what happens next.
31. When `SENTRY_DSN` is set, the backend and the workers initialise the error tracker with the release, environment `production`, and tags `job_id`, `account_id`, `content_item_id` when present. Request bodies and AI payloads are not sent. When it is empty, nothing is initialised.

### Runbook

32. `docs/operations/RUNBOOK.md` is written in this story with: architecture on one page; where things live on the VM; first-time setup; deploy and rollback; backup and restore; the rehearsal record; and the failure table below, each with symptoms, how to confirm, and steps.

| Failure | Symptoms | First steps |
| --- | --- | --- |
| Instagram asks for a challenge | Connection status `challenge_required`; publications blocked with `session_problem`; attention entry | An admin opens Settings → Accounts → Connection, requests the code and submits it. Blocked publications resume by themselves. If challenges repeat, check that the account's proxy address has not changed. |
| Instagram session invalid | Status `needs_attention`; `SessionRequired` in publish attempts | Log in again from the Connection tab. Do not log in from many addresses; use the stored proxy. |
| Post may have been sent twice, or not at all | Publication in `verifying` or attempts with outcome `ambiguous` | Do nothing first: the worker verifies live before retrying (E08-S04). If it ends in `failed`, check the account on Instagram, then use "Mark as published" with the link or "Retry". |
| Stuck job | An item shows a spinner for longer than its job kind's timeout (E00-S06) | The sweeper fails it automatically with `stale_job`. Check `docker compose logs worker` for the job ID, then retry from the panel. If many jobs are stuck, check Redis and the worker containers. |
| Render failed | `production.*` job failed; `render-worker` restarted | Check `docker compose logs render-worker` for out-of-memory kills or a missing font. Confirm free memory and `/dev/shm` size. Retry the render. A specific item failing every time usually has an oversized source file. |
| AI provider errors | Jobs fail with `provider_error` or `provider_not_configured` | System status page shows which key is missing. For rate limits or outages, wait and retry. For repeated refusals on one item, edit the brief or script by hand. |
| Nothing publishes | Due publications stay `scheduled` | Check, in order: account "Publishing on"; connection status; `scheduler` container running (exactly one); `worker` consuming the `publish` queue; server clock. |
| Scheduler ran twice | Duplicate periodic work in logs | Ensure only one `scheduler` container exists (`docker compose ps`). Publishing is protected by leases; other periodic tasks are idempotent. |
| Redis restarted | Queued tasks lost; jobs stay `queued` | Start Redis. The sweeper fails stale queued jobs after 6 hours; to recover sooner, retry the affected items from the panel (a retry is allowed once the old job is failed) or fail them by hand in the Django admin. Due publications are found again from the database by the next minute tick. |
| Disk full | Uploads and renders fail; Postgres errors | `docker system prune` for old images; check `/var/backups/socialhub`; move media to S3 if on local storage. |
| Certificate expired | Browser warning | `certbot renew --force-renewal`, then reload nginx. Check the systemd timer. |
| Bad deploy | Health check fails after deploy | `deploy/deploy.sh <previous-tag>`. If data was changed by a migration that the old code cannot read, restore from the pre-deploy backup. |
| Lost VM | Everything down | New VM, install prerequisites, check out the tag, restore `.env.prod` from the password manager, run `restore.sh` with the latest remote dump, point DNS. |

## Data

No new tables or fields.

## API

No new endpoints. Two existing ones are affected:

- `GET /api/v1/health/ready/` — unchanged contract; it is the deploy script's smoke check and the target for an optional external uptime monitor.
- `GET /system/status/` (E00-S05) — must include `release` (from `SOCIALHUB_RELEASE`) so the panel can show the running version. If E00-S05 has not added it, this story does.

## Background work

| Task | Queue | Schedule | Idempotency | Retries |
| --- | --- | --- | --- | --- |
| `core.tasks.beat_heartbeat` | `default` | Every minute | Sets one cache key | None |

Host-level schedules (not Celery): backup at 02:30 UTC (crontab), certificate renewal (certbot systemd timer).

## AI

None.

## Panel

No new pages. The panel must build and run in production form:

- `npm run build` produces `frontend/dist` with no mock data, no dev proxy and no demo identity. API calls use the relative path `/api/v1/`.
- `publicPath` is `/`; history routing relies on the nginx fallback in rule 14.
- The footer shows "Social Hub {release}" using `release` from `GET /system/status/` for admins, and plain "Social Hub" for operators (the endpoint is admin-only).
- When the API is unreachable (nginx returns a non-JSON 502 or 503 during a deploy), the request error handler shows "Social Hub is restarting. Try again in a moment." instead of a parse error, and retries idempotent `GET` requests once after two seconds.

## Acceptance criteria

1. Given a clean Ubuntu 24.04 VM with the prerequisites and a filled `.env.prod`, when `deploy/deploy.sh <tag>` is run, then the stack starts, migrations are applied, and `https://{domain}/api/v1/health/ready/` returns 200.
2. Given the stack is running, when the panel is opened at `https://{domain}/`, then the login page loads over HTTPS with a valid certificate, and `http://` redirects to `https://`.
3. Given a signed-in admin, when a deep link such as `/content/42` is opened directly, then the panel loads (single-page fallback) and static assets are served with long cache headers while `index.html` is not cached.
4. Given `DJANGO_DEBUG=false` and no `SOCIALHUB_ENCRYPTION_KEY`, when the backend starts, then it exits with a message naming the missing setting.
5. Given `DJANGO_DEBUG=false` and `SOCIALHUB_AI_TEXT_PROVIDER=fake`, when the backend starts, then it exits with a message that fake providers are not allowed in production.
6. Given the VM is rebooted, when it comes back, then all services start by themselves and exactly one `scheduler` container is running.
7. Given the backup script has run, when the remote is listed, then it contains today's database dump and the media files, and local dumps older than the retention are gone.
8. Given last night's backup, when `restore.sh` is run on a scratch environment, then an admin can sign in, open an existing content item and view its rendered asset; the rehearsal is recorded in the runbook with its duration.
9. Given a job left `running` past its kind's timeout with a dead worker on the production stack, when E00-S06's sweeper runs, then the job is `failed` with `error_code = stale_job`, the item's `active_job` is cleared, the item can be retried from the panel, and `ops_check` no longer reports it.
10. Given the `scheduler` container is stopped for 5 minutes, when `ops_check` runs, then it reports the stale heartbeat and exits non-zero.
11. Given a deploy whose health check fails, when the script ends, then it exits non-zero and prints the rollback command.
12. Given `SENTRY_DSN` is empty, when the stack runs, then no error-tracker client is initialised; given it is set, then an unhandled exception in a worker task appears in the tracker with the release and `job_id`.
13. Given container logs have grown past 20 MB for a service, when Docker rotates them, then at most five files per service exist.
14. Given the API is restarting, when the panel makes a `GET` request and receives a 502 from nginx, then the user sees the restart message, not a parsing error.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E11-S02-BE1 | Production images and settings | `prod` targets in `backend/Dockerfile` and `backend/Dockerfile.render` (no dev dependencies, non-root user, gunicorn added to `pyproject.toml` and the lockfile); production settings block and startup checks (rules 8–10); JSON log formatter; unit tests for each startup check. | 0.5 |
| E11-S02-BE2 | Compose file and nginx | `compose.prod.yaml` with the services table, healthchecks, logging options, volumes; `deploy/nginx/Dockerfile` and `nginx.conf.template` (rules 12–15) with HTTP-only and HTTPS variants; `deploy/env.prod.example` with every variable from the table. | 0.75 |
| E11-S02-BE3 | TLS, deploy script, first deployment | certbot webroot flow and renewal hook; `deploy/deploy.sh` (rule 19) with smoke check and release stamping; first deployment to the VM, superuser creation, firewall and unattended upgrades documented as commands. | 0.5 |
| E11-S02-BE4 | Backup and restore | `deploy/backup/backup.sh`, `restore.sh`, crontab entry, rclone remote setup notes, retention pruning; run the restore rehearsal and record it. | 0.5 |
| E11-S02-BE5 | Operations helpers | `ops_check` management command (job limits read from E00-S06's per-kind timeouts); `beat_heartbeat` task with its Beat entry and tests; check that the production Beat schedule includes E00-S06's `core.sweep_stale_jobs`; optional Sentry initialisation for Django and Celery; `release` in `GET /system/status/`. | 0.5 |
| E11-S02-BE6 | Runbook | `docs/operations/RUNBOOK.md` with the sections in rule 32; each failure procedure tried once on the deployed system where it can be simulated (stop Redis, stop the scheduler, kill the render worker, fake challenge). | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E11-S02-FE1 | Production build of the panel | Verify `npm run build` output runs behind nginx with no mocks or demo identity; set `publicPath` and remove dev-only code paths from the production bundle; footer release text; restart message and single retry for non-JSON 502/503 in `src/requestErrorConfig.ts` with a unit test. | 0.5 |

### Test

None beyond the tests in each subtask. The deployed system is exercised by the pilot dry run in E11-S03.

## Test notes

- **Settings:** parametrised tests that import settings with different environments and assert each startup failure message.
- **Sweeper:** cases for running-too-long, queued-too-long, per-kind limits, a job that completes between selection and update, and an item whose `active_job` is cleared.
- **Scripts:** `deploy.sh`, `backup.sh` and `restore.sh` are checked with `shellcheck` and exercised on the real VM; there are no unit tests for them. `restore.sh` is tested for its refusal to overwrite a non-empty database.
- **Compose:** `docker compose -f compose.prod.yaml config` runs in CI with the example env file to catch syntax and missing variables.
- **Manual checks on the VM:** reboot test, certificate renewal dry run (`certbot renew --dry-run`), log rotation settings (`docker inspect`), upload of a 500 MB video through nginx.

## Later

- CI-built images pushed to a registry, so the VM pulls instead of building.
- A staging stack from the same compose file with its own env file.
- Managed Postgres and Redis, and S3 for media, to make the VM disposable.
- `MultiFernet` to rotate `SOCIALHUB_ENCRYPTION_KEY` without forcing re-login.
- An external uptime monitor and alerts built on `ops_check` output.
