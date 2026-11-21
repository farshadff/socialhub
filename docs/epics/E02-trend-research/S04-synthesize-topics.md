# E02-S04 — Synthesize signals into topics and hooks

| | |
| --- | --- |
| Epic | E02 Trend research |
| Priority | Must |
| Estimate | BE 2 d · FE 0 d · QA 0 d |
| Depends on | E02-S02, E00-S05 |
| Needed by | E02-S05, E03-S02, E03-S03 |

## User story

As an operator, I want the collected signals grouped into a short list of topics, each with ready-to-use hook ideas and a score that shows how much evidence stands behind it, so that I can decide what the week should talk about in minutes.

## Context

This is the "find emerging hooks and topics" half of workflow step 02. A run can collect dozens of signals; nobody wants to read them one by one. The last stage of a research run sends the recent signals to Claude, which groups them into topics and writes hooks. Code then checks every signal reference, computes the evidence score and saves the topics. The score is computed in code, not by the model, so it is repeatable and explainable ([AI-INTEGRATION.md](../../AI-INTEGRATION.md), prompt rule 3).

The panel for topics is E02-S05. This story has no frontend work.

## Scope

**In:**

- `TrendTopic` table with its signal links.
- The synthesis stage of the research run, AI task `research.synthesize_topics`.
- Validation of the model's output against real signal IDs.
- The evidence score formula and breakdown.
- What happens to existing topics when research runs again.
- `GET /research/topics/` and `POST /research/topics/` (manual topic).
- Service functions other epics call: `score_topic`, `mark_used`.

**Out (later):**

- Embedding-based clustering or deduplication.
- Tracking a topic across weeks.
- Learning from past performance when scoring (that is goal fit, E03-S02, and feedback, E10).
- Topic detail and edit endpoints (E02-S05).

## Behaviour and rules

### When synthesis runs

1. Synthesis is the last stage of a research run when `params.synthesize` is true (E02-S02 rule 24). It is not a separate job. To regroup without collecting, start a run with `collect = false`.
2. Input signals: the account's signals with `captured_at` on or after `run.started_at` minus `lookback_days`, of any kind and from any run, including manual ones. If there are more than 150, the 150 with the latest `coalesce(published_at, captured_at)` are used.
3. If fewer than 3 input signals exist, synthesis is skipped: no AI call, existing topics untouched, `stats.synthesis = "skipped_too_few_signals"`, `stats.topics = 0`, and the job message is "Not enough signals to form topics yet."

### What the model is asked for

4. One AI call (AI section) returns at most `SOCIALHUB_RESEARCH_MAX_TOPICS` topics (default 8). Each topic has a title, summary, "why now", 2 to 5 hooks, 1 to 3 suggested formats, 3 to 8 keywords and the IDs of the signals that support it.
5. All topic text is written in the account's `content_language`.
6. The model is told which topics already exist and must not be repeated (rule 12), and which were dismissed and must not be proposed again.
7. A signal may support more than one topic. Not every signal has to be used.

### Validation in code

8. After the call, each topic is checked in this order; a topic that fails is dropped and counted in `stats.dropped_topics`:
   1. `signal_ids` is reduced to IDs that were in the input. If none remain, drop the topic. A topic without evidence is never saved.
   2. If the title, compared case-insensitively after whitespace collapse, equals the title of a kept or dismissed topic (rule 12), drop it.
   3. If the title contains one of the brand profile's `banned_terms` (case-insensitive substring), drop it.
9. Within a kept topic: hooks containing a banned term are removed; if fewer than one hook remains, drop the topic. `suggested_formats` values outside the `Format` enum are removed; if none remain, set all three formats. Text is trimmed to the limits (title 120, summary 600, why now 300, each hook 160, each keyword 40), lists are cut to their maximums, duplicates in lists are removed.
10. If no topic survives validation, nothing is replaced (rule 12 is not applied), `stats.topics = 0` and `stats.synthesis = "done"`.

### Saving

11. Each surviving topic is saved with `origin = ai`, `status = new`, `run` = this run, `plan` = the run's plan (may be null), its signals linked, and its evidence score computed (rules 14–19).
12. Replacement rule. In the same transaction, before the new topics are inserted, the run deletes the account's topics that match all of: same `plan` as the run (or both null), `origin = ai`, `status = new`, and not referenced by any candidate. Everything else is kept: `shortlisted`, `dismissed` and `used` topics, manual topics, and `new` topics already referenced by a candidate. The kept non-dismissed topics are the "already exist" list of rule 6; the dismissed ones are the "do not propose" list.
13. Because saving and deleting share one transaction, a failed synthesis leaves the previous topics exactly as they were.

