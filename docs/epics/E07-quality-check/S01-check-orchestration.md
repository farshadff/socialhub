# E07-S01 — Check run orchestration and outcome routing

| | |
| --- | --- |
| Epic | E07 Quality check |
| Priority | Must |
| Estimate | BE 2.5 d · FE 0.5 d · QA 0 d |
| Depends on | E00-S05, E00-S06, E03-S04, E04-S01, E06-S07 |
| Needed by | E07-S02, E07-S03, E07-S04, E07-S05, E07-S06, E08-S01 |

## User story

As an operator, I want every produced version to be checked automatically and routed to pass, revise or escalate, so that good content schedules itself and I only see the items that need a person.

## Context

When E06-S07 submits a content version, the pipeline moves the item to `in_check`. This story owns what happens next: one background job runs the five checks, stores their results, reduces them to one outcome and moves the item on. The individual checkers are specified in E07-S02 (format, rights), E07-S03 (copy, facts) and E07-S04 (design). The revise job is E07-S05. The panel views of the results are E07-S06.

This story also defines the shared rules that all checkers follow: the finding shape, the severity-to-outcome table, the score, and what happens when a checker crashes.

## Scope

**In**

- The `quality` Django app, its three tables and the checker interface.
- The `qc.run` job: build the check context, run five checkers, store results.
- Severity-to-outcome mapping per check, aggregation across checks, run summary.
- Routing: Pass, Revise (including the revision limit) and Escalate.
- `POST /content-items/{id}/checks/run/` for a rerun after a failed run and for a recheck during review.
- The run action and progress display on the Checks tab.

**Out (later)**

- Per-account thresholds or disabling individual checks.
- Partial reruns of a single check.
- Rechecking a scheduled item when something changes after approval.

## Behaviour and rules

### Starting a run

1. A run is started by `quality.services.start_run(item, trigger, user=None)`. It is called by the pipeline's `advance(item)` when an item enters `in_check`, and by the endpoint in this story.
2. `trigger` is one of `submission` (first check of a version from E06-S07), `revision` (a version produced by the revise job) and `manual_recheck` (started from the endpoint). The `in_check` handler does not guess: it reads `ContentVersion.submit_trigger`, which E06-S07's `submit_version` sets to `submission` or `revision`, and passes it as `trigger`. The endpoint always uses `manual_recheck`.
3. `start_run` runs in one transaction with the item row locked (`select_for_update`). It verifies that the item has a `current_version` with `status = submitted`, `render_status = ready` and a `final_asset`; creates a `QCRun` with `attempt = previous highest attempt for the item + 1` and `status = running`; creates a `JobRun` with `kind = qc.run`, `target_type = content_item`; sets `ContentItem.active_job`; and enqueues the task after commit.
4. One version can have more than one run (a rerun after a failure, or a recheck). `attempt` counts runs per item, not per version.
5. If the item already has an active `qc.run` job, `start_run` raises a conflict (`409 job_in_progress`).
6. The endpoint may start a run only when:
   - the item is `in_check` and has no active job (the previous run failed), or
   - the item is `in_review` and its open review task has reason `qc_escalated` or `max_revisions` (a recheck, typically after someone fixed asset rights metadata or after a provider outage). The pipeline moves the item `in_review → in_check` for the duration of the run.
   Any other status returns `409 invalid_transition`.

### Running the checks

