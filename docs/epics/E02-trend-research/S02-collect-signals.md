# E02-S02 — Collect signals from web search, RSS and manual entry

| | |
| --- | --- |
| Epic | E02 Trend research |
| Priority | Must |
| Estimate | BE 3 d · FE 0.5 d · QA 0 d |
| Depends on | E02-S01, E00-S05, E00-S06, E01-S01 |
| Needed by | E02-S04, E02-S05; E02-S03 (later) adds a collector |

## User story

As an operator, I want to press one button and have the system look through my watchlist and record what it finds with the original links, so that topic ideas rest on evidence I can open and check.

## Context

This is the "record sources and signals" half of workflow step 02. A research run walks the account's active sources, turns each finding into a `TrendSignal`, and skips anything it has seen before. This story delivers the run itself, the web search and RSS collectors, manual signal entry, and the "Run research" button. Public Instagram signals are not collected in the MVP (E02-S03 is Later); an operator who finds a relevant Instagram post adds it as a manual signal with its link and numbers. Topic synthesis is the last stage of the run and is specified in E02-S04; until that story lands the stage is a no-op.

## Scope

**In:**

- `ResearchRun` and `TrendSignal` tables.
- `POST /research/runs/` and the `research.run` background job, with progress, per-source results and partial failure.
- Collector protocol with two implementations: web search (Claude, two calls) and RSS.
- URL normalization and fingerprint deduplication.
- A safe HTTP fetch helper that refuses private addresses.
- Run history endpoints, signal list endpoint, manual signal entry.
- "Run research" button with options and live progress.

**Out (later):**

- Scheduled runs.
- Cancelling a run.
- Fetching and storing full article text or page snapshots.
- Conditional RSS requests (`ETag`, `Last-Modified`).
- Parallel collection across sources.
- Editing or deleting signals.

## Behaviour and rules

### Starting a run

1. `POST /research/runs/` creates a `ResearchRun` with status `running` and a `JobRun` of kind `research.run` (`target_type = "research_run"`, `target_id` = run ID), enqueues the task on the `default` queue and returns `202` with the job.
2. One run per account at a time. If the account has a run with status `running`, the request returns `409 job_in_progress` with the active job in `error.details.job`. The check and insert happen in one transaction with the account row locked; a partial unique index on `ResearchRun(account)` where `status = 'running'` backs it up.
3. Stale runs do not block forever. Before rule 2 is applied, a `running` run whose job is already `succeeded`, `failed` or `cancelled`, or whose `started_at` is more than 30 minutes ago, is marked `failed` with job `error_code = stale_run`.
4. Request options:

   | Field | Type | Default | Rule |
   | --- | --- | --- | --- |
   | `account` | int | required | Must be an active account |
   | `plan` | int or null | see rule 5 | Must belong to the account and not be `closed` |
   | `source_ids` | list of int | all active sources | Each must belong to the account and be active |
   | `lookback_days` | int | 7 | 1–30 |
   | `collect` | bool | true | When false, skip collection and only synthesize existing signals |
   | `synthesize` | bool | true | When false, collect only |

   `collect` and `synthesize` cannot both be false (`400 validation_error`, non-field code `nothing_to_do`).
5. When `plan` is omitted, the server picks the account's earliest plan with status `draft` or `active` whose `week_end` is today or later in the account timezone. If there is none, the run has no plan. Research does not require a plan.
6. With `collect = true`, the account must have at least one active source among those requested; otherwise `400 validation_error` on `source_ids` with code `no_active_sources`.
7. With `synthesize = true`, the text AI provider must be configured; otherwise `503 provider_not_configured`. With `synthesize = false`, a missing provider is not an error for the request: web search sources are recorded as `error:provider_not_configured` and RSS sources still run.
8. The options are stored on the run in `params` so history shows what was asked.

### Collecting

