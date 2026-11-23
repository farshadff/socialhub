# E00-S05 — AI gateway for Claude and OpenAI

| | |
| --- | --- |
| Epic | E00 Foundation |
| Priority | Must |
| Estimate | BE 3 d · FE 0.5 d · QA 0 d |
| Depends on | E00-S01 (admin permission), E00-S06 (jobs); E00-S02 for the System page |
| Needed by | Every story with an AI task: E02-S02, E02-S04, E03-S02, E04-S03, E05-S01, E05-S03, E06-S05, E06-S06, E07-S03, E07-S04, E10-S02, E10-S04 |

## User story

As a developer building a workflow step, I want one function to call for text and one for images, with prompts, schemas, retries, cost and logging handled for me, so that each step is a prompt and a schema instead of provider plumbing — and as an admin, I want to see that the AI keys work and what the calls cost.

## Context

[AI-INTEGRATION.md](../../AI-INTEGRATION.md) fixes the design: Claude for reasoning, writing, checking, vision and web search; OpenAI for image generation; keys from environment variables; one gateway module that is the only importer of provider SDKs. This story builds that gateway, the fake providers that let the whole pipeline run without keys, the `AIRun` log, and a small admin page that shows provider status.

The scaffold's `apps/core/providers.py` has `FixtureModelProvider`, `FixtureSourceProvider` and `DisabledPublisher`, and `settings.py` refuses to start unless both providers are `fixture` and the publisher is `disabled`. This story removes all of it. Phase 1 has no publisher, so nothing replaces the publisher part.

## Scope

**In**

- `apps/ai`: gateway functions `run_text` and `run_image`, provider adapters (`anthropic`, `openai`, `fake`), task registry and prompt loader, `AIRun` model.
- Structured output, effort, refusal handling with fallback, web search, image input, prompt caching, streaming for long outputs, retries, timeouts, a per-job call guard.
- Cost calculation from a price table.
- `system.ping` task; `GET /system/status/`, `POST /system/ai-test/`, `GET /ai/runs/`, `GET /ai/runs/{id}/`.
- Panel: Settings → System page (admin).

**Out (later)**

- The prompts and schemas of the workflow tasks (each belongs to its own story).
- Spend caps, per-account budgets, model routing or prompt editing in the panel.
- Batch processing, embeddings, agents or tool loops.
- Other providers.

## Behaviour and rules

### Public surface

1. The only public functions are those in AI-INTEGRATION.md section 2:

```python
run_text(task, *, variables, schema=None, images=None, web_search=None, account_id=None, job_id=None) -> TextResult
run_image(task, *, prompt, size, account_id=None, job_id=None) -> ImageResult
```

2. No module outside `apps/ai/providers/` imports `anthropic` or `openai`. A test enforces this by scanning imports.
3. `TextResult` has `data` (an instance of `schema` when one is given, otherwise `str`), `citations` (list of `{"url", "title"}`), `ai_run_id`. `ImageResult` has `content` (bytes), `mime`, `width`, `height`, `ai_run_id`.
4. Gateway errors, all subclasses of `AIError` with a `code` and a `retryable` flag:

| Exception | `code` | Raised when |
| --- | --- | --- |
| `ProviderNotConfigured` | `provider_not_configured` | The key or model setting for the active provider is missing |
| `ProviderRefused` | `provider_error`, detail `refused` | The model declined the request and the fallback also declined or was unavailable |
| `ProviderError` | `provider_error`, detail `rate_limited`, `timeout`, `unavailable`, `bad_request`, `web_search_failed` | The provider failed after retries, or rejected the request |
| `OutputInvalid` | `provider_error`, detail `invalid_output` | The output could not be validated against the schema, or was cut off by the output limit |
| `CallLimitExceeded` | `provider_error`, detail `call_limit` | The job already made `SOCIALHUB_AI_MAX_CALLS_PER_JOB` calls |

   Job tasks catch `AIError` and fail the job with `error_code = exc.code` and `error_detail = exc.detail`.

### Task registry and prompts

