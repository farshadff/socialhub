# Data model

This is the reference for every table in the MVP. Story specifications refer to these names and must not redefine them. If a story needs a new field, add it here in the same change.

Conventions:

- Primary keys are `BigAutoField` integers, except `JobRun`, which uses a UUID so job links are not guessable.
- Every table has `created_at` and `updated_at` (UTC). They are not repeated below.
- Timestamps are stored in UTC. Each account has an IANA timezone used for display and for slot times.
- Enum values are lowercase strings stored as text with `choices`.
- "JSON" means a PostgreSQL `jsonb` column whose shape is validated by a serializer or Pydantic model before saving.
- FK = foreign key. "null" means the column is nullable.

## 1. Shared enums

| Enum | Values |
| --- | --- |
| `Format` | `reel`, `story`, `feed_post` |
| `MediaKind` | `image`, `video` |
| `ProductionMode` | `design` (rendered image), `motion` (rendered frames animated into video), `video` (uploaded footage assembled) |
| `Role` | `attract` (reach new people), `educate` (teach something worth saving), `build_trust` (proof, behind the scenes), `convert` (drive an action), `engage` (start interaction) |
| `Metric` | `reach`, `views`, `likes`, `comments`, `saves`, `shares`, `replies`, `follower_growth` |
| `Checkpoint` | `1h`, `6h`, `23h`, `24h`, `72h`, `7d`, `adhoc` |
| `QCOutcome` | `pass`, `revise`, `escalate` |
| `QCCheck` | `design`, `copy`, `facts`, `rights`, `format` |

Allowed combinations (enforced by the format registry, E04-S01):

| Format | Media kind | Production modes |
| --- | --- | --- |
| `feed_post` | `image` | `design` |
| `story` | `image` | `design` |
| `story` | `video` | `motion`, `video` |
| `reel` | `video` | `motion`, `video` |

Default primary metric per role, used when a brief does not set one: `attract` → `reach`, `educate` → `saves`, `build_trust` → `shares`, `convert` → `shares`, `engage` → `comments` (`replies` for stories).

## 2. accounts

### User

Django's built-in `auth.User`. Role is derived: `admin` when `is_superuser` is true, otherwise `operator`. No profile table in the MVP.

### InstagramAccount

| Field | Type | Notes |
| --- | --- | --- |
| `handle` | text, unique | Lowercase, no `@`; matches `^[a-z0-9._]{1,30}$`; unique including archived accounts. Only an admin can change it, and only while the connection is `disconnected` |
| `display_name` | text | 1–80 characters |
| `timezone` | text | IANA name; default from `SOCIALHUB_DEFAULT_ACCOUNT_TIME_ZONE` |
| `content_language` | text | `fa` (default) or `en` |
| `week_start_day` | int 0–6 | 0 = Monday; default 5 (Saturday) |
| `status` | enum | `active`, `archived`. Archiving forces `publishing_enabled` to false; archived accounts are skipped by all scheduled work |
| `publishing_enabled` | bool | Default false. The stop switch for sending to Instagram |
| `autopilot` | JSON | `{"selection": false, "brief": false, "script": false}` |
| `posting_rules` | JSON | `{"min_gap_minutes": 120, "max_feed_per_day": 2, "max_stories_per_day": 5, "max_revisions": 2}` (`max_feed_per_day` counts reels and feed posts together). Ranges: `min_gap_minutes` 15–1440, `max_feed_per_day` 1–10, `max_stories_per_day` 1–20, `max_revisions` 0–5. `PATCH` merges keys; unknown keys are rejected |
| `notes` | text | |

### BrandProfile

One per account, created with the account.

| Field | Type | Notes |
| --- | --- | --- |
| `account` | 1:1 FK | |
| `logo_light` / `logo_dark` | file, null | PNG or SVG; light is for light backgrounds |
| `colors` | JSON | `{"primary", "secondary", "accent", "background", "text"}` as `#RRGGBB` |
| `fonts` | JSON | `{"heading", "body"}`; each is a key from the bundled font list |
| `tone_of_voice` | text | Plain description used in prompts |
| `audience_summary` | text | Default audience; a weekly plan can override it |
| `content_pillars` | JSON list of text | Recurring themes |
| `default_hashtags` | JSON list of text | Without `#` |
| `banned_terms` | JSON list of text | Words the copy check must reject |
| `cta_examples` | JSON list of text | |
| `handle_display` | text | Shown on rendered assets, for example `@brand` |
| `ai_disclosure` | enum | `generated_only` (default), `always`, `never` |

Defaults: `colors` `{"primary": "#111111", "secondary": "#666666", "accent": "#1677FF", "background": "#FFFFFF", "text": "#111111"}` (stored uppercase); `fonts` `{"heading": "vazirmatn", "body": "vazirmatn"}`; `handle_display` `@{handle}`; lists and texts empty. Font keys come from the bundled registry in `apps/core/fonts/`: `vazirmatn`, `noto-sans-arabic`, `noto-naskh-arabic`, `inter`, `noto-sans`. Logos are stored files on the profile, not `Asset` rows.

### AccountConnection

One per account.