9. Sources are visited one at a time in this order: `web_search`, then `rss`. Within a kind, by `id`.
10. A source whose `availability` is false is not called. It is recorded with status `error:<unavailable_reason>`.
11. Each collector returns a list of `SignalDraft` objects (`kind`, `url`, `title`, `excerpt`, `author`, `published_at`, `metrics`, `raw`). The run service, not the collector, normalizes, deduplicates and saves.
12. Per-source limits per run: web search keeps at most 8 signals; RSS keeps at most 20 (newest first).
13. Text limits applied before saving: `title` 300 characters, `excerpt` 1,000, `author` 120, `url` 2,000. Longer text is cut at the last whole word and ends with "…". HTML tags are removed and whitespace is collapsed. A draft with an empty title is dropped.
14. Age limit: a draft whose `published_at` is known and older than `lookback_days` is dropped. A draft with no date is kept; deduplication stops it from reappearing on later runs.
15. Each saved signal gets `captured_at` = now, `run` = this run, `source` = the source.

### Deduplication

16. The fingerprint is the SHA-256 hex digest of the normalized URL. Normalization, in order:
    1. Trim; parse; reject anything that is not `http` or `https`.
    2. Scheme becomes `https`. Host is lowercased; a leading `www.` or `m.` is removed; default ports are removed.
    3. The fragment is removed.
    4. Query parameters named `utm_*`, `fbclid`, `gclid`, `igshid`, `igsh`, `ref`, `ref_src`, `mc_cid`, `mc_eid`, `spm` are removed. The rest are sorted by name.
    5. A trailing `/` is removed unless the path is only `/`.
    6. Instagram post and reel URLs (`/p/{code}`, `/reel/{code}`, `/reels/{code}`, `/tv/{code}`) become `https://instagram.com/p/{code}`. Manual signals often link Instagram posts, so the same post pasted in two forms is caught as a duplicate.
17. When there is no URL (manual signals only), the fingerprint is the SHA-256 of `kind|author|excerpt` with author and excerpt lowercased and whitespace-collapsed.
18. (`account`, `fingerprint`) is unique. When a draft's fingerprint already exists for the account, no row is created. If the draft carries metrics, the existing row's `metrics` are replaced with the newer values. `captured_at`, `run` and `source` of the existing row do not change. The source's `duplicates` counter goes up by one.
19. Two drafts in the same run with the same fingerprint: the first is saved, the second counts as a duplicate.

### Partial failure and outcome

20. Each source is collected inside its own error boundary. A failure records `error:<code>` on the source (`last_status`) and in `stats.by_source`, and the run continues.
21. Source statuses: `ok` (at least one new signal), `empty` (nothing new), or `error:<code>` with one of `timeout`, `http_<status>`, `invalid_feed`, `blocked_url`, `provider_error`, `refused`, `provider_not_configured`.
22. Every visited source gets `last_run_at` = now and `last_status`.
23. The collection stage fails the run only when every attempted source ended in an error. The run then has status `failed` and the job has `error_code = all_sources_failed`. Synthesis is skipped.
24. Otherwise, if `synthesize` is true, the run calls the synthesis stage (E02-S04) and then completes. A synthesis failure fails the run with the synthesis error code, but collected signals are kept.
25. Progress: collection moves `JobRun.progress` from 0 to 70 in equal steps per source, with `message` "Collecting {label} ({i} of {n})". Synthesis sets 75 with "Grouping signals into topics" and 100 at the end.
26. On success the job `result` is `{"run_id", "signals", "duplicates", "topics"}` and `ResearchRun.stats` is filled as in the Data section.
27. After a run linked to a plan commits as `completed`, and if that account's `autopilot.selection` is on and the plan is `active`, the run service calls `selection.services.ranking.request_rank(plan, reason="research_completed")` (E03-S02). A failure to request ranking is logged and never changes the run's outcome.

### Web search collector

