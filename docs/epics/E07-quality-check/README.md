# E07 — Quality check

## Goal

Workflow step 07, "Check the output": every produced version is checked for design, copy, facts, rights and format before it can be scheduled. Each run ends in exactly one of the three outcomes on the workflow page:

| Outcome | What the workflow page says | What Phase 1 does |
| --- | --- | --- |
| Pass | Schedule automatically | The version is marked `passed`, the item becomes `approved`, and the scheduler (E08-S01) gives it a publication in the same step |
| Revise | Return to production, then recheck | The item becomes `needs_revision`; a revise job makes the smallest rework that addresses the findings, creates the next version and submits it for a new check |
| Escalate | Send unresolved issues to human review | A review task opens, the item becomes `in_review`, and a person approves, requests changes or rejects |

## Scope

**In Phase 1**

- One check run per submitted version, with five checks: `format` and `rights` by rules, `copy`, `facts` and `design` by Claude plus a few rules.
- A fixed catalogue of finding codes, each with a severity, whether it can be fixed automatically, and what kind of rework fixes it.
- Outcome aggregation and routing into the content pipeline.
- The automatic revise loop, limited by `posting_rules.max_revisions` (default 2).
- The Checks tab of the item workspace, the review queue and the review task page.
- A manual "Run checks again" action for a failed run or a recheck during review.

**Left for later**

- Per-account thresholds, custom checks and a rule editor.
- Fetching reference pages from the web during the facts check (Phase 1 checks claims against the text stored with signals and feed items).
- Assigning review tasks to a person, due dates, comments and notifications.
- Learning from reviewer decisions, and measuring checker accuracy against human labels.
- Rechecking scheduled content when rights or brand rules change after approval.

## Stories

| Story | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E07-S01](S01-check-orchestration.md) | Check run orchestration and outcome routing | Must | 2.5 | 0.5 | |
| [E07-S02](S02-format-and-rights-checks.md) | Format and rights checks | Must | 2 | 0 | |
| [E07-S03](S03-copy-and-facts-checks.md) | Copy and facts checks | Must | 2.5 | 0 | |
| [E07-S04](S04-design-check.md) | Design check | Must | 2 | 0 | |
| [E07-S05](S05-revise-loop.md) | Automatic revise loop | Must | 2 | 0.5 | |
| [E07-S06](S06-results-and-review-queue.md) | Check results and human review queue | Must | 1.5 | 4 | |
| | **Total** | | **12.5** | **5** | |

## Flow

```text
E06-S07 submit ─► item in_check ─► job qc.run
                                     ├─ format  (rules)   ┐ first
                                     ├─ rights  (rules)   ┘
                                     ├─ copy    (rules + AI) ┐
                                     ├─ facts   (AI + code)  ├ in parallel
                                     └─ design  (rules + AI) ┘
                                     ▼
                         aggregate five results into one outcome
        ┌────────────────────────────┼─────────────────────────────┐
      pass                         revise                        escalate
        │                            │                              │
 version passed            auto revisions < limit?          ReviewTask opened
 item approved               yes │        no │              item in_review
 E08-S01 schedules   item needs_revision   escalate              │
                        job qc.revise     (max_revisions)   reviewer decides
                        version n+1                          approve ─► approved
                        resubmit ─► qc.run                   request changes ─► needs_revision
                                                             reject ─► cancelled
```

1. E06-S07 submits a content version. The pipeline moves the item to `in_check` and starts `qc.run` (S01).
2. The run executes the five checks (S02, S03, S04) and stores one `QCResult` per check.
3. S01 turns the five results into one outcome and routes the item.
4. On Revise, S05 reworks the version and resubmits it. On the third Revise in a row (with the default limit of 2) the item is escalated instead.
5. On Escalate, a reviewer works the task in the panel (S06).

## Owns

| Kind | Items |
| --- | --- |
| Tables | `QCRun`, `QCResult`, `ReviewTask` |
| Endpoints | `POST /content-items/{id}/checks/run/`, `GET /content-items/{id}/checks/`, `GET /checks/runs/{id}/`, `GET /review-tasks/`, `GET /review-tasks/{id}/`, `POST /review-tasks/{id}/resolve/`, and `POST /content-items/{id}/revision/retry/` (added by S05) |
| Panel pages | Checks tab of `/content/:id`; `/review`; `/review/:taskId` |
| Background jobs | `qc.run`, `qc.revise` (both on the `default` queue) |
| AI tasks | `qc.copy`, `qc.facts`, `qc.design` |
| Django app | `backend/apps/quality/` |

## Depends on / needed by

| Depends on | For |
| --- | --- |
| E00-S05 | AI gateway (`run_text`, images, structured output, the fake provider) |
| E00-S06 | `JobRun`, job polling, `JobButton` and `JobProgress`, media storage |
| E00-S03 | `BrandProfile` (banned terms, tone, colours, logo, `ai_disclosure`) and `posting_rules.max_revisions` |
| E03-S04 | `ContentItem`, the pipeline service, `ContentEvent`, the item workspace shell and its tabs |
| E04-S01 | Format registry: sizes, durations, codecs, caption and hashtag limits, safe areas |
| E04-S03 | `Brief.references`, `key_message`, `cta`, `must_include`, `must_avoid` |
| E05-S01 | Script package (on-screen text, frames, design notes); `script.generate` with feedback for script-level rework |
| E06-S01 | `Asset` rights metadata |
| E06-S02, E06-S03 | Render services, render warnings and render options used by render-level rework |
| E06-S06 | `copy.generate` with feedback for copy-level rework |
| E06-S07 | Submission of a content version; `MediaPreview` |

| Needed by | For |
| --- | --- |
| E08-S01 | Starts from an `approved` item with a `passed` version; opens review tasks with reason `no_slot`, which S06 resolves |
| E11-S01 | Open review tasks on the attention list |
| E11-S03 | End-to-end acceptance of all three outcomes |

## Done when

1. Submitting a clean version leads, with no person involved, to `QCRun.outcome = pass`, the item `approved`, and a publication created by E08-S01.
2. Submitting a version with a too-long caption leads to Revise, a new version with a shorter caption, a second run, and Pass.
3. Submitting a version whose caption contains a number that no reference supports leads to Escalate, an open review task, and the item `in_review`; a reviewer can approve with a note, request changes or reject, and each decision moves the item as specified.
4. A version that still needs revision after `max_revisions` automatic revisions is escalated with reason `max_revisions`.
5. A checker that crashes does not lose the run: its check is recorded as `escalate` with a `checker_error` finding and the other four results are kept.
6. All of the above run in automated tests with the fake AI provider.

## Later

- The finding catalogue is data in code (`quality/catalogue.py`). Per-account severity overrides can be added as a JSON field on the account without changing the checkers.
- Checkers implement one small interface, so a new check (for example accessibility or trademark screening) is one class plus catalogue entries.
- The facts check takes an evidence pack. A later version can add fetched page text to the pack without changing the prompt contract.
- `ReviewTask` can gain an assignee and comments; the queue already filters by reason and status.
- Phase 2: review tasks with reason `publish_failed`, opened by E08-S04 when a publication fails, and resolved through E08-S04's `on_review_decision` hook (retry, request changes, reject). The reason is already in the enum.