| Field | Type | Notes |
| --- | --- | --- |
| `account` | 1:1 FK | |
| `provider` | enum | `instagrapi`, `graph_api`, `manual`, `fake` |
| `status` | enum | `disconnected`, `connected`, `challenge_required`, `needs_attention` |
| `username` | text | |
| `session_encrypted` | text, null | Fernet-encrypted provider session; never serialized |
| `proxy_url_encrypted` | text, null | Never serialized; the API exposes only `has_proxy` |
| `capabilities` | JSON | `{"publish_feed", "publish_reel", "publish_story", "insights", "research"}` booleans, filled by verification |
| `challenge` | JSON, null | `{"method", "hint", "expires_at", "attempts"}` while a challenge is pending; `method` is `sms`, `email`, `totp` or `unknown`; `hint` is the masked destination |
| `last_verified_at` | datetime, null | |
| `last_error_code` / `last_error_at` | text / datetime, null | |

`capabilities.research` is always false for brand accounts. Public-signal research uses the separate research account below.

### ResearchConnection (app `instagram`)

A single row holding the session of the dedicated research account used by E02-S03. Signed in with the management command `ig_research_login`; there is no panel screen.

| Field | Type | Notes |
| --- | --- | --- |
| `provider` | enum | `instagrapi`, `fake` |
| `status` | enum | `disconnected`, `connected`, `challenge_required`, `needs_attention` |
| `username` | text | |
| `session_encrypted` | text, null | Fernet-encrypted; never serialized |
| `last_verified_at` | datetime, null | |
| `last_error_code` / `last_error_at` | text / datetime, null | |

## 3. core and ai

### JobRun

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | |
| `kind` | text | Dotted name; the list of kinds is below |
| `status` | enum | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| `account` | FK, null | |
| `target_type` / `target_id` | text / text | `target_type` is one of `content_item`, `publication`, `plan`, `account`, `account_connection` (id = account id), `feed_source`, `research_run`, `repurpose_task`, `system` (id such as `ai`) |
| `progress` | int 0–100 | |
| `message` | text | Short human-readable step |
| `result` | JSON, null | Small result summary; IDs of what was created |
| `error_code` / `error_detail` | text / text, null | Machine code and safe description |
| `request_id` | text, null | From the request that created the job |
| `celery_task_id` | text, null | |
| `queue` | text | `default`, `render` or `publish` |
| `deadline_at` | datetime, null | `started_at` plus the kind's timeout; the stale-job sweeper fails jobs past it |
| `created_by` | FK User, null | Null for scheduled jobs |
| `started_at` / `finished_at` | datetime, null | |

At most one active job per target and kind: partial unique index on (`target_type`, `target_id`, `kind`) where `status` is `queued` or `running`. Index on (`account`, `status`, `finished_at`) for the overview. Every `active_job` foreign key elsewhere uses `on_delete=SET_NULL`. APIs return an active job as `JobSummary` = `{id, kind, status, progress, message}`.

Job kinds by owning story:

| Area | Kinds |
| --- | --- |
| Foundation (E00) | `instagram.login`, `instagram.challenge`, `instagram.verify`, `system.ai_test` |
| Research and selection (E02, E03) | `research.run`, `feeds.sync`, `selection.rank` |
| Briefs and scripts (E04, E05) | `brief.generate`, `brief.generate_batch`, `script.generate` |
| Production (E06) | `production.start`, `production.render`, `production.generate_image`, `copy.generate` |
| Checks (E07) | `qc.run`, `qc.revise` |
| Publishing (E08) | `publish.send`, `publish.verify` |
| Analytics (E09, E10) | `analytics.refresh`, `evaluation.run`, `report.weekly`, `repurpose.suggest` |

Stories that introduce a new kind add it here.

### AIRun

| Field | Type | Notes |
| --- | --- | --- |
| `job` | FK JobRun, null | |
| `account` | FK, null | |
| `provider` | enum | `anthropic`, `openai`, `fake` |
| `model` | text | Exact model ID that answered (after any server-side fallback) |
| `task` | text | Prompt key, for example `brief.generate` |
| `prompt_version` | text | |
| `input_tokens` / `output_tokens` | int | Zero for image generation; see `units` |
| `units` | JSON | Keys used: `cache_read_tokens`, `cache_write_tokens`, `web_searches`, `images`, `attempts`, `fallback_used`, `price_missing` |
| `cost_usd` | decimal(10,6) | Computed from the price table in settings; 0 with `units.price_missing` when the model has no price |
| `latency_ms` | int | |
| `status` | enum | `ok`, `error`, `refused` |
| `error_code` | text, null | |
| `provider_request_id` | text, null | |
| `payload` | JSON, null | `{"request": {"system", "user", "options"}, "response", "truncated"}`, at most 64 KB; images are replaced by `{"sha256", "bytes", "media_type"}`. Set to null after 30 days by `ai.prune_payloads` |

Indexes: (`created_at`), (`task`, `created_at`), (`account`, `created_at`), (`job`).

### IdempotencyKey

Stores the first successful response of an idempotent request (E03-S03). Unique on (`user`, `method`, `path`, `key`). Rows older than 24 hours are deleted daily by `core.prune_idempotency_keys`.

| Field | Type | Notes |
| --- | --- | --- |
| `user` | FK User | |
| `key` | text | 8–64 characters, from the `Idempotency-Key` header |
| `method` / `path` | text | |
| `request_hash` | text | SHA-256 of the canonical JSON body |
| `response_status` | int | |
| `response_body` | JSON | |

## 4. planning (step 01)

