# E10-S01 — Evaluate posts against goal and same-age baseline

| | |
| --- | --- |
| Epic | E10 Evaluate and feed back |
| Priority | Must |
| Estimate | BE 3 d · FE 1.5 d · QA 0 d |
| Depends on | E09-S03, E09-S04, E08-S05, E04-S03, E01-S01, E01-S02, E00-S06 |
| Needed by | E10-S02, E10-S04, E11-S01 |

## User story

As an operator, I want every published post to be compared with its goal and with similar posts at the same age, so that I can see which posts worked without reading raw numbers.

## Context

Step 10 of the workflow. E09-S03 stores a `MetricSnapshot` when the operator enters a publication's numbers at a checkpoint, and E09-S04 asks for them at the evaluation checkpoints. A raw number such as "84 saves" says little on its own. This story turns each snapshot at an evaluation checkpoint into a `PerformanceEvaluation`: the value of the post's primary metric, whether the goal was met, how it compares with the median of similar posts at the same age, and a verdict. The weekly report (E10-S02) and repurpose tasks (E10-S04) are built from these records.

## Scope

**In:**

- Automatic evaluation every 15 minutes and on demand.
- Primary metric resolution, goal lookup, baseline, ratio, verdict.
- A per-metric comparison table for all post metrics.
- Evaluation list, detail and run endpoints.
- `EvaluationCard` in the panel and verdict columns on the posts table.

**Out (later):**

- Baselines by role, media kind, posting time or topic.
- Week-level goals such as `follower_growth` (evaluated in E10-S02).
- Re-evaluating old posts automatically when later posts change the baseline.
- Confidence intervals and significance.

## Behaviour and rules

### Which checkpoints are evaluated

1. Evaluation checkpoints by format: `reel` and `feed_post` → `24h` and `7d`; `story` → `23h`. The last one for a format is its **final checkpoint** (`7d`, `7d`, `23h`). Constants live in `analytics/services/evaluation.py` as `EVALUATION_CHECKPOINTS` and `FINAL_CHECKPOINT`.
2. An evaluation is created for a publication and checkpoint when a `MetricSnapshot` with `status = captured` exists for that publication and that checkpoint. Rows with `status = skipped` (E09-S04) never produce an evaluation; the panel shows them as "not entered" (see Panel). Snapshots with checkpoint `adhoc`, `1h`, `6h` or `72h` are never evaluated. Every Phase 1 snapshot has `source = manual`; Phase 2 adds `source = provider` rows, which count the same. When manual entry (E09-S03 rule 13) replaces the numbers of a captured snapshot, E09-S03 deletes the evaluation for that publication and checkpoint in the same transaction. The next `analytics.evaluate_due` run finds the pair without an evaluation and recomputes it; no separate trigger exists.
3. Only publications with status `published` are evaluated.
4. There is at most one `PerformanceEvaluation` per (`publication`, `checkpoint`). Evaluating again recomputes and overwrites that row (`update_or_create`); it never creates a second one.

### Primary metric

5. The primary metric is the `success_metric` of the brief the published version was written from: `publication.content_version.script.brief`, falling back to `content_item.current_brief`.
6. If there is no brief, or its `success_metric` is `follower_growth`, use the role default from DATA-MODEL.md section 1 (`attract` → `reach`, `educate` → `saves`, `build_trust` → `shares`, `convert` → `shares`, `engage` → `comments`, or `replies` for a story). If the item has no role, use `reach`.
7. `value` is the primary metric's value in the snapshot. It is `null` when the snapshot's value is null or the metric is listed in the snapshot's `unavailable`.

### Goal

8. The plan is `content_item.plan`. The goal for a metric and a post is the first match in this order:

   | Order | `PlanGoal` matched | `goal_source` | `goal_target` |
   | --- | --- | --- | --- |
   | 1 | `scope = per_post`, `format` = the post's format | `per_post_format` | `target_value` |
   | 2 | `scope = per_post`, `format` null | `per_post_all` | `target_value` |
   | 3 | `scope = week_total`, `format` = the post's format | `week_total_share` | `ceil(target_value / N)` where N = the plan's slots with that format and status other than `skipped` |
   | 4 | `scope = week_total`, `format` null | `week_total_share` | `ceil(target_value / N)` where N = all the plan's slots with status other than `skipped` |
   | 5 | none | `none` | null |

   If N is 0 in rows 3 or 4, that row does not match and the lookup continues.
