# E00-S06 — Background jobs, run tracking and media storage

| | |
| --- | --- |
| Epic | E00 Foundation |
| Priority | Must |
| Estimate | BE 2 d · FE 1 d · QA 0 d |
| Depends on | E00-S01 (signed-in user, permission classes); E00-S02 for the panel components (Refine data provider and query client options, `StatusTag`, `errorText`) |
| Needed by | Every endpoint that returns a job (first E00-S05), E00-S03 logo uploads (storage), E06-S01 uploads (validation and storage), every worker that reads media (E06, E07), the posting pack download links (E08-S05) |

## User story

As a developer building a workflow step, I want one way to start background work, report its progress and store its files, so that every long action behaves the same in the API and the panel — and as an operator, I want to see that something is running, how far it got and why it failed, even after I reload the page.

## Context

Almost every step of the workflow is too slow for a request: research, AI writing, rendering, checks, evaluation. [ARCHITECTURE.md](../../ARCHITECTURE.md) section 4 fixes the pattern: the API creates a `JobRun`, enqueues a Celery task with the job ID and returns `202`; the task reports progress; the panel polls `GET /jobs/{id}/`. This story builds that pattern once so later stories only register a job kind and write the task body.

The scaffold already runs Celery with Redis (`worker`, `render-worker`, `scheduler` in `compose.yaml`) and has one smoke task, `core.ping`. The `worker` service consumes Celery's default queue `celery`; the `render-worker` consumes `render`. Nothing records job state yet.

Files are the second shared need. Logos (E00-S03), uploads and rendered output (E06) and the files the operator downloads from the posting pack (E08-S05) all go through one storage layer that works on a local volume in development and on an S3-compatible bucket when hosted. This story adds that layer, the storage key scheme from ARCHITECTURE.md section 6, signed URLs, a helper that gives workers a local file path, and the upload validation helper E06-S01 reuses.

The scaffold's provider and publisher guard in `backend/config/settings.py` is removed by E00-S05. This story does not touch it; it adds Celery and storage settings beside it, so it can land before or after those stories.

## Scope

**In**

- `JobRun` model, a job-kind registry and the `core.jobs` service: `start_job`, the `job_task` decorator with `JobContext`, conflict rules, `active_job` bookkeeping on targets, `cancel_queued_job`.
- Celery configuration: queues `default` and `render`, routing, acknowledgement and time-limit settings; `compose.yaml` queue flags.
- Stale-job sweeper on Celery Beat.
- `GET /jobs/{id}/`, `GET /jobs/`, and the shared `JobSummary` shape other resources embed as `active_job`.
- Media storage: `SOCIALHUB_MEDIA_BACKEND` (`local` or `s3`), key helpers, `media_url`, `local_copy` and `work_dir`, `validate_upload` with type profiles, the `storage` block of `GET /system/status/`.
- Panel: `useJob`, `useActiveJob`, `JobButton`, `JobProgress`, job error text, and a "Recent jobs" tab on Settings → System.

**Out (later)**

- Cancelling a running job from the panel, job priorities, job chains or a general workflow engine.
- Pruning old job rows.
- Live push (server-sent events or websockets) instead of polling.
- Virus scanning of uploads, image transformations on upload, a CDN.

## Behaviour and rules

### Job kinds

1. Every job kind is registered once, in the owning app's `jobs.py`, with `register_job_kind(kind, *, task, queue, timeout_seconds, target_type, conflicts_with=None)`:

   | Argument | Meaning |
   | --- | --- |
   | `kind` | Dotted name stored in `JobRun.kind`, for example `brief.generate` |
   | `task` | Celery task name, for example `content.brief_generate` |
   | `queue` | `default` or `render` |
   | `timeout_seconds` | Soft time limit and the stale threshold (rule 17) |
   | `target_type` | The kind of record the job works on, for example `content_item`, `plan`, `system` |
   | `conflicts_with` | Other kinds that may not run at the same time on the same target. The kind always conflicts with itself. |

   Example: two kinds that both rewrite the same record list each other in `conflicts_with`, so only one of them runs on that record at a time.
2. The default timeout when a story does not set one is 1,800 s (30 minutes) on every queue. Owning stories register these kinds with these timeouts, which this story's tests assert:

   | Kind | Timeout |
   | --- | --- |
   | `production.start` | 45 min |
   | `production.render` | 30 min |
   | `qc.run` | 15 min |
   | `qc.revise` | 60 min |

   `SOCIALHUB_JOB_TIMEOUT_OVERRIDES` (JSON map of kind to seconds) overrides any of them without a code change. The broker visibility timeout (rule 24, 7,200 s) stays longer than the longest limit.
3. A Django system check fails at startup when a registered kind names an unknown Celery task or queue, or when two registrations use the same kind.
4. Targets that carry an `active_job` field are registered with `register_job_target(target_type, model)`. In the MVP that is `content_item` → `ContentItem`; others can be added later. A target without such a field is still valid; its `active_job` is computed from `JobRun` when a serializer needs it (rule 23).

### Starting a job

