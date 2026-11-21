# API conventions and endpoint index

All endpoints live under `/api/v1/`. This file is the contract the panel builds against. Each story specification gives the full request and response shapes for its endpoints; `docs/openapi.yaml` is extended in the same change that adds an endpoint.

## 1. Conventions

### Authentication and permissions

- Django session cookie plus CSRF token. The panel calls `GET /auth/csrf/` once, then sends `X-CSRFToken` on every mutating request.
- Every endpoint requires a signed-in user unless marked public.
- Two roles. `admin` can do everything. `operator` can do everything except the endpoints marked **admin** below.
- An unauthenticated request returns `403` with code `authentication_required`. A forbidden one returns `403` with code `permission_denied`. This matches the existing error handler.

### Account scope

Almost every resource belongs to one Instagram account.

- List endpoints require `?account={id}` and return `400 validation_error` on `account` when it is missing.
- Create endpoints take `account` in the body, or inherit it from the parent in the URL.
- The panel keeps the current account in its top bar and adds the parameter to every call.
- Not account-scoped: `/accounts/`, `/fonts/`, `/system/*`, `/ai/runs/` (account optional; the list adds `totals`), and the public `/instagram/oauth/callback/` (section 2, E00). `/fonts/` is not paginated (`{"results": [...]}`). `/candidates/` and `/selection/proposal/` also require `plan`.
- A resource outside the user's accounts, or one that does not exist, returns `404 not_found`.

### Shapes

- JSON only, `snake_case` keys, UTF-8.
- Timestamps are ISO 8601 UTC with a `Z` suffix. Dates are `YYYY-MM-DD`. The account's timezone is returned on the account so the panel can convert.
- Lists return `{"count", "next", "previous", "results"}`. `page` and `page_size` (default 50, maximum 100) control paging.
- Filters are query parameters named after fields; multiple values are comma-separated (`status=open,reserved`). Ordering uses `ordering=field` or `ordering=-field` and only the fields a story lists.
- A create returns `201` with the resource. An update returns `200` with the resource. A delete returns `204`. An asset upload that matches an existing asset returns `200` with the existing resource and `"duplicate": true`.
- Enum fields are returned as their stored value. The panel owns the display labels.
- Users: the full user object (`id`, `username`, `full_name`, `email`, `role`) appears only in `/auth/*`. Every nested reference (`created_by`, `actor`, `resolved_by`, …) is `{"id", "name"}`, where `name` is the full name, falling back to the username.

### Long actions

An endpoint that starts background work returns `202`:

```json
{
  "job": {
    "id": "0b8f6f0e-6a0b-4d3e-9a52-0c1f4f9d2a11",
    "kind": "brief.generate",
    "status": "queued",
    "progress": 0,
    "message": "",
    "account": 3,
    "queue": "default",
    "target_type": "content_item",
    "target_id": "42",
    "result": null,
    "error_code": null,
    "error_detail": null,
    "created_by": {"id": 1, "name": "Sara"},
    "request_id": "d2f1f843-9fc5-48a8-8dbe-cea02fc87f79",
    "created_at": "2026-11-22T09:00:00Z",
    "started_at": null,
    "finished_at": null
  }
}
```

The panel polls `GET /jobs/{id}/` every two seconds until `status` is `succeeded`, `failed` or `cancelled`, then reloads the affected resource. Starting an action while the same target already has an active job of the same kind, or of a kind registered as conflicting with it, returns `409 job_in_progress` with `retryable: true` and the active job in `error.details.job`. Resources that can have a running job expose it as `active_job` in the `JobSummary` shape `{id, kind, status, progress, message}`.

Jobs with no account (system jobs) are visible only to admins and to the user who started them; anyone else gets `404`. Shared job `error_code` values: `enqueue_failed`, `stale_job`, `timeout`, `server_error`, `media_checksum_mismatch`, plus the codes each story defines for its own job kinds.

