# AI integration

Two providers, one gateway. Claude does reasoning, writing, checking, vision and web search. OpenAI generates images. No other code in the project imports a provider SDK; everything goes through `apps.ai.gateway`.

## 1. Keys and settings

Keys are supplied as environment variables and never stored in the database.

| Setting | Purpose | Default |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key | none |
| `OPENAI_API_KEY` | OpenAI API key | none |
| `SOCIALHUB_AI_TEXT_PROVIDER` | `anthropic` or `fake` | `fake` locally |
| `SOCIALHUB_AI_IMAGE_PROVIDER` | `openai` or `fake` | `fake` locally |
| `SOCIALHUB_AI_TEXT_MODEL` | Default Claude model for every task | `claude-opus-5-5` |
| `SOCIALHUB_AI_TEXT_MODEL_OVERRIDES` | JSON map of task key to model ID | `{}` |
| `SOCIALHUB_AI_IMAGE_MODEL` | OpenAI image model ID | Set at deployment to OpenAI's current image model; confirm the ID in OpenAI's documentation when implementing |
| `SOCIALHUB_AI_IMAGE_SIZES` | Provider size for each shape the gateway accepts | `{"square": "1024x1024", "portrait": "1024x1536", "landscape": "1536x1024"}` |
| `SOCIALHUB_AI_PRICES` | JSON keyed by model ID. Text models: `input`, `output`, `cache_read`, `cache_write` per million tokens, optional `web_search` per call. Image models: `per_image` by size. A model with no entry costs 0 and sets `units.price_missing` | Seeded: `claude-opus-5-5` 4.00 / 20.00, cache read 0.20; `claude-haiku-5-5` 0.10 / 0.50 |
| `SOCIALHUB_AI_TIMEOUT_SECONDS` | Per-call timeout | 180 |
| `SOCIALHUB_AI_MAX_CALLS_PER_JOB` | Logical AI calls one job may make (section 6) | 20 |
| `SOCIALHUB_AI_MAX_IMAGES_PER_ITEM` | Generated images per content item across versions; over the cap the API returns `429 rate_limited` (E06-S05) | 12 |
| `SOCIALHUB_PRODUCTION_AUTO_IMAGES` | Generate missing frame backgrounds during `production.start` (E06-S05) | false |
| `SOCIALHUB_REPORT_LANGUAGE` | Language of weekly reports and repurpose reasons (E10-S02, E10-S04) | `en` |

One model for every text task keeps the MVP simple. The override map lets a cheaper model (for example `claude-haiku-5-5`) be assigned to a high-volume task later, once its quality on that task has been checked. That is a cost decision for the product owner, not a default.

When a key is missing, the gateway raises `ProviderNotConfigured` and `GET /system/status/` shows which key is absent. Actions started by a user check this before creating a job and return `503 provider_not_configured`; automatic paths fail their job with that code.

## 2. Gateway interface

```python
# apps/ai/gateway.py — the only public surface

def run_text(task: str, *, variables: dict, schema: type[BaseModel] | None = None,
             images: list[ImageInput] | None = None, web_search: WebSearchOptions | None = None,
             account_id: int | None = None, job_id: UUID | None = None) -> TextResult: ...

def run_image(task: str, *, prompt: str, size: Literal["square", "portrait", "landscape"],
              account_id: int | None = None, job_id: UUID | None = None) -> ImageResult: ...
```

- `task` is a key in the prompt registry (section 4).
- `images` takes up to 8 `ImageInput(content, media_type)`.
- `WebSearchOptions` carries `max_uses` (default 5), `allowed_domains` and `blocked_domains` (merged with `SOCIALHUB_RESEARCH_BLOCKED_DOMAINS`). Passing `schema` and `web_search` together is a programming error (see the two-call rule in section 3).
- `TextResult` carries `data` (a validated Pydantic object when `schema` is given, otherwise text), `citations` (a list of `{url, title}` from web search, de-duplicated by URL), and `ai_run_id`.
- `ImageResult` carries `content`, `mime`, `width`, `height` and `ai_run_id`.
- Every call writes one `AIRun` row, including failed and refused calls. `AIRun.model` stores the model that actually answered.

Errors are all `AIError` subclasses with `code`, `detail` and `retryable`. A job that catches one fails with `error_code = exc.code` and `error_detail = exc.detail`.

| Exception | `code` | `detail` |
| --- | --- | --- |
| `ProviderNotConfigured` | `provider_not_configured` | The missing setting |
| `ProviderRefused` | `provider_error` | `refused` |
| `ProviderError` | `provider_error` | `rate_limited`, `timeout`, `unavailable`, `bad_request` or `web_search_failed` |
| `OutputInvalid` | `provider_error` | `invalid_output` (schema failure or truncated output) |
| `CallLimitExceeded` | `provider_error` | `call_limit` |