### WeeklyPlan

Unique on (`account`, `week_start`).

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `week_start` / `week_end` | date | `week_end` = `week_start` + 6 days; `week_start` must fall on the account's `week_start_day` |
| `status` | enum | `draft`, `active`, `closed` |
| `title` | text | 1–120 characters; defaults to "Week of {D MMM}" of `week_start` |
| `objective` | text | What the week is for; 0–1,000 characters, required to activate |
| `audience_summary` | text | Who the week speaks to; pre-filled from the brand profile; 0–2,000 characters, required to activate |
| `audience_segments` | JSON list | `[{"name", "description"}]`; 0–5 items, names unique |
| `success_metrics` | JSON list of `Metric` | The metrics that decide success this week; 1–4 distinct; default `["reach", "saves", "shares"]` |
| `notes` | text | |
| `carried_findings` | JSON list | Accepted findings copied from the previous weekly report (E10-S03). Each item is a finding (section 10) without `accepted` and `evidence_publications`, plus `report_id` and `state` (`pending`, `applied`, `ignored`) |
| `source_report` | FK WeeklyReport, null, `on_delete=SET_NULL` | |
| `activated_at` / `closed_at` | datetime, null | |
| `created_by` | FK User | |

A plan can be created for the current week up to eight weeks ahead. `week_start` cannot change after creation.

### PlanGoal

Unique on (`plan`, `metric`, `scope`, `format`). At most 20 goals per plan. `follower_growth` is allowed only with scope `week_total` and a null format; `replies` only with format `story` or null.

| Field | Type | Notes |
| --- | --- | --- |
| `plan` | FK | |
| `metric` | `Metric` | |
| `scope` | enum | `week_total` (sum over the week) or `per_post` |
| `format` | `Format`, null | Null means all formats |
| `target_value` | int 1–100,000,000 | |

### SlotTemplate

The account's usual week. Used to generate a plan's slots. Unique on (`account`, `weekday`, `local_time`, `format`); at most 40 rows per account; `local_time` in 5-minute steps.

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `weekday` | int 0–6 | 0 = Monday |
| `local_time` | time | In the account timezone |
| `format` | `Format` | |
| `default_role` | `Role`, null | |
| `active` | bool | |

### PlanSlot

Unique on (`plan`, `scheduled_at`, `format`); index on (`plan`, `scheduled_at`); at most 60 slots per plan.

| Field | Type | Notes |
| --- | --- | --- |
| `plan` | FK | |
| `scheduled_at` | datetime | UTC; must fall inside the plan week in the account timezone |
| `format` | `Format` | |
| `role` | `Role`, null | Hint for selection and briefing |
| `status` | enum | `open`, `reserved` (has a content item), `scheduled` (has a publication), `published`, `skipped` |
| `note` | text | |

The link to content is `ContentItem.slot`. Open slots become `skipped` when the plan closes. A slot released by a cancelled or rejected item returns to `open` if its time is still in the future, otherwise it becomes `skipped`.

## 5. research (step 02)

### ResearchSource

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `kind` | enum | `web_search`, `rss`, `instagram_hashtag`, `instagram_account`. (`manual` exists only on `TrendSignal.kind`; it cannot be a source.) |
| `value` | text | Search query, feed URL, hashtag without `#`, or username without `@` |
| `label` | text | |
| `active` | bool | |
| `last_run_at` / `last_status` | datetime / text, null | `ok`, `empty`, or `error:<code>` where code is one of `timeout`, `http_<status>`, `invalid_feed`, `blocked_url`, `provider_error`, `refused`, `provider_not_configured`, `not_supported`, `session_required`, `rate_limited`, `transient`, `not_found`, `run_budget`, `daily_budget` |

### ResearchRun

At most one `running` run per account (partial unique index on `account` where `status = 'running'`).

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `plan` | FK WeeklyPlan, null | The plan the run serves |
| `job` | FK JobRun | |
| `status` | enum | `running`, `completed`, `failed` |
| `params` | JSON | `{"lookback_days", "source_ids", "collect", "synthesize"}` as requested |
| `stats` | JSON | `{"signals": n, "duplicates": n, "topics": n, "dropped_topics": n, "synthesis": "done" \| "skipped_too_few_signals" \| "skipped", "by_source": {source_id: {"signals": n, "duplicates": n, "status": "ok"}}}` |
| `started_at` / `finished_at` | datetime | |

### TrendSignal

Unique on (`account`, `fingerprint`).

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `run` | FK ResearchRun, null | Null for manual signals added outside a run |
| `source` | FK ResearchSource, null | |
| `kind` | enum | Same values as `ResearchSource.kind` |
| `url` | text | The original source link |
| `title` | text | |
| `excerpt` | text | At most 1,000 characters |
| `author` | text | Publisher or account |
| `published_at` | datetime, null | |
| `captured_at` | datetime | |
| `metrics` | JSON | Whatever was observed: `{"likes", "comments", "views"}` |
| `fingerprint` | text | SHA-256 of the normalized URL (or of kind + author + excerpt when there is no URL) |
| `raw` | JSON | Trimmed provider payload |