An action started by a user checks provider configuration before creating a job and returns `503 provider_not_configured` straight away. Only automatic paths (autopilot, scheduled tasks, the revise loop) create the job and fail it inside with that code.

### Versioned documents

Briefs, scripts and content versions are immutable versions.

- `GET` returns the current version plus `version` and `latest_version`; for scripts also `approved_version`. `?version=n` returns an older version read-only.
- An edit is a `PUT` that carries `base_version`. The server creates version n+1. If `base_version` is not the latest, it returns `409 version_conflict` with `details.latest_version` (and optionally `latest_origin`, `latest_created_by`), so one person's edit cannot silently replace another's or an AI regeneration.
- Mutating production endpoints (`PUT`, `PATCH` and `POST` under `/content-items/{id}/production/` and `/content-items/{id}/copy/`) also carry `base_version` and return `409 version_conflict` when it is stale.

### Errors

The existing contract stays as it is:

```json
{
  "error": {
    "code": "validation_error",
    "message": "…",
    "fields": [{"path": "goals.0.target_value", "code": "min_value", "message": "…"}],
    "request_id": "d2f1f843-9fc5-48a8-8dbe-cea02fc87f79",
    "retryable": false
  }
}
```

Additions for the MVP:

- An optional `details` object inside `error` for machine-readable context:

  | Code | `details` keys |
  | --- | --- |
  | `invalid_transition` | `status` (current, always); `allowed_statuses` (target statuses allowed now) or `allowed_actions` (actions allowed now, used for publications) where the story defines them; `reason` (a story-defined machine code); plus keys a story names, such as `problems` or `fields` |
  | `job_in_progress` | `job` |
  | `version_conflict` | `latest_version`, optionally `latest_origin`, `latest_created_by` |
  | `state_conflict` | `reason` and, by case, `conflicts`, `used_by` or `candidates` |
  | `unsupported_media` | `reasons` (list) |
  | `validation_error` | story keys such as `undecided` or `task` |

- Field-level codes inside `fields[].code` (for example `invalid_week_start`, `outside_week`, `no_active_sources`) are defined by the story that owns the field. Job `error_code` values are defined by the story that owns the job.
- New codes, added to the enum in `openapi.yaml` as stories introduce them:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `invalid_credentials` | 400 | Wrong username or password, or an inactive user (sign-in) |
| `invalid_transition` | 409 | The action is not allowed in the resource's current status |
| `job_in_progress` | 409 | The target already has an active job |
| `version_conflict` | 409 | `base_version` is not the latest |
| `provider_not_configured` | 503 | A required API key or provider setting is missing |
| `provider_error` | 502 | The AI or Instagram provider failed |
| `instagram_not_connected` | 409 | The account is not connected to Instagram, or its connection is `needs_attention` |
| `instagram_permission_missing` | 409 | The connection lacks an Instagram permission the action needs |
| `publishing_disabled` | 409 | The account's stop switch is off |
| `insights_unavailable` | 409 | Metrics were requested for an account whose provider is `manual` or whose `insights` capability is false |
| `unsupported_media` | 400 | The uploaded file fails format rules; each field error carries `reason`: `type_not_allowed`, `extension_mismatch`, `empty_file`, or a format-rule reason defined by the owning story |

Existing codes with MVP meanings:

| Code | HTTP | Used for |
| --- | --- | --- |
| `not_found` | 404 | The resource does not exist or is outside the user's accounts |
| `state_conflict` | 409 | The data changed between read and write (`details.conflicts`), an idempotency key was reused with a different body (`details.reason = "idempotency_key_reused"`), or the resource is referenced elsewhere (deleting an asset in use, `details.used_by`; a feed source with candidates, `details.candidates`); manual metric entry for a checkpoint that already has numbers uses `details.reason = "snapshot_exists"` |
| `payload_too_large` | 413 | An upload is larger than its kind's size limit |
| `rate_limited` | 429 | Too many requests or a usage cap (for example generated images per item); carries `Retry-After` in seconds when waiting helps, and `retryable` says whether it does |