9. `goal_result`: `met` when `value >= goal_target`; `missed` when `value < goal_target`; `no_goal` when `goal_source` is `none`; `not_measured` when a goal exists and `value` is null.
10. The same target is used at every checkpoint. A `24h` evaluation with `missed` means "not met yet"; the final checkpoint's result is the one that counts in the weekly report.
11. `PlanGoal` rows with metric `follower_growth` are ignored here.

### Baseline

12. Baseline samples are the account's other publications that meet all of these: status `published`; same `format`; `published_at` in the 60 days before the evaluated post's `published_at` (`SOCIALHUB_EVAL_BASELINE_DAYS`); a `MetricSnapshot` at the same checkpoint with `status = captured` and a non-null value for the metric. The evaluated post is excluded. Posts published after it are excluded, so the result does not depend on when the evaluation runs.
13. `baseline_value` is the median of the sample values, stored with two decimals. For an even count it is the mean of the two middle values.
14. `baseline_sample_size` is the number of samples. Fewer than 5 samples (`SOCIALHUB_EVAL_BASELINE_MIN_SAMPLES`) means no baseline: `baseline_value` and `baseline_ratio` are null.
15. `baseline_ratio = value / baseline_value`, rounded half up to two decimals. It is null when `value` is null, there is no baseline, or `baseline_value` is 0.
16. `baseline_samples` stores the primary metric's samples as `[{"publication": id, "value": n}]`, newest first, at most 50, so the panel can show what the post was compared with.

### Verdict

17. The verdict uses the stored (rounded) `baseline_ratio` of the primary metric:

    | Condition | Verdict |
    | --- | --- |
    | `baseline_ratio` is null | `insufficient_data` |
    | `baseline_ratio >= 1.5` (`SOCIALHUB_EVAL_OUTPERFORM_RATIO`) | `outperforming` |
    | `baseline_ratio <= 0.6` (`SOCIALHUB_EVAL_UNDERPERFORM_RATIO`) | `underperforming` |
    | otherwise | `on_par` |

18. `goal_result` is computed even when the verdict is `insufficient_data`.
19. Settings are validated at start-up: underperform ratio must be greater than 0 and less than 1; outperform ratio must be greater than 1.

### All-metrics table

20. `metrics` holds one entry for each of `reach`, `views`, `likes`, `comments`, `saves`, `shares`, `replies`, computed with rules 8 and 12–15 for that metric: `{"value", "baseline", "ratio", "goal", "sample_size"}`. Any part that cannot be computed is null. The primary metric's entry equals the top-level fields.

### Side effects

21. After saving, write a `ContentEvent` of type `note` on the content item: "Evaluated at 7 d: outperforming (saves 84, 1.62× baseline)".
22. After saving a final-checkpoint evaluation with verdict `outperforming`, call `selection.services.repurpose.create_for_evaluation(evaluation)` (E10-S04). A failure there is logged and does not fail the evaluation.

### Worked examples

**Example A — outperforming, goal met.** Reel, primary metric `saves`, `7d` snapshot has saves = 84. The plan has `PlanGoal(metric=saves, scope=per_post, format=reel, target_value=60)`. Seven earlier reels in the last 60 days have `7d` saves of 31, 40, 44, 52, 58, 61, 75.

- Goal: row 1 matches → `goal_target = 60`, `goal_source = per_post_format`, 84 ≥ 60 → `met`.
- Baseline: median of 7 values = 52.00, sample size 7.
- Ratio: 84 / 52 = 1.615… → `1.62` ≥ 1.5 → `outperforming`.

**Example B — too few samples, share of a weekly goal.** Feed post, primary metric `reach`, `7d` reach = 2,100. The only reach goal is `PlanGoal(metric=reach, scope=week_total, format=null, target_value=50000)`; the plan has 10 slots that are not skipped. Four earlier feed posts qualify as samples.

- Goal: row 4 matches → `ceil(50000 / 10) = 5000`, `goal_source = week_total_share`, 2,100 < 5,000 → `missed`.
- Baseline: 4 samples < 5 → `baseline_value` null, ratio null → `insufficient_data`.

