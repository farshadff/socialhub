# E02 — Trend research

Workflow step 02: "Research public trends — find emerging hooks and topics, record sources and signals."

## Goal

Before a week is planned in detail, the system looks at what the account's audience is paying attention to right now. A research run reads a watchlist of sources, stores every finding as a signal with its original link, and groups the signals into trend topics with hook ideas and an evidence score. Those topics are the main input to content selection (E03).

## Scope

**In the MVP**

- A per-account watchlist of research sources: web search queries, RSS feeds, Instagram hashtags and Instagram accounts.
- A research run, started by hand from the panel, that collects signals from every active source and tolerates sources that fail.
- Signals collected from web search (Claude with the web search tool), RSS and manual entry. Public Instagram signals are a Should story.
- Deduplication of signals by a URL fingerprint.
- AI synthesis of signals into topics with summary, "why now", hooks, suggested formats and keywords, each linked to the signals that support it.
- An evidence score computed in code, with a visible breakdown.
- A research workspace in the panel: review topics, shortlist or dismiss them, inspect signals and sources, add a signal or topic by hand, see run history.

**Left for later**

- Scheduled (automatic) research runs. The run service is callable from Celery Beat; only the schedule is missing.
- Google Trends, YouTube, X, TikTok or paid trend APIs. Each is one more collector.
- Embedding-based clustering and cross-week topic tracking.
- Storing thumbnails, screenshots or page snapshots as evidence.
- Editing or deleting individual signals from the panel.
- Cancelling a run in progress.
- A "test this source" button.

## Stories

| Story | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E02-S01](S01-research-sources.md) | Research sources watchlist | Must | 1 | 1.5 | |
| [E02-S02](S02-collect-signals.md) | Collect signals from web search, RSS and manual entry | Must | 3 | 0.5 | |
| [E02-S03](S03-instagram-public-signals.md) | Collect public Instagram signals | Should | 2 | 0 | |
| [E02-S04](S04-synthesize-topics.md) | Synthesize signals into topics and hooks | Must | 2 | 0 | |
| [E02-S05](S05-research-workspace.md) | Research workspace | Must | 0.5 | 3 | |
| | **Total** | | **8.5** | **5** | |

## Flow

1. The operator opens **Research → Sources** and adds what to watch: a few search queries, industry feeds, and (if the research account is set up) hashtags and sector accounts. (S01)
2. The operator picks the plan the research is for and presses **Run research**. The API creates a `ResearchRun` and a job. (S02)
3. The run visits each active source in turn. Web search sources make two Claude calls (search, then extract). RSS sources are fetched and parsed. Instagram sources go through the research provider. Each finding becomes a `TrendSignal` unless its fingerprint already exists. A source that fails is recorded and skipped. (S02, S03)
4. When collection ends, the run sends the recent signals to Claude, which returns topics that reference signal IDs. Code validates the references, computes the evidence score and saves the topics. (S04)
5. The operator reviews topics in **Research → Topics**: reads the hooks, opens the supporting signals, shortlists the good ones and dismisses the rest. They can add a signal or a topic by hand at any time. (S05)
6. E03-S02 turns topics with status `new` or `shortlisted` into candidates and ranks them.

```text
ResearchSource ──► ResearchRun ──► TrendSignal ──► TrendTopic ──► (E03) Candidate
   watchlist        one per press    one per finding   AI groups,     ranked for
                    of the button    deduplicated      code scores    the week
```

## Owns

| Kind | Items |
| --- | --- |
| Django app | `apps/research` |
| Tables | `ResearchSource`, `ResearchRun`, `TrendSignal`, `TrendTopic`; `ResearchConnection` (S03, in `apps/instagram`) |
| Endpoints | `/research/sources/`, `/research/runs/`, `/research/signals/`, `/research/topics/` (see [API.md](../../API.md)) |
| Panel | `/research` with tabs Topics, Signals, Sources, Runs |
| Background tasks | `research.run` on the `default` queue; no periodic task |
| AI tasks | `research.web_search`, `research.extract_signals`, `research.synthesize_topics` |
| Providers | `InstagramResearchProvider` usage (S03); the interface itself is defined in E00-S04 |
| Shared helper | `apps/core/http.py` `safe_fetch` (S02), reusable by E03-S01 for feed reading |

## Depends on / needed by

| Depends on | Why |
| --- | --- |
| E00-S03 | Accounts and brand profile (pillars, tone, banned terms, content language) |
| E00-S04 | `InstagramResearchProvider` interface, error types, session encryption (S03 only) |
| E00-S05 | AI gateway `run_text` with web search and structured output |
| E00-S06 | `JobRun`, job polling, `JobButton` |
| E00-S02 | Panel shell, `StatusTag`, `ContentText`, `DateTime` |
| E01-S01 | `WeeklyPlan` objective and audience used as research context (a run can also work without a plan) |

| Needed by | Why |
| --- | --- |
| E03-S02 | Builds `trend` candidates from topics; reads `evidence_score`, `hooks`, `suggested_formats` and the topic's signals as `Candidate.sources` |
| E03-S03 | Sets a topic's status to `used` when its candidate is selected |
| E11-S01 | Overview shows when research last ran |

## Done when

On a test account with at least two web search sources and one RSS feed:

1. Pressing **Run research** finishes with signals from each working source, and a source with a broken URL shows an error without failing the run.
2. Running it again does not create duplicate signals.
3. Topics appear with hooks, each linked to at least one signal whose original URL opens.
4. Every topic shows an evidence score and its four components, and the score matches the formula in S04 when recomputed by hand.
5. Shortlisted and dismissed topics survive a second run; untouched AI topics are replaced.
6. The whole flow runs locally with the `fake` AI provider and no API keys.

## Later

- Add a Beat entry that starts a run for each account two days before its next week begins.
- Add collectors behind the same `Collector` protocol; each returns `SignalDraft` objects and nothing else changes.
- Replace the evidence formula in `research/services/evidence.py`; the stored breakdown keeps old scores explainable.
- Track a topic across weeks by matching keywords, so "rising for three weeks" can raise the score.
