# E02-S05 — Research workspace

| | |
| --- | --- |
| Epic | E02 Trend research |
| Priority | Must |
| Estimate | BE 0.5 d · FE 3 d · QA 0 d |
| Depends on | E02-S01, E02-S02, E02-S04 |
| Needed by | E03-S02 (operators shortlist topics before ranking) |

## User story

As an operator, I want one place to read the topics research found, open the evidence behind each, keep the good ones and discard the rest, so that only topics I trust go forward to selection.

## Context

After a run, the account has signals and AI-written topics. This story fills the three placeholder tabs of `/research` (Topics, Signals, Runs) created in E02-S01 and adds the two topic endpoints the panel needs: detail and update. The header's plan selector and "Run research" button already exist (E02-S02).

The operator's job here is quick triage: read a topic's hooks, glance at the evidence score, open one or two sources, then shortlist or dismiss. Shortlisting is optional — E03-S02 ranks both `new` and `shortlisted` topics — but dismissing removes a topic from ranking, and shortlisting protects it from being replaced by the next run.

## Scope

**In:**

- `GET /research/topics/{id}/` with the topic's signals.
- `PATCH /research/topics/{id}/` for status changes, text edits and attaching or detaching signals.
- Topics tab: list, filters, detail drawer, shortlist, dismiss, restore, edit, add a topic by hand.
- Signals tab: list, filters, add a signal by hand.
- Runs tab: history and per-source results.
- Status labels for topic, run and source statuses in `StatusTag`.

**Out (later):**

- Merging topics, bulk actions, drag and drop between topics.
- Deleting topics or signals.
- Comments on topics.
- Charts of signals over time.

## Behaviour and rules

### Topic detail and update (backend)

1. `GET /research/topics/{id}/` returns the topic with its linked signals embedded, newest first.
2. `PATCH` accepts any of: `status`, `title`, `summary`, `why_now`, `hooks`, `suggested_formats`, `keywords`, `signal_ids`, `plan`. Text and list limits are those of manual topics (E02-S04 rule 24).
3. Status changes follow the transition table in E02-S04 rule 21. `used` cannot be set through the API. A change that is not allowed returns `409 invalid_transition` with the allowed targets in `error.details.allowed_statuses`.
4. A topic with status `used` is read-only: any `PATCH` returns `409 invalid_transition`.
5. Editing content protects the topic. If a `PATCH` changes any of `title`, `summary`, `why_now`, `hooks`, `suggested_formats`, `keywords` or `signal_ids` on a topic whose status is `new`, and the request does not set `status`, the server sets `status = shortlisted` in the same update. This keeps a hand-edited topic from being replaced by the next research run (E02-S04 rule 12).
6. `signal_ids` replaces the whole list. Every ID must be a signal of the same account; at most 20. When the list changes, the evidence score is recomputed in the same transaction.
7. A title change is checked for uniqueness within the account and plan among non-dismissed topics (`400 validation_error`, `title`: `unique`).
8. `plan` may be changed to another plan of the account that is not `closed`, or to null.
9. `origin` never changes. An AI topic that has been edited remains `origin = ai`.
10. Two people editing the same topic: the last write wins. Topics are not versioned documents, and the edit window is short.

### Panel behaviour

11. The Topics tab opens filtered to the plan chosen in the header and to statuses `new` and `shortlisted`, ordered by evidence score, highest first.
12. Row actions depend on status:

    | Status | Actions |
    | --- | --- |
    | `new` | Shortlist, Dismiss |
    | `shortlisted` | Remove from shortlist, Dismiss |
    | `dismissed` | Restore |
    | `used` | None; a link "View item" appears once E03-S04 exists |

13. Shortlist, remove, dismiss and restore act at once without a confirmation; each shows an "Undo" link in the success message for 5 seconds that sends the reverse change.
14. All topic text, signal titles and excerpts are rendered with `ContentText` (`dir="auto"`), so Persian reads right-to-left inside the English panel.
15. External links (signal URLs) open in a new tab with `rel="noopener noreferrer"`.
16. After a research run finishes, all three tabs reload (the shared refresh key from E02-S02).