**Example C — underperforming, even sample count.** Story, primary metric `replies`, `23h` replies = 3. Six earlier stories have 4, 6, 6, 8, 9, 12. No goal for `replies`.

- Goal: `no_goal`.
- Baseline: median = (6 + 8) / 2 = 7.00. Ratio 3 / 7 = 0.428… → `0.43` ≤ 0.6 → `underperforming`.

**Example D — metric unavailable.** Reel, primary metric `shares`, the `24h` snapshot lists `shares` in `unavailable`. A per-post goal of 20 exists.

- `value` null → `goal_result = not_measured`, ratio null → `insufficient_data`.

## Data

Uses `PerformanceEvaluation`, `MetricSnapshot`, `Publication`, `ContentItem`, `Brief`, `PlanGoal`, `PlanSlot`, `ContentEvent` as defined in [DATA-MODEL.md](../../DATA-MODEL.md).

Additions this story needs on `PerformanceEvaluation` (to be added to DATA-MODEL.md):

| Field | Type | Notes |
| --- | --- | --- |
| `goal_source` | enum | `per_post_format`, `per_post_all`, `week_total_share`, `none` |
| `baseline_samples` | JSON list | `[{"publication", "value"}]`, primary metric only, at most 50 |
| `goal_result` | enum | Adds the value `not_measured` to `met`, `missed`, `no_goal` |
| `metrics` | JSON | Each entry adds `sample_size` |

Indexes: unique (`publication`, `checkpoint`); index on (`verdict`, `evaluated_at`).

## API

All endpoints need a signed-in user; operators and admins have the same rights.

### GET /api/v1/evaluations/

Query parameters: `account` (required), `plan`, `publication`, `checkpoint`, `verdict`, `goal_result`, `format` (comma-separated values allowed), `final` (`true` returns only final-checkpoint evaluations), `ordering` (`evaluated_at`, `-evaluated_at` default, `baseline_ratio`, `-baseline_ratio`, `published_at`, `-published_at`).

Response `200`:

```json
{
  "count": 2,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 91,
      "publication": 57,
      "content_item": 42,
      "plan": 12,
      "title": "Three mistakes first-time renters make",
      "format": "reel",
      "permalink": "https://www.instagram.com/reel/DCxQ1aBcDeF/",
      "published_at": "2026-12-01T15:30:00Z",
      "checkpoint": "7d",
      "is_final": true,
      "primary_metric": "saves",
      "value": 84,
      "goal_target": 60,
      "goal_source": "per_post_format",
      "goal_result": "met",
      "baseline_value": "52.00",
      "baseline_sample_size": 7,
      "baseline_ratio": "1.62",
      "verdict": "outperforming",
      "repurpose_task": 5,
      "evaluated_at": "2026-12-08T15:44:10Z"
    },
    {
      "id": 88,
      "publication": 57,
      "content_item": 42,
      "plan": 12,
      "title": "Three mistakes first-time renters make",
      "format": "reel",
      "permalink": "https://www.instagram.com/reel/DCxQ1aBcDeF/",
      "published_at": "2026-12-01T15:30:00Z",
      "checkpoint": "24h",
      "is_final": false,
      "primary_metric": "saves",
      "value": 41,
      "goal_target": 60,
      "goal_source": "per_post_format",
      "goal_result": "missed",
      "baseline_value": "29.00",
      "baseline_sample_size": 7,
      "baseline_ratio": "1.41",
      "verdict": "on_par",
      "repurpose_task": null,
      "evaluated_at": "2026-12-02T15:44:02Z"
    }
  ]
}
```

Errors: `400 validation_error` on `account` when missing or on an unknown enum value in a filter.

### GET /api/v1/evaluations/{id}/

Response `200`: the list item plus:

```json
{
  "metrics": {
    "reach":    {"value": 9800, "baseline": 6100.0, "ratio": 1.61, "goal": 5000, "sample_size": 7},
    "views":    {"value": 14250, "baseline": 9050.0, "ratio": 1.57, "goal": null, "sample_size": 7},
    "likes":    {"value": 512, "baseline": 398.0, "ratio": 1.29, "goal": null, "sample_size": 7},
    "comments": {"value": 23, "baseline": 19.0, "ratio": 1.21, "goal": null, "sample_size": 7},
    "saves":    {"value": 84, "baseline": 52.0, "ratio": 1.62, "goal": 60, "sample_size": 7},
    "shares":   {"value": 37, "baseline": 21.0, "ratio": 1.76, "goal": null, "sample_size": 7},
    "replies":  {"value": null, "baseline": null, "ratio": null, "goal": null, "sample_size": 0}
  },
  "baseline_samples": [
    {"publication": 51, "value": 61},
    {"publication": 48, "value": 44},
    {"publication": 44, "value": 75},
    {"publication": 39, "value": 31},
    {"publication": 36, "value": 52},
    {"publication": 33, "value": 58},
    {"publication": 30, "value": 40}
  ],
  "baseline_window_days": 60,
  "thresholds": {"outperforming": 1.5, "underperforming": 0.6, "min_samples": 5},
  "snapshot": {"id": 733, "checkpoint": "7d", "captured_at": "2026-12-08T15:32:41Z", "age_minutes": 10082, "source": "manual"}
}
```

Errors: `404 not_found`.

### POST /api/v1/evaluations/run/

Evaluates now, without waiting for the 15-minute task. Body, exactly one of `plan` and `publication`:

```json
{"account": 1, "plan": 12, "force": true}
```

```json
{"account": 1, "publication": 57, "checkpoint": "7d", "force": true}
```

| Field | Rule |
| --- | --- |
| `account` | Required |
| `plan` | Evaluates every published publication of the plan at every evaluation checkpoint that has a snapshot |
| `publication` | Evaluates one publication; must have status `published` |
| `checkpoint` | Optional, only with `publication`; must be an evaluation checkpoint for the publication's format |
| `force` | Default false: existing evaluations are skipped. True: they are recomputed |

Response `202` with a job of kind `evaluation.run` (shape in [API.md](../../API.md)); `target_type` is `plan` or `publication`. The job's `result` on success:

```json
{"evaluated": 9, "skipped": 4, "missing_snapshot": 2, "repurpose_tasks_created": 1}
```

Errors:

| Case | Response |
| --- | --- |
| Both or neither of `plan` and `publication`; `checkpoint` not valid for the format | `400 validation_error` with the field path |
| Plan or publication not found or not in `account` | `404 not_found` |
| Publication is not `published` | `409 invalid_transition` |
| An `evaluation.run` job is already active for the same target | `409 job_in_progress` with the job in `error.details.job` |

### Change to an existing endpoint

`GET /analytics/posts/` (E09-S03) adds to each row a `latest_evaluation` object, or null, taken from the publication's evaluation with the highest checkpoint, and accepts the filter `verdict`:

```json
"latest_evaluation": {"id": 91, "checkpoint": "7d", "is_final": true, "primary_metric": "saves", "value": 84, "goal_result": "met", "baseline_ratio": "1.62", "verdict": "outperforming"}
```

## Background work

| Task | Queue | Schedule | Behaviour |
| --- | --- | --- | --- |
| `analytics.evaluate_due` | `default` | Every 15 minutes (Celery Beat) | Selects up to 200 (publication, checkpoint) pairs that have a `captured` snapshot at an evaluation checkpoint and no evaluation (including pairs whose evaluation E09-S03 deleted after a manual correction), oldest snapshot first, and calls `evaluate_publication` for each. A Redis lock `lock:evaluate_due` (TTL 10 minutes) stops overlapping runs. One failing pair is logged and skipped; the rest continue. No `JobRun` is created for scheduled runs. |
| `analytics.run_evaluations` | `default` | On `POST /evaluations/run/` | Wraps the same service in a `JobRun` of kind `evaluation.run`, updating `progress` per publication. |

Idempotency: `evaluate_publication(publication_id, checkpoint)` is a pure recomputation written with `update_or_create`; running it twice gives the same row. No external calls, so no retries are needed beyond the task's default single retry on database errors.

## AI

None. Everything in this story is computed in code.

## Panel

### EvaluationCard