### Evidence score

`evidence_score` is an integer from 0 to 100, computed by `research.services.evidence.score_topic(topic, now)` from the topic's linked signals. It has four components, each an integer 0–100 stored in `evidence_breakdown`. Rounding is half-up everywhere.

14. **`signal_count`** — how many signals support the topic. With `n` signals:

    `signal_count = min(100, round(100 × ln(1 + n) / ln(9)))`

    | n | 1 | 2 | 3 | 4 | 5 | 6 | 8 or more |
    | --- | --- | --- | --- | --- | --- | --- | --- |
    | value | 32 | 50 | 63 | 73 | 82 | 89 | 100 |

15. **`source_diversity`** — whether the evidence comes from independent places. An origin is the URL host without `www.` for `web_search`, `rss` and manual signals with a URL, and the `author` for Instagram signals and manual signals without a URL. With `d` distinct origins and `k` distinct signal kinds:

    `source_diversity = min(100, 25 × min(d, 3) + (25 if k ≥ 2 else 0))`

    One origin scores 25, two score 50, three or more score 75, and evidence from two or more kinds of source adds 25.

16. **`recency`** — how fresh the evidence is. For each signal, age `a` is the number of days (with fractions) from `coalesce(published_at, captured_at)` to now.

    `r = 100` when `a ≤ 2`; `r = max(0, 100 × (14 − a) / 12)` when `a > 2`

    `recency` is the rounded mean of the three highest `r` values (or of all of them when there are fewer than three). A few fresh signals are enough; old supporting material does not pull a topic down.

17. **`engagement`** — how strongly people reacted, where numbers exist. For a signal with at least one of `likes`, `comments`, `views` in `metrics`:

    `e = likes + 2 × comments + 0.1 × views` (missing values count as 0)

    Its percentile is the share of the reference set whose `e` is less than or equal to its own. The reference set is the account's signals of the same `kind` that have metrics and were captured in the last 30 days, including the signal itself. If the reference set has fewer than 5 signals, the percentile is 0.5.

    `engagement = round(100 × highest percentile among the topic's signals)`. If none of the topic's signals has metrics, `engagement = 50`, so topics built only from articles are neither rewarded nor punished.

18. **Total.**

    `evidence_score = round(0.35 × signal_count + 0.25 × source_diversity + 0.25 × recency + 0.15 × engagement)`

    The weights come from `SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS` (default `{"signal_count": 0.35, "source_diversity": 0.25, "recency": 0.25, "engagement": 0.15}`) and must sum to 1.

19. A topic with no signals has all components and the score at 0.

    Worked example: four signals — an article on perfectdailygrind.com 3 days old, a feed item on sprudge.com 1 day old, a hashtag post by `@brewlab` 5 days old at the 92nd percentile, a hashtag post by `@homebarista` 9 days old at the 40th percentile.

    | Component | Calculation | Value |
    | --- | --- | --- |
    | `signal_count` | 100 × ln 5 / ln 9 = 73.2 | 73 |
    | `source_diversity` | 4 origins → 75; 3 kinds → +25 | 100 |
    | `recency` | r = 91.7, 100, 75, 41.7; mean of top three = 88.9 | 89 |
    | `engagement` | highest percentile 0.92 | 92 |
    | `evidence_score` | 0.35×73 + 0.25×100 + 0.25×89 + 0.15×92 = 86.6 | 87 |

20. The score is recomputed whenever a topic's signals change (manual attach in E02-S02, edits in E02-S05). It is not recomputed just because time passes; the stored value reflects the evidence when the topic was last touched.

### Status

21. Statuses and who may set them:

    | From | To | By |
    | --- | --- | --- |
    | — | `new` | Synthesis |
    | — | `shortlisted` | Manual creation |
    | `new` | `shortlisted`, `dismissed` | Operator (E02-S05) |
    | `shortlisted` | `new`, `dismissed` | Operator |
    | `dismissed` | `new` | Operator (restore) |
    | `new`, `shortlisted` | `used` | System: `research.services.topics.mark_used(topic_id)`, called by E03-S03 when a candidate built from the topic is selected |
    | `used` | — | Final |

22. E03-S02 builds candidates from topics with status `new` or `shortlisted` for the plan. Dismissed topics are never ranked.