27. One web search source means one query. The collector makes two AI calls through the gateway (see AI section): a search call that returns text and result URLs, then an extraction call that returns structured signals.
28. Code keeps an extracted signal only if its URL, after normalization, is one of the URLs returned by the search call. This guarantees every stored link was really retrieved.
29. If the search returns no result URLs, the source is `empty` and the extraction call is skipped.
30. A refusal becomes `error:refused`. Any other provider failure after the gateway's own retries becomes `error:provider_error`.

### RSS collector

31. The feed is fetched with `safe_fetch`: `GET`, timeout 10 seconds, at most 3 redirects, response body capped at 2 MB, `User-Agent` from `SOCIALHUB_HTTP_USER_AGENT` (default `SocialHubBot/1.0`). Before connecting, and again after each redirect, the host is resolved and the request is refused if any address is loopback, private, link-local, multicast or reserved (`error:blocked_url`).
32. A timeout or connection error is retried once after 2 seconds, then recorded as `error:timeout`. A status of 400 or above is `error:http_<status>` with no retry.
33. The body is parsed with `feedparser` (RSS 0.9x, 1.0, 2.0 and Atom). If parsing yields no entries and the parser reports a malformed document, the source is `error:invalid_feed`. A valid feed with no entries is `empty`.
34. Entry mapping:

    | Signal field | From the entry |
    | --- | --- |
    | `url` | `link`; entries without a link are skipped; relative links are resolved against the feed URL |
    | `title` | `title` |
    | `excerpt` | `summary`, else the first `content` value |
    | `author` | `author`, else the feed's `title`, else the feed host |
    | `published_at` | `published_parsed`, else `updated_parsed`, converted to UTC; null when both are missing; a date more than one day in the future is treated as missing |
    | `metrics` | `{}` |
    | `raw` | `{"feed_title", "entry_id", "tags"}` (tags capped at 10) |

35. Entries are sorted newest first (undated last), filtered by rule 14, then cut to 20.

### Manual signals

36. `POST /research/signals/` creates a signal with `kind = manual`, `source = null`, `run = null`, `captured_at` = now.
37. `title` is required. At least one of `url` and `excerpt` is required. `url`, when present, must be `http` or `https`.
38. A duplicate fingerprint returns `400 validation_error` on `url` (or `excerpt` when there is no URL) with code `unique` and the existing signal's ID in `error.details.signal_id`.
39. `metrics` accepts only the keys `likes`, `comments`, `views`, each a non-negative integer.
40. `topic` is optional. When given, the new signal is attached to that topic and the topic's evidence score is recomputed (E02-S04). The topic must belong to the account and not be `used`.

### Reading

41. Signals are listed newest first by `captured_at`. `raw` is never returned by the API.
42. Runs are listed newest first by `started_at`.

## Data

Uses `ResearchRun` and `TrendSignal` from [DATA-MODEL.md](../../DATA-MODEL.md), plus:

| Table | Addition | Notes |
| --- | --- | --- |
| `ResearchRun` | `params` JSON | `{"lookback_days": 7, "source_ids": [21, 22] or null, "collect": true, "synthesize": true}` |
| `ResearchRun.stats` | Extra keys | `duplicates` at top level; `duplicates` per source; `synthesis` (`done`, `skipped_too_few_signals`, `skipped`) |

`stats` after a run:

```json
{
  "signals": 23,
  "duplicates": 5,
  "topics": 6,
  "synthesis": "done",
  "by_source": {
    "21": {"signals": 7, "duplicates": 1, "status": "ok"},
    "22": {"signals": 0, "duplicates": 0, "status": "error:timeout"},
    "26": {"signals": 16, "duplicates": 4, "status": "ok"}
  }
}
```

Indexes: `TrendSignal(account, captured_at desc)`, unique `TrendSignal(account, fingerprint)`, `TrendSignal(run)`, `ResearchRun(account, started_at desc)`, partial unique `ResearchRun(account) WHERE status = 'running'`.