### TrendTopic

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `run` | FK ResearchRun, null | |
| `plan` | FK WeeklyPlan, null | |
| `title` | text | |
| `summary` | text | |
| `why_now` | text | |
| `hooks` | JSON list of text | Opening lines or angles |
| `suggested_formats` | JSON list of `Format` | |
| `keywords` | JSON list of text | |
| `evidence_score` | int 0–100 | Computed in code |
| `evidence_breakdown` | JSON | `{"signal_count", "source_diversity", "recency", "engagement"}` each 0–100 |
| `signals` | M2M TrendSignal | |
| `status` | enum | `new`, `shortlisted`, `dismissed`, `used` |
| `origin` | enum | `ai`, `manual` |

## 6. selection (step 03)

### FeedSource

At most 20 sources and one `manual` source per account. `name` is unique per account, case-insensitive.

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `kind` | enum | `rss`, `json_api`, `manual` |
| `name` | text | 1–80 characters |
| `url` | text | `http` or `https`, at most 500 characters; empty for `manual` |
| `config` | JSON | Every kind: `{"auto_eligible": true, "max_age_days": 14}` (1–365). `json_api` adds `{"items_path", "fields": {"external_id", "title", "summary", "url", "image_url", "published_at"}, "auth_header_env"}`; `fields.external_id` and `fields.title` are required; `auth_header_env` must name a setting starting with `SOCIALHUB_FEED_` |
| `active` | bool | |
| `last_synced_at` / `last_status` | datetime / text, null | `ok`, `empty`, or `error:<code>` with code `fetch_failed` (connection error other than a timeout), `timeout`, `http_<status>`, `blocked_url`, `too_large`, `parse_failed`, `mapping_failed`, `auth_header_missing` |

### FeedItem

Unique on (`source`, `external_id`). Index on (`account`, `status`, `published_at` desc).

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `source` | FK FeedSource | |
| `external_id` | text | Manual items use `manual-<uuid>` |
| `title` / `summary` | text | At most 300 / 2,000 characters |
| `url` / `image_url` | text | |
| `published_at` | datetime, null | |
| `payload` | JSON | Original item, trimmed to 8 KB |
| `status` | enum | `new`, `eligible`, `ignored`, `used` |

### RepurposeTask

Created by E10-S04, automatically for outperforming posts or by hand. Partial unique on (`source_publication`) where `status` is `open` or `in_selection`; index on (`account`, `status`).

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `source_publication` | FK Publication | |
| `evaluation` | FK PerformanceEvaluation, null | Null for tasks created by hand |
| `reason` | text | Why it outperformed, with numbers |
| `suggested_angle` | text | |
| `suggested_formats` | JSON list of `Format` | |
| `status` | enum | `open`, `in_selection`, `used`, `dismissed` |
| `dismiss_reason` | text | Operator reason, or `expired` |
| `expires_at` | datetime | Creation or reopen time plus `SOCIALHUB_REPURPOSE_EXPIRY_DAYS` |
| `created_by` | FK User, null | Null when created automatically |

### Candidate

Partial unique on (`plan`, `topic`), (`plan`, `feed_item`) and (`plan`, `repurpose_task`) where the column is not null. A check constraint requires exactly one source FK, matching `kind`. Index on (`plan`, `status`, `rank`).

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `plan` | FK WeeklyPlan | |
| `kind` | enum | `trend`, `feed_item`, `repurpose` |
| `topic` / `feed_item` / `repurpose_task` | FK, null, `on_delete=PROTECT` | Exactly one is set, matching `kind`. Protected so re-running research never deletes a topic a candidate references |
| `title` / `summary` | text | Trimmed to 200 / 1,500 characters |
| `suggested_formats` | JSON list of `Format` | |
| `suggested_role` | `Role`, null | From `selection.score_goal_fit`; used by the proposal and as the item's fallback role |
| `sources` | JSON list | `[{"title", "url"}]`; the evidence carried into the brief and the facts check |
| `evidence_score` / `goal_fit_score` / `freshness_score` | int 0–100 | |
| `total_score` | decimal(5,2) | Weighted sum |
| `rationale` | text | Why it fits the week's goals; at most 600 characters |
| `duplicate_of` | FK ContentItem, null | Set when it repeats recent content |
| `rank` | int, null | 1 = best, within the plan |
| `status` | enum | `candidate`, `proposed` (matched to a slot in the proposal), `selected`, `rejected`. `rejected → candidate` restores it |
| `proposed_slot` | FK PlanSlot, null | |
| `ranked_at` | datetime, null | |

## 7. content (steps 03–06)

### ContentItem

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `plan` | FK WeeklyPlan | |
| `slot` | 1:1 FK PlanSlot, null, `on_delete=SET_NULL` | |
| `candidate` | FK Candidate, `on_delete=PROTECT` | |
| `title` | text | |
| `format` | `Format` | |
| `media_kind` | `MediaKind` | |
| `production_mode` | `ProductionMode` | |
| `role` | `Role`, null | Set in step 04 |
| `status` | enum | `selected`, `briefed`, `scripted`, `in_production`, `in_check`, `needs_revision`, `in_review`, `approved`, `scheduled`, `publishing`, `published`, `failed`, `cancelled` |
| `current_brief` | FK Brief, null | Always the latest brief version |
| `current_script` | FK ScriptVersion, null | Always the latest script version, whatever its status; the approved script is the one version with status `approved` |
| `current_version` | FK ContentVersion, null | |
| `revision_count` | int, default 0 | Every revision: automatic, reviewer-requested, or handed back for manual rework (E07-S05) |
| `auto_revision_count` | int, default 0 | Revisions started by a Revise outcome; compared with `posting_rules.max_revisions` |
| `active_job` | FK JobRun, null | Set while a job is working on the item |
| `hold_reason` | text | Why it is waiting, shown in the panel. Cleared by every status change unless a new reason is passed; `pipeline.set_hold_reason` changes it without a status change |
| `cancelled_reason` | text | |
| `created_by` | FK User, null | Null when created by autopilot |