5. A task is a directory named exactly after its dotted key, `apps/ai/prompts/<task.key>/` (for example `apps/ai/prompts/brief.generate/`), containing `system.md`, `user.md` (Jinja2), optional `schema.py` (exporting a Pydantic model as `Output`; an alias such as `Output = ScriptPackage` is fine), `VERSION` (a short string such as `1`), and fake fixtures `fixture.json` plus optional `fixture.<variant>.json`. Runtime options live in one table, `apps/ai/tasks.py`:

```python
TASKS = {
    "system.ping": TaskSpec(provider="text", effort="low", max_tokens=64, stream=False),
    # later stories add their rows: effort from AI-INTEGRATION.md section 4
}
```

6. `TaskSpec` fields: `provider` (`text` or `image`), `effort` (`low`, `medium`, `high`), `max_tokens` (default 16,000), `stream` (default false; true for long outputs), `cache_brand` (default true: include the brand block in the cached prefix when `account_id` is given).
7. Templates render with Jinja2 `StrictUndefined`: a missing variable is a programming error raised before any provider call. Structured variables are inserted as JSON with sorted keys so identical inputs produce identical prompts.
8. `system.md` must not contain timestamps, IDs or per-item data; a registry test rejects templates in `system.md` that reference variables other than `content_language`.
9. When `account_id` is given and `cache_brand` is true, the gateway adds a second system block built by `render_brand_block(account)` (tone of voice, audience, pillars, banned terms, CTA examples, handle, language, colour names with their hex values, heading and body font keys) in a fixed key order, and marks the end of the stable prefix as cacheable. Per-item content goes in the user message.
10. Unknown task key, missing files or a `schema.py` without `Output` fail at startup through a Django system check, not at call time.
11. The model for a text task is `SOCIALHUB_AI_TEXT_MODEL_OVERRIDES[task]` if present, otherwise `SOCIALHUB_AI_TEXT_MODEL` (default `claude-opus-5-5`). The model ID is passed exactly as configured.

### Text calls (Claude)

The adapter follows AI-INTEGRATION.md section 3. Method names and signatures come from the official `anthropic` Python SDK documentation for the pinned SDK version; this specification states behaviour only.