### Manual topics

23. `POST /research/topics/` creates a topic with `origin = manual`, `status = shortlisted`, `run = null`.
24. Validation: `title` 3–120 characters, required; `summary` up to 600; `why_now` up to 300; `hooks` up to 5 items of up to 160 characters; `suggested_formats` up to 3 `Format` values (empty means any format); `keywords` up to 8 items of up to 40 characters; `signal_ids` up to 20 signals of the same account.
25. `plan` is optional. When omitted, the server picks the plan by the same rule as a run (E02-S02 rule 5). A given plan must belong to the account and not be `closed`.
26. A title equal (case-insensitive) to another non-dismissed topic of the same account and plan returns `400 validation_error` on `title` with code `unique`.
27. A manual topic may have no signals. Its evidence score is then 0, which the panel shows with a prompt to attach evidence.

## Data

Uses `TrendTopic` and its `signals` many-to-many from [DATA-MODEL.md](../../DATA-MODEL.md). No new stored fields.

`ResearchRun.stats` gains `dropped_topics` (int).

Indexes: `TrendTopic(account, plan, status)`, `TrendTopic(account, evidence_score desc)`.

Settings added: `SOCIALHUB_RESEARCH_MAX_TOPICS` (default 8), `SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS`.

Dependency on E03-S02: `Candidate.topic` should use `on_delete=PROTECT` so a topic in use cannot be deleted by mistake; rule 12 excludes such topics before deleting.

## API

All paths are under `/api/v1/`. Signed-in users of either role.

### `GET /research/topics/`

Query: `account` (required), `plan` (ID, or `none` for topics without a plan), `run`, `status` (comma-separated), `origin`, `min_evidence` (0–100), `q` (case-insensitive match in `title`, `summary`, `keywords`), `ordering` (`-evidence_score` default, `evidence_score`, `-created_at`, `title`), `page`, `page_size`.

```json
{
  "count": 6,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 58,
      "account": 3,
      "plan": 12,
      "run": 31,
      "title": "بازگشت قهوه دمی به منوی کافه‌ها",
      "summary": "کافه‌ها از افزایش سفارش قهوه دمی و بچ‌برو خبر می‌دهند؛ مشتری‌ها دنبال فنجان سبک‌تر و ارزان‌تر هستند.",
      "why_now": "در یک هفته گذشته چند رسانه تخصصی و پست پربازدید اینستاگرامی به این تغییر پرداخته‌اند.",
      "hooks": [
        "چرا همه دوباره سراغ قهوه دمی رفته‌اند؟",
        "سه دلیل که فنجان بعدی‌ات باید دمی باشد",
        "اسپرسو یا دمی؟ جواب کافه‌دارها عوض شده"
      ],
      "suggested_formats": ["reel", "feed_post"],
      "keywords": ["قهوه دمی", "بچ برو", "پور اور", "ترند کافه"],
      "evidence_score": 87,
      "evidence_breakdown": {"signal_count": 73, "source_diversity": 100, "recency": 89, "engagement": 92},
      "signal_count": 4,
      "status": "new",
      "origin": "ai",
      "created_at": "2026-11-22T09:24:30Z",
      "updated_at": "2026-11-22T09:24:30Z"
    }
  ]
}
```

`signal_count` here is the number of linked signals (a serializer field), not the breakdown component.

Errors: `400 validation_error` on `account` when missing, on `min_evidence` when out of range.

### `POST /research/topics/`

Request:

```json
{
  "account": 3,
  "plan": 12,
  "title": "راهنمای خرید آسیاب دستی",
  "summary": "سؤال پرتکرار مخاطبان در دایرکت: با بودجه محدود کدام آسیاب دستی را بخرند.",
  "why_now": "فصل هدیه نزدیک است و جست‌وجوی آسیاب قهوه بالا رفته.",
  "hooks": ["قبل از خرید آسیاب، این سه چیز را بدان"],
  "suggested_formats": ["reel"],
  "keywords": ["آسیاب دستی", "راهنمای خرید"],
  "signal_ids": [412, 419]
}
```

Response `201`: the topic object as in the list, with `origin = "manual"`, `status = "shortlisted"`, `run = null`, and the computed `evidence_score` and `evidence_breakdown`.