Indexes on (`account`, `status`) and (`plan`, `status`).

### Brief

Unique on (`content_item`, `version`). Immutable after creation, except `status`.

| Field | Type | Notes |
| --- | --- | --- |
| `content_item` | FK | |
| `version` | int | Starts at 1 |
| `role` | `Role` | |
| `objective` | text | What this piece must achieve |
| `key_message` | text | The one thing the viewer should take away |
| `hook_direction` | text | How it should open |
| `audience_note` | text | |
| `cta` | text | |
| `must_include` / `must_avoid` | JSON list of text | |
| `references` | JSON list | `[{"title", "url"}]`, copied from the candidate's sources and editable |
| `format_notes` | text | Length, pacing, format-specific guidance |
| `success_metric` | `Metric` | |
| `feedback` | text | Regeneration feedback or the editor's change note that led to this version; default empty |
| `status` | enum | `draft`, `approved`, `superseded` |
| `origin` | enum | `ai`, `human` |
| `ai_run` | FK AIRun, null | |
| `created_by` | FK User, null | |

Index on (`content_item`, `-version`). `ContentItem.current_brief` always points to the latest version; only the latest version can be approved.

### ScriptVersion

Unique on (`content_item`, `version`). Immutable after creation, except `status`.

| Field | Type | Notes |
| --- | --- | --- |
| `content_item` | FK | |
| `version` | int | |
| `brief` | FK Brief | The brief it was written from |
| `payload` | JSON | The script package, schema below |
| `feedback` | text | Regeneration feedback (from an operator or the revise loop), an edit note, or "Restored from version n" |
| `status` | enum | `draft`, `approved`, `superseded` |
| `origin` | enum | `ai`, `human` |
| `ai_run` | FK AIRun, null | |
| `created_by` | FK User, null | |

At most one approved and one draft version per item. A new draft supersedes earlier drafts; approving a version supersedes the previously approved one.

Script package (`payload`):

```json
{
  "scenario": "Short narrative of what happens from first second to last.",
  "hook": "The opening line or image.",
  "duration_seconds": 30,
  "shots": [
    {
      "index": 1,
      "duration_seconds": 4,
      "type": "graphic",
      "description": "What is seen.",
      "on_screen_text": "Text shown on screen.",
      "voiceover": "",
      "asset_hint": "What footage or image is needed."
    }
  ],
  "frames": [
    {
      "index": 1,
      "shot_index": 1,
      "template": "title",
      "headline": "Main text",
      "body": "Supporting text",
      "visual_prompt": "Background or illustration description, no text in the image.",
      "duration_seconds": 4,
      "transition": "fade"
    }
  ],
  "design_notes": {
    "mood": "",
    "color_usage": "",
    "typography": "",
    "imagery_style": "",
    "layout": "",
    "do": [],
    "dont": []
  },
  "cta": "Closing call to action.",
  "music_hint": ""
}
```

`shots[].type` is `footage`, `graphic` or `text`. `frames[].template` is one of `title`, `statement`, `stat`, `list`, `quote`, `image_caption`, `cta`. `frames[].transition` is `cut`, `fade` or `slide`. Image formats have exactly one frame, `duration_seconds` 0, transition `cut` and an empty `music_hint`. `footage` shots are allowed only in `video` mode. Frame and shot counts, durations and text limits per combination live in the format registry (`script_rules`, `frame_templates`, added by E05-S01).

### Asset

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `content_item` | FK, null | Null for library assets |
| `kind` | enum | `image`, `video`, `audio`, `document` |
| `role` | enum | `source`, `background`, `clip`, `music`, `frame`, `cover`, `final` |
| `file` | file | |
| `thumbnail` | file, null | JPEG 480 px wide: the image itself or a video poster at 1 s; null for audio and documents; stored next to the file as `…-thumb.jpg` |
| `original_filename` | text | |
| `mime` | text | |
| `bytes` | bigint | |
| `width` / `height` | int, null | |
| `duration_ms` | int, null | |
| `checksum` | text | SHA-256 |
| `origin` | enum | `uploaded`, `licensed`, `ai_generated`, `rendered` |
| `rights_status` | enum | `cleared`, `unknown`, `restricted`, `expired` |
| `license_note` | text | Where the right to use it comes from |
| `source_url` | text | |
| `rights_expires_at` | date, null | |
| `meta` | JSON | Keys by origin, listed below |
| `created_by` | FK User, null | |

Indexes on (`account`, `content_item`, `kind`) and (`account`, `checksum`). An upload with the same `account`, `checksum`, `content_item` and `role` returns the existing row.

`meta` keys by origin:

| Origin | Keys |
| --- | --- |
| `uploaded`, `licensed` | `probe`: `{"video_codec", "audio_codec", "fps", "has_audio"}` |
| `rendered` frame | `template`, `template_version`, `layout`, `frame_index`, `input_hash`, `inputs`, `warnings`, `fit` |
| `rendered` final or normalised file | `input_hash`, `inputs` (every frame, clip, overlay and music asset ID used), `profile`, `ffmpeg` |
| `ai_generated` | `prompt`, `subject`, `model`, `size`, `frame_index`, `ai_run_id` |

Effective rights: a `cleared` asset whose `rights_expires_at` has passed (account timezone) reads as `expired`; the stored value is not rewritten. API filters and checks use the effective value. A `rendered` asset takes the worst status among its inputs (`expired` > `restricted` > `unknown` > `cleared`) and the earliest input expiry. `production.services.rights.version_input_assets(version)` returns every asset a version uses (final, cover, music, clips, frames, frame backgrounds, and their `meta.inputs` recursively); E06 and E07 use it for rights and disclosure.

### ContentVersion

The produced package that checks read and the publisher sends. Unique on (`content_item`, `version`).

| Field | Type | Notes |
| --- | --- | --- |
| `content_item` | FK | |
| `version` | int | |
| `script` | FK ScriptVersion, null | Null for a manual upload without a script |
| `caption` | text | Empty for stories |
| `hashtags` | JSON list of text | Without `#` |
| `alt_text` | text | |
| `frames` | JSON list | Working copy of each frame (E06-S02): `{"index", "shot_index", "template", "headline", "body", "visual_prompt", "background_asset_id", "duration_seconds", "transition", "render_options", "asset_id", "state", "input_hash", "warnings", "overridden"}`. `render_options` is `{"text_backdrop": false, "logo_variant": "auto" \| "light" \| "dark"}` and is part of `input_hash`. `state` is `pending`, `rendered`, `stale` or `failed`. `overridden` lists the fields that differ from the approved script. Checks read frame text and timing from here |
| `clips` | JSON list | Video mode only: `[{"shot_index", "asset_id", "start_ms"}]` (E06-S04) |
| `music_asset` | FK Asset, null | Audio mixed in by assembly (E06-S03) |
| `cover_frame_index` | int, null | Frame used for the reel cover; null means the first frame |
| `final_asset` | FK Asset, null | The image or video to publish |
| `cover_asset` | FK Asset, null | Reel cover |
| `render_status` | enum | `pending`, `rendering`, `ready`, `failed` |
| `render_warnings` | JSON list | The single list of production warnings for the panel and the design check. Each item is `{"code", "message"}` plus one locator: `frame_index`, `shot_index`, `asset_id` or `field`. Codes: `text_overflow`, `logo_not_configured`, `brand_incomplete`, `background_required`, `background_missing`, `background_low_resolution`, `rights_not_cleared`, `clip_padded`, `clip_cropped_heavily`, `clip_low_resolution`, `banned_term`, `first_line_long`, `final_needs_normalising` (defined in E06-S02 to S07) |
| `production_steps` | JSON | Per production step: `{"status", "input_hash", "finished_at", "error_code"}`; status `pending`, `running`, `done`, `skipped`, `waiting`, `failed` (E06-S07) |
| `origin` | enum | `pipeline`, `manual_upload` |
| `change_note` | text | What changed since the previous version |
| `status` | enum | `draft`, `submitted`, `passed`, `rejected` |
| `submit_trigger` | enum, null | `submission` or `revision`; read by the check run (E07-S01) |
| `submitted_at` / `submitted_by` | datetime / FK User, null | |
| `created_by` | FK User, null | |

A version is editable only while `status` is `draft`. Frame text, template and background overrides live on the draft version and never change the approved script. Editing a submitted version creates the next version. A Revise outcome sets the version to `rejected`; an Escalate outcome leaves it `submitted` until a reviewer decides.

### ContentEvent

Append-only. Index on (`content_item`, `created_at` desc).

| Field | Type | Notes |
| --- | --- | --- |
| `content_item` | FK | |
| `type` | enum | `status_changed`, `job_started`, `job_failed`, `edited`, `qc_result`, `review_decision`, `publish_attempt`, `note` |
| `from_status` / `to_status` | text, null | |
| `actor` | FK User, null | Null means the system |
| `message` | text | |
| `data` | JSON | `job_started` / `job_failed`: `{"job_id", "kind", "error_code"}`; script `edited`: `{"script_version", "origin", "valid", "source"}`; other types as their story defines |

## 8. quality (step 07)

### QCRun

Unique on (`content_item`, `attempt`).

| Field | Type | Notes |
| --- | --- | --- |
| `content_item` | FK | |
| `content_version` | FK | |
| `attempt` | int | 1 for the first check of an item, then 2, 3… |
| `trigger` | enum | `submission`, `revision`, `manual_recheck`; taken from `ContentVersion.submit_trigger` or the recheck action |
| `started_by` | FK User, null | The user who started a manual recheck |
| `status` | enum | `running`, `completed`, `failed` |
| `outcome` | `QCOutcome`, null | Set when completed |
| `summary` | text | One or two sentences for the operator |
| `job` | FK JobRun | |
| `completed_at` | datetime, null | |

### QCResult

Unique on (`run`, `check`).