12. **Structured output.** When `schema` is given, the adapter uses the SDK's structured-output parsing with that Pydantic model. It never extracts JSON from free text. If parsing fails or the response ended because the output limit was reached, it raises `OutputInvalid`.
13. **Thinking and effort.** Thinking is left at the model default. `output_config.effort` is always set from the task's `effort`. No `temperature`, `top_p`, `top_k`, assistant prefill or forced tool choice is ever sent.
14. **Refusals.** The adapter checks `stop_reason` before reading content. Requests enable the server-side fallback (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta). If the final response is still a refusal, the `AIRun` is stored with `status = refused` and `ProviderRefused` is raised. The model that actually answered is the one stored in `AIRun.model`.
15. **Web search.** When `web_search` is given (`WebSearchOptions(max_uses=5, allowed_domains=None, blocked_domains=None)`), the adapter declares the `web_search_20260209` server tool with those limits and a schema must not be given in the same call (the two-call pattern in AI-INTEGRATION.md is the caller's job). It collects `citations` from the result blocks, de-duplicated by URL. A result block that carries an error object is skipped; if every search errored, it raises `ProviderError` with detail `web_search_failed`. A `pause_turn` stop is continued as the SDK documentation describes until the turn ends.
16. **Images.** `images` is a list of up to 8 `ImageInput(content: bytes, media_type)`. Each is downscaled with Pillow so its long side is at most 1568 px, re-encoded (JPEG quality 90, or PNG when it has transparency), and sent as a base64 image block before the text block.
17. **Streaming.** When the task has `stream = True`, the adapter streams and uses the SDK's final-message helper; callers still get one `TextResult`. Non-streaming calls cap `max_tokens` at 16,000.
18. **Timeout and retries.** Per-attempt timeout is `SOCIALHUB_AI_TIMEOUT_SECONDS` (default 180). The SDK's own retry count is set to 0 so retries are counted in one place. The gateway retries rate limits, 5xx responses, timeouts and connection errors up to 3 times (4 attempts in total), waiting 2, 8 and 30 seconds before the retries or the provider's `retry-after` when it is longer (capped at 60 seconds). 4xx errors other than rate limits are not retried. Errors are caught from the most specific SDK error class to the least.

### Image calls (OpenAI)

19. `run_image` uses the official `openai` SDK's image generation endpoint with `SOCIALHUB_AI_IMAGE_MODEL`. `size` is one of `square`, `portrait`, `landscape`, mapped to pixel sizes by `SOCIALHUB_AI_IMAGE_SIZES` (default `{"square": "1024x1024", "portrait": "1024x1536", "landscape": "1536x1024"}`; confirm the sizes the configured model supports when deploying).
20. The gateway appends a fixed instruction to every image prompt: no text, letters, numbers, logos or watermarks in the image. Text on assets is drawn by render templates.
21. The result is returned as bytes. The gateway does not create `Asset` rows; the calling story (E06-S05) does.
22. A content-policy rejection raises `ProviderRefused`. Retries follow rule 18.

### Logging, cost and limits

23. Every `run_text` and `run_image` call writes exactly one `AIRun` row, whatever the outcome, with `task`, `prompt_version`, `provider`, `model`, token counts, `units`, `cost_usd`, `latency_ms` (total across attempts), `status`, `error_code`, `provider_request_id`, `job`, `account`.
24. `units` records what the provider reported beyond plain tokens: `cache_read_tokens`, `cache_write_tokens`, `web_searches`, `images`, `attempts`, `fallback_used`.
25. `cost_usd` is computed from `SOCIALHUB_AI_PRICES`, a JSON map keyed by model ID. Text entries hold prices per million tokens: `input`, `output`, `cache_read`, `cache_write`; optional `web_search` per call. Image entries hold `per_image` by size. The seed table contains `claude-opus-5-5` (`input` 4.00, `output` 20.00, `cache_read` 0.20) and `claude-haiku-5-5` (`input` 0.10, `output` 0.50); the remaining values and the image model's prices are filled from the providers' pricing pages at deployment. A model missing from the table gets cost 0 and `units.price_missing = true`, and the System page lists it.
26. `payload` stores the rendered system and user text, the options sent, and the response text or parsed data, truncated to 64 KB in total. Images are replaced by `{"sha256", "bytes", "media_type"}`. API keys are never included.
27. `ai.prune_payloads` runs daily and sets `payload` to null on rows older than 30 days. The rest of the row is kept.
28. Before a call with a `job_id`, the gateway counts that job's `AIRun` rows; at `SOCIALHUB_AI_MAX_CALLS_PER_JOB` (default 20) it raises `CallLimitExceeded` without calling the provider. Only logical calls count: the retries inside one `run_text` or `run_image` call (rule 18) share one `AIRun` row and do not count separately.
29. When the active provider's key is missing, the gateway writes an `AIRun` with `status = error`, `error_code = provider_not_configured`, and raises `ProviderNotConfigured`.

### Fake providers

30. `fake` text returns the content of `apps/ai/prompts/<task>/fixture.json`, validated against the task's schema (plain text for tasks without a schema). It picks what to return in this order: (1) when `SOCIALHUB_TESTING_HOOKS=true`, an override stored in Redis for the task (`{"variant": "<name>"}` or literal `{"data": …}`), set through the E11-S03 test hooks so the API and every worker see it; (2) an in-process override from `fake_text.set(task, data_or_exception)` (unit tests); (3) a variant selected by the `_fixture` variable or a caption marker, loading `fixture.<name>.json`; (4) `fixture.json`. With `web_search`, it returns two fixed citations on `example.com`. Variants needed by the acceptance suite ship with their tasks: `copy.generate` → `fixture.too-long.json`, `qc.facts` → `fixture.unsupported-number.json`.
31. `fake` image returns a PNG of the requested size filled with a colour derived from the prompt's hash, drawn with Pillow.
32. Fake calls write `AIRun` rows with `provider = fake`, zero tokens and zero cost.
33. A registry test asserts that every registered text task with a schema has a fixture that validates, so the pipeline always runs locally.

### Settings and guard

34. Settings added: all rows of AI-INTEGRATION.md section 1, plus `SOCIALHUB_AI_IMAGE_SIZES` and `SOCIALHUB_AI_MAX_CALLS_PER_JOB`. Local defaults keep both providers on `fake`.
35. Settings removed: `SOCIALHUB_SOURCE_PROVIDER`, `SOCIALHUB_MODEL_PROVIDER`, `SOCIALHUB_PUBLISHER_PROVIDER`, `SOCIALHUB_PUBLISHING_ENABLED`, the whole startup guard that checks them, `apps/core/providers.py` (including `DisabledPublisher`) and `apps/core/fixtures/demo_source_items.json`. `.env.example`, `compose.yaml` comments and the root `README.md` are updated to match.
36. With `DJANGO_DEBUG=false` and a provider set to `fake`, startup fails with `ImproperlyConfigured` (the production startup rule owned by E11-S02 rule 9). Local development and the acceptance stack run with `DJANGO_DEBUG=true`, where `fake` is the default.

### System status and AI test

37. `GET /system/status/` reports configuration, never secret values. `configured` is true when the provider is `fake`, or when its key and model setting are present. The Celery worker check uses a one-second inspect timeout and reports `unknown` when it cannot tell.
38. `POST /system/ai-test/` starts a `system.ai_test` job that runs `system.ping` through `run_text` and one `square` image through `run_image` (the image is discarded). The job succeeds whenever it ran; each provider's outcome is in `result`. Real providers are billed for the test, so the panel says so.

## Data

- `AIRun` as in [DATA-MODEL.md](../../DATA-MODEL.md) section 3. Indexes on (`created_at`), (`task`, `created_at`), (`account`, `created_at`), (`job`).
- `JobRun` kind: `system.ai_test`.
- New dependencies: `anthropic`, `openai`, `pydantic`, `jinja2`, `pillow`, all pinned in the lock file.

## API

Conventions and error shape: [API.md](../../API.md). All endpoints here are admin-only; operators get `403 permission_denied`.

### `GET /api/v1/system/status/`

```json
{
  "app": { "version": "0.1.0", "environment": "production", "debug": false },
  "dependencies": { "database": "ok", "redis": "ok" },
  "workers": { "default": "ok", "render": "ok" },
  "ai": {
    "text": {
      "provider": "anthropic",
      "configured": true,
      "missing": [],
      "model": "claude-opus-5-5",
      "overrides": {}
    },
    "image": {
      "provider": "openai",
      "configured": false,
      "missing": ["OPENAI_API_KEY"],
      "model": ""
    },
    "models_without_price": [],
    "max_calls_per_job": 20,
    "timeout_seconds": 180
  },
  "storage": { "backend": "s3", "bucket": "socialhub-media", "public_base_url": null }
}
```

The `storage` block is filled by E00-S06; until it lands the key is present with a `null` value.

### `POST /api/v1/system/ai-test/`

Request (optional body; default tests both):

```json
{ "providers": ["text", "image"] }
```

Response `202` with a job of kind `system.ai_test`. The finished job from `GET /jobs/{id}/`:

```json
{
  "id": "3f5d9d0a-91f5-4a3b-8f3a-5a1b7d2c9e10",
  "kind": "system.ai_test",
  "status": "succeeded",
  "progress": 100,
  "message": "Done",
  "target_type": "system",
  "target_id": "ai",
  "result": {
    "text": {
      "ok": true,
      "provider": "anthropic",
      "model": "claude-opus-5-5",
      "latency_ms": 1840,
      "ai_run_id": 311,
      "error_code": null,
      "error_detail": null
    },
    "image": {
      "ok": false,
      "provider": "openai",
      "model": "",
      "latency_ms": 0,
      "ai_run_id": 312,
      "error_code": "provider_not_configured",
      "error_detail": "OPENAI_API_KEY is not set."
    }
  },
  "error_code": null,
  "error_detail": null,
  "created_at": "2026-11-25T10:02:00Z",
  "started_at": "2026-11-25T10:02:00Z",
  "finished_at": "2026-11-25T10:02:03Z"
}
```

| Case | HTTP | Code |
| --- | --- | --- |
| `providers` contains anything other than `text`, `image` | 400 | `validation_error` (`providers`) |
| A test job is already running | 409 | `job_in_progress` |

### `GET /api/v1/ai/runs/`

Filters: `account`, `task`, `provider`, `status`, `job`, `created_after`, `created_before`. Ordering: `-created_at` (default), `created_at`, `-cost_usd`, `-latency_ms`. `account` is optional here because system calls have none. The response adds `totals` for the whole filtered set, not just the page.

```json
{
  "count": 2,
  "next": null,
  "previous": null,
  "totals": {
    "calls": 2,
    "input_tokens": 4170,
    "output_tokens": 1263,
    "cost_usd": "0.041940"
  },
  "results": [
    {
      "id": 318,
      "created_at": "2026-11-25T11:20:14Z",
      "job": "b0f7c1f4-0c8e-4f4e-9c57-7a5a2b0d1c33",
      "account": 1,
      "provider": "anthropic",
      "model": "claude-opus-5-5",
      "task": "brief.generate",
      "prompt_version": "1",
      "input_tokens": 4150,
      "output_tokens": 1260,
      "units": { "cache_read_tokens": 1900, "attempts": 1, "fallback_used": false },
      "cost_usd": "0.041900",
      "latency_ms": 9420,
      "status": "ok",
      "error_code": null,
      "provider_request_id": "req_011CVx2mK9"
    },
    {
      "id": 311,
      "created_at": "2026-11-25T10:02:02Z",
      "job": "3f5d9d0a-91f5-4a3b-8f3a-5a1b7d2c9e10",
      "account": null,
      "provider": "anthropic",
      "model": "claude-opus-5-5",
      "task": "system.ping",
      "prompt_version": "1",
      "input_tokens": 20,
      "output_tokens": 3,
      "units": { "attempts": 1, "fallback_used": false },
      "cost_usd": "0.000140",
      "latency_ms": 1840,
      "status": "ok",
      "error_code": null,
      "provider_request_id": "req_011CVwYt3Q"
    }
  ]
}
```

### `GET /api/v1/ai/runs/{id}/`

The list object plus `payload` (or `null` after pruning):

```json
{
  "id": 311,
  "created_at": "2026-11-25T10:02:02Z",
  "job": "3f5d9d0a-91f5-4a3b-8f3a-5a1b7d2c9e10",
  "account": null,
  "provider": "anthropic",
  "model": "claude-opus-5-5",
  "task": "system.ping",
  "prompt_version": "1",
  "input_tokens": 20,
  "output_tokens": 3,
  "units": { "attempts": 1, "fallback_used": false },
  "cost_usd": "0.000140",
  "latency_ms": 1840,
  "status": "ok",
  "error_code": null,
  "provider_request_id": "req_011CVwYt3Q",
  "payload": {
    "request": {
      "system": ["You are a connectivity check for Social Hub."],
      "user": "Reply with the single word: pong",
      "options": { "effort": "low", "max_tokens": 64, "web_search": null, "images": [] }
    },
    "response": { "text": "pong", "stop_reason": "end_turn" },
    "truncated": false
  }
}
```

## Background work

| Task | Queue | Trigger | Notes |
| --- | --- | --- | --- |
| `system.ai_test` | `default` | `POST /system/ai-test/` | Progress 50 after the text call, 100 after the image call. Provider failures are recorded in `result`, not as a job failure. |
| `ai.prune_payloads` | `default` | Celery Beat, daily 02:30 UTC | Nulls `payload` on rows older than 30 days, in batches of 1,000. |

The gateway itself runs inside whichever task calls it. It is safe to call from any queue; it holds no global state besides the SDK clients, which are created once per process.

## AI

| Task | Provider | Input | Output | Effort |
| --- | --- | --- | --- | --- |
| `system.ping` | Claude | System: "You are a connectivity check for Social Hub." User: "Reply with the single word: pong" | Text | low, `max_tokens` 64 |

Failure handling is rule 38: the outcome is reported, nothing retries beyond rule 18.

## Panel

### `/settings/system` — System (admin only)

`PageFrame` title "System", description "Integration status and AI usage." Two tabs: **Status** and **AI calls**.

**Status tab** — `Card`s with `Descriptions`:

| Card | Rows |
| --- | --- |
| Application | Version, Environment, Database, Redis, Workers (Default, Render) each as a tag: "OK" (success), "Unavailable" (error), "Unknown" (default) |
| AI providers | Two rows, Text and Images: provider name ("Claude", "OpenAI", "Fake (local testing)"), model ID, and a tag "Ready" (success) or "Missing {setting names}" (error). A warning `Alert` lists `models_without_price` when not empty: "No price is set for {models}; their cost is recorded as 0." Action: "Run AI test" (`JobButton`) with the helper text "Makes one small call to each provider. Real providers charge for it." |
| Storage | Backend ("Local disk" / "S3-compatible"), Bucket |

After the test job ends, a result list appears under the AI providers card: for each provider, a success line "Claude replied in 1.8 s" or an error line with the English text for the `error_code` and the `error_detail`. The page reloads the status afterwards.

**AI calls tab** — `Table` (`useTable`) on `GET /ai/runs/`:

- Columns: Time (`DateTime`), Task, Account (`@handle` or "—"), Provider, Model, Tokens in / out, Cost (USD, 4 decimals), Duration (seconds, 1 decimal), Status (tag: OK success, Error error, Refused warning).
- Search form: Task (select of registered tasks, from the distinct values in the result set), Account, Status, date range. Default range: last 7 days.
- Above the table, a summary line from `totals`: "{calls} calls · {input} tokens in · {output} tokens out · ${cost}".
- Row click opens a `Drawer` with `GET /ai/runs/{id}/`: the row's fields, then "Request" and "Response" as preformatted, scrollable JSON wrapped in `ContentText`-style `dir="auto"` blocks; "Payload removed after 30 days." when `payload` is null.

States: skeletons while loading; `PageError` on failure; empty table text "No AI calls in this period."; operators never reach the page (403 page).

## Acceptance criteria

1. Given both providers are `fake`, when an admin runs the AI test, then the job succeeds, both results are `ok`, and two `AIRun` rows with `provider = fake` and cost 0 exist.
2. Given `SOCIALHUB_AI_TEXT_PROVIDER=anthropic` and no `ANTHROPIC_API_KEY`, when `run_text` is called, then `ProviderNotConfigured` is raised, an `AIRun` with `error_code = provider_not_configured` exists, and the System page shows "Missing ANTHROPIC_API_KEY" for Text.
3. Given a task with a schema and a valid provider response, when `run_text` returns, then `data` is an instance of that schema and the `AIRun` has token counts, `cost_usd` computed from the price table, and `status = ok`.
4. Given the provider returns a rate-limit error twice and then succeeds, when `run_text` is called, then it returns normally, one `AIRun` exists, and `units.attempts` is 3.
5. Given the provider returns a 400 error, when `run_text` is called, then no retry happens and `ProviderError` with detail `bad_request` is raised.
6. Given a refusal that the fallback does not resolve, when `run_text` is called, then `ProviderRefused` is raised and the `AIRun` has `status = refused`.
7. Given a `user.md` that references a variable the caller did not pass, when `run_text` is called, then it fails before any provider call and no `AIRun` is written.
8. Given a job that has already made 20 AI calls, when it calls the gateway again, then `CallLimitExceeded` is raised and the provider is not called.
9. Given a 3000 × 4000 px image input, when it is sent, then the block sent to the provider is at most 1568 px on its long side.
10. Given `web_search` options, when the fake provider answers, then `citations` contains URL and title pairs without duplicates; given a schema and `web_search` together, then the gateway raises a programming error before calling the provider.
11. Given an `AIRun` older than 30 days, when the prune task runs, then its `payload` is null and its other fields are unchanged.
12. Given a search of the backend for `import anthropic` or `import openai`, when run, then matches exist only under `apps/ai/providers/`.
13. Given an operator, when they call `GET /system/status/` or `GET /ai/runs/`, then the response is `403 permission_denied`.
14. Given the backend starts without the old `SOCIALHUB_MODEL_PROVIDER`, `SOCIALHUB_SOURCE_PROVIDER`, `SOCIALHUB_PUBLISHER_PROVIDER` and `SOCIALHUB_PUBLISHING_ENABLED` variables, then it boots normally; the old guard is gone.
15. Given a registered text task whose fixture does not match its schema, when the test suite runs, then the registry test fails naming the task.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S05-BE1 | App, model, settings and task registry | Create `apps/ai`; `AIRun` model, migration and indexes; settings from rule 34 and removal of the old guard, its variables, `apps/core/providers.py` and the demo fixture, with `.env.example` and README updated (rule 35); `tasks.py` with `TaskSpec`; prompt loader with `StrictUndefined`; system check for registry consistency (rules 5–11); `system.ping` task with fixture. | 0.5 |
| E00-S05-BE2 | Gateway core | `gateway.py`: `run_text`, `run_image`, result and error types, model selection, brand block rendering, retry loop, timeout, call guard, `AIRun` writing with payload truncation and cost calculation from `SOCIALHUB_AI_PRICES` (rules 1–4, 18, 23–29). Unit tests with a scripted provider double. | 0.75 |
| E00-S05-BE3 | Anthropic adapter | `providers/anthropic_provider.py` following the pinned SDK's documentation: structured output, effort, no sampling parameters, refusal check with server-side fallback, web search tool and citation extraction, `pause_turn` continuation, image blocks with downscaling, prompt caching of the stable prefix, streaming with the final-message helper, typed error mapping (rules 12–18). Tests against recorded response objects; one opt-in live test skipped without a key. | 1.0 |
| E00-S05-BE4 | OpenAI image adapter and fake providers | `providers/openai_provider.py` (rules 19–22); `providers/fake.py` for text and image with fixtures, variants, Redis-backed and in-process test overrides (rules 30–33); import-boundary test (rule 2). | 0.5 |
| E00-S05-BE5 | System endpoints, test job and pruning | `GET /system/status/` (with a `null` placeholder for the `storage` block), `POST /system/ai-test/` and its task, `GET /ai/runs/` with filters and `totals`, `GET /ai/runs/{id}/`, `ai.prune_payloads` and its Beat entry, `openapi.yaml`. API tests including the permission checks. | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S05-FE1 | System status tab | `src/services/socialhub/system.ts`; `/settings/system` Status tab with the three cards, "Run AI test" with `JobButton`, result list and status reload. | 0.25 |
| E00-S05-FE2 | AI calls tab | `Table` (`useTable`) with filters, totals line and the detail drawer. | 0.25 |

### Test

None beyond the tests inside each subtask.

## Test notes

- **Gateway unit tests** use a scripted provider double (not the fake provider) that returns a sequence of responses and errors, to cover retries, refusal, invalid output, cost arithmetic (including cached tokens and a model without a price), truncation at 64 KB, and the call guard.
- **Adapter tests** build provider response objects by hand and assert the request the adapter would send: effort present, no sampling parameters, schema passed through the SDK's structured-output mechanism, web search tool declared with `max_uses`, images before text, cache marker on the stable prefix.
- **Live tests** (`pytest -m live`) call each real provider once with `system.ping` and a 1024-px image; they are skipped unless the keys are set and are never part of CI.
- **Registry tests:** every task has `system.md`, `user.md`, `VERSION`; every schema has field descriptions and bounded lists; every fixture validates.
- **Panel:** component test for the status cards with configured, missing and fake variants; table and drawer against mocked responses.
- Later stories test their own prompts through `fake_text.set(...)` and never against a live provider in CI.

## Later

- Spend caps: check a budget before rule 28's guard using the same `AIRun` cost data; add `budget_exceeded` as an error detail.
- Per-task model routing in the panel: store `SOCIALHUB_AI_TEXT_MODEL_OVERRIDES` in a table read by rule 11.
- Batch processing for non-urgent tasks (weekly report, research synthesis) at lower cost: a second adapter method behind the same `run_text` signature with a `deferred=True` flag.
- Another text or image provider: one new file under `providers/` and a registry entry.
- Prompt evaluation sets per task, run when `VERSION` changes.
- Phase 2: an `instagram` block in `GET /system/status/` and an Instagram card on the Status tab (Meta app settings, Graph API version, token refresh, encryption key), and a Publish row under Workers (E00-S04, E08-S03).