7. The task builds one `CheckContext` and passes it to every checker: the item, content version, brief, script payload, account, brand profile, the format specification from the registry (E04-S01), the resolved input assets (see E07-S02), and local temporary paths of the final and cover assets downloaded from storage.
8. Order: `format` and `rights` run first, one after the other, because they are fast and need no AI. Then `copy`, `facts` and `design` run in parallel in a thread pool of three workers (the work is waiting on the AI provider).
9. All five checks always run, even when an early check already fails, so that one revision can address every finding at once. The single exception: when the format check reports `format.asset_missing` or `format.unreadable_media`, the design check does not call the AI and records one finding `design.not_checked`.
10. Each checker returns a list of findings and optional `details`. The orchestration computes the check's outcome and score from the findings (rules 14–16) and writes one `QCResult` per check. A run always ends with exactly five results.
11. **A checker crash never fails the run.** Any exception from a checker — including AI gateway errors after the gateway's own retries, a refusal, `provider_not_configured`, or a timeout — is caught. That check gets `outcome = escalate`, `score = 0` and one finding `{"code": "<check>.checker_error", "severity": "blocker", "auto_fixable": false, "message": "The <check> check could not run: <error_code>."}`. The exception is logged with the job ID.
12. The task has a soft time limit of 600 seconds (`SOCIALHUB_QC_RUN_TIMEOUT_SECONDS`). A checker still running at the limit is treated as crashed (rule 11).
13. The run itself fails only for errors outside the checkers (database unavailable, storage download failed, worker killed). Celery retries the task once after 60 seconds for those. If it fails again: `QCRun.status = failed`, `JobRun.status = failed` with `error_code = qc_run_failed`, `active_job` cleared, the item stays `in_check` (or returns to `in_review` for a manual recheck) with `hold_reason = "Check run failed. Run checks again."`.

13a. **Scheduling failure after a Pass.** The Pass route calls the scheduler (E08-S01) inside the same job. If scheduling raises, the run stays `completed` with outcome `pass` and the version stays `passed`, but the job fails with `error_code = scheduling_failed` and is not retried. The item stays `in_check` with `hold_reason = "Passed checks but could not be scheduled: <reason>. Run checks again."`; the failed job puts it on the overview attention list (E11-S01). Running checks again (the endpoint) repeats the run and, on Pass, the scheduling.

### From findings to a check outcome

14. Every finding uses a code from the catalogue in `quality/catalogue.py`. The catalogue fixes, per code, the allowed severities, whether it is auto-fixable, the rework level (`copy`, `render`, `script` or none) and whether a reviewer may override it. A checker cannot emit a code that is not in the catalogue; unknown codes from an AI checker are dropped and logged.
15. Outcome of one check, decided by its worst finding:

| Findings in the check | Check outcome |
| --- | --- |
| At least one `blocker` with `auto_fixable = false` | `escalate` |
| At least one `major` with `auto_fixable = false` (and none of the above) | `escalate` |
| At least one `blocker` or `major`, all of them `auto_fixable = true` | `revise` |
| Only `minor` and `info` findings, or none | `pass` (the findings are kept as notes) |

   The second row exists because a finding that the revise loop cannot fix must go to a person. The catalogue marks almost every `major` code as auto-fixable; the exceptions are media findings on manually uploaded files (E07-S02, E07-S04).

16. Score of one check: start at 100; subtract 40 per `blocker`, 20 per `major`, 5 per `minor`, 0 per `info`; never below 0. The score is for display and later analysis; routing uses outcomes only.

### From five results to one run outcome

17. Aggregation:

| Check outcomes | Run outcome |
| --- | --- |
| Any check is `escalate` | `escalate` |
| No `escalate`, at least one `revise` | `revise` |
| All five `pass` | `pass` |

18. `QCRun.summary` is built in code, with no AI call: the outcome, then up to three finding messages ordered by severity. Examples: "Passed all five checks with 2 notes." · "Revise: caption is 2,431 characters, limit 2,200; frame 2 text overflows its box." · "Escalated: the caption states '37%' and no reference supports it."

### Routing

19. Routing runs in one transaction after the five results are saved, through `content.services.pipeline` (the only writer of `ContentItem.status`). Before routing, the service checks that the item is still `in_check` and that `item.current_version` is the version that was checked. If not (the item was cancelled meanwhile), the run is saved as `completed` with its outcome, a `ContentEvent` of type `note` records "Check result ignored: item changed during the run", and nothing else happens.
20. Routing table:

| Run outcome | Condition | Effect |
| --- | --- | --- |
| `pass` | any trigger | `ContentVersion.status = passed`; item → `approved`; `advance(item)` invokes the scheduler (E08-S01), which creates the publication and moves the item to `scheduled`. If the run was a manual recheck, the open review task is resolved with `decision = approve`, `decision_note = "Resolved by recheck: run #<attempt> passed."`, `resolved_by` = the user who started the recheck |
| `revise` | trigger is `submission` or `revision`, and `auto_revision_count < posting_rules.max_revisions` | `ContentVersion.status = rejected`; item → `needs_revision`; `advance(item)` starts the revise job (E07-S05) |
| `revise` | trigger is `submission` or `revision`, and `auto_revision_count >= posting_rules.max_revisions` | Treated as escalate with `ReviewTask.reason = max_revisions` and detail "Still needs revision after <n> automatic revisions." |
| `revise` | trigger is `manual_recheck` | Item returns to `in_review`; the open task stays open and its `qc_run` is set to the new run. A recheck never starts the automatic revise loop, because a person is already handling the item |
| `escalate` | trigger is `submission` or `revision` | `ContentVersion.status` stays `submitted`; a `ReviewTask` is opened with `reason = qc_escalated`, `qc_run` = this run, `detail` = the run summary; item → `in_review` |
| `escalate` | trigger is `manual_recheck` | Item returns to `in_review`; the open task stays open, `qc_run` and `detail` are updated to the new run |

21. At most one review task per item is open at a time (partial unique index on `content_item` where `status = open`). Opening a task when one is already open updates that task instead.
22. Every completed run writes a `ContentEvent` of type `qc_result` with `data = {"qc_run_id", "attempt", "outcome", "trigger", "outcomes": {"format": "pass", …}, "finding_counts": {"blocker": 0, "major": 1, "minor": 2, "info": 0}}` and the summary as `message`.
23. `active_job` is cleared and `hold_reason` is set in the same transaction: empty on pass, "Automatic revision in progress" on revise, "Waiting for review: <summary>" on escalate.

## Data

Uses `QCRun`, `QCResult`, `ReviewTask`, `ContentItem`, `ContentVersion`, `ContentEvent` and `JobRun` as defined in [DATA-MODEL.md](../../DATA-MODEL.md).

New fields introduced by this epic (to be added to DATA-MODEL.md):

| Table | Field | Type | Notes |
| --- | --- | --- | --- |
| `QCRun` | `trigger` | enum | `submission`, `revision`, `manual_recheck` |
| `QCRun` | `started_by` | FK User, null | The user who started a manual recheck; null for pipeline runs |
| `QCResult` | `details` | JSON, default `{}` | Structured checker output that is not a finding: media probe for `format`, input asset list for `rights`, claims for `facts`, frames checked for `design` |
| `ContentItem` | `auto_revision_count` | int, default 0 | Revisions started by a Revise outcome. `revision_count` keeps counting automatic and requested revisions together |

New pipeline transition (to be added to ARCHITECTURE.md): `in_review → in_check`, only for a manual recheck, and back to `in_review` when the recheck does not pass.

Constraints: unique (`content_item`, `attempt`) on `QCRun`; unique (`run`, `check`) on `QCResult`; partial unique index on `ReviewTask (content_item)` where `status = 'open'`.

Checker interface (`quality/checkers/base.py`):

```python
@dataclass
class Finding:
    code: str            # from the catalogue
    severity: str        # info | minor | major | blocker
    message: str         # one sentence, English, shown in the panel
    location: dict       # {"field": "caption"} | {"frame_index": 2} | {"asset_id": 17} | {}
    suggestion: str = ""
    auto_fixable: bool = False

@dataclass
class CheckOutput:
    findings: list[Finding]
    details: dict
    ai_run_id: int | None = None

class Checker(Protocol):
    check: str                     # QCCheck value
    checker: str                   # "rule" | "ai"
    def run(self, ctx: CheckContext) -> CheckOutput: ...
```

## API

### `POST /api/v1/content-items/{id}/checks/run/`

Runs the five checks on the item's current version. Permission: admin or operator. Body: empty object.

Response `202`:

```json
{
  "job": {
    "id": "5f0c2a8e-1d7b-4a55-9f1e-6f2b9c3d4e10",
    "kind": "qc.run",
    "status": "queued",
    "progress": 0,
    "message": "",
    "target_type": "content_item",
    "target_id": "42",
    "result": null,
    "error_code": null,
    "error_detail": null,
    "created_at": "2026-12-01T08:15:02Z",
    "started_at": null,
    "finished_at": null
  }
}
```

When the job succeeds, `result` is:

```json
{"qc_run_id": 118, "attempt": 2, "outcome": "revise", "item_status": "needs_revision"}
```

Errors:

| Case | HTTP | Code | `details` |
| --- | --- | --- | --- |
| Item not found, or belongs to an account the user cannot see | 404 | `not_found` | |
| Item status is not `in_check` or `in_review` | 409 | `invalid_transition` | `{"status": "in_production", "allowed_statuses": ["in_check", "in_review"]}` |
| Item is `in_review` but its open task has reason `publish_failed`, `no_slot` or `manual` | 409 | `invalid_transition` | `{"review_reason": "publish_failed"}` |
| A `qc.run` or `qc.revise` job is active for the item | 409 | `job_in_progress` | `{"job": { … }}` |
| Current version is missing, not `submitted`, not rendered, or has no final asset | 409 | `invalid_transition` | `{"reason": "version_not_ready"}` |

## Background work

| Item | Value |
| --- | --- |
| Task | `quality.tasks.run_checks(job_id, qc_run_id)` |
| Job kind | `qc.run` |
| Queue | `default` |
| Idempotency | Keyed by `qc_run_id`. If the run is already `completed`, the task exits. Results are written with `update_or_create` on (`run`, `check`), so a retried task overwrites instead of duplicating |
| Retries | One automatic retry after 60 s for errors outside the checkers; none for checker errors (rule 11) |
| Time limits | Soft 600 s, hard 660 s |
| Progress | 5 "Preparing files" · 20 "Checking format and rights" · 40 "Checking copy, facts and design" · +15 as each AI check returns · 90 "Deciding the outcome" · 100 |
| Temporary files | Downloaded media and extracted frames live in a per-run temporary directory that is removed in a `finally` block |

`JobRun.result` on success is the object shown in the API section.

## AI

None in this story. The AI tasks `qc.copy`, `qc.facts` and `qc.design` are specified in E07-S03 and E07-S04. This story only requires that every AI checker passes `job_id` and `account_id` to the gateway so the calls appear in `AIRun` under the run's job.

## Panel