The API's `message` stays as implemented (Persian). The panel shows its own English text chosen by `code`, and falls back to `message` for unknown codes.

### Idempotency

Create endpoints that would be harmful to repeat (`/selection/confirm/`, `/review-tasks/{id}/resolve/`, `/publications/{id}/publish-now/`, `/publications/{id}/retry/`) accept an `Idempotency-Key` header of 8–64 characters.

- The first 2xx response for (user, method, path, key) is stored for 24 hours with a SHA-256 of the request body (`core.IdempotencyKey`).
- The same key and body returns the stored response with the header `Idempotency-Replayed: true`.
- The same key with a different body returns `409 state_conflict` with `details.reason = "idempotency_key_reused"`.
- 4xx and 5xx responses are not stored.

## 2. Endpoint index

**admin** marks admin-only endpoints. "→ job" means the endpoint returns `202` with a job.

### E00 Foundation

| Method and path | Purpose | Story |
| --- | --- | --- |
| `GET /auth/csrf/` | Set the CSRF cookie (public) | E00-S01 |
| `POST /auth/login/` | Sign in (public) | E00-S01 |
| `POST /auth/logout/` | Sign out | E00-S01 |
| `GET /auth/me/` | Current user and role | E00-S01 |
| `GET /accounts/` · `POST /accounts/` (**admin**) | List and create Instagram accounts | E00-S03 |
| `GET /accounts/{id}/` · `PATCH /accounts/{id}/` | Read and update an account (`handle`, `publishing_enabled`, `autopilot`, `status` are **admin**) | E00-S03 |
| `GET /accounts/{id}/brand/` · `PUT /accounts/{id}/brand/` | Brand profile | E00-S03 |
| `POST /accounts/{id}/brand/logo/` | Upload a logo (`variant=light|dark`) | E00-S03 |
| `GET /fonts/` | Bundled fonts available to brand profiles | E00-S03 |
| `GET /accounts/{id}/connection/` | Status, username, account type, token expiry, scopes, capabilities and `has_token` (never the token) | E00-S04 |
| `PATCH /accounts/{id}/connection/` (**admin**) | Choose the provider (`graph_api`, `manual`, `fake`), only while `disconnected`; `manual` connects at once with every capability false | E00-S04 |
| `POST /accounts/{id}/connection/connect/` (**admin**) | Start "Connect with Instagram": returns `authorize_url` and `expires_at` (the OAuth state lives 10 minutes) | E00-S04 |
| `GET /instagram/oauth/callback/` | Instagram's OAuth redirect (public); finishes the connection and redirects the browser to the account's Connection tab | E00-S04 |
| `POST /accounts/{id}/connection/verify/` | Re-check the token, permissions and capabilities → job | E00-S04 |
| `POST /accounts/{id}/connection/refresh-token/` (**admin**) | Refresh the long-lived token now → job | E00-S04 |
| `DELETE /accounts/{id}/connection/` (**admin**) | Disconnect: delete the stored token, set every capability false, turn `publishing_enabled` off | E00-S04 |
| `GET /system/status/` (**admin**) | Which providers and keys are configured; whether the Meta app settings are configured and the pinned Graph API version; versions and `release` | E00-S05, E11-S02 |
| `POST /system/ai-test/` (**admin**) | One text call and one image call → job | E00-S05 |
| `GET /ai/runs/` (**admin**) | AI call log with filters and `totals` | E00-S05 |
| `GET /ai/runs/{id}/` (**admin**) | One AI call with its payload | E00-S05 |
| `GET /jobs/{id}/` | One job | E00-S06 |
| `GET /jobs/` | Jobs by `account` (required for operators; admins may omit it or pass `account=none` for system jobs), `kind`, `kind_prefix`, `status`, `target_type`, `target_id`, `created_after`, `created_before` | E00-S06 |