## Data

Uses `TrendTopic`, `TrendSignal`, `ResearchRun`, `ResearchSource` from [DATA-MODEL.md](../../DATA-MODEL.md). No new fields.

## API

All paths are under `/api/v1/`. Signed-in users of either role. List endpoints used by this story (`GET /research/topics/`, `GET /research/signals/`, `GET /research/runs/`, `GET /research/runs/{id}/`, `POST /research/topics/`, `POST /research/signals/`) are specified in E02-S02 and E02-S04.

### `GET /research/topics/{id}/`

```json
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
  "updated_at": "2026-11-22T09:24:30Z",
  "signals": [
    {
      "id": 431,
      "account": 3,
      "run": 31,
      "source": {"id": 26, "kind": "rss", "label": "sprudge.com"},
      "kind": "rss",
      "url": "https://sprudge.com/batch-brew-is-having-a-moment-2026",
      "title": "Batch brew is having a moment",
      "excerpt": "Roasters say filter coffee now makes up a third of bar sales in several markets.",
      "author": "Sprudge",
      "published_at": "2026-11-21T12:00:00Z",
      "captured_at": "2026-11-22T09:22:40Z",
      "metrics": {},
      "topic_ids": [58]
    },
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

Errors: `404 not_found`.

### `PATCH /research/topics/{id}/`

Status change:

```json
{"status": "shortlisted"}
```

Content edit (the server also sets `status` to `shortlisted` because the topic was `new`):

```json
{
  "title": "قهوه دمی دوباره مد شده",
  "hooks": [
    "چرا همه دوباره سراغ قهوه دمی رفته‌اند؟",
    "اسپرسو یا دمی؟ جواب کافه‌دارها عوض شده"
  ],
  "signal_ids": [412, 431, 440]
}
```

Response `200`: the full topic detail object, with the new `status`, recomputed `evidence_score` and `evidence_breakdown`.

Error example, transition not allowed:

```json
{
  "error": {
    "code": "invalid_transition",
    "message": "اطلاعات تغییر کرده است. صفحه را تازه‌سازی و دوباره بررسی کنید.",
    "fields": [],
    "request_id": "0d6a1d0e-2b61-4f3b-9d0b-3d7f2a9c1e44",
    "retryable": false,
    "details": {"status": "used", "allowed_statuses": []}
  }
}
```

| Case | Status and code | Detail |
| --- | --- | --- |
| Unknown topic | `404 not_found` | |
| Topic is `used` | `409 invalid_transition` | `details.allowed_statuses` is empty |
| Status change not in the table, or `status = used` | `409 invalid_transition` | `details.allowed_statuses` lists valid targets |
| Text or list over its limit | `400 validation_error` | `max_length` on the field |
| Empty `title` | `400 validation_error` | `title`: `blank` |
| Signal of another account or unknown | `400 validation_error` | `signal_ids.<index>`: `does_not_exist` |
| More than 20 signals | `400 validation_error` | `signal_ids`: `max_length` |
| Duplicate title in the plan | `400 validation_error` | `title`: `unique` |
| `plan` of another account or `closed` | `400 validation_error` | `plan`: `invalid` |
| Attempt to send `origin`, `account`, `evidence_score` | Ignored (read-only fields) | |

## Background work

None.

## AI

None.

## Panel

**Route:** `/research?tab=topics|signals|sources|runs&plan={id|none}`. Page frame, plan selector and "Run research" come from E02-S01 and E02-S02.

### Topics tab

A `ProTable` in a `ProCard`.

| Column | Content |
| --- | --- |
| Topic | Title in `ContentText`, bold; summary below it, two lines, truncated |
| Evidence | The score as a number with a small `Progress` bar; hovering shows the four components with labels "Signals", "Source variety", "Freshness", "Engagement" |
| Signals | Count, for example "4 signals" |
| Formats | Tags: "Reel", "Story", "Feed post" |
| Status | `StatusTag` |
| Origin | "AI" or "Manual" as plain text |
| Found | `DateTime` of `created_at` |
| Actions | Per rule 12, plus "View" |

Toolbar: Status (multi-select; default New, Shortlisted), Origin, "Minimum evidence" (`Slider` 0–100, default 0), search box (sends `q`). Primary button: "Add topic".

Clicking a row or "View" opens the **topic drawer** (`Drawer`, width 640):

| Block | Content |
| --- | --- |
| Header | Title, `StatusTag`, action buttons for the status (rule 12), "Edit" |
| Summary | `summary`, then "Why now" with `why_now` |
| Hooks | Numbered list; each line has a copy icon ("Copy hook") |
| Details | `ProDescriptions`: formats, keywords as tags, origin, plan, found date |
| Evidence | Score, then four labelled bars for the components, with one line under the title: "Calculated from the signals below." For a score of 0 with no signals: "No evidence attached yet. Add signals to give this topic a score." |
| Signals | List of linked signals: kind tag, title (`ContentText`) as an external link, author, published date or "No date", metrics when present ("9,200 likes · 310 comments · 180,000 views"), excerpt collapsed to two lines. Button "Attach signals" |

**Attach signals** opens a `Modal` with a searchable signal table (calls `GET /research/signals/` with `q`), checkboxes pre-ticked for linked signals, a counter "{n} of 20 selected", and "Save". It sends `PATCH {signal_ids}`. For a `new` topic the modal shows the note "Saving also adds this topic to the shortlist."

**Edit** switches the drawer body to a `ProForm`:

| Field | Control | Validation |
| --- | --- | --- |
| Title | `Input` | Required, 3–120 characters |
| Summary | `TextArea`, 3 rows | Up to 600 |
| Why now | `TextArea`, 2 rows | Up to 300 |
| Hooks | `ProFormList` of `Input` | Up to 5, each up to 160 |
| Formats | `Checkbox.Group` | Up to 3 |
| Keywords | `Select` in tags mode | Up to 8, each up to 40 |

Buttons: "Save" ("Save and shortlist" when the topic is `new`), "Cancel". Text inputs use `dir="auto"`. Unsaved changes prompt "Discard your changes?" on close.

**Add topic** opens a `ModalForm` "Add topic" with the same fields plus "Plan" (defaults to the header's plan). It sends `POST /research/topics/`. On success: "Topic added to the shortlist", the table reloads and the new topic's drawer opens so signals can be attached.

Messages: "Topic shortlisted", "Topic removed from shortlist", "Topic dismissed", "Topic restored" (each with "Undo"), "Topic saved".

### Signals tab

A `ProTable` in a `ProCard`.

| Column | Content |
| --- | --- |
| Signal | Title in `ContentText` as an external link; excerpt below, two lines |
| Kind | Tag: "Web search", "RSS feed", "Manual" |
| Source | Source label, or "—" |
| Author | Text |
| Published | `DateTime`, or "No date" |
| Captured | `DateTime` |
| Metrics | "9,200 likes · 310 comments · 180,000 views", or "—" |
| Topics | Count with a tooltip of topic titles; clicking opens the first topic's drawer |

Toolbar: Kind (multi-select), Source (select), Run (select of recent runs by date), "Not in any topic" (checkbox, sends `unassigned=true`), captured date range, search box. Primary button: "Add signal".

**Add signal** opens a `ModalForm` "Add signal":

| Field | Control | Validation |
| --- | --- | --- |
| Link | `Input` | Optional; must start with `http://` or `https://` |
| Title | `Input` | Required, up to 300 |
| What it shows | `TextArea` | Up to 1,000; required when Link is empty |
| Author or publisher | `Input` | Up to 120 |
| Published on | `DatePicker` with time | Optional |
| Likes / Comments / Views | Three `InputNumber` | Optional, 0 or more |
| Attach to topic | `Select` of open topics | Optional |