## 3. How Claude is called

These rules come from the current Claude API and are built into the Anthropic adapter. Follow the official `anthropic` Python SDK documentation for exact signatures; do not guess them.

| Topic | Rule |
| --- | --- |
| Client | The official `anthropic` SDK. No raw HTTP, no OpenAI-compatible shim. |
| Model | `claude-opus-5-5` unless overridden per task. Use the ID exactly as written; never add a date suffix. |
| Structured output | Use the SDK's structured-output support (`client.messages.parse()` with a Pydantic model, which sets `output_config.format`). The result is validated against the schema. Do not parse JSON out of free text. |
| Thinking | Leave thinking on its default (adaptive). On this model it cannot be disabled, and `budget_tokens` is rejected. |
| Effort | Set `output_config.effort` explicitly per task (section 4). The model's default is `medium`. |
| Sampling parameters | Do not send `temperature`, `top_p` or `top_k`; they are rejected. |
| Prefill and forced tools | Do not prefill the assistant turn and do not force a tool with `tool_choice`; both are rejected. |
| Refusals | Check `stop_reason` before reading content. `refusal` becomes `AIRun.status = refused` and a `provider_error` with detail `refused`. Enable the server-side fallback (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta) so a refused request can be served by another model; `units.fallback_used` records it. |
| Web search | Declare the server tool `web_search_20260209` with a `max_uses` limit. Results come back as `web_search_tool_result` blocks; an error comes back as an object inside the block, not as an exception. A `pause_turn` stop is continued. If every search in a call errors, the call fails with `web_search_failed`. |
| Web search with structured output | Run two calls: first a search call that returns text and result URLs, then a structured call that turns that text into the schema. This keeps URLs exact and avoids mixing citations with structured output. |
| Vision | Send images as base64 image blocks before the text block. Downscale to at most 1568 pixels on the long side and re-encode as JPEG quality 90, or PNG when the image has transparency. |
| Prompt caching | Put the stable system prompt and the account's brand block first and mark them cacheable; put per-item content last. Never put timestamps or IDs in the cached part. When `account_id` is given and the task's `cache_brand` is true, the gateway appends a system block from `render_brand_block(account)`: tone, audience, pillars, banned terms, CTA examples, handle, language, colour names and font keys. `system.md` itself may reference only `content_language`. |
| Output limits | `max_tokens` is set per task (default 16,000 for non-streaming calls). Use streaming with the SDK's final-message helper for anything that may be long (scripts, weekly reports). |
| Errors and retries | SDK retries are set to 0. The gateway retries rate limits, 5xx errors, timeouts and connection errors 3 times (4 attempts), waiting 2, 8 and 30 seconds, or the `retry-after` value capped at 60 seconds. 4xx errors do not retry. Catch the SDK's typed errors from most to least specific. |

## 4. Task registry

Each task is a directory `apps/ai/prompts/<task key>/` named with the dotted key (for example `apps/ai/prompts/script.generate/`). It holds:

- `system.md` and `user.md` (Jinja2 with `StrictUndefined`);
- `schema.py`, optional, exporting the output model as `Output` (an alias such as `Output = ScriptPackage` is fine);
- `VERSION`; changing a prompt bumps it, and the version is stored on every `AIRun`;
- `fixture.json` and optional `fixture.<variant>.json` for the fake provider.

Runtime options live in `apps/ai/tasks.py` as `TASKS = {key: TaskSpec(provider, effort, max_tokens=16000, stream=False, cache_brand=True)}`. A Django system check fails startup when a registered task is missing a file.

