# E03 — Content selection

## Goal

Workflow step 03: "Select content — rank suggestions and feed items by research evidence and goal fit."

Everything that could become a post this week is turned into a candidate: trend topics from research, items from the company feed, and repurpose tasks from outperforming posts. Candidates are scored on evidence, goal fit and freshness, ranked, and matched to the plan's open slots. Confirming the match creates the content items that move through steps 04 to 08. This epic also builds the place where those items are followed: the pipeline list, the board and the item workspace shell.

## Scope

**In the MVP**

- Feed sources of kind `rss`, `json_api` and `manual`; hourly sync; feed items an operator can mark eligible or ignored.
- Candidate building from `TrendTopic`, `FeedItem` and `RepurposeTask`.
- Scoring in code (evidence, freshness, weighted total, rank) with one AI call per batch for goal fit and duplicate detection.
- A proposal that matches ranked candidates to open slots by format and role; operator edits and confirms, or `autopilot.selection` confirms.
- `ContentItem`, `ContentEvent` and the pipeline service that every later epic uses to change an item's status.
- Panel: `/selection` (tabs Candidates, Proposal, Feed items, Feed sources), `/content` (list and board), `/content/:id` (workspace shell and History tab).

**Left for later**

- Paginated or authenticated-by-OAuth feed APIs, webhooks, field transforms.
- Embedding-based duplicate detection and topic clustering across weeks.
- Learning the weights from performance data.
- Drag and drop on the board and on the proposal; slot swaps between two items in one action.
- Bulk operations on content items other than batch brief generation (E04-S03).

## Stories

| ID | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E03-S01](S01-feed-sources-and-items.md) | Feed sources and feed items | Must | 2.5 | 2 | |
| [E03-S02](S02-rank-candidates.md) | Build and rank candidates | Must | 3 | 0 | |
| [E03-S03](S03-select-into-slots.md) | Select content into slots | Must | 2 | 3.5 | |
| [E03-S04](S04-pipeline-board-and-workspace.md) | Content pipeline board and item workspace shell | Must | 1.5 | 3 | |
| | **Total** | | **9** | **8.5** | |

## Flow

1. An admin or operator adds feed sources. The hourly sync, or "Sync now", stores new feed items. Recent items become `eligible` automatically; the operator can ignore any of them (S01).
2. Research (E02) leaves trend topics with status `new` or `shortlisted`. Evaluation (E10-S04) leaves repurpose tasks with status `open`.
3. The operator presses "Rank candidates" for the plan. A job builds one candidate per topic, eligible feed item and repurpose task, scores them, flags duplicates and writes ranks (S02).
4. The same job builds the proposal: each ranked candidate is matched to the best open slot (S03).
5. The operator reviews the Candidates and Proposal tabs, changes assignments if needed and confirms. With `autopilot.selection` on, the job confirms the proposal itself (S03).
6. Confirming creates one `ContentItem` per assignment with status `selected`, reserves the slot and marks the source as used. The pipeline service then calls `advance`, which starts brief generation (E04-S03) (S03, S04).
7. Items appear on `/content`. Each opens in the workspace at `/content/:id`, where later epics fill the Brief, Script, Production, Checks, Publishing and Performance tabs (S04).

```text
TrendTopic (new, shortlisted) ─┐
FeedItem (eligible) ───────────┼─► Candidate ─► scored and ranked ─► proposal ─► confirm ─► ContentItem (selected)
RepurposeTask (open) ──────────┘                                         ▲
                                                           PlanSlot (open) ┘
```

Build order inside the epic: S04's backend (models and pipeline service) comes before S03's confirm, because confirm creates content items. S01 and S02 are independent of S04.

## Owns

| Kind | Items |
| --- | --- |
| Tables | `FeedSource`, `FeedItem`, `Candidate` (app `selection`); `ContentItem`, `ContentEvent` (app `content`); `IdempotencyKey` (app `core`, introduced in S03) |
| Endpoints | `/feeds/sources/`, `/feeds/sources/{id}/sync/`, `/feeds/items/`, `/selection/rank/`, `/candidates/`, `/selection/proposal/`, `/selection/confirm/`, `/content-items/` (list, detail, cancel, events) |
| Services | `selection.services.feeds`, `selection.services.candidates`, `selection.services.scoring`, `selection.services.proposal`, `selection.services.confirm`, `content.services.pipeline` |
| Panel pages | `/selection`, `/content`, `/content/:id` (shell and History tab) |
| Background tasks | `feeds.sync_active_sources` (hourly), `feeds.sync_source`, `selection.rank` |
| AI tasks | `selection.score_goal_fit` |
| Job kinds | `feeds.sync`, `selection.rank` |

## Depends on / needed by

| Depends on | For |
| --- | --- |
| E00-S02 | Panel shell, account switcher, `StatusTag`, `ContentText`, `DateTime` |
| E00-S03 | `InstagramAccount`, `BrandProfile`, `autopilot` |
| E00-S05 | AI gateway for `selection.score_goal_fit` |
| E00-S06 | `JobRun`, `JobButton`, `JobProgress` |
| E01-S01, E01-S02 | `WeeklyPlan`, `PlanGoal`, `PlanSlot` |
| E02-S04 | `TrendTopic` with evidence scores and signals |
| E04-S01 | Default media kind and production mode for a format (used by confirm) |

| Needed by | For |
| --- | --- |
| E04, E05, E06, E07, E08 | `ContentItem`, the pipeline service, the workspace shell and its tabs |
| E10-S04 | Repurpose tasks enter ranking as candidates of kind `repurpose` |
| E11-S01 | Counts by status for the overview |

## Done when

1. With a plan that has open slots, two shortlisted topics, three eligible feed items and one open repurpose task, "Rank candidates" produces six ranked candidates with scores, rationale and a proposal.
2. Confirming the proposal creates content items with status `selected`, reserves their slots and marks their sources `used`; repeating the same request with the same idempotency key creates nothing new.
3. A candidate that repeats content from the last 30 days is flagged and left out of the proposal.
4. With `autopilot.selection` on, ranking an active plan confirms the proposal without a person.
5. `/content` shows the items in list and board form, and `/content/:id` shows status, history and working cancel.

## Later

- New feed kinds are a new `FeedReader` class and a `FeedSource.kind` value.
- New candidate kinds are a new builder function and a `Candidate.kind` value; scoring and proposal do not change.
- The weights, half-lives, minimum score and duplicate penalty are settings, so they can be tuned or replaced by a learned model without schema changes.
- The pipeline's handler registry lets a new step be inserted by registering a handler for a status.