On a `unique` error the modal shows "This link is already saved as a signal." with a "Show it" link that filters the table to the existing signal (`error.details.signal_id`). On success: "Signal added".

### Runs tab

A `ProTable` in a `ProCard`, newest first.

| Column | Content |
| --- | --- |
| Started | `DateTime` |
| Started by | Username, or "System" |
| Plan | "Week of 28 Nov", or "No plan" |
| Status | `StatusTag`; a running run shows `JobProgress` inline |
| New signals | `stats.signals` |
| Duplicates | `stats.duplicates` |
| Topics | `stats.topics`; "Skipped" with tooltip "Not enough signals to form topics" when `stats.synthesis` is `skipped_too_few_signals`; "—" when `skipped` |
| Duration | `finished_at − started_at`, for example "4 min 36 s" |

Expanding a row loads `GET /research/runs/{id}/` and shows a nested table of `sources`: kind tag, label (or "Deleted source"), new signals, duplicates, result (`StatusTag` with the tooltip map from E02-S01). A failed run shows an `Alert` above the nested table with text by job `error_code`: `all_sources_failed` → "No source could be read."; `timeout` → "The run took too long and was stopped."; `stale_run` → "The run stopped unexpectedly."; `provider_error` → "The AI provider failed while grouping signals. Signals were kept; run again with 'Collect new signals' off."