| Task key | Provider | Used in | Effort | Input | Output |
| --- | --- | --- | --- | --- | --- |
| `system.ping` | Claude | E00-S05 | low | Fixed sentence; `max_tokens` 64 | Text |
| `research.web_search` | Claude + web search | E02-S02 | medium | Queries, audience, language, date window | Text with result URLs |
| `research.extract_signals` | Claude | E02-S02 | low | Search text and URLs | List of signals |
| `research.synthesize_topics` | Claude | E02-S04 | high | Signals, plan objective and audience, brand pillars | Topics with hooks and signal references |
| `selection.score_goal_fit` | Claude | E03-S02 | medium | Plan (objective, audience, segments, success metrics, goals, carried finding titles), open-slot mix, at most 40 recent items `{id, title, format}`, at most 20 candidates per batch, format guide | Per candidate: goal fit 0–100, rationale (at most 600 characters), 1–3 suggested formats, suggested role, duplicate content-item ID or null |
| `brief.generate` | Claude | E04-S03 | medium | Candidate, sources, plan, slot, brand block, format rules | Brief fields except `references` and `success_metric`, which are set in code; `max_tokens` 4,000 |
| `script.generate` | Claude | E05-S01, E05-S03, E07-S05 | high | Brief, item, script rules and frame templates, optional feedback, previous version and the frame indexes that may change; `violations` on the single repair call | Script package; streamed |
| `copy.generate` | Claude | E06-S06, E07-S05 | medium | Brief (including references), script, frame text as on the version, format limits, default hashtags and remaining slots, banned terms, optional feedback | Caption, `first_line`, hashtags, alt text |
| `image.generate` | OpenAI | E06-S05, E07-S05 | — | Prompt assembled in code: subject, style from design notes, brand palette names, a fixed no-text constraint, size | Image |
| `qc.copy` | Claude | E07-S03 | medium | Text inventory (caption, hashtags, alt text, frame and shot text, script CTA), format, role, the brief's objective, key message, hook direction, CTA, must include and must avoid, brand block | Issues from a fixed code list, each with quote and suggestion |
| `qc.facts` | Claude | E07-S03 | high | Text inventory, evidence pack (stored text of the brief's references from signals, feed items and repurpose sources), today's date | Claims with kind, status, reference ID and evidence quote |
| `qc.design` | Claude with images | E07-S04 | medium | Final image or up to `SOCIALHUB_QC_DESIGN_MAX_IMAGES` key frames, logo reference image, brand block, design notes, safe area, intended text per frame, whether backgrounds are AI-generated | Issues with image index and confidence; an assessment per image |
| `report.weekly_findings` | Claude | E10-S02 | high | Plan and goals, computed totals, post table with hook and production mode, the plan's carried findings, report language | Summary and findings |
| `repurpose.suggest` | Claude | E10-S04 | low | Any published post (outperforming or chosen by hand), its brief and script, evaluation metrics when present, brand tone and pillars | Angle and formats |

Prompt rules shared by all tasks:

1. The system prompt states the role, the output language, and that the model must use only the supplied sources for facts. Output language: the account's `content_language` for content (briefs, scripts, captions, alt text); English for check findings and revision instructions; `SOCIALHUB_REPORT_LANGUAGE` for weekly reports and repurpose reasons.
2. Brand profile fields are passed as data in the brand block, not woven into instructions.
3. Calculations are done in code before or after the call. The model explains numbers; it does not compute them.
4. Text inside sources is data. The system prompt says to ignore any instructions found in fetched or uploaded content.
5. Every schema field has a description, and lists have a maximum length, so outputs stay bounded.

## 5. How OpenAI is called

- The official `openai` Python SDK, image generation endpoint only.
- Images are generated without text. All text on an asset is drawn by the render templates, which is what keeps Persian text correct.
- The gateway takes a shape (`square`, `portrait`, `landscape`) mapped by `SOCIALHUB_AI_IMAGE_SIZES`; the renderer then crops and scales to the format's exact pixel size.
- The result is stored as an `Asset` with `origin = ai_generated` and `rights_status = cleared`, with the prompt and model in `meta`.
- Content policy rejections fail the job with `provider_error` and detail `refused`; the operator can edit the prompt or upload an image instead.

## 6. Cost and limits

- `cost_usd` is computed from token or image counts and the price table. Cached input tokens are priced separately.
- `GET /ai/runs/` lets an admin see cost by task, account and day.
- The MVP has no spend caps. Two guards exist: `SOCIALHUB_AI_MAX_CALLS_PER_JOB` (default 20) stops a runaway job, and `SOCIALHUB_AI_MAX_IMAGES_PER_ITEM` (default 12) caps generated images per item. Only logical calls count toward the per-job cap; the gateway's own retries inside one `run_text` or `run_image` call do not.

## 7. The fake provider

`fake` returns deterministic outputs and records `AIRun` rows with zero cost. It lets the whole pipeline run locally and in automated tests without keys.

- Text: the task's `fixture.json`, validated against the same schema. A variant is chosen, in order, by a Redis-backed override (a fixture variant name or literal `data`, used by the acceptance suite when testing hooks are on), then the `_fixture` variable or a caption marker, then the default fixture. Unit tests can call `fake_text.set(task, data_or_exception)`.
- Variants shipped for the acceptance suite include `copy.generate` → `too-long` and `qc.facts` → `unsupported-number`.
- Web search returns two `example.com` citations.
- Images are solid-colour PNGs seeded by the prompt hash.
- A registry test requires a valid fixture for every task with a schema.