Settings added: `SOCIALHUB_HTTP_USER_AGENT` (default `SocialHubBot/1.0`), `SOCIALHUB_RESEARCH_BLOCKED_DOMAINS` (comma-separated domains, default empty), `SOCIALHUB_FETCH_ALLOW_HOSTS` (comma-separated hosts that `safe_fetch` may reach even when private; honoured only when `DJANGO_DEBUG=true` or the test hooks are on).

New dependency: `feedparser`.

## API

All paths are under `/api/v1/`. Signed-in users of either role.

### `POST /research/runs/` → job

Request:

```json
{
  "account": 3,
  "plan": 12,
  "lookback_days": 7,
  "collect": true,
  "synthesize": true
}
```

Response `202`:

```json
{
  "job": {
    "id": "7c1d2c2e-93a5-4d0b-8c7e-5f0a3b1f6d21",
    "kind": "research.run",
    "status": "queued",
    "progress": 0,
    "message": "",
    "target_type": "research_run",
    "target_id": "31",
    "result": null,
    "error_code": null,
    "error_detail": null,
    "created_at": "2026-11-22T09:20:00Z",
    "started_at": null,
    "finished_at": null
  }
}
```

Job `result` on success:

```json
{"run_id": 31, "signals": 23, "duplicates": 5, "topics": 6}
```

| Case | Status and code | Detail |
| --- | --- | --- |
| Missing or unknown `account` | `400 validation_error` | `account` |
| Account archived | `409 invalid_transition` | |
| `plan` of another account or `closed` | `400 validation_error` | `plan`: `invalid` |
| `source_ids` contains an inactive or foreign source | `400 validation_error` | `source_ids.<index>`: `invalid` |
| No active sources and `collect` true | `400 validation_error` | `source_ids`: `no_active_sources` |
| `lookback_days` outside 1–30 | `400 validation_error` | `lookback_days`: `min_value` or `max_value` |
| `collect` and `synthesize` both false | `400 validation_error` | non-field: `nothing_to_do` |
| A run is already running | `409 job_in_progress` | `error.details.job` is the active job |
| AI provider missing and `synthesize` true | `503 provider_not_configured` | |

### `GET /research/runs/`

Query: `account` (required), `plan`, `status` (comma-separated), `page`, `page_size`. Ordered by `-started_at`.

```json
{
  "count": 2,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 31,
      "account": 3,
      "plan": 12,
      "status": "completed",
      "params": {"lookback_days": 7, "source_ids": null, "collect": true, "synthesize": true},
      "stats": {
        "signals": 23,
        "duplicates": 5,
        "topics": 6,
        "synthesis": "done",
        "by_source": {
          "21": {"signals": 7, "duplicates": 1, "status": "ok"},
          "22": {"signals": 0, "duplicates": 0, "status": "error:timeout"},
          "26": {"signals": 16, "duplicates": 4, "status": "ok"}
        }
      },
      "started_at": "2026-11-22T09:20:01Z",
      "finished_at": "2026-11-22T09:24:37Z",
      "job": {
        "id": "7c1d2c2e-93a5-4d0b-8c7e-5f0a3b1f6d21",
        "status": "succeeded",
        "progress": 100,
        "message": "Done",
        "error_code": null
      },
      "started_by": {"id": 2, "name": "Sara Ahmadi"}
    }
  ]
}
```

### `GET /research/runs/{id}/`

Same object as a list row, plus `sources`: the per-source results joined with the source's current kind and label, so the panel does not need a second call. A deleted source appears with `kind` and `label` null.