`src/components/EvaluationCard`. Shown on the Performance tab of `/content/:id` and on `/analytics/posts/:publicationId`, below the metric chart from E09-S03. Data: `GET /evaluations/?account=&publication=` then `GET /evaluations/{id}/` for the selected checkpoint.

Layout, top to bottom:

1. **Header:** "Evaluation", a segmented control with the available checkpoints ("24 h", "7 d" or "23 h"; the final one selected by default), and a `JobButton` "Evaluate now" (calls `POST /evaluations/run/` with the publication and `force: true`).
2. **Verdict row:** `StatusTag` for the verdict ("Outperforming" green, "On par" default, "Underperforming" red, "Not enough data" default) and one sentence:
   - With baseline: "Saves 84 at 7 d — 1.62× the median of 7 similar reels (52)."
   - Without: "Saves 84 at 7 d — only 4 similar reels in the last 60 days; 5 are needed for a comparison."
   - Value missing: "Shares were not available at 24 h."
3. **Goal row:** `StatusTag` "Goal met" (green), "Goal missed" (red; on a non-final checkpoint the label is "Goal not met yet", warning colour), "No goal" (default) or "Not measured" (default), followed by "84 of 60". When `goal_source` is `week_total_share`, a tooltip says "Share of the weekly goal: 50,000 ÷ 10 slots".
4. **All metrics table** (`Table` (`useTable`), no paging): columns Metric, Value, Baseline (median), Ratio, Goal, Samples. Null cells show "—"; a metric listed as unavailable shows "Not available". The primary metric's row is marked with a "Primary" tag.
5. **Compared with** (collapsed by default): the `baseline_samples` list as links to `/analytics/posts/:publicationId` with each value.

States:

| State | Display |
| --- | --- |
| Loading | Skeleton card |
| No evaluation yet, post younger than the first checkpoint | `Empty`: "This post will be evaluated when its 24 h metrics are entered." with the expected time through `DateTime` |
| No evaluation, snapshot missing or recorded as skipped after the checkpoint age | `Empty`: "No 24 h metrics were entered for this post." with a link to manual entry (E09-S03) |
| Not published | Card is not rendered |
| Job running | "Evaluate now" shows progress; the rest stays readable |
| Error | Inline `Result` with Retry and the `request_id` |

### Posts table

On `/analytics/posts` (E09-S03) add:

- Column "Verdict": `StatusTag` from `latest_evaluation.verdict` with the checkpoint in small text ("7 d"); a non-final evaluation adds "so far".
- Column "Vs baseline": `1.62×` or "—".
- Column "Goal": the goal tag from the card.
- Filter "Verdict" (multi-select) mapped to the `verdict` query parameter.

Copy: sentence case; numbers with thousands separators; ratios with two decimals and "×".

## Acceptance criteria

