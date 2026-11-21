# E10 — Evaluate and feed back

## Goal

Workflow step 10, "Evaluate performance: compare with the goal and similar posts at the same age", and both feedback loops on the workflow page. Every published post gets a verdict against its goal and against a baseline of similar posts measured at the same age. At the end of the week the numbers become a weekly report with findings. Accepted findings pre-fill next week's plan (loop to step 01), and outperforming posts become repurpose tasks that enter the next ranking (loop to step 03).

## Scope

**In the MVP**

- One evaluation per publication per evaluation checkpoint: `24h` and `7d` for reels and feed posts, `23h` for stories.
- Goal comparison from the plan's `PlanGoal` rows; baseline comparison from the median of similar posts at the same checkpoint.
- Four verdicts: `outperforming`, `on_par`, `underperforming`, `insufficient_data`.
- One weekly report per plan: totals computed in code, summary and findings written by AI from those totals, editable by the operator, accepted per finding and as a whole.
- Applying an accepted report to next week's draft plan as carried findings with suggested changes the operator applies or ignores.
- Repurpose tasks created automatically for outperforming posts and by hand for any published post.

**Left for later**

- Statistical significance, confidence intervals, seasonality adjustment.
- Baselines by role, media kind, posting hour or topic.
- Automated experiments and automatic changes to an active plan.
- Cross-account comparison and benchmarks.
- Report export (PDF, email) and scheduled delivery.

## Stories

| Story | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E10-S01](S01-evaluate-posts.md) | Evaluate posts against goal and same-age baseline | Must | 3 | 1.5 | |
| [E10-S02](S02-weekly-report.md) | Weekly findings report | Must | 2.5 | 2.5 | |
| [E10-S03](S03-apply-findings-to-plan.md) | Apply findings to the next weekly plan | Must | 1.5 | 1.5 | |
| [E10-S04](S04-repurpose-tasks.md) | Repurpose tasks for outperforming posts | Must | 1.5 | 1 | |
| | **Total** | | **8.5** | **6.5** | |

## Flow

1. E09-S01 stores a `MetricSnapshot` for a publication at a checkpoint.
2. Every 15 minutes `analytics.evaluate_due` finds publications that have a snapshot at an evaluation checkpoint and no `PerformanceEvaluation` for it, and evaluates them (S01).
3. An evaluation resolves the primary metric, the goal and the baseline, then stores the verdict.
4. When a final-checkpoint evaluation (`7d`, or `23h` for a story) is `outperforming`, S04 creates a `RepurposeTask` and asks AI for an angle and formats.
5. When the plan is closed, S02 builds the `WeeklyReport`: code computes totals and the post table, AI writes the summary and 3–7 findings.
6. The operator edits the report, accepts or dismisses each finding, and accepts the report (S02).
7. The operator applies the accepted report. S03 finds or creates next week's draft plan and stores the accepted findings as `carried_findings`. In the plan editor each finding's suggestion is applied or ignored by a person.
8. The next ranking (E03-S02) turns open repurpose tasks into candidates of kind `repurpose`.

```text
MetricSnapshot ─► PerformanceEvaluation ─┬─► WeeklyReport ─► accepted findings ─► next WeeklyPlan.carried_findings   (loop to 01)
        (E09)            (S01)           │       (S02)               (S03)
                                         └─► RepurposeTask ─► Candidate(kind=repurpose)                              (loop to 03)
                                                 (S04)              (E03-S02)
```

## Owns

| Kind | Items |
| --- | --- |
| Tables | `PerformanceEvaluation`, `WeeklyReport` (app `analytics`); lifecycle of `RepurposeTask` (table lives in app `selection`) |
| Endpoints | `GET /evaluations/`, `GET /evaluations/{id}/`, `POST /evaluations/run/`, `POST /weekly-reports/generate/`, `GET /weekly-reports/`, `GET /weekly-reports/{id}/`, `PATCH /weekly-reports/{id}/`, `POST /weekly-reports/{id}/accept/`, `POST /weekly-reports/{id}/apply-to-plan/`, `GET /repurpose-tasks/`, `POST /repurpose-tasks/`, `PATCH /repurpose-tasks/{id}/` |
| Panel | `/reports`, `/reports/:id`; `EvaluationCard` on the Performance tab of `/content/:id` and on `/analytics/posts/:publicationId`; verdict columns on `/analytics/posts`; "Repurpose tasks" section on the Candidates tab of `/selection`; suggestion actions inside the plan editor's carried-findings panel |
| Background tasks | `analytics.evaluate_due` (every 15 minutes), job `evaluation.run`, job `report.weekly`, job `repurpose.suggest`, `selection.expire_repurpose_tasks` (daily) |
| AI tasks | `report.weekly_findings`, `repurpose.suggest` |
| Settings | `SOCIALHUB_EVAL_OUTPERFORM_RATIO` (1.5), `SOCIALHUB_EVAL_UNDERPERFORM_RATIO` (0.6), `SOCIALHUB_EVAL_BASELINE_DAYS` (60), `SOCIALHUB_EVAL_BASELINE_MIN_SAMPLES` (5), `SOCIALHUB_REPURPOSE_EXPIRY_DAYS` (30), `SOCIALHUB_REPORT_LANGUAGE` (`en`) |

## Depends on / needed by

| Story | Depends on | Needed by |
| --- | --- | --- |
| E10-S01 | E09-S01 (snapshots), E08-S03 (publications), E04-S03 (brief `success_metric`), E01-S01 and E01-S02 (goals and slots), E09-S03 (Performance tab and posts table it extends) | E10-S02, E10-S04, E11-S01 |
| E10-S02 | E10-S01, E09-S02 (follower snapshots), E01-S03 (plan close), E00-S05 (AI gateway), E00-S06 (jobs) | E10-S03, E11-S03 |
| E10-S03 | E10-S02, E01-S01 (plan editor and `PATCH /plans/{id}/`), E01-S03 (duplicate rules) | E11-S03 |
| E10-S04 | E10-S01, E00-S05, E00-S06 | E03-S02 (repurpose candidates), E03-S03 (marks tasks used), E11-S03 |

## Done when

On an account with at least six earlier published reels:

1. A reel's `24h` snapshot produces an evaluation within 15 minutes, with a goal result, a baseline from the earlier reels and a verdict.
2. A reel whose `7d` evaluation is `outperforming` creates exactly one repurpose task with an angle and formats, and the next ranking shows it as a `repurpose` candidate.
3. Closing the plan produces a draft weekly report whose totals match a hand calculation from the snapshots, with 3–7 findings that each cite real publications.
4. After the operator accepts findings and the report, "Apply to next plan" creates next week's draft plan with those findings carried, and applying a goal suggestion in the plan editor changes the draft plan's goal.
5. An active plan's goals and slots are never changed by any of this without a person's click.

## Later

- The scoring functions (`resolve_goal`, `compute_baseline`, `decide_verdict`) are pure functions in `analytics/services/evaluation.py`; smarter baselines replace them without touching tables or the API.
- `WeeklyReport.findings` already carries `plan_field` and a structured `suggested_change`, so automatic application behind an autopilot switch is a small step.
- `RepurposeTask` is one source of candidates; other "reuse" sources (evergreen reposts, series continuation) can create the same record.