5. `start_job(kind, *, target_id, account=None, user=None, request_id=None, payload=None) -> JobRun` is the only way to create a job. It:
   1. opens a transaction and takes a PostgreSQL advisory transaction lock on (`target_type`, `target_id`) so two requests for the same target are serialised;
   2. looks for a job on the same target whose kind is in the conflict set and whose status is `queued` or `running`; if one exists it raises `JobInProgress(job)`;
   3. creates the `JobRun` with status `queued`, `queue`, `request_id`, `created_by` and `celery_task_id` equal to the job ID;
   4. sets `active_job` on the target when the target is registered with one (rule 4);
   5. enqueues the task after the transaction commits (`transaction.on_commit`) with `apply_async(args=[str(job.id)], kwargs=payload or {}, queue=queue, task_id=str(job.id), soft_time_limit=timeout, time_limit=timeout + 60)`.
6. `payload` holds task arguments that are not on the target (for example `{"feedback": "Shorter hook"}`). It must be JSON-serialisable and is limited to 16 KB. Secrets never go in `payload`.
7. The API layer maps `JobInProgress` to `409` with code `job_in_progress` and the active job, serialised as in rule 22, in `error.details.job`. This replaces the `409 state_conflict` wording in API.md's "Long actions" paragraph.
8. If enqueueing fails after commit (broker down), the job is marked `failed` with `error_code = enqueue_failed`, `active_job` is cleared, and the error is logged with the job ID. The API response has already been sent as `202`, so the panel sees the failure on its first poll.
9. A partial unique index on (`target_type`, `target_id`, `kind`) where status is `queued` or `running` backs up rule 5 at the database level for the same kind.

### Running a job

10. Tasks are written with the `job_task` decorator, which wraps a Celery `shared_task` and hands the body a `JobContext`:

    ```python
    @job_task("brief.generate")
    def brief_generate(ctx: JobContext, **payload):
        item = ContentItem.objects.get(pk=ctx.job.target_id)
        ctx.progress(20, "Writing brief")
        brief = briefs.generate(item, job_id=ctx.job.id)
        ctx.succeed({"brief_id": brief.id, "version": brief.version})
    ```

11. On entry the decorator loads the job and moves it from `queued` to `running` with `started_at` and `deadline_at = now + timeout`, using a conditional update. If the job is already `succeeded`, `failed` or `cancelled` (a duplicate delivery or a job cancelled while queued), the body is not run and the task returns. A job found `running` is a Celery retry or a redelivery after a worker crash; the body runs again, which is why job bodies must be idempotent (ARCHITECTURE.md section 3, rule 3).
12. `ctx.progress(percent, message)` stores `progress` (0–100, never lower than the current value) and `message` (at most 120 characters). Writes closer than one second apart are merged, except the final one before finishing.
13. `ctx.succeed(result=None)` sets `succeeded`, `progress = 100`, `finished_at` and `result`. `result` is a small JSON summary of at most 16 KB, typically IDs of what was created. If the body returns without calling `succeed` or `fail`, the decorator calls `succeed(None)`.
14. `ctx.fail(code, detail="")` sets `failed`, `error_code`, `error_detail` (at most 500 characters, safe to show, no secrets or provider bodies) and `finished_at`. Exceptions are mapped by the decorator:

    | Exception | `error_code` | `error_detail` |
    | --- | --- | --- |
    | `JobError(code, detail)` raised by the body | `code` | `detail` |
    | `AIError` from the gateway (E00-S05) | its `code` | its detail, for example `refused` |
    | Celery `SoftTimeLimitExceeded` | `timeout` | "The task took longer than {n} minutes." |
    | Celery `Retry` | not a failure; status stays `running`, `message` becomes "Retrying ({n} of {max})" | — |
    | Any other exception | `server_error` | "Unexpected error. Reference: {job id}." The traceback goes to the log and the error tracker only. |

15. Every terminal update (`succeed`, `fail`, cancel, sweeper) is conditional on the current status being `queued` or `running`. A late update to a job that is already terminal changes nothing and logs a warning `job_late_update` with the job ID. The task's own database writes stand; only the job record is left alone.
16. When a job reaches a terminal status, the decorator clears `active_job` on the target if it still points to this job, and sends the `job_finished` signal (`job`) after commit. Pipeline code (E03-S04) listens to it to call `advance(item)`.

### Stale jobs and cancellation

17. Celery Beat runs `core.sweep_stale_jobs` every 5 minutes. It fails, with `error_code = stale_job`:
    - `running` jobs whose `deadline_at` is more than 120 seconds in the past (the hard time limit is 60 s after the soft one, so a live task would already have stopped);
    - `queued` jobs older than 6 hours, with `error_detail` "The task never started. A worker may be down." The limit is long because the `render` queue runs one job at a time and a busy week can queue renders for a while.
    It clears `active_job` and sends `job_finished` for each, through the same code as rule 16. It processes at most 500 jobs per run and is safe to run twice.
17a. Celery Beat runs `core.prune_jobs` daily at 03:15 UTC. It deletes jobs started by the system (`created_by` is null) whose kind is registered with `prunable=True` (for example `feeds.sync`): succeeded jobs older than 7 days and failed or cancelled ones older than 30 days. Jobs referenced by another row (`AIRun.job`, `ResearchRun.job`, `QCRun.job`) or still set as an `active_job` are skipped. At most 5,000 rows per run; idempotent.
18. `cancel_queued_job(job, reason)` cancels a `queued` job: status `cancelled`, `error_detail` = reason, `finished_at`, revokes the Celery task ID, clears `active_job`. A `running` job cannot be cancelled in the MVP; the function returns False. Other stories use it, for example when an item is cancelled (E03-S04). There is no cancel endpoint.