```json
{
  "id": 31,
  "account": 3,
  "plan": 12,
  "status": "completed",
  "params": {"lookback_days": 7, "source_ids": null, "collect": true, "synthesize": true},
  "stats": {"signals": 23, "duplicates": 5, "topics": 6, "synthesis": "done", "by_source": {"21": {"signals": 7, "duplicates": 1, "status": "ok"}, "22": {"signals": 0, "duplicates": 0, "status": "error:timeout"}, "26": {"signals": 16, "duplicates": 4, "status": "ok"}}},
  "sources": [
    {"source_id": 21, "kind": "web_search", "label": "Coffee trends", "signals": 7, "duplicates": 1, "status": "ok"},
    {"source_id": 22, "kind": "rss", "label": "perfectdailygrind.com", "signals": 0, "duplicates": 0, "status": "error:timeout"},
    {"source_id": 26, "kind": "rss", "label": "sprudge.com", "signals": 16, "duplicates": 4, "status": "ok"}
  ],
  "started_at": "2026-11-22T09:20:01Z",
  "finished_at": "2026-11-22T09:24:37Z",
  "job": {"id": "7c1d2c2e-93a5-4d0b-8c7e-5f0a3b1f6d21", "status": "succeeded", "progress": 100, "message": "Done", "error_code": null},
  "started_by": {"id": 2, "name": "Sara Ahmadi"}
}
```

Errors: `404 not_found`.

### `GET /research/signals/`

Query: `account` (required), `run`, `source`, `kind` (comma-separated), `topic` (signals attached to a topic), `unassigned` (`true`: attached to no topic), `q` (case-insensitive match in `title`, `excerpt`, `author`), `captured_after`, `captured_before` (ISO timestamps), `ordering` (`-captured_at` default, `captured_at`, `-published_at`, `published_at`), `page`, `page_size`.

```json
{
  "count": 23,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 412,
      "account": 3,
      "run": 31,
      "source": {"id": 21, "kind": "web_search", "label": "Coffee trends"},
      "kind": "web_search",
      "url": "https://perfectdailygrind.com/2026/11/why-filter-coffee-is-back",
      "title": "Why filter coffee is back on café menus",
      "excerpt": "Cafés report rising orders for batch brew and pour-over as customers look for lighter, cheaper cups.",
      "author": "Perfect Daily Grind",
      "published_at": "2026-11-19T07:00:00Z",
      "captured_at": "2026-11-22T09:21:14Z",
      "metrics": {},
      "topic_ids": [58]
    }
  ]
}
```

### `POST /research/signals/`

Request:

```json
{
  "account": 3,
  "url": "https://www.instagram.com/reel/DCx1abcDEF/?igsh=MWx0",
  "title": "Competitor reel on cold brew at home, 180k views",
  "excerpt": "Three-step cold brew recipe with a kitchen jar. Comments ask about grind size.",
  "author": "@somecoffeebrand",
  "published_at": "2026-11-20T16:30:00Z",
  "metrics": {"likes": 9200, "comments": 310, "views": 180000},
  "topic": null
}
```

Response `201`: the signal object as in the list, with `kind = "manual"`, `run = null`, `source = null`.

| Case | Status and code | Field |
| --- | --- | --- |
| Missing `title` | `400 validation_error` | `title`: `required` |
| Neither `url` nor `excerpt` | `400 validation_error` | non-field: `url_or_excerpt_required` |
| `url` not `http` or `https` | `400 validation_error` | `url`: `invalid` |
| Duplicate fingerprint | `400 validation_error` | `url` or `excerpt`: `unique`; `error.details.signal_id` |
| Unknown metric key or negative value | `400 validation_error` | `metrics.<key>`: `invalid` or `min_value` |
| `topic` of another account | `400 validation_error` | `topic`: `invalid` |
| `topic` is `used` | `409 invalid_transition` | |

## Background work

| Item | Value |
| --- | --- |
| Task | `research.tasks.run_research(run_id)` |
| Queue | `default` |
| Trigger | `POST /research/runs/` only; no schedule in the MVP |
| Time limits | Soft 20 minutes, hard 22. On the soft limit the run is marked `failed` with `error_code = timeout`; signals saved so far are kept |
| Idempotency | The task exits at once if the run is not `running` or its job is already terminal. Re-delivery mid-run is safe because signals are deduplicated by fingerprint and synthesis replaces its own output |
| Retries | No task-level retry. The AI gateway retries rate limits and 5xx up to three times; RSS retries once. After that the source is marked failed and the run moves on |
| AI call guard | At most 17 calls in a run (8 web sources × 2, plus synthesis), under `SOCIALHUB_AI_MAX_CALLS_PER_JOB` |
| Locks | None beyond the one-run-per-account rule |