### Status labels

Added to the `StatusTag` label and colour map:

| Kind | Value | Label | Colour group |
| --- | --- | --- | --- |
| Topic | `new` | New | Neutral |
| Topic | `shortlisted` | Shortlisted | Ready (cyan) |
| Topic | `dismissed` | Dismissed | Neutral |
| Topic | `used` | Used | Done (green) |
| Run | `running` | Running | In progress |
| Run | `completed` | Completed | Done |
| Run | `failed` | Failed | Problem |
| Source result | `ok` | OK | Done |
| Source result | `empty` | Nothing new | Neutral |
| Source result | `error:*` | Failed | Problem |

### States

| Tab | Loading | Empty | Error |
| --- | --- | --- | --- |
| Topics | Table skeleton | No runs yet: "No topics yet. Run research to find what your audience is paying attention to." with buttons "Run research" and "Add topic". Runs exist but filters hide everything: "No topics match these filters." with "Clear filters" | Inline `Result` with Retry and `request_id` |
| Signals | Table skeleton | "No signals yet. Signals are the posts and articles research finds. Run research or add one by hand." with "Add signal" | Same |
| Runs | Table skeleton | "Research has not run for this account yet." with "Run research" | Same |
| Topic drawer | `Skeleton` in the body | — | `Result` inside the drawer with Retry |

Other states: while a research run is active, a slim `Alert` on the Topics tab says "Research is running. Topics you have not shortlisted may be replaced when it finishes." No account selected → the shared prompt. Archived account → all create, edit and status actions are hidden. On `409 invalid_transition` → "This topic changed. Reloading." and the row or drawer reloads.

## Acceptance criteria