### Reading jobs

19. `GET /jobs/{id}/` and `GET /jobs/` are available to both roles, with one restriction: jobs whose `account` is null (system jobs such as `system.ai_test`) are visible only to admins and to the user who created them. Others get `404 not_found`, not `403`, so job IDs reveal nothing.
20. `GET /jobs/` requires `account` for operators. Admins may omit it to list across accounts, or send `account=none` for system jobs only.
21. Filters: `account`, `kind` (comma-separated exact values), `kind_prefix` (for example `production.`), `status` (comma-separated), `target_type`, `target_id`, `created_after`, `created_before`. Ordering: `created_at`, `-created_at` (default), `finished_at`, `-finished_at`. Standard paging.
22. The full job shape is the one in [API.md](../../API.md) "Long actions" plus `account`, `queue`, `created_by` and `request_id`. `JobSummary`, embedded by other resources as `active_job`, is `{id, kind, status, progress, message}`.
23. Resources with an `active_job` field serialise it as a `JobSummary` or `null`. Resources without one that still show running work (for example the AI test in E00-S05) compute it with `core.jobs.active_job_for(target_type, target_id, kinds)`. The panel never has to guess whether something is running.

### Celery configuration

24. Queues and routing:

    | Setting | Value |
    | --- | --- |
    | `CELERY_TASK_DEFAULT_QUEUE` | `default` |
    | `CELERY_TASK_QUEUES` | `default`, `render` |
    | `CELERY_TASK_ROUTES` | Only browser and FFmpeg work goes to `render`: `production.tasks.render_*`, `production.tasks.export_*`, `production.tasks.assemble_*`, `production.tasks.normalise_*`. Everything else → `default`, including AI steps such as `production.tasks.generate_copy` and `production.tasks.generate_frame_image`. Job tasks are also routed explicitly by `start_job` (rule 5) and by each step of a chain (E06-S07); the routes cover Beat and internal tasks. |
    | `CELERY_TASK_ACKS_LATE` | `True` |
    | `CELERY_TASK_REJECT_ON_WORKER_LOST` | `True` |
    | `CELERY_WORKER_PREFETCH_MULTIPLIER` | `1` |
    | `CELERY_BROKER_TRANSPORT_OPTIONS` | `{"visibility_timeout": 7200}` — longer than the longest time limit, so a long render is not redelivered while still running |
    | `CELERY_TASK_IGNORE_RESULT` | `True` — state lives in `JobRun`, not in a result backend |

25. `compose.yaml`: the `worker` command gains `--queues=default`; `render-worker` keeps `--queues=render --concurrency=1`. The existing `core.ping` task moves to the `default` queue.

### Media storage

26. `SOCIALHUB_MEDIA_BACKEND` selects Django's default storage:

    | Value | Storage | Use |
    | --- | --- | --- |
    | `local` (default) | `FileSystemStorage` at `MEDIA_ROOT` (the `media_data` volume) | Local development and automated tests. Files are served by Django at `/media/` only when `DEBUG` is true. |
    | `s3` | `storages.backends.s3.S3Storage` from `django-storages` (pinned in `requirements.lock`) | Every hosted environment. Works with AWS S3, MinIO, Cloudflare R2 and other S3-compatible services. The bucket stays private; the API and workers reach it with the access key, and operators' browsers load files through presigned URLs, so its endpoint must be reachable from where operators work. |

    Startup fails with a clear message when `DEBUG` is false and the backend is `local`, because local media has no access control.
27. Settings for `s3`:

    | Setting | Required | Default | Notes |
    | --- | --- | --- | --- |
    | `SOCIALHUB_S3_BUCKET` | Yes | — | |
    | `SOCIALHUB_S3_ENDPOINT_URL` | No | AWS | Set for MinIO, R2 and others |
    | `SOCIALHUB_S3_REGION` | No | `us-east-1` | |
    | `SOCIALHUB_S3_ACCESS_KEY_ID` / `SOCIALHUB_S3_SECRET_ACCESS_KEY` | Yes | — | Never logged or returned |
    | `SOCIALHUB_S3_ADDRESSING_STYLE` | No | `path` | `path` suits MinIO; `virtual` suits AWS |
    | `SOCIALHUB_S3_PUBLIC_BASE_URL` | No | empty | When set (public bucket or CDN), URLs are `{base}/{key}` and are not signed |

    Objects are written private (no public ACL), with the file's MIME type as `Content-Type`. Startup fails when a required setting is missing.