The OAuth callback is public because Instagram's redirect lands on it. It needs no signed-in session and takes no `account` parameter: the `state` that `connect/` stored in Redis identifies the account and the admin, and an unknown or expired `state` is refused. It finishes the token exchange synchronously and answers with a redirect, not JSON: `/settings/accounts/{id}?tab=connection&connect=success`, or `&connect=error&code={code}` with a connection code from [INSTAGRAM-INTEGRATION.md](INSTAGRAM-INTEGRATION.md) section 7.

### E01 Weekly plan

| Method and path | Purpose | Story |
| --- | --- | --- |
| `GET /plans/` · `POST /plans/` | List and create plans | E01-S01 |
| `GET /plans/current/` | The active plan whose week contains today, else the nearest future active plan, or `404` | E01-S01 |
| `GET /plans/{id}/` · `PATCH /plans/{id}/` · `DELETE /plans/{id}/` | Read, update (goals nested), delete a draft | E01-S01 |
| `GET /accounts/{id}/slot-template/` · `PUT /accounts/{id}/slot-template/` | The account's usual week | E01-S02 |
| `GET /plans/{id}/slots/` · `POST /plans/{id}/slots/` | List and add slots | E01-S02 |
| `POST /plans/{id}/slots/generate/` | Create slots from the template | E01-S02 |
| `PATCH /slots/{id}/` · `DELETE /slots/{id}/` | Change, skip or unskip a slot; remove a slot | E01-S02 |
| `POST /plans/{id}/activate/` | Draft → active | E01-S03 |
| `POST /plans/{id}/close/` | Active → closed | E01-S03 |
| `POST /plans/{id}/duplicate/` | Copy a plan to another week | E01-S03 |

### E02 Trend research

| Method and path | Purpose | Story |
| --- | --- | --- |
| `GET /research/sources/` · `POST /research/sources/` | Watchlist | E02-S01 |
| `PATCH /research/sources/{id}/` · `DELETE /research/sources/{id}/` | Change or remove a source | E02-S01 |
| `POST /research/runs/` | Start a research run → job | E02-S02 |
| `GET /research/runs/` · `GET /research/runs/{id}/` | Run history and stats | E02-S02 |
| `GET /research/signals/` · `POST /research/signals/` | List signals; add one by hand | E02-S02 |
| `GET /research/topics/` · `POST /research/topics/` | List topics; add one by hand | E02-S04, E02-S05 |
| `GET /research/topics/{id}/` · `PATCH /research/topics/{id}/` | Topic detail with signals; shortlist or dismiss | E02-S05 |

### E03 Content selection

| Method and path | Purpose | Story |
| --- | --- | --- |
| `GET /feeds/sources/` · `POST /feeds/sources/` | Feed sources | E03-S01 |
| `PATCH /feeds/sources/{id}/` · `DELETE /feeds/sources/{id}/` | Change or remove a feed source | E03-S01 |
| `POST /feeds/sources/{id}/sync/` | Fetch now → job | E03-S01 |
| `GET /feeds/items/` · `POST /feeds/items/` | List feed items; add one by hand | E03-S01 |
| `PATCH /feeds/items/{id}/` | Change status (including `used` → `eligible`); edit a manual item's text | E03-S01 |
| `POST /selection/rank/` | Build and rank candidates for a plan → job | E03-S02 |
| `GET /candidates/` · `PATCH /candidates/{id}/` | List ranked candidates; reject or restore | E03-S02 |
| `GET /selection/proposal/` | Proposed candidate-to-slot assignments for a plan | E03-S03 |
| `POST /selection/confirm/` | Confirm assignments and create content items | E03-S03 |
| `GET /content-items/` | Pipeline list with filters | E03-S04 |
| `GET /content-items/{id}/` | Item detail with current brief, script, version and publication summaries | E03-S04 |
| `POST /content-items/{id}/cancel/` | Cancel an item | E03-S04 |
| `GET /content-items/{id}/events/` | Item history | E03-S04 |