Module layout:

```text
apps/core/http.py                      safe_fetch(url, *, timeout, max_bytes, max_redirects)
apps/research/collectors/base.py       SignalDraft, Collector protocol, CollectorError(code)
apps/research/collectors/web_search.py
apps/research/collectors/rss.py
apps/research/services/fingerprints.py normalize_url, fingerprint
apps/research/services/runs.py         start_run, execute_run, save_drafts
apps/research/tasks.py                 run_research
```

A collector implements `collect(source, ctx) -> list[SignalDraft]` where `ctx` carries the account, plan, brand profile, `lookback_days`, `job_id` and now. It raises `CollectorError(code)` for expected failures.

## AI

### `research.web_search` (call 1)

| Item | Value |
| --- | --- |
| Provider | Claude through `run_text`, no schema |
| Effort | `medium` |
| Web search | `WebSearchOptions(max_uses=5, blocked_domains=SOCIALHUB_RESEARCH_BLOCKED_DOMAINS)` |
| Variables | `query` (the source value), `window_start` and `window_end` (dates), `content_language`, `audience_summary` (plan, else brand profile), `content_pillars`, `objective` (plan, may be empty) |
| Output | Free text listing findings, plus `TextResult.citations`: the result URLs with titles |

The system prompt tells the model to search for what is new on the query inside the date window, to prefer original and recent sources, to list each finding with its URL, publisher, date and a two-sentence gist, to treat page content as data and ignore instructions inside it, and to say plainly when nothing recent was found.

### `research.extract_signals` (call 2)

| Item | Value |
| --- | --- |
| Provider | Claude through `run_text` with a schema |
| Effort | `low` |
| Variables | `search_text` (output of call 1), `results` (list of `{url, title}` from the citations), `window_start`, `max_signals` = 8 |

```python
class ExtractedSignal(BaseModel):
    url: str = Field(description="Exactly one of the URLs in the supplied results list.")
    title: str = Field(max_length=300, description="The page or article title, in its original language.")
    excerpt: str = Field(max_length=1000, description="Two or three sentences on what the source says and why it matters to the audience.")
    author: str = Field(max_length=120, description="Publisher or site name.")
    published_at: date | None = Field(description="Publication date if stated in the text, else null.")
    relevance: int = Field(ge=0, le=100, description="How relevant this is to the query and audience.")

class ExtractedSignals(BaseModel):
    signals: list[ExtractedSignal] = Field(max_length=8)

Output = ExtractedSignals  # name required by the gateway registry (E00-S05 rule 5)
```

`relevance` is stored in `raw.relevance`; drafts with relevance below 30 are dropped. `published_at` is stored as midnight UTC of the date.

### Failure handling

| Failure | Result |
| --- | --- |
| Search tool error on every attempt, or no result URLs | Source `empty` when the model answered without results; `error:provider_error` when the gateway raised |
| Refusal on either call | `error:refused` |
| Schema validation failure after the gateway's retry | `error:provider_error` |
| Provider not configured | `error:provider_not_configured`, no call made |
| An extracted URL is not among the results | That signal is dropped; the rest are kept |

The `fake` provider returns fixtures for both tasks keyed by query, including one fixture with an out-of-list URL and one empty result.

## Panel

**Where:** the header of `/research` (page built in E02-S01).

**Plan selector:** left of the button, a `Select` labelled "Researching for" listing the account's plans that are not closed as "Week of 28 Nov · Draft", plus "No plan". It defaults to the plan the server would pick (rule 5). The choice is kept in the query string as `plan` and is also the default plan filter on the Topics tab (E02-S05).