1. Given a finished run with six topics, when I open `/research`, then the Topics tab lists them by evidence score with status New, and hovering a score shows its four components.
2. Given a topic row, when I open it, then the drawer shows summary, why now, hooks, keywords, the evidence breakdown and each supporting signal with a link that opens the original source in a new tab.
3. Given a `new` topic, when I press "Shortlist", then its status becomes Shortlisted without a page reload, and "Undo" within 5 seconds returns it to New.
4. Given a `new` topic, when I press "Dismiss", then it leaves the default list; when I filter by Dismissed and press "Restore", then it returns as New.
5. Given a `new` topic, when I edit its title and save, then the button read "Save and shortlist", the topic is saved, and its status is Shortlisted.
6. Given a topic with two signals, when I attach a third through "Attach signals", then the signal list shows three and the evidence score and bars change.
7. Given a `used` topic, when I open it, then no edit or status actions are shown, and a direct `PATCH` returns `409 invalid_transition`.
8. Given a `PATCH` with `status = used`, when sent, then it returns `409 invalid_transition`.
9. Given "Add topic" with a title only, when I save, then a Manual, Shortlisted topic appears with score 0 and the drawer invites me to attach signals.
10. Given "Add signal" with a link that already exists, when I save, then I see "This link is already saved as a signal." and "Show it" filters the table to that signal.
11. Given the Signals tab, when I tick "Not in any topic", then only signals with no topic are listed.
12. Given a run in which one source failed, when I expand it on the Runs tab, then I see each source's new signals, duplicates and result, and the failed source's tooltip explains the failure.
13. Given a Persian topic, when it is displayed, then its title, summary and hooks read right-to-left and the surrounding panel stays left-to-right.
14. Given a research run finishes while I am on the Topics tab, when the job ends, then the list reloads without a manual refresh.
15. Given an account with no runs, when I open each tab, then each shows its empty state with the stated action.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E02-S05-BE1 | Topic detail and update | `GET /research/topics/{id}/` with embedded signals (prefetch); `PATCH` using `services/topics.transition` and an `update_topic` service: transition table, read-only `used`, auto-shortlist on content edit, `signal_ids` replace with rescore in one transaction, title uniqueness, plan change. `details.allowed_statuses` on `invalid_transition`. `docs/openapi.yaml` update. API tests for every error row and rules 3–8. | 0.5 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E02-S05-FE1 | Topics table | `src/pages/research/TopicsTab.tsx`: `ProTable` with columns, default filters bound to the header plan, evidence cell with breakdown tooltip, status actions with optimistic update and Undo, empty states. | 0.75 d |
| E02-S05-FE2 | Topic drawer and edit | `TopicDrawer.tsx`: read view (summary, hooks with copy, details, evidence bars, signal list), edit form with limits and `dir="auto"`, "Save and shortlist" label, unsaved-changes guard, `AttachSignalsModal.tsx` with search and 20-item cap. | 0.75 d |
| E02-S05-FE3 | Add topic | `TopicFormModal.tsx` reusing the edit form fields plus Plan; opens the drawer after create; server field errors mapped to fields. | 0.25 d |
| E02-S05-FE4 | Signals tab | `SignalsTab.tsx`: table, filters (kind, source, run, unassigned, date range, search), metrics formatting, topics count with tooltip; `SignalFormModal.tsx` with the duplicate-link flow. | 0.5 d |
| E02-S05-FE5 | Runs tab | `RunsTab.tsx`: history table, inline `JobProgress` for a running run, expandable per-source results, failure alert texts, duration formatting. | 0.5 d |
| E02-S05-FE6 | Labels, states and tests | Add topic, run and source-result entries to `StatusTag`; running-research alert; archived and no-account states; typed service calls in `src/services/socialhub/research.ts`; component tests for status actions with Undo, auto-shortlist label, duplicate-signal flow, right-to-left rendering of Persian text. | 0.25 d |

### Test

None. Tests are part of each subtask.

## Test notes

- API: transition matrix as a table-driven test (every from/to pair); content edit on `new` sets `shortlisted`, on `shortlisted` leaves it, on `dismissed` leaves it; `signal_ids` change triggers a rescore and an unchanged list does not; read-only fields ignored.
- Panel: mock the API from the examples in E02-S02, E02-S04 and this story. Check default filters follow the header plan; Undo sends the reverse `PATCH`; the drawer reloads after attach; the Runs tab polls only while a run is active.
- Accessibility: every row action is reachable by keyboard; the evidence tooltip content is also in the drawer, so nothing is hover-only; copy buttons have accessible names.
- Fixtures: one account with a completed run (six topics across all four statuses, 23 signals of all three kinds, including a manual signal that links an Instagram reel and carries metrics), one failed run and one run with a failed source.

## Later

- Bulk shortlist and dismiss with row selection.
- Merge topics: one `POST /research/topics/{id}/merge/` that unions signals and keeps one title.
- A "Send to selection" shortcut that starts ranking (E03-S02) from this page.
- Signal detail page with the stored `raw` payload for admins.
- Delete for signals collected by mistake, with a rescore of affected topics.