| Field | Type | Notes |
| --- | --- | --- |
| `run` | FK QCRun | |
| `check` | `QCCheck` | |
| `outcome` | `QCOutcome` | |
| `score` | int 0–100 | |
| `findings` | JSON list | `[{"code", "severity", "message", "location", "suggestion", "auto_fixable"}]` |
| `details` | JSON, default `{}` | Check-specific evidence. format: `{"probe"}`; rights: `{"assets", "disclosure"}`; copy: `{"inventory_chars", "rule_findings", "ai_issues", "dropped_issues"}`; facts: `{"claims", "references", "references_with_text", "downgraded"}`; design: `{"frames_checked", "logo_reference", "render_warnings", "ai_issues", "downgraded_low_confidence", "deduplicated"}` |
| `checker` | enum | `rule`, `ai` |
| `ai_run` | FK AIRun, null | |

Finding fields: `code` is `<check>.<name>` from the catalogue in `quality/catalogue.py` (E07-S02 to S04). `severity` is `info`, `minor`, `major` or `blocker`. `location` is `{"field": "caption"}`, `{"frame_index": 2}`, `{"asset_id": 17}` or `{}`. `auto_fixable` says whether the revise loop may fix it without a person.

### ReviewTask

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `content_item` | FK | |
| `qc_run` | FK QCRun, null | |
| `publication` | FK Publication, null | |
| `reason` | enum | `qc_escalated`, `max_revisions`, `publish_failed`, `no_slot`, `manual` |
| `detail` | text | |
| `status` | enum | `open`, `resolved` |
| `decision` | enum, null | `approve`, `request_changes`, `reject` |
| `decision_note` | text | |
| `instructions` | text | What to change, for `request_changes` |
| `rework` | enum, null | `copy`, `script`, `manual`: the rework chosen with Request changes (E07-S05) |
| `overridden_findings` | JSON list of text | Finding codes the reviewer approved despite; default `[]` |
| `resolved_by` | FK User, null | |
| `resolved_at` | datetime, null | |

Partial unique on (`content_item`) where `status = 'open'`: opening a second task for an item updates the open one. Index on (`account`, `status`, `created_at`).

## 9. publishing (step 08)

### Publication

One row per item. A `cancelled` row left by `withdraw` is reused when the item is approved again: version, time, slot, delivery and fingerprint are replaced and `attempt_count` is reset to 0. Indexes on (`status`, `scheduled_at`), (`account`, `status`, `scheduled_at`), (`account`, `published_at`), and (`account`, `next_metrics_at`) where not null.

| Field | Type | Notes |
| --- | --- | --- |
| `content_item` | 1:1 FK | |
| `account` | FK | |
| `slot` | FK PlanSlot, null | |
| `content_version` | FK | The exact version that passed |
| `format` | `Format` | |
| `scheduled_at` | datetime | |
| `status` | enum | `scheduled`, `publishing`, `verifying`, `published`, `failed`, `cancelled` |
| `delivery` | enum | `provider` (default; sent by the worker) or `manual` (posted by hand). Re-checked at send time: a capability that turned false switches it to `manual` |
| `blocked_reason` | enum, null | `publishing_paused`, `session_problem`, `daily_limit` |
| `attempt_count` | int | Sends that used the retry budget; `PublishAttempt.number` counts every row |
| `next_attempt_at` | datetime, null | Set while waiting to retry |
| `caption_fingerprint` | text | First 32 hex characters of SHA-256 over the NFC-normalised, whitespace-collapsed, casefolded first 100 characters of the full caption. Empty for stories and for captions shorter than 10 characters |
| `remote_media_pk` / `remote_media_code` | text, null | Provider identifiers |
| `permalink` | text, null | |
| `published_at` | datetime, null | |
| `published_via` | enum, null | How it actually went out: `provider` or `manual` |
| `next_metrics_checkpoint` | `Checkpoint`, null | |
| `next_metrics_at` | datetime, null | |
| `lease_owner` / `lease_expires_at` | text / datetime, null | Worker claim |

### PublishAttempt

| Field | Type | Notes |
| --- | --- | --- |
| `publication` | FK | |
| `number` | int | |
| `provider` | text | |
| `started_at` | datetime | |
| `finished_at` | datetime, null | Null while running |
| `outcome` | enum, null | `success`, `verified_live`, `retryable_error`, `fatal_error`, `ambiguous`; null while running |
| `error_code` / `error_message` | text, null | Codes include `session_required`, `challenge_required`, `rate_limited`, `asset_corrupt`, `caption_too_long`, `timeout`, `lease_expired` |
| `verification` | JSON, null | `{"pre_story_pks": [...], "checks": [{"at", "method", "window_start", "listed", "candidates", "result", "remote_media_pk", "remote_media_code", "taken_at"}], "final_check_pending": bool}`; `method` is `caption_fingerprint`, `active_stories` or `time_window`; the remote fields appear only on a match |

## 10. analytics (steps 09–10)

### MetricSnapshot

Partial unique constraint on (`publication`, `checkpoint`) where `checkpoint <> 'adhoc'`.

| Field | Type | Notes |
| --- | --- | --- |
| `publication` | FK | |
| `checkpoint` | `Checkpoint` | |
| `status` | enum | `captured` (default) or `skipped`. Only `captured` rows are evaluated |
| `skip_reason` | enum, null | Set only when skipped: `missed`, `insights_unavailable`, `media_not_found`, `expired`, `gave_up` |
| `age_minutes` | int | Actual age when captured |
| `captured_at` | datetime | |
| `reach`, `views`, `likes`, `comments`, `saves`, `shares`, `replies` | int, null | Null when not available |
| `unavailable` | JSON list of `Metric` | Metrics the provider could not return |
| `extra` | JSON | Other provider fields |
| `source` | enum | `provider`, `manual` |