| Case | Status and code | Field |
| --- | --- | --- |
| Missing `account` or `title` | `400 validation_error` | `required` |
| Text or list over its limit | `400 validation_error` | `max_length` on the field, for example `hooks.2` |
| Unknown format | `400 validation_error` | `suggested_formats.<index>`: `invalid_choice` |
| A signal of another account, or unknown | `400 validation_error` | `signal_ids.<index>`: `does_not_exist` |
| `plan` of another account or `closed` | `400 validation_error` | `plan`: `invalid` |
| Duplicate title in the plan | `400 validation_error` | `title`: `unique` |
| Account archived | `409 invalid_transition` | |

## Background work

| Item | Value |
| --- | --- |
| Task | Runs inside `research.tasks.run_research` (E02-S02) as `services.synthesis.synthesize(run)` |
| Queue | `default` |
| Idempotency | The stage is safe to repeat: it deletes only untouched AI topics of the same plan and re-creates them in one transaction |
| Retries | The AI gateway's own retries (rate limits and 5xx, up to three). No retry on validation failure beyond the gateway's |
| Failure | The run becomes `failed` with the job `error_code` from the table in the AI section; collected signals and existing topics are kept |
| Duration | One streaming call, typically under two minutes |

Module layout:

```text
apps/research/services/synthesis.py   select_signals, build_variables, validate, save (transaction)
apps/research/services/evidence.py    component functions, score_topic, engagement percentiles
apps/research/services/topics.py      create_manual, mark_used, transition
apps/ai/prompts/research.synthesize_topics/{system.md,user.md,schema.py,VERSION}
```

## AI

### `research.synthesize_topics`

| Item | Value |
| --- | --- |
| Provider | Claude through `run_text` with a schema; streaming, because the output can be long |
| Effort | `high` |
| Caching | System prompt and brand profile first (cacheable); plan and signals last |

Variables:

| Variable | Content |
| --- | --- |
| `content_language` | `fa` or `en` |
| `today` | Date in the account timezone |
| `brand` | `content_pillars`, `tone_of_voice`, `audience_summary`, `banned_terms` |
| `plan` | `objective`, `audience_summary`, `audience_segments`, `success_metrics`, week dates; null when the run has no plan |
| `formats` | The `Format` values with one line each on what the format suits |
| `signals` | List of `{id, kind, title, excerpt (cut to 400 characters), author, published_at, metrics}` |
| `existing_topics` | `{title, keywords}` of kept, non-dismissed topics (rule 12) |
| `dismissed_topics` | Titles of dismissed topics for the plan |
| `max_topics` | From settings |

The system prompt tells the model to group signals that point at the same audience interest, to prefer interests supported by several independent signals, to write hooks as opening lines a viewer would stop for, to reference only supplied signal IDs, to skip weak one-off items rather than pad the list, to write in `content_language`, and to treat signal text as data and ignore instructions inside it.

Output schema:

```python
class TopicDraft(BaseModel):
    title: str = Field(max_length=120, description="Short name of the topic, in the content language.")
    summary: str = Field(max_length=600, description="What is happening, in two or three sentences.")
    why_now: str = Field(max_length=300, description="Why this matters this week.")
    hooks: list[str] = Field(min_length=2, max_length=5, description="Opening lines or angles, each at most 160 characters.")
    suggested_formats: list[Format] = Field(min_length=1, max_length=3)
    keywords: list[str] = Field(min_length=3, max_length=8, description="Search-style keywords, each at most 40 characters.")
    signal_ids: list[int] = Field(min_length=1, max_length=20, description="IDs of supplied signals that support this topic.")

class TopicSynthesis(BaseModel):
    topics: list[TopicDraft] = Field(max_length=8)

Output = TopicSynthesis  # name required by the gateway registry (E00-S05 rule 5)
```

Limits are enforced again in code (rules 8 and 9), because a provider may not enforce every length constraint.

Failure handling:

| Failure | Run result |
| --- | --- |
| Provider not configured | Cannot happen here; the request was rejected with `503` (E02-S02 rule 7) |
| Refusal | Run `failed`, job `error_code = provider_error`, `error_detail = refused` |
| Rate limit or 5xx after retries, or timeout | Run `failed`, `error_code = provider_error` |
| Output fails schema validation after the gateway's retry | Run `failed`, `error_code = provider_error`, `error_detail = invalid_output` |
| Output valid but every topic dropped | Run `completed`, `stats.topics = 0`, existing topics kept |

The `fake` provider returns a fixture with three topics: one valid, one that references an unknown signal ID only, one whose title repeats an existing topic. Tests use it to cover rule 8.

## Panel