### E04 Formats and briefs

| Method and path | Purpose | Story |
| --- | --- | --- |
| `GET /formats/` | `registry_version`, `formats` (sizes, limits, allowed modes, `script_rules`, `frame_templates`), `production_modes`, `roles`; sends an ETag and answers `304` when unchanged | E04-S01, E05-S01 |
| `PATCH /content-items/{id}/` | Set `format`, `media_kind`, `production_mode`, `role`, `slot`; the response carries `effects` (superseded brief or script, status change) | E04-S02 |
| `POST /content-items/{id}/brief/generate/` | Write a brief → job | E04-S03 |
| `POST /plans/{id}/briefs/generate/` | Write briefs for every selected item in a plan → job | E04-S03 |
| `GET /content-items/{id}/brief/` · `PUT /content-items/{id}/brief/` | Read the current brief (`?version=n` for an older one); save an edit as a new version | E04-S03 |
| `GET /content-items/{id}/brief/versions/` | Brief history | E04-S03 |
| `POST /content-items/{id}/brief/approve/` | Approve the latest version, body `{"version": n}`; item becomes `briefed` | E04-S03 |

### E05 Script and storyboard

| Method and path | Purpose | Story |
| --- | --- | --- |
| `POST /content-items/{id}/script/generate/` | Write a script package, optionally with feedback → job | E05-S01, E05-S03 |
| `GET /content-items/{id}/script/` · `PUT /content-items/{id}/script/` | Read the current script; save an edit as a new version | E05-S01 (GET), E05-S02 (PUT) |
| `GET /content-items/{id}/script/versions/` · `GET /content-items/{id}/script/versions/{version}/` | Script history | E05-S03 |
| `POST /content-items/{id}/script/approve/` | Approve; item becomes `scripted` and production starts | E05-S02 |

### E06 Assets and copy

| Method and path | Purpose | Story |
| --- | --- | --- |
| `GET /assets/` · `POST /assets/` | List; upload (multipart) | E06-S01 |
| `GET /assets/{id}/` · `PATCH /assets/{id}/` · `DELETE /assets/{id}/` | Read; edit rights metadata; delete if unused | E06-S01 |
| `GET /render-templates/` | Available render templates per format | E06-S02 |
| `POST /content-items/{id}/production/start/` | Run production for the approved script → job | E06-S07 |
| `GET /content-items/{id}/production/` | Current content version with frames, final asset, copy, render status; `?version=n` for a read-only older version | E06-S07 |
| `PATCH /content-items/{id}/production/` | Set music and reel cover frame on the draft version | E06-S03 |
| `POST /content-items/{id}/production/render/` | Re-render all or selected frames and reassemble → job | E06-S02, E06-S03, E06-S04 |
| `PUT /content-items/{id}/production/frames/{index}/` | Change a frame's text, template or background asset | E06-S07 |
| `PUT /content-items/{id}/production/clips/` | Map uploaded clips to shots (video mode) | E06-S04 |
| `POST /content-items/{id}/production/generate-image/` | Generate a background image for a frame → job | E06-S05 |
| `POST /content-items/{id}/copy/generate/` | Draft caption and hashtags → job | E06-S06 |
| `PUT /content-items/{id}/copy/` | Edit caption, hashtags, alt text | E06-S06 |
| `POST /content-items/{id}/production/final-asset/` | Use an uploaded file as the final asset | E06-S07 |
| `POST /content-items/{id}/production/submit/` | Submit the version for checking | E06-S07 |

### E07 Quality check