**Run research:** a `JobButton` (primary) with a small options dropdown.

| Element | Behaviour |
| --- | --- |
| Button "Run research" | Sends `POST /research/runs/` with the selected plan and default options |
| Dropdown "Run with options…" | Opens a `ModalForm` "Run research": "Look back" (`InputNumber`, 1–30 days, default 7); "Sources" (multi-select of active, available sources, default all); "Collect new signals" (checkbox, default on); "Group signals into topics" (checkbox, default on). Button "Run" |
| While the job runs | `JobProgress` under the header shows the percentage and the job message ("Collecting Coffee trends (2 of 5)"). The button is disabled with tooltip "Research is running." |
| On success | `message.success("Research finished: {signals} new signals, {topics} topics")`; all tabs reload |
| On failure | `notification.error` with text by `error_code`: `all_sources_failed` → "No source could be read. Check the Sources tab."; `timeout` → "Research took too long and was stopped. Signals found so far were kept."; otherwise the generic provider message |
| `409 job_in_progress` | The panel adopts the job from `error.details.job` and shows its progress instead of an error |
| `400 no_active_sources` | `message.warning("Add at least one active source first")` and the Sources tab opens |
| `503 provider_not_configured` | "The AI provider is not configured. Ask an admin to check Settings → System." |

On page load the panel calls `GET /jobs/?account=&kind=research.run&status=queued,running` and resumes progress if a run is active.

**States:** no account selected → the button is hidden; archived account → hidden.

## Acceptance criteria