### AccountSnapshot

Unique on (`account`, `date`).

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `date` | date | In the account timezone. Taken at 00:10 local time, so a row dated D describes the end of D − 1; a plan week's change compares the rows dated `week_start` and `week_end` + 1 |
| `captured_at` | datetime | |
| `followers` | int | |
| `following` / `media_count` | int, null | Null when a manual entry gives only the follower count |
| `follower_change` | int, null | Against the previous snapshot |
| `source` | enum | `provider`, `manual` |

### PerformanceEvaluation

Unique on (`publication`, `checkpoint`). Index on (`verdict`, `evaluated_at`). Only `MetricSnapshot` rows with `status = captured` are evaluated.

| Field | Type | Notes |
| --- | --- | --- |
| `publication` | FK | |
| `checkpoint` | `Checkpoint` | `24h` and `7d` for reels and feed posts; `23h` for stories |
| `primary_metric` | `Metric` | From the brief's `success_metric` |
| `value` | int, null | |
| `goal_target` | int, null | |
| `goal_source` | enum | `per_post_format`, `per_post_all`, `week_total_share`, `none` |
| `goal_result` | enum | `met`, `missed`, `no_goal`, `not_measured` (the metric was unavailable) |
| `baseline_value` | decimal, null | Median of similar posts at the same age |
| `baseline_sample_size` | int | |
| `baseline_samples` | JSON list | `[{"publication", "value"}]` for the primary metric, newest first, at most 50 |
| `baseline_ratio` | decimal(6,2), null | `value / baseline_value` |
| `verdict` | enum | `outperforming`, `on_par`, `underperforming`, `insufficient_data` |
| `metrics` | JSON | Per metric: `{"value", "baseline", "ratio", "goal", "sample_size"}` |
| `evaluated_at` | datetime | |

### WeeklyReport

| Field | Type | Notes |
| --- | --- | --- |
| `account` | FK | |
| `plan` | 1:1 FK WeeklyPlan | |
| `status` | enum | `draft`, `accepted` |
| `summary` | text | |
| `totals` | JSON | Computed in code; shape below |
| `findings` | JSON list | Schema below |
| `ai_run` | FK AIRun, null | |
| `generated_at` | datetime | |
| `accepted_by` / `accepted_at` | FK User / datetime, null | |
| `applied_plan` | FK WeeklyPlan, null, `on_delete=SET_NULL` | The plan the findings were applied to |

Totals:

```json
{
  "metrics": {"reach": {"actual": 61200, "goal": 60000, "attainment": 1.02, "is_success_metric": true, "posts_measured": 9}},
  "format_goals": [{"metric": "saves", "format": "feed_post", "actual": 140, "goal": 120, "attainment": 1.17}],
  "follower_change": {"start": 12040, "end": 12310, "change": 270, "goal": 250, "attainment": 1.08, "complete": true},
  "posts": {"planned": 9, "skipped": 0, "published": 9, "unfinished": 0, "provisional": 2, "by_format": {}, "by_verdict": {}, "goals_met": 6, "goals_missed": 3},
  "best": {}, "worst": {},
  "post_rows": [],
  "computed_at": "2026-12-07T02:05:00Z",
  "provisional_until": "2026-12-11T15:30:00Z"
}
```

`post_rows` holds at most 40 rows.

Finding:

```json
{
  "id": "f1",
  "type": "worked",
  "title": "Short statement of the finding",
  "detail": "What the numbers show.",
  "evidence_publications": [12, 15],
  "recommendation": "What to do next week.",
  "plan_field": "slots",
  "suggested_change": {"note": "Move the Tuesday reel from 12:00 to 19:00"},
  "accepted": null
}
```

`type` is `worked`, `didnt_work` or `insight`. `plan_field` is `objective`, `audience`, `goals`, `slots`, `notes` or `none`. `suggested_change` always has `note`; for `plan_field = goals` it may also carry all four of `metric`, `scope`, `format` and `target_value`, or none of them. `accepted` is `null` until the operator accepts (`true`) or dismisses (`false`) the finding.

## 11. Relationships at a glance

```text
InstagramAccount ─┬─ BrandProfile, AccountConnection
                  ├─ SlotTemplate
                  ├─ WeeklyPlan ─┬─ PlanGoal
                  │              ├─ PlanSlot ◄──── ContentItem.slot
                  │              ├─ Candidate ◄─── TrendTopic | FeedItem | RepurposeTask
                  │              └─ WeeklyReport
                  ├─ ResearchSource ─ ResearchRun ─ TrendSignal ─ TrendTopic
                  ├─ FeedSource ─ FeedItem
                  └─ ContentItem ─┬─ Brief (versions)
                                  ├─ ScriptVersion (versions)
                                  ├─ Asset
                                  ├─ ContentVersion (versions) ─ QCRun ─ QCResult
                                  ├─ ReviewTask
                                  ├─ ContentEvent
                                  └─ Publication ─┬─ PublishAttempt
                                                  ├─ MetricSnapshot
                                                  └─ PerformanceEvaluation ─ RepurposeTask
```