Route: `/content/:id`, Checks tab (the tab's result views are E07-S06). This story adds the run action and the running state.

| Element | Behaviour |
| --- | --- |
| Tab header, right side | `JobButton` "Run checks again". Visible when the item is `in_check` with no active job, or `in_review` with a task of reason `qc_escalated` or `max_revisions`. Hidden otherwise |
| Confirmation | `Popconfirm`: "Run all five checks on version {n} again?" |
| While a `qc.run` job is active (from `active_job`) | `JobProgress` at the top of the tab with the job message; a five-row list (Format, Rights, Copy, Facts, Design) each showing a spinner until the job ends; all other actions on the tab disabled with the tooltip "Checks are running" |
| Job succeeded | Reload the item and the check list; show `message.success` with the outcome: "Checks passed", "Checks returned Revise" or "Checks escalated to review" |
| Job failed | Inline `Result` (warning): "The check run failed. Nothing was changed." with the button "Run checks again" and the `request_id` in small text |
| `409 job_in_progress` | `message.info`: "Checks are already running." and attach to the active job from `error.details.job` |
| `409 invalid_transition` | `message.warning`: "This item can't be checked in its current status." and reload the item |

## Acceptance criteria

1. Given an item in `in_production` whose version was just submitted, when the pipeline moves it to `in_check`, then a `QCRun` with `trigger = submission` and `status = running` exists, a `qc.run` job is queued, and `active_job` points to it.
2. Given a run whose five checks return no `major` or `blocker` findings, when the job ends, then `QCRun.outcome = pass`, the version is `passed`, the item has moved through `approved` and the scheduler was invoked exactly once.
3. Given a run with one auto-fixable `major` finding and `auto_revision_count = 0`, when the job ends, then the outcome is `revise`, the version is `rejected`, the item is `needs_revision` and a `qc.revise` job is queued.
4. Given the same finding with `auto_revision_count = 2` and `max_revisions = 2`, when the job ends, then a review task with reason `max_revisions` is open and the item is `in_review`.
5. Given a run with one `blocker` finding that is not auto-fixable, when the job ends, then the outcome is `escalate`, the version is still `submitted`, a review task with reason `qc_escalated` is open and the item is `in_review`.
6. Given the copy checker raises an exception, when the job ends, then five results exist, the copy result has `outcome = escalate` with a single `copy.checker_error` finding, and the run is `completed`, not `failed`.
7. Given the format check reports `format.asset_missing`, when the job ends, then no `qc.design` AI call was made and the design result contains `design.not_checked`.
8. Given an item that was cancelled while its run was in progress, when the job ends, then the run is stored, the item is still `cancelled`, no review task exists and a `note` event explains why.
9. Given an item in `in_review` with a `qc_escalated` task, when an operator calls the endpoint and the new run passes, then the task is `resolved` with `decision = approve`, `resolved_by` is that operator, and the item is scheduled.
10. Given the same recheck returns `revise`, then the item is back in `in_review`, no revise job was started, and the task's `qc_run` is the new run.
11. Given an item in `scripted`, when the endpoint is called, then the response is `409 invalid_transition`.
12. Given a run is active, when the endpoint is called again, then the response is `409 job_in_progress` with the active job in `details`.
13. Given the storage download fails twice, then `QCRun.status = failed`, the job is `failed` with `qc_run_failed`, the item is still `in_check`, and "Run checks again" is visible on the Checks tab.
14. Given a version submitted by the revise job (`submit_trigger = revision`), when the item enters `in_check`, then the new run has `trigger = revision`.
15. Given a run that passes and a scheduler that raises, then the run is `completed` with `pass`, the job is `failed` with `scheduling_failed` and was not retried, and the item is `in_check` with a hold reason.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E07-S01-BE1 | Create the `quality` app and tables | `apps/quality/models.py`: `QCRun` (with `trigger`, `started_by`), `QCResult` (with `details`), `ReviewTask`; constraints and the partial unique index; migration adding `ContentItem.auto_revision_count`; admin registrations | 0.5 |
| E07-S01-BE2 | Checker framework and catalogue loader | `quality/checkers/base.py` (`Finding`, `CheckOutput`, `Checker`, `CheckContext`); `quality/catalogue.py` with the lookup, validation of emitted codes and severities, and the per-check outcome and score functions (rules 14–16); `quality/context.py` building the context and downloading media to a temp directory | 0.5 |
| E07-S01-BE3 | `qc.run` task | `quality/tasks.py`: sequential rule checks, thread pool for AI checks, crash capture as `checker_error`, soft time limit handling, progress messages, idempotent result writes, retry policy for non-checker errors, temp cleanup | 0.5 |
| E07-S01-BE4 | Aggregation and routing | `quality/services.py`: `start_run`, `complete_run`, summary builder, routing table (rule 20) through `content.services.pipeline`, stale-item guard, `ContentEvent` writes, review task open-or-update, hook from `advance(item)` for `in_check` reading `ContentVersion.submit_trigger`, `scheduling_failed` handling (rule 13a), new transition `in_review ↔ in_check` | 0.5 |
| E07-S01-BE5 | Endpoint and contract | `POST /content-items/{id}/checks/run/` view, status and job conflict handling, `details` payloads, new error codes in `docs/openapi.yaml`, API tests for every row of the error table | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E07-S01-FE1 | Run action and running state on the Checks tab | `src/pages/content/workspace/tabs/ChecksTab/RunHeader.tsx`: `JobButton`, `Popconfirm`, `JobProgress`, five-row running list, success and failure messages, conflict handling; service function in `src/services/socialhub/checks.ts` | 0.5 |

### Test

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| — | None beyond the tests in each subtask | End-to-end coverage of the three outcomes is E11-S03 | 0 |

## Test notes

- Unit: outcome table (rule 15) with every combination of severity and `auto_fixable`; score floor; aggregation table; summary text for each outcome.
- Service tests with stub checkers that return fixed findings: one test per row of the routing table, plus the stale-item guard and the open-or-update behaviour of review tasks.
- Task tests: a stub checker that raises, one that sleeps past the soft limit, and a storage failure before the checkers start.
- API tests: each error row; the manual recheck from `in_review` for pass, revise and escalate.
- Concurrency: two simultaneous `start_run` calls for the same item produce one run and one `409`.
- All tests use the fake AI provider; no test in this story needs real media (stub checkers), which keeps the orchestration tests fast.

## Later

- A per-account JSON override of catalogue severities can be read in the outcome function without touching the checkers.
- The thread pool can become a Celery group if AI checks need their own queue or rate limiting.
- A rerun of a single check needs only a `checks` parameter on `start_run`; results are already stored per check.