| Method and path | Purpose | Story |
| --- | --- | --- |
| `POST /content-items/{id}/checks/run/` | Run the five checks on the current version → job | E07-S01 |
| `POST /content-items/{id}/revision/retry/` | Restart a failed automatic revision → job | E07-S05 |
| `GET /content-items/{id}/checks/` | Check runs for an item, newest first | E07-S06 |
| `GET /checks/runs/{id}/` | One run with its five results | E07-S06 |
| `GET /review-tasks/` | Human review queue | E07-S06 |
| `GET /review-tasks/{id}/` | One task with item, version and findings | E07-S06 |
| `POST /review-tasks/{id}/resolve/` | Approve, request changes or reject | E07-S06 |

### E08 Schedule and publish

| Method and path | Purpose | Story |
| --- | --- | --- |
| `GET /publications/` · `GET /publications/{id}/` | Publications with attempts | E08-S02 |
| `GET /calendar/` | Slots and publications for a date range | E08-S02 |
| `POST /publications/{id}/reschedule/` | Move to another time or slot | E08-S02 |
| `POST /publications/{id}/cancel/` | Cancel a scheduled publication | E08-S02 |
| `POST /publications/{id}/publish-now/` | Send as soon as rules allow | E08-S03 |
| `POST /publications/{id}/retry/` | Retry a failed publication | E08-S04 |
| `POST /publications/{id}/mark-published/` | Record a post made by hand, with its link | E08-S04 |

### E09 Analytics refresh

| Method and path | Purpose | Story |
| --- | --- | --- |
| `POST /analytics/refresh/` | Pull metrics now for an account or one publication → job | E09-S03 |
| `GET /analytics/posts/` | Published posts with their latest metrics and `latest_evaluation`; filter `verdict` | E09-S03, E10-S01 |
| `GET /analytics/posts/{publication_id}/` | One post with all snapshots | E09-S03 |
| `POST /analytics/posts/{publication_id}/snapshots/` | Enter metrics by hand | E09-S03 |
| `GET /analytics/account/` | Follower series and change for a date range | E09-S03 |
| `GET /analytics/sync-status/` | Last successful metric and follower sync per account, overdue counts | E09-S01 |
| `POST /analytics/account/snapshots/` | Enter a follower count by hand | E09-S03 |

### E10 Evaluate and feed back

| Method and path | Purpose | Story |
| --- | --- | --- |
| `GET /evaluations/` · `GET /evaluations/{id}/` | Post evaluations | E10-S01 |
| `POST /evaluations/run/` | Evaluate a plan's posts or one publication now → job | E10-S01 |
| `POST /weekly-reports/generate/` | Build the report for a plan → job | E10-S02 |
| `GET /weekly-reports/` · `GET /weekly-reports/{id}/` | Reports | E10-S02 |
| `PATCH /weekly-reports/{id}/` | Edit summary and findings; accept or dismiss each finding | E10-S02 |
| `POST /weekly-reports/{id}/accept/` | Accept the report | E10-S02 |
| `POST /weekly-reports/{id}/apply-to-plan/` | Create or update next week's draft plan from accepted findings | E10-S03 |
| `GET /repurpose-tasks/` · `POST /repurpose-tasks/` | List; create by hand from a publication (the `201` response embeds a `job` when a suggestion job starts) | E10-S04 |
| `PATCH /repurpose-tasks/{id}/` | Dismiss or reopen | E10-S04 |

### E11 Release

| Method and path | Purpose | Story |
| --- | --- | --- |
| `GET /overview/` | This week's counts by status, attention list, next publications, sync health | E11-S01 |
| `GET /health/live/` · `GET /health/ready/` | Existing health checks (public) | — |

Test-only hooks for the acceptance suite (E11-S03). They exist only when `SOCIALHUB_TESTING_HOOKS=true`, are admin-only, are refused in production, and are not part of `openapi.yaml`: `GET`/`POST /testing/fakes/`, `POST /testing/reset/`, `POST /testing/clock/`, `GET`/`POST /testing/run-task/`, `GET /testing/idle/`.