1. Given a published reel with a `24h` snapshot and no evaluation, when `analytics.evaluate_due` runs, then one `PerformanceEvaluation` exists for (`publication`, `24h`) and a `note` event is on the item.
2. Given the data of example A, when the reel is evaluated at `7d`, then `value` = 84, `goal_target` = 60, `goal_result` = `met`, `baseline_value` = 52.00, `baseline_sample_size` = 7, `baseline_ratio` = 1.62 and `verdict` = `outperforming`.
3. Given the data of example B, when the feed post is evaluated, then `goal_target` = 5000, `goal_source` = `week_total_share`, `goal_result` = `missed` and `verdict` = `insufficient_data`.
4. Given the data of example C, then `baseline_value` = 7.00, `baseline_ratio` = 0.43 and `verdict` = `underperforming`.
5. Given a snapshot where the primary metric is unavailable and a goal exists, then `value` is null, `goal_result` = `not_measured` and `verdict` = `insufficient_data`.
6. Given an existing evaluation, when the same pair is evaluated again, then there is still exactly one row and its `evaluated_at` is updated.
7. Given a story, when it has `1h` and `6h` snapshots only, then no evaluation is created; when its `23h` snapshot arrives, one is created and it is final.
8. Given a sample post published after the evaluated post, when the baseline is computed, then that post is not in `baseline_samples`.
9. Given `POST /evaluations/run/` with both `plan` and `publication`, then the response is `400 validation_error`.
10. Given a plan with nine published posts, when `POST /evaluations/run/` is called with `force: true`, then the job succeeds and `result.evaluated` equals the number of (publication, evaluation checkpoint) pairs that have snapshots.
11. Given a final-checkpoint evaluation that is `outperforming`, then `create_for_evaluation` is called once; given it raises, the evaluation is still saved.
12. Given the Performance tab of a published item with a `7d` evaluation, then the card shows the verdict tag, the sentence with value, ratio, sample count and median, the goal tag, and the all-metrics table with the primary row marked.
13. Given `/analytics/posts` filtered by verdict "Outperforming", then only posts whose latest evaluation is `outperforming` are listed.
14. Given a reel whose `24h` snapshot row has `status = skipped`, when `analytics.evaluate_due` runs, then no `24h` evaluation is created and that post is not used as a `24h` baseline sample for other posts.
15. Given a `24h` evaluation that E09-S03 deleted after a manual correction, when `analytics.evaluate_due` next runs, then the evaluation is recomputed from the corrected numbers.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E10-S01-BE1 | Model, migration, settings | `analytics/models.py`: `PerformanceEvaluation` with `goal_source`, `baseline_samples`, `not_measured`; constraints and indexes; the four `SOCIALHUB_EVAL_*` settings with start-up validation | 0.25 |
| E10-S01-BE2 | Primary metric and goal resolution | `analytics/services/evaluation.py`: `resolve_primary_metric(publication)`, `resolve_goal(plan, metric, format)` implementing rules 5–11; unit tests for every lookup row and N = 0 | 0.5 |
| E10-S01-BE3 | Baseline, ratio, verdict | `compute_baseline(publication, checkpoint, metric)`, `decide_verdict(ratio)`; median, rounding, window, exclusions; unit tests for examples A–D and boundary ratios 1.50 and 0.60 | 0.75 |
| E10-S01-BE4 | Evaluate service | `evaluate_publication(publication_id, checkpoint, force)`: builds `metrics`, upserts, writes the `ContentEvent`, calls the repurpose hook for final outperformers; tests for idempotency and hook failure | 0.5 |
| E10-S01-BE5 | Scheduled task and run job | `analytics/tasks.py`: `evaluate_due` with lock and batch limit, Beat entry; `run_evaluations` job with progress and result counts | 0.5 |
| E10-S01-BE6 | API | List, detail and run endpoints with filters, ordering and errors; `latest_evaluation` and `verdict` filter on `GET /analytics/posts/`; `openapi.yaml`; API tests | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E10-S01-FE1 | Service and types | `src/services/socialhub/evaluations.ts`; types; verdict and goal labels added to the `StatusTag` label map | 0.25 |
| E10-S01-FE2 | EvaluationCard | Checkpoint switch, verdict and goal rows with all sentence variants, metrics table, compared-with list; component tests for the four examples | 0.75 |
| E10-S01-FE3 | Posts table columns | Verdict, Vs baseline and Goal columns plus the verdict filter on `/analytics/posts` | 0.25 |
| E10-S01-FE4 | Evaluate now and states | `JobButton` wiring, empty, loading and error states on both pages | 0.25 |

### Test

None beyond the tests in each subtask.

## Test notes

- Unit tests are table-driven from the worked examples; add boundaries: ratio exactly 1.50 → `outperforming`, 1.49 → `on_par`, 0.60 → `underperforming`, 0.61 → `on_par`; baseline 0 → `insufficient_data`; exactly 5 samples → baseline computed.
- A factory builds an account with a plan, goals, slots and N published publications with snapshots at chosen checkpoints; it is reused by E10-S02 and E10-S04.
- API tests cover every error row and that `account` scoping hides other accounts' evaluations.
- Panel tests render `EvaluationCard` from fixture JSON for each verdict and for the empty states.

## Later

- Baseline dimensions (role, media kind, hour of day): add arguments to `compute_baseline`; the stored fields stay the same.
- Automatic re-evaluation when a manual snapshot is edited: call `evaluate_publication` from the snapshot save hook.
- Phase 2: snapshots collected from Instagram (E09-S01) are evaluated by the same rules; nothing in this story changes.
- Per-account thresholds: move the two ratios from settings to `InstagramAccount.posting_rules`.