1. Given an account with two web search sources and one RSS feed, when I press "Run research", then I get a job, progress advances per source, and the run completes with signals attributed to each source.
2. Given a completed run, when I run again with nothing new published, then no new signals are created, `duplicates` is greater than zero, and each source shows "Nothing new".
3. Given one RSS source that times out and one that works, when the run finishes, then the run is `completed`, the failing source shows `error:timeout`, and the other source's signals are saved.
4. Given every source fails, when the run ends, then it is `failed` with `all_sources_failed` and no synthesis call is made.
5. Given a run is in progress, when I start another for the same account, then I get `409 job_in_progress` with the active job, and the panel shows that job's progress.
6. Given a run stuck in `running` for more than 30 minutes, when I start a new run, then the old run is marked failed with `stale_run` and the new one starts.
7. Given two feed entries whose links differ only by `utm_source` and a trailing slash, when they are collected, then one signal is stored.
8. Given an RSS source whose host resolves to `10.0.0.5`, when the run visits it, then no request is sent and the source shows `error:blocked_url`.
9. Given the extraction call returns a URL that the search did not return, when the collector validates it, then that signal is dropped.
10. Given a feed entry dated 20 days ago and `lookback_days` 7, when the feed is collected, then the entry is not stored.
11. Given the add-signal request with a title and a URL, when I send it, then a `manual` signal is created with no run and no source; sending the same URL again returns `unique` with the first signal's ID.
12. Given `collect = false` and `synthesize = false`, when I start a run, then I get `400` with `nothing_to_do`.
13. Given no plan is passed and the account has a draft plan for next week, when the run starts, then the run's `plan` is that plan.
14. Given the `fake` AI provider and no API keys, when I run research, then the run completes from fixtures.
15. Given an account with `autopilot.selection` on and a run linked to its active plan, when the run completes, then a `selection.rank` job is requested for that plan once; with autopilot off, no ranking job is created.
16. Given a manual signal saved with `https://www.instagram.com/reel/DCx1abcDEF/?igsh=MWx0`, when I add another with `https://instagram.com/p/DCx1abcDEF/`, then I get `unique` with the first signal's ID.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E02-S02-BE1 | Models | `ResearchRun` (with `params`) and `TrendSignal` in `apps/research/models.py`, indexes and the partial unique index, migration, admin registration. | 0.25 d |
| E02-S02-BE2 | Fingerprints | `services/fingerprints.py`: `normalize_url`, `fingerprint(kind, url, author, excerpt)`. Table-driven tests for every normalization step, Instagram URL forms, and the no-URL case. | 0.25 d |
| E02-S02-BE3 | Safe fetch and RSS collector | `apps/core/http.py` `safe_fetch` with address checks on every hop, the `SOCIALHUB_FETCH_ALLOW_HOSTS` bypass (debug or test hooks only), size cap, redirect cap; shared with E03-S01 feeds. `collectors/rss.py` with `feedparser`, entry mapping, sorting, limits, error codes. Add `feedparser` to `pyproject.toml` and the lock file. Tests with recorded feeds (RSS 2.0, Atom, malformed, empty, relative links, missing dates). | 0.5 d |
| E02-S02-BE4 | Web search collector | `collectors/web_search.py`; prompt directories `apps/ai/prompts/research.web_search/` and `research.extract_signals/` with `system.md`, `user.md`, `schema.py`, `VERSION`; URL-in-results validation; relevance cut; fake fixtures. Tests for each failure row. | 0.75 d |
| E02-S02-BE5 | Run service and task | `services/runs.py` (`start_run` with locking and stale-run recovery, `execute_run` with per-source error boundary, `save_drafts`, progress, stats, source status updates, the on-commit `request_rank` call of rule 27, synthesis hook) and `tasks.run_research` with time limits. | 0.5 d |
| E02-S02-BE6 | Run endpoints | `POST /research/runs/`, `GET /research/runs/`, `GET /research/runs/{id}/` with validation, plan default, `409 job_in_progress`, `503 provider_not_configured`. Enable the delete guard from E02-S01-BE3. | 0.25 d |
| E02-S02-BE7 | Signal endpoints | `GET /research/signals/` with filters and ordering; `POST /research/signals/` with manual rules and optional topic attach (attach is a no-op hook until E02-S04). | 0.25 d |
| E02-S02-BE8 | Contract and integration tests | Extend `docs/openapi.yaml` (five endpoints, schemas, error code `job_in_progress`). End-to-end test: start run with fake provider and stubbed HTTP, assert stats, statuses, dedupe on second run. | 0.25 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E02-S02-FE1 | Run research control | Plan selector and `JobButton` in the `/research` header, options `ModalForm`, `JobProgress`, resume on load, success and failure messages, `409` adoption, reload of tabs through a shared refresh key. Service calls in `src/services/socialhub/research.ts`. Component test for the `409` and `400 no_active_sources` paths. | 0.5 d |

### Test

None. Tests are part of each subtask.

## Test notes

- Unit: fingerprints; text trimming at word boundaries; age filter with and without dates; future-dated entries; per-source caps; stats arithmetic.
- Collector: RSS against local fixture files served by a stub transport (no network in tests); `safe_fetch` refuses loopback, private, link-local addresses and a redirect to one; body over 2 MB is cut and treated as `invalid_feed` when unparsable.
- Service: partial failure; all-failed; stale-run recovery; concurrent `start_run` calls produce one run (transaction test); re-delivered task exits early.
- API: every error row; plan default selection across timezones (account in `Asia/Tehran` around midnight UTC).
- Fake-provider scenarios: `research.web_search` fixtures `ok`, `empty`, `refused`; `research.extract_signals` fixtures `ok`, `out_of_list_url`, `low_relevance`.

## Later

- Scheduled runs: add a Beat entry that calls `start_run(account, created_by=None)`; nothing else changes.
- Parallel collection with a small thread pool for web search sources if runs become slow.
- Conditional feed requests using stored `ETag` and `Last-Modified` in a `ResearchSource.state` JSON field.
- A `last_seen_at` on signals to tell "still trending" from "seen once".
- Cancel: `POST /research/runs/{id}/cancel/` setting a flag the loop checks between sources.
- Public Instagram signals as a third collector, visited after RSS (E02-S03).