28. Shared settings: `SOCIALHUB_MEDIA_URL_TTL_SECONDS` (default 21,600, six hours, long enough for a working session without reloads), `SOCIALHUB_MEDIA_BASE_URL` for `local` (default `http://localhost:8000/media/`), `SOCIALHUB_WORK_DIR` for worker scratch space (default the system temporary directory).
29. Storage keys are built only by helpers in `apps/core/storage.py`, never by string formatting in other apps:

    | Helper | Key | Example |
    | --- | --- | --- |
    | `asset_key(account_id, asset_id, filename, at)` | `accounts/{account_id}/{yyyy}/{mm}/{asset_id}-{slug}.{ext}` | `accounts/3/2026/11/418-entryway-reel-final.mp4` |
    | `brand_key(account_id, variant, ext)` | `accounts/{account_id}/brand/logo-{variant}-{8 hex}.{ext}` | `accounts/3/brand/logo-light-9f2c1a7b.png` |

    `slug` is the ASCII slug of the filename stem, at most 40 characters; a stem with no ASCII letters or digits (for example a Persian filename) becomes `file`. `ext` is the lowercase extension from the validated type (rule 33), not the uploaded name. `yyyy/mm` comes from `at` in UTC. Because the key contains the asset ID, an asset row is created first and its file saved second, inside one transaction; if the file save fails, the row is rolled back.
30. `media_url(file_or_key, *, ttl=None) -> str` returns a URL the browser can load: for `local`, `SOCIALHUB_MEDIA_BASE_URL` + key; for `s3` with a public base URL, that base + key; otherwise a presigned GET URL valid for `ttl` (default `SOCIALHUB_MEDIA_URL_TTL_SECONDS`). Serializers use the `MediaURLField` that calls it.

    `media_url` also takes `download_name=None`. When it is given, the URL makes the browser save the file under that name instead of opening it: for `s3` the presigned URL carries a `Content-Disposition: attachment; filename*=UTF-8''{name}` response override; for `local` the debug `/media/` view adds the same header when the URL has `?download={name}`. The posting pack in E08-S05 uses it for the final asset and the reel cover.
31. `local_copy(file_or_key, *, expected_sha256=None)` is a context manager that yields a local `Path` for a stored file:
    - for `s3` it streams the object in 1 MB chunks into a new temporary directory under `SOCIALHUB_WORK_DIR`, checks the SHA-256 when given (mismatch raises `JobError("media_checksum_mismatch")`), and deletes the directory on exit, also on exceptions;
    - for `local` it yields the file's own path without copying.
    Callers must treat the path as read-only.
32. `work_dir(job_id)` is a context manager that yields an empty scratch directory `SOCIALHUB_WORK_DIR/socialhub-{job_id}-{random}` and deletes it on exit. Renderers write outputs there and then save them through storage.

### Upload validation

33. `validate_upload(uploaded_file, profile) -> UploadInfo` is used by every endpoint that accepts files. It returns `mime`, `ext`, `bytes` and `sha256`, and:
    1. rejects files larger than the profile's maximum before reading them (`413 payload_too_large`);
    2. sniffs the real type from the first bytes with the pure-Python `filetype` library (no system libmagic); the browser's `Content-Type` is ignored;
    3. requires the sniffed type to be in the profile and the file's extension to belong to that type (a PNG named `.jpg` is rejected);
    4. computes the SHA-256 while streaming;
    5. raises `UnsupportedMedia(field, reason)` otherwise, which the API returns as `400 unsupported_media` with the field path and a `reason` of `type_not_allowed`, `extension_mismatch` or `empty_file`.
34. Profiles shipped by this story. E06-S01 owns the final limits for library uploads and may change these values; E00-S03 keeps its own logo rules (PNG or SVG, 2 MB, SVG safety checks) and uses `validate_upload` only for size and PNG sniffing.

    | Profile | Types and extensions | Maximum |
    | --- | --- | --- |
    | `IMAGE` | JPEG (`jpg`, `jpeg`), PNG (`png`), WebP (`webp`) | 20 MB |
    | `VIDEO` | MP4 (`mp4`), QuickTime (`mov`) | 500 MB |
    | `AUDIO` | MP3 (`mp3`), M4A (`m4a`), WAV (`wav`) | 50 MB |

35. Django keeps uploads above `FILE_UPLOAD_MAX_MEMORY_SIZE` (8 MB, unchanged) in temporary files, so large videos never sit in memory. The reverse proxy in E11-S02 must allow request bodies of at least 520 MB.

## Data

`JobRun` as in [DATA-MODEL.md](../../DATA-MODEL.md) section 3, with two added fields:

| Field | Type | Notes |
| --- | --- | --- |
| `queue` | text | `default` or `render`, copied from the kind registry |
| `deadline_at` | datetime, null | `started_at` + timeout; used by the sweeper |

Indexes: (`target_type`, `target_id`, `status`); (`account`, `-created_at`); (`status`, `deadline_at`); the partial unique index from rule 9.

`ContentItem.active_job` (DATA-MODEL.md section 7) is a nullable FK to `JobRun` with `on_delete=SET_NULL`; it is created in E03 and maintained by this story's service.

New error codes used in `JobRun.error_code`: `enqueue_failed`, `stale_job`, `timeout`, `server_error`, `media_checksum_mismatch`. API error code added: none beyond `job_in_progress` and `unsupported_media`, which API.md already lists.

## API

### `GET /api/v1/jobs/{id}/`

Both roles; see rule 19 for system jobs. Response `200`, a running render job:

```json
{
  "id": "5d1a2f7e-3b8c-4c41-9e0a-7a2d6c1f4b90",
  "kind": "production.render",
  "status": "running",
  "progress": 60,
  "message": "Rendering frame 3 of 5",
  "account": 3,
  "queue": "render",
  "target_type": "content_item",
  "target_id": "88",
  "result": null,
  "error_code": null,
  "error_detail": null,
  "created_by": {"id": 2, "name": "Sara"},
  "request_id": "a3e0c9b2-6f6d-4b7e-8d55-1c2e9f0b7a14",
  "created_at": "2026-11-28T08:02:11Z",
  "started_at": "2026-11-28T08:02:12Z",
  "finished_at": null
}
```

The same job when it succeeded:

```json
{
  "id": "5d1a2f7e-3b8c-4c41-9e0a-7a2d6c1f4b90",
  "kind": "production.render",
  "status": "succeeded",
  "progress": 100,
  "message": "Done",
  "account": 3,
  "queue": "render",
  "target_type": "content_item",
  "target_id": "88",
  "result": {"content_version_id": 141, "version": 2, "final_asset_id": 418, "warnings": []},
  "error_code": null,
  "error_detail": null,
  "created_by": {"id": 2, "name": "Sara"},
  "request_id": "a3e0c9b2-6f6d-4b7e-8d55-1c2e9f0b7a14",
  "created_at": "2026-11-28T08:02:11Z",
  "started_at": "2026-11-28T08:02:12Z",
  "finished_at": "2026-11-28T08:04:47Z"
}
```

A job ended by the sweeper:

```json
{
  "id": "e4b7c1d9-0a2f-4f36-8b1e-6c9d2a7f3e55",
  "kind": "qc.run",
  "status": "failed",
  "progress": 40,
  "message": "Checking design",
  "account": 3,
  "queue": "default",
  "target_type": "content_item",
  "target_id": "91",
  "result": null,
  "error_code": "stale_job",
  "error_detail": "The task stopped responding and was ended.",
  "created_by": null,
  "request_id": null,
  "created_at": "2026-11-28T09:10:00Z",
  "started_at": "2026-11-28T09:10:01Z",
  "finished_at": "2026-11-28T09:32:05Z"
}
```

| Case | HTTP | Code |
| --- | --- | --- |
| Unknown ID, or a system job the user may not see | 404 | `not_found` |
| Malformed UUID | 404 | `not_found` |

### `GET /api/v1/jobs/?account={id}`

Example: `GET /api/v1/jobs/?account=3&status=queued,running&kind_prefix=production.`

```json
{
  "count": 2,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": "5d1a2f7e-3b8c-4c41-9e0a-7a2d6c1f4b90",
      "kind": "production.render",
      "status": "running",
      "progress": 60,
      "message": "Rendering frame 3 of 5",
      "account": 3,
      "queue": "render",
      "target_type": "content_item",
      "target_id": "88",
      "result": null,
      "error_code": null,
      "error_detail": null,
      "created_by": {"id": 2, "name": "Sara"},
      "request_id": "a3e0c9b2-6f6d-4b7e-8d55-1c2e9f0b7a14",
      "created_at": "2026-11-28T08:02:11Z",
      "started_at": "2026-11-28T08:02:12Z",
      "finished_at": null
    },
    {
      "id": "0c7f3a1b-9d2e-4e58-a6b4-2f1e8d7c5a63",
      "kind": "production.start",
      "status": "queued",
      "progress": 0,
      "message": "",
      "account": 3,
      "queue": "render",
      "target_type": "content_item",
      "target_id": "93",
      "result": null,
      "error_code": null,
      "error_detail": null,
      "created_by": null,
      "request_id": null,
      "created_at": "2026-11-28T08:03:40Z",
      "started_at": null,
      "finished_at": null
    }
  ]
}
```

| Case | HTTP | Code |
| --- | --- | --- |
| Operator omits `account` | 400 | `validation_error`, field `account`, code `required` |
| Unknown `status` value or bad date | 400 | `validation_error` on that field |

### Conflict response used by every job-starting endpoint

```json
{
  "error": {
    "code": "job_in_progress",
    "message": "…",
    "fields": [],
    "details": {
      "job": {
        "id": "5d1a2f7e-3b8c-4c41-9e0a-7a2d6c1f4b90",
        "kind": "production.render",
        "status": "running",
        "progress": 60,
        "message": "Rendering frame 3 of 5",
        "account": 3,
        "queue": "render",
        "target_type": "content_item",
        "target_id": "88",
        "result": null,
        "error_code": null,
        "error_detail": null,
        "created_by": {"id": 2, "name": "Sara"},
        "request_id": "a3e0c9b2-6f6d-4b7e-8d55-1c2e9f0b7a14",
        "created_at": "2026-11-28T08:02:11Z",
        "started_at": "2026-11-28T08:02:12Z",
        "finished_at": null
      }
    },
    "request_id": "1f9b6e2c-4d7a-4b0e-9c3f-8a5d2e7b6c10",
    "retryable": true
  }
}
```

`retryable` is true because the same request will succeed once the active job ends.

### `GET /api/v1/system/status/` — `storage` block

E00-S05 owns the endpoint; this story fills its `storage` block:

```json
{ "storage": { "backend": "s3", "bucket": "socialhub-media", "public_base_url": null } }
```

For `local`: `{"backend": "local", "bucket": null, "public_base_url": "http://localhost:8000/media/"}`.

## Background work

| Task | Queue | Trigger | Notes |
| --- | --- | --- | --- |
| `core.sweep_stale_jobs` | `default` | Celery Beat, every 5 minutes | Rule 17. At most 500 jobs per run; idempotent. |
| `core.prune_jobs` | `default` | Celery Beat, daily 03:15 UTC | Rule 17a. Deletes old system jobs of prunable kinds; skips referenced rows. |
| `core.ping` | `default` | Manual smoke test | Existing task, moved to the `default` queue. |

Every job task inherits from rules 10–16: idempotent bodies, one job record per run, acks late, soft and hard time limits per kind.

## AI

None.

## Panel

### Data layer

- `src/services/socialhub/jobs.ts`: `getJob(id)`, `listJobs(params)`, and the types `Job`, `JobSummary`, `JobStatus`, `isTerminal(status)`.
- `useJob(jobId | null, { onDone?, onFailed?, intervalMs = 2000 })` uses Refine's `useOne` on resource `jobs` (TanStack Query underneath) with `queryOptions.refetchInterval`:
  - polls every `intervalMs` while the status is `queued` or `running`, and stops at `succeeded`, `failed` or `cancelled`;
  - polling pauses while the browser tab is hidden and resumes when it is visible (TanStack Query's default, which Refine keeps);
  - calls `onDone(job)` once on `succeeded` and `onFailed(job)` once on `failed` or `cancelled`, guarded so a re-render never calls them twice;
  - on network errors it keeps polling with the interval doubling up to 10 seconds; after five failures in a row it exposes `connectionProblem = true`;
  - a `404` stops polling and returns `notFound = true`;
  - returns `{ job, isActive, isTerminal, connectionProblem, notFound }`.
- `useActiveJob({ targetType, targetId, kinds })` is for pages whose resource has no `active_job` field: on mount it calls `GET /jobs/?target_type=…&target_id=…&status=queued,running&kind=…` and returns the newest match, so a job started before a reload is picked up again.

### `JobButton`

`src/components/JobButton`. A button that starts a job and follows it.

| Prop | Type | Meaning |
| --- | --- | --- |
| `start` | `() => Promise<{ job: Job }>` | Calls the endpoint that returns `202` |
| `activeJob` | `JobSummary \| null` | The resource's `active_job`, so a running job survives a reload |
| `kinds` | `string[]` | Kinds this button starts; an active job of another kind disables the button with the tooltip "Another task is running: {kind label}" |
| `onDone` | `(job: Job) => void` | Usually refetches the resource |
| `onFailed` | `(job: Job) => void` | Optional |
| `successMessage` | `string \| (job) => string` | Default "Done" |
| `confirm` | `{ title, content, okText }` | Optional `Modal.confirm` before starting |
| `disabled`, `disabledReason` | | External disable with a tooltip |
| `type`, `size`, `icon`, `children` | | Passed to Ant Design `Button` |

Behaviour:

1. Click → optional confirmation → `start()`. The button is in loading state from the click, so a double click cannot send two requests.
2. On `202` it follows the returned job with `useJob`. While active the label becomes the job's message, or "Working…", followed by the progress when above 0 ("Rendering frame 3 of 5 · 60%"). The button stays disabled.
3. On `409 job_in_progress` it follows `error.details.job` instead of showing an error, and shows `message.info("Already running. Showing its progress.")`.
4. On `succeeded`: `message.success(successMessage)` and `onDone(job)`.
5. On `failed`: `notification.error` with the title "{label} failed", the text from `jobErrorText(job)` and the line "Reference: {job id}"; then `onFailed(job)`. The button becomes clickable again.
6. Any other error from `start()` uses the default mutation error handling from E00-S02 (rule 34 there).
7. When `activeJob` is given on mount and is active, the button starts in the following state without a click.

### `JobProgress`

`src/components/JobProgress`. Shows a job's state where more room is available, for example the production panel in E06-S07.

| Prop | Type | Meaning |
| --- | --- | --- |
| `job` or `jobId` | `Job \| JobSummary` or `string` | Follows the job with `useJob` |
| `title` | `string` | Optional heading |
| `variant` | `'card' \| 'inline'` | Card with heading, or one line |
| `onDone`, `onFailed` | | As in `useJob` |
| `onRetry` | `() => void` | When given, a failed job shows a "Try again" button |

It shows `StatusTag kind="job"`, an Ant Design `Progress` bar (`active` while running, `success` when done, `exception` when failed), the message, and the elapsed time ("Running for 2 min"). While running at 0%, a `Spin` with the message replaces the bar, because the step has not reported progress yet. A failed job shows `jobErrorText(job)` and, for admins, the `error_detail` in secondary text. `connectionProblem` shows a warning line "Can't reach the server. Still trying…". `notFound` shows "This task no longer exists."

### Job error text

`jobErrorText(job)` looks up `job.error_code` in the `errorText` map from E00-S02, then falls back to `job.error_detail`, then to "The task failed." This story adds:

| Code | Text |
| --- | --- |
| `stale_job` | This task stopped responding and was ended. Try again. |
| `timeout` | This task took too long and was stopped. Try again. |
| `enqueue_failed` | The task couldn't be started. Try again in a minute. |
| `media_checksum_mismatch` | A stored file looks damaged. Upload it again. |

Stories that introduce job error codes add their text to the same map.

### Recent jobs — Settings → System, tab "Jobs" (admin)

A `Table` (`useTable`) on `/settings/system` beside the Status tab from E00-S05, reading `GET /jobs/` without `account`.

- Columns: Started (`DateTime`), Kind, Account (handle or "System"), Target (`target_type` #`target_id`, linking to `/content/{id}` for content items), Status (`StatusTag kind="job"`), Progress, Duration, Error (text from `jobErrorText`, `error_code` in a tooltip), Started by ("System" when null).
- Filters: status, kind prefix, account.
- Auto-refresh every 10 seconds while any row on the page is active; a "Refresh" button.
- Empty state: "No background tasks yet."
- Clicking a row opens a `Drawer` with `Descriptions` of every field, `result` as formatted JSON, and the request ID.

States: skeleton while loading; `PageError` on failure; operators never see the tab.

## Acceptance criteria

1. Given a registered kind `test.echo` on the `default` queue, when `start_job` is called for content item 88, then a `JobRun` with status `queued`, `queue = default` and `celery_task_id` equal to its ID exists, item 88's `active_job` points to it, and one Celery task is enqueued only after the transaction commits.
2. Given a `queued` job of kind `test.echo` for item 88, when `start_job("test.echo", target_id=88)` is called again, then `JobInProgress` is raised and the endpoint returns `409 job_in_progress` with that job in `error.details.job`.
3. Given kinds `test.a` and `test.b` registered with each other in `conflicts_with`, and `test.a` running for content item 88, when `test.b` is started for item 88, then it is refused with `job_in_progress`; when it is started for item 89, then it is created.
4. Given two requests start the same kind for the same target at the same moment, when both commit, then exactly one job exists.
5. Given a task body that calls `ctx.progress(40, "Checking copy")` and then `ctx.succeed({"qc_run_id": 7})`, when it runs, then the job goes `queued` → `running` → `succeeded` with `progress` 100, `result` `{"qc_run_id": 7}`, `started_at` and `finished_at` set, the item's `active_job` is null, and `job_finished` is sent once.
6. Given a task body that raises `JobError("render_failed", "Frame 3 overflowed")`, when it runs, then the job is `failed` with that code and detail; given it raises `KeyError`, then the job is `failed` with `server_error`, and the detail contains no traceback.
7. Given a task that exceeds its soft time limit, when the limit fires, then the job is `failed` with `error_code = timeout`.
8. Given a job is delivered twice and the first delivery has already succeeded, when the second delivery starts, then the body does not run and the job is unchanged.
9. Given a `running` job whose `deadline_at` passed 5 minutes ago, when the sweeper runs, then the job is `failed` with `stale_job` and `active_job` is cleared; when the original task later calls `succeed`, then the job stays `failed` and a `job_late_update` warning is logged.
10. Given a `queued` job created 6 hours and 1 minute ago, when the sweeper runs, then it is `failed` with `stale_job` and the detail "The task never started. A worker may be down."; a `queued` render job created 2 hours ago is left alone.
11. Given an operator and a system job created by an admin, when the operator requests `GET /jobs/{id}/`, then the response is `404 not_found`.
12. Given an operator, when they call `GET /jobs/` without `account`, then they get `400 validation_error` on `account`; given an admin, then they get jobs across accounts.
13. Given `SOCIALHUB_MEDIA_BACKEND=s3` with a private bucket, when a serializer renders an asset URL, then it is a presigned URL that expires after `SOCIALHUB_MEDIA_URL_TTL_SECONDS`; with `SOCIALHUB_S3_PUBLIC_BASE_URL` set, it is `{base}/{key}` without a signature.
14. Given `DEBUG=false` and `SOCIALHUB_MEDIA_BACKEND=local`, when the backend starts, then it exits with a message naming the setting; given `s3` without `SOCIALHUB_S3_BUCKET`, it also exits naming the missing setting.
15. Given a file named `عکس.PNG` whose bytes are a PNG, when `asset_key` builds its key for asset 418 in November 2026 on account 3, then the key is `accounts/3/2026/11/418-file.png`.
16. Given an upload named `photo.jpg` whose bytes are a PNG, when it is validated with the `IMAGE` profile, then the API returns `400 unsupported_media` with reason `extension_mismatch`; given a 600 MB MP4 with the `VIDEO` profile, then `413 payload_too_large` is returned before the file is read.
17. Given an `s3` file and its SHA-256, when a worker uses `local_copy`, then it receives a local path to an identical file and the temporary directory is gone after the block, also when the block raises.
18. In the panel, given a `JobButton` whose `start` returns a job that runs for six seconds and succeeds, then the button shows the job's message and progress while it runs, shows the success message once, and calls `onDone` once.
19. In the panel, given a page whose resource has an active job, when I reload the page, then the `JobButton` shows the running state immediately and continues polling until the job ends.
20. In the panel, given the start request returns `409 job_in_progress`, then no error notification is shown and the button follows the existing job.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S06-BE1 | `JobRun`, registry and `start_job` | `apps/core/models.py` `JobRun` with `queue` and `deadline_at`, indexes and the partial unique index; `apps/core/jobs.py` with `register_job_kind`, `register_job_target`, system check, `start_job` (advisory lock, conflict set, on-commit enqueue, `enqueue_failed`), `JobInProgress` mapped to `409 job_in_progress` in `apps/core/errors.py`, `active_job_for`, `cancel_queued_job`. Tests for rules 1–9 and 18. | 0.5 |
| E00-S06-BE2 | `job_task`, `JobContext` and Celery configuration | Decorator and context (rules 10–16), exception mapping table, `job_finished` signal; Celery settings from rule 24; `compose.yaml` queue flags; `core.ping` on `default`. Tests with eager Celery and `captureOnCommitCallbacks` for success, failure, retry, soft time limit, duplicate delivery, late update. | 0.5 |
| E00-S06-BE3 | Job endpoints and sweeper | `JobSerializer`, `JobSummarySerializer`; `JobViewSet` (retrieve, list) with filters, ordering and the visibility rules 19–21; `core.sweep_stale_jobs` task and Beat entry; `openapi.yaml` additions for `/jobs/`, `/jobs/{id}/`, the `Job` and `JobSummary` schemas and the `details.job` conflict shape. API tests for every case above. | 0.5 |
| E00-S06-BE4 | Media storage and upload validation | `django-storages[s3]` and `filetype` pinned in `pyproject.toml` and `requirements.lock`; `STORAGES` built from `SOCIALHUB_MEDIA_BACKEND` with startup checks (rules 26–28); `apps/core/storage.py` with `asset_key`, `brand_key`, `media_url` (including `download_name`), `MediaURLField`, `local_copy`, `work_dir`; `apps/core/uploads.py` with `validate_upload`, `UploadInfo`, profiles; `/media/` URL pattern under `DEBUG`; `storage` block for `GET /system/status/`; `.env.example` entries; an optional `minio` service in `compose.yaml` under the `s3` profile. Tests with a temporary `MEDIA_ROOT` and with the S3 backend mocked by `moto`. | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S06-FE1 | Job service and hooks | `src/services/socialhub/jobs.ts` and types; `useJob` with terminal stop, once-only callbacks, backoff, hidden-tab pause; `useActiveJob`. Unit tests with fake timers. | 0.25 |
| E00-S06-FE2 | `JobButton`, `JobProgress` and error text | Both components as specified, `jobErrorText`, the four new error texts. Component tests with mocked job sequences: success, failure, `409` adoption, reload with an active job. | 0.5 |
| E00-S06-FE3 | Recent jobs tab | Jobs tab on `/settings/system` with filters, auto-refresh while active rows exist, detail drawer, admin-only visibility. | 0.25 |

### Test

None beyond the tests inside each subtask.

## Test notes

- **Service tests** run Celery eagerly and use Django's `captureOnCommitCallbacks` to prove enqueueing waits for commit. A concurrency test opens two database connections and calls `start_job` in parallel threads to prove acceptance criterion 4.
- **Sweeper tests** use a frozen clock for the `deadline_at` and 6-hour queued thresholds.
- **A contract test** asserts that every registered job kind's task exists and that every task decorated with `job_task` is registered, so a story cannot add a task the registry does not know.
- **Storage tests** cover both backends: key building (ASCII, Persian and mixed filenames, uppercase extensions), presigned versus public URLs, the download header for `download_name` (including a Persian name), `local_copy` cleanup on exceptions, checksum mismatch.
- **Upload fixtures**: a real PNG, JPEG, WebP, MP4, MOV, MP3, a PNG renamed `.jpg`, an empty file, a text file renamed `.mp4`. Oversized cases set a small profile limit in the test instead of shipping large files.
- **Manual check**: `docker compose --profile s3 up -d minio`, set the `s3` settings to the MinIO service, upload a logo through E00-S03 and open its URL.
- **Panel tests** use Vitest with fake timers and a mocked request layer; one Playwright test on the local stack runs the AI test from Settings → System (E00-S05) with fake providers and watches `JobButton` finish.

## Later

- Cancel a running job: add a `cancel_requested` flag that `JobContext.progress` checks, and a `POST /jobs/{id}/cancel/` endpoint.
- Prune old `JobRun` rows (for example succeeded jobs older than 90 days) once `active_job` links are known to be clear.
- Replace polling with server-sent events on a job channel; `useJob` keeps its interface.
- More targets with an `active_job` field: one `register_job_target` call each.
- Phase 2: a `publish` queue for the publish worker (E08-S03): add it to `CELERY_TASK_QUEUES`, route `publishing.*` to it, add `publish` to `JobRun.queue` and run a worker for it; the `publish.send` and `publish.verify` kinds register with a 20-minute timeout. E00-S04 registers `instagram.verify` and `instagram.refresh_token` (prunable, conflicting with each other) and maps Instagram provider errors in the job decorator; its `public_url` helper builds on `media_url` for Meta's downloads.
- Image variants (thumbnails) generated on upload and served from the same storage layer; virus scanning as one more step in `validate_upload`.