None in this story. Topics are shown and managed in E02-S05.

## Acceptance criteria

1. Given a run that collected 12 signals, when synthesis finishes, then topics exist with `origin = ai`, `status = new`, the run's plan, 2 to 5 hooks each, and at least one linked signal each.
2. Given the model returns a topic whose `signal_ids` are all unknown, when the output is validated, then that topic is not saved and `stats.dropped_topics` is 1.
3. Given the brand profile bans a term, when a returned hook contains it, then the hook is removed; when a returned title contains it, then the topic is dropped.
4. Given a topic with the four signals of the worked example, when it is scored, then the breakdown is 73, 100, 89, 92 and the score is 87.
5. Given a topic whose signals all lack metrics, when it is scored, then `engagement` is 50.
6. Given fewer than five reference signals of a kind, when a signal of that kind is scored, then its percentile is 0.5.
7. Given two signals in the account, when a run reaches synthesis, then no AI call is made and `stats.synthesis` is `skipped_too_few_signals`.
8. Given a plan with one shortlisted, one dismissed and two untouched AI topics, when research runs again for that plan, then the shortlisted and dismissed topics are unchanged, the two untouched ones are gone, and the new topics do not repeat the shortlisted or dismissed titles.
9. Given synthesis fails with a provider error, when the run ends, then it is `failed`, the signals it collected exist, and the topics from before the run are unchanged.
10. Given `POST /research/topics/` with a title and two signal IDs, when it succeeds, then the topic is `manual`, `shortlisted`, and has a computed score.
11. Given a manual topic with no signals, when it is created, then its score and all components are 0.
12. Given `GET /research/topics/?account=3&status=new,shortlisted`, when called, then dismissed and used topics are not returned and results are ordered by score, highest first.
13. Given a topic with status `new`, when `mark_used` is called, then its status is `used`; calling it on a dismissed topic raises an invalid transition.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E02-S04-BE1 | Model | `TrendTopic` with the `signals` many-to-many, indexes, migration, admin registration. | 0.25 d |
| E02-S04-BE2 | Prompt and schema | `apps/ai/prompts/research.synthesize_topics/`: `system.md`, `user.md` (Jinja2 with the variables above), `schema.py`, `VERSION`; fake fixtures including the invalid cases. | 0.5 d |
| E02-S04-BE3 | Synthesis service | `services/synthesis.py`: signal selection and cap, variable building, validation rules 8–10, replacement and save in one transaction, stats (`topics`, `dropped_topics`, `synthesis`), wiring into `execute_run`, failure mapping. | 0.5 d |
| E02-S04-BE4 | Evidence scoring | `services/evidence.py`: the four components, percentile reference sets with one query per kind, half-up rounding, weights from settings with a sum check at startup; call from manual signal attach (E02-S02-BE7 hook). | 0.25 d |
| E02-S04-BE5 | Topic endpoints | `GET /research/topics/` with filters and ordering; `POST /research/topics/` with manual rules; `services/topics.py` with `create_manual`, `mark_used`, `transition`; `docs/openapi.yaml` schemas. | 0.25 d |
| E02-S04-BE6 | Tests | Table-driven scoring tests (every row of rule 14, diversity cases, recency boundaries at 2 and 14 days, engagement with small and large reference sets, the worked example); synthesis tests for validation, replacement and failure rollback; API tests for every error row. | 0.25 d |

### Frontend

None.

### Test

None. Tests are part of each subtask.

## Test notes

- Scoring is pure and takes `now` as an argument; tests never depend on the clock.
- Recency boundaries: exactly 2 days gives 100; exactly 14 days gives 0; undated signals use `captured_at`.
- Diversity: `www.example.com` and `example.com` are one origin; two Instagram authors are two origins; one origin with two kinds scores 50.
- Replacement: a `new` AI topic referenced by a candidate is kept (use a stub candidate relation until E03-S02 exists).
- Transaction: force an exception after delete and before insert; assert the old topics are still there.
- Language: the fake fixture is in Persian; assert text is stored and returned unchanged, including zero-width non-joiners.

## Later

- Replace the grouping call with embeddings plus clustering when signal volume grows; `synthesize` keeps its inputs and outputs.
- Add a fifth component, such as "seen in previous weeks", by extending `evidence_breakdown` and the weights setting.
- Let operators re-score all open topics on demand, or re-score nightly, if stale recency becomes confusing.
- Merge two topics in the panel (union of signals, one title).
