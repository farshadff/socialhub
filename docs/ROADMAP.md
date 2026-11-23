# Social Hub MVP roadmap — Instagram workflow

Prepared 2026-11-22, revised 2026-11-22 to split delivery into two phases. Source of scope: `Social_Hub_Instagram_Workflow (2).pdf` (the one-page "Instagram automation" workflow). The MVP delivers that workflow: ten steps, two feedback loops and three quality-check outcomes. Anything the page does not show is out of scope unless the workflow cannot run without it.

All estimates in this document are planning estimates in ideal working days. The team that will build it has not checked them.

## 0. Phases

The MVP is built in two phases. **Phase 1 is the plan to build now.**

| Phase | Focus | Instagram |
| --- | --- | --- |
| **Phase 1 — Content engine** (this plan) | The AI agents and the operator panel: weekly plan, research, feed reading and analysis, selection, briefs, scripts, asset and copy production, quality checks, scheduling on a calendar, manual metric entry, evaluation and both feedback loops | **No Instagram API.** No Meta app, no OAuth, no tokens, no automated posting, no API metrics. At the scheduled time the operator gets a posting pack (final asset and caption), posts it in the Instagram app, and pastes the post link. Metrics and follower counts are typed in from the Instagram app at fixed checkpoints |
| **Phase 2 — Instagram API** (next) | Connect accounts through Meta's official Instagram API, publish automatically with verify-before-retry, collect metrics and follower counts automatically | Everything in [INSTAGRAM-INTEGRATION.md](INSTAGRAM-INTEGRATION.md). Phase 1's manual route stays as the fallback |

Phase 2 specifications are kept, complete, in the same files and marked **Phase 2** at the top. They are not built in Phase 1, and Phase 1 code does not depend on them. Section 8 lists what Phase 2 contains and the seams Phase 1 leaves for it.

## 1. What Phase 1 delivers

One sentence: an operator sets a weekly plan for an Instagram account, the AI agents research trends, select and produce content and check it, the system schedules it across the week's slots, the operator posts each item by hand when it is due and types in the numbers, and the system evaluates the results and feeds the findings into the next week.

| # | Workflow step (from the PDF) | What Phase 1 does | Epic |
| --- | --- | --- | --- |
| 01 | Set the weekly plan — audience, goals, slots, success metrics | Operator creates one plan per account per week with audience, goals with numeric targets, posting slots and the success metrics that matter | [E01](epics/E01-weekly-plan/README.md) |
| 02 | Research public trends — find emerging hooks and topics, record sources and signals | A research run collects signals from web search, RSS feeds and manual entries (including Instagram posts the operator found by hand), stores every source, and groups them into trend topics with hook ideas | [E02](epics/E02-trend-research/README.md) |
| 03 | Select content — rank suggestions and feed items by research evidence and goal fit | Trend topics, company feed items and repurpose tasks become candidates, ranked by evidence and goal fit, then assigned to the week's slots | [E03](epics/E03-content-selection/README.md) |
| 04 | Choose formats — assign a role and brief to each Reel, Story, or feed post | Each selected item gets a format, a role in the week and a written brief | [E04](epics/E04-formats-and-briefs/README.md) |
| 05 | Script & storyboard — scenario, shot list, frame sequence, design notes | AI writes a script package per item; the operator can edit it in a storyboard editor | [E05](epics/E05-script-and-storyboard/README.md) |
| 06 | Produce assets & copy — create video, motion, or design; draft captions and hashtags | Templates render brand-consistent images and motion videos; footage can be assembled; AI drafts caption and hashtags | [E06](epics/E06-assets-and-copy/README.md) |
| 07 | Check the output — design, copy, facts, rights, format | Five checks run on every produced version and end in Pass, Revise or Escalate | [E07](epics/E07-quality-check/README.md) |
| 08 | Schedule & publish — sequence posts across slots, verify live posts before retrying | Passed items are scheduled automatically and shown on the calendar. When an item is due, the operator downloads the posting pack, posts it by hand and pastes the link. *Phase 2: a worker publishes through the API and verifies live posts before retrying* | [E08](epics/E08-schedule-and-publish/README.md) |
| 09 | Refresh analytics — reach, saves, shares; follower change by account | Each post asks for its numbers at the evaluation checkpoints (24 h and 7 d; 23 h for stories) and the operator types them in; follower counts are typed in at least once per plan week. *Phase 2: pulled from the API at every checkpoint and daily* | [E09](epics/E09-analytics-refresh/README.md) |
| 10 | Evaluate performance — compare with the goal and similar posts at the same age | Each post gets a verdict against its goal and a same-age baseline; a weekly report summarises findings | [E10](epics/E10-evaluate-and-feedback/README.md) |
| Loop | Weekly findings → 01 Weekly plan | Accepted findings pre-fill next week's plan | E10 |
| Loop | Outperforming posts → 03 Selection via a repurpose task | Outperformers create repurpose tasks that enter the next ranking as candidates | E10 |
| Outcomes | Pass / Revise / Escalate | Pass schedules automatically; Revise returns to production and rechecks; Escalate opens a human review task | E07 |

Two supporting epics exist only because the workflow cannot run without them: [E00 Foundation](epics/E00-foundation/README.md) (sign-in, accounts and brand, AI gateway, jobs and media storage) and [E11 Release](epics/E11-release/README.md) (overview page, deployment, end-to-end acceptance).

## 2. Scope rules

### In Phase 1

- One internal team, two roles (admin, operator), several Instagram accounts. An account is a handle, a timezone, a content language, a brand profile and posting rules; it has no connection to Instagram.
- Formats: Reel, Story (image or video), single-image feed post.
- Production modes: `design` (rendered image), `motion` (rendered frames animated into video), `video` (uploaded footage assembled), plus manual upload of a finished asset as an escape hatch.
- AI through two providers: Claude (reasoning, writing, checking, vision) and OpenAI (image generation). Keys come from environment variables.
- Reading and analysing feeds: web search, RSS research sources and company feeds (JSON or RSS). An Instagram post the operator finds can be added by hand as a research signal with its link.
- Scheduling: automatic times from the slots and posting rules, a week calendar, reschedule and cancel.
- Posting by hand: every publication has `delivery = manual`. The panel gives the final asset and the full caption, and "Mark as published" takes the post link.
- Metrics by hand: metric entry at the evaluation checkpoints and follower entry per day, with reminders on the overview.
- English, left-to-right operator panel built on Umi Max 4, Ant Design 6 and Pro Components (`frontend/`). Content language is set per account (default Persian), and rendering is right-to-left safe.

### Moved to Phase 2 (Instagram API)

| Moved | Phase 1 instead | Seam kept |
| --- | --- | --- |
| Meta app, Instagram Login OAuth, tokens, the provider layer (E00-S04) | No connection. Accounts are created in the panel | `InstagramAccount` has everything a connection hangs off; `AccountConnection` is added in Phase 2 |
| Publish worker and container flow (E08-S03) | Operator posts by hand from the posting pack (E08-S05) | `Publication.delivery` (`manual` now, `provider` in Phase 2); the scheduler, calendar and pipeline statuses do not change |
| Verify before retry, publish failures and retries (E08-S04) | A person posting cannot create a duplicate; nothing to verify | Statuses `publishing`, `verifying`, `failed` and `PublishAttempt` are reserved |
| Automatic metric collection at every checkpoint (E09-S01) | Metrics entered at the evaluation checkpoints (E09-S04, E09-S03) | `MetricSnapshot.source` (`manual` now, `provider` in Phase 2); evaluation reads snapshots regardless of source |
| Daily follower collection (E09-S02) | Follower count entered by hand (E09-S03), prompted once per plan week (E09-S04) | `AccountSnapshot.source` |
| "Refresh metrics now" (part of E09-S03) | Not offered | Endpoint reserved |
| Public Instagram trend signals (E02-S03) | Manual signals with an Instagram link | A Facebook Login adapter (`graph_api_fb`); E02-S03 keeps the design (INSTAGRAM-INTEGRATION.md section 8) |
| `publishing_enabled` stop switch | Not shown; nothing is sent | Field stays on `InstagramAccount`, default false |

### Deliberately out of the MVP (both phases)

Each of these is a later extension. The architecture leaves a seam for it; no code is written for it now.

| Left out | Seam that keeps it cheap to add later |
| --- | --- |
| Carousels, feed videos, story stickers/polls | `format` and `media_kind` enums plus the format registry (E04-S01) |
| Other platforms (YouTube, LinkedIn, X) | `InstagramAccount` becomes one kind of channel; provider interface is per platform |
| Multi-tenant workspaces, billing, fine-grained permissions | Every record hangs off an account; a `workspace` foreign key can be added on the account |
| Spend caps, per-role model routing UI, prompt management UI | The AI gateway already logs cost and reads models and prompts from configuration |
| Comment/DM inbox, ads, influencer tools | Not part of the workflow |
| Automated A/B tests | Weekly findings are recommendations a person accepts |
| Jalali calendar display, Persian panel UI | Locale files exist in the scaffold; dates are stored in UTC with account timezone |
| Notifications by email or chat | In-panel attention list only (E11-S01) |
| AI-generated video clips and voiceover | New asset origins and one more production step behind the same orchestration |
| Full audit log | `ContentEvent` records each item's history; a general audit table can be added |

### Priorities inside Phase 1

Every Phase 1 story is tagged **Must** or **Should**. Must stories form the working product. Should stories improve automation and can slip to a fast follow without breaking the flow:

- E06-S04 Footage-based video assembly (reels still ship through motion mode or a manually uploaded final video).
- E06-S05 AI image generation (designs still render with uploaded or library images and brand backgrounds).

Stories tagged **Phase 2** are specified but not built now.

## 3. Epics, stories and estimates

BE = backend days, FE = frontend days, QA = test days beyond the tests each task already includes. Epic totals count Phase 1 stories only.

| Story | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| **E00** | **Foundation** | | **8.5** | **8.5** | |
| E00-S01 | Sign in and keep a session | Must | 1.5 | 1.5 | |
| E00-S02 | Panel shell, navigation and design tokens | Must | 0 | 3 | |
| E00-S03 | Manage Instagram accounts and brand profile | Must | 2 | 2.5 | |
| E00-S04 | Connect an Instagram account (Meta app setup, OAuth, provider layer) | Phase 2 | (4) | (1.5) | |
| E00-S05 | AI gateway for Claude and OpenAI | Must | 3 | 0.5 | |
| E00-S06 | Background jobs, run tracking and media storage | Must | 2 | 1 | |
| **E01** | **Weekly plan** | | **4.5** | **5.5** | |
| E01-S01 | Create and edit the weekly plan | Must | 2 | 2.5 | |
| E01-S02 | Posting slots and slot template | Must | 1.5 | 2 | |
| E01-S03 | Activate, close and duplicate a plan | Must | 1 | 1 | |
| **E02** | **Trend research** | | **6.5** | **5** | |
| E02-S01 | Research sources watchlist | Must | 1 | 1.5 | |
| E02-S02 | Collect signals from web search, RSS and manual entry | Must | 3 | 0.5 | |
| E02-S03 | Collect public Instagram signals | Phase 2 | — | — | |
| E02-S04 | Synthesize signals into topics and hooks | Must | 2 | 0 | |
| E02-S05 | Research workspace | Must | 0.5 | 3 | |
| **E03** | **Content selection** | | **9** | **8.5** | |
| E03-S01 | Feed sources and feed items | Must | 2.5 | 2 | |
| E03-S02 | Build and rank candidates | Must | 3 | 0 | |
| E03-S03 | Select content into slots | Must | 2 | 3.5 | |
| E03-S04 | Content pipeline board and item workspace shell | Must | 1.5 | 3 | |
| **E04** | **Formats and briefs** | | **4** | **4** | |
| E04-S01 | Format specification registry | Must | 1 | 0.5 | |
| E04-S02 | Assign format and role | Must | 1 | 1.5 | |
| E04-S03 | Generate, edit and approve the brief | Must | 2 | 2 | |
| **E05** | **Script and storyboard** | | **4.5** | **5** | |
| E05-S01 | Generate the script package | Must | 2.5 | 0.5 | |
| E05-S02 | Storyboard editor and approval | Must | 1 | 3.5 | |
| E05-S03 | Regenerate with feedback and version history | Must | 1 | 1 | |
| **E06** | **Assets and copy** | | **17** | **10** | |
| E06-S01 | Asset library and rights metadata | Must | 2 | 2.5 | |
| E06-S02 | Design rendering with brand templates | Must | 4 | 0.5 | |
| E06-S03 | Motion video assembly | Must | 3.5 | 0 | |
| E06-S04 | Footage-based video assembly | Should | 2.5 | 1 | |
| E06-S05 | AI image generation | Should | 1.5 | 1 | |
| E06-S06 | Caption and hashtags | Must | 1.5 | 1 | |
| E06-S07 | Production orchestration and workspace | Must | 2 | 4 | |
| **E07** | **Quality check** | | **12.5** | **5** | |
| E07-S01 | Check run orchestration and outcome routing | Must | 2.5 | 0.5 | |
| E07-S02 | Format and rights checks | Must | 2 | 0 | |
| E07-S03 | Copy and facts checks | Must | 2.5 | 0 | |
| E07-S04 | Design check | Must | 2 | 0 | |
| E07-S05 | Automatic revise loop | Must | 2 | 0.5 | |
| E07-S06 | Check results and human review queue | Must | 1.5 | 4 | |
| **E08** | **Schedule and post** | | **5** | **5** | |
| E08-S01 | Automatic scheduling and sequencing | Must | 2 | 0 | |
| E08-S02 | Calendar and manual controls | Must | 1.5 | 3.5 | |
| E08-S03 | Publish worker for each format | Phase 2 | (3.5) | (0.5) | |
| E08-S04 | Verify before retry and publish failures | Phase 2 | (3) | (1.5) | |
| E08-S05 | Post by hand: posting pack and mark as published | Must | 1.5 | 1.5 | |
| **E09** | **Analytics refresh** | | **2** | **4** | |
| E09-S01 | Collect post metrics from Instagram at fixed ages | Phase 2 | (3) | (0) | |
| E09-S02 | Collect follower counts from Instagram daily | Phase 2 | (1) | (0) | |
| E09-S03 | Analytics views and manual entry | Must | 1 | 3.5 | |
| E09-S04 | Metric entry checkpoints and reminders | Must | 1 | 0.5 | |
| **E10** | **Evaluate and feed back** | | **8.5** | **6.5** | |
| E10-S01 | Evaluate posts against goal and same-age baseline | Must | 3 | 1.5 | |
| E10-S02 | Weekly findings report | Must | 2.5 | 2.5 | |
| E10-S03 | Apply findings to the next weekly plan | Must | 1.5 | 1.5 | |
| E10-S04 | Repurpose tasks for outperforming posts | Must | 1.5 | 1 | |
| **E11** | **Release** | | **5** | **4** | **3** |
| E11-S01 | Overview page and attention list | Must | 1.5 | 2.5 | |
| E11-S02 | Production deployment and operations basics | Must | 2.5 | 0.5 | |
| E11-S03 | End-to-end acceptance and pilot dry run | Must | 1 | 1 | 3 |
| | **Phase 1 total** | | **87** | **71** | **3** |

Figures in brackets are the Phase 2 stories' existing estimates; they are not in the Phase 1 total. Dropping the two Should stories removes 4 BE and 2 FE days.

Compared with the single-phase plan (100.5 BE, 73.5 FE, 4 QA), Phase 1 removes E00-S04, E08-S03, E08-S04, E09-S01 and E09-S02, takes the API parts out of E08-S01, E08-S02, E09-S03 and E11, and adds two small stories for the manual route: E08-S05 (the posting pack and "Mark as published", taken out of E08-S04) and E09-S04 (checkpoints that ask a person for numbers).

## 4. Delivery plan (Phase 1)

About 161 ideal days of work. With two backend developers, one frontend developer and one full-stack developer who leans frontend, that is roughly nine calendar weeks. A smaller team takes proportionally longer; the release order stays the same.

| Release | Weeks | Epics | You can demo |
| --- | --- | --- | --- |
| R0 Foundation | 1–2 | E00 | Sign in, add an account with its brand profile, run a test AI call, watch a background job finish |
| R1 Plan & select | 3–4 | E01, E02, E03, E04 | Set a weekly plan, run research, rank candidates, fill the week's slots, get a brief for every item |
| R2 Create & schedule | 5–7 | E05, E06, E07, E08 | An item goes from brief to script, rendered asset and caption, through the five checks and onto the calendar; when it is due, the operator downloads the posting pack, posts it on a test account and marks it published |
| R3 Measure & reuse | 8–9 | E09, E10, E11 | The panel asks for metrics at each evaluation checkpoint, posts get verdicts, the weekly report feeds the next plan, an outperformer returns as a repurpose candidate |

### Ordering and dependencies

```text
E00 ─┬─ E01 ─┬─ E02 ─┐
     │       └─ E03 ◄┘ ── E04 ── E05 ── E06 ── E07 ── E08 ── E09 ── E10
     │                                                         └── E11
     └─ E00-S05 AI gateway gates every AI task from E02 on
```

- **No Meta gate.** Phase 1 has no external go/no-go item. The largest remaining risk is AI output quality and Persian rendering, so the walking skeleton through E05–E07 comes first in R2.
- **Walking skeleton first.** In each release, connect the steps end to end with the thinnest version of each story before deepening any one of them. In R2 that means one feed post rendered from one template, checked, scheduled and marked published by hand, before motion video or the revise loop is polished.
- **Frontend can start early.** The API index in [API.md](API.md) is the contract. Frontend builds against mocks from that contract while backend lands endpoints.
- **Parallel tracks in R2.** Rendering (E06-S02/S03) and the checks (E07-S02..S04) depend only on the data model, so they can be built side by side. Scheduling and the posting pack (E08-S01, E08-S05) depend only on the data model and can also start early.

### Definition of done for Phase 1

1. On a real test account, one week runs through all ten steps, with posting and metric entry done by hand in the panel, without a developer touching the database.
2. A check that returns Revise sends the item back to production and rechecks it; a check that returns Escalate creates a review task that an operator can resolve.
3. Every passed item lands on the calendar at a valid time without anyone choosing it; when it is due, the operator can download the asset, copy the caption, paste the post link and see the item as published.
4. Metrics typed in at an evaluation checkpoint produce a verdict for the post.
5. An accepted weekly report pre-fills the next plan, and an outperforming post appears as a repurpose candidate in the next ranking.
6. The deployment runbook in E11-S02 restores the system from a backup.

## 5. Automation levels

The PDF describes an automated flow where people see only escalations. Phase 1 automates every step except posting and reading the numbers off Instagram, and lets a team start cautiously. Three per-account switches (`autopilot`) decide whether a step waits for a person:

| Switch | Off (default at launch) | On |
| --- | --- | --- |
| `selection` | Operator confirms the proposed slot assignments | Top-ranked proposal is confirmed automatically |
| `brief` | Operator approves each brief | Brief is approved when generated |
| `script` | Operator approves each script | Script is approved when generated |

Quality-check outcomes are always automatic, exactly as the PDF states. In Phase 2, `publishing_enabled` on the account becomes the stop switch for automated sending; in Phase 1 nothing is sent, so the switch is not shown.

## 6. Risks (Phase 1)

| Risk | Effect | Response |
| --- | --- | --- |
| Operators miss a due post or forget to paste the link | Slots go unposted; the item never reaches analytics | "Post by hand — due" and "overdue" entries on the overview attention list and the calendar; the posting pack is available from the moment the item is scheduled |
| Operators skip metric entry | Evaluations return `insufficient_data`; weekly report has gaps | Only the evaluation checkpoints are required (two per post, one per story); "Metrics to enter" on the overview; the weekly report names posts without numbers |
| Story numbers are read too late | Instagram shows story insights in the app for a limited time after the story ends | Story checkpoint is 23 h, flagged on the overview the moment it is due |
| Rendered Persian text looks wrong | Assets fail the design check or look unprofessional | Text is rendered by the browser from templates with bundled fonts, never drawn by an image model; a fixed set of right-to-left samples is part of the template tests |
| AI output quality varies | More revise loops and escalations | Structured outputs with schemas; revise loop capped at two; every prompt is versioned so changes can be compared |
| Instagram's media limits differ from what the format registry assumes | A posted file is rejected or cropped by the Instagram app | Limits come from Instagram's published specifications; the pilot posts one of each format by hand in R2 and adjusts the registry (E04-S01) |
| Frontend volume is the bottleneck | R1 and R2 slip | Reuse the Umi route structure, typed Social Hub API services and shared Pro Components; one item workspace shell with tabs; no custom design work beyond the tokens in [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) |
| Phase 1 code makes Phase 2 harder | Rework when the API arrives | Phase 2 adds a delivery route and a metrics source; it changes no Phase 1 table, status or endpoint. The seams are listed in section 2 and section 8 |

## 7. Decisions needed from the product owner

None of these block starting E00. Each has a default that the specs already use.

| Decision | Default used in the specs | Needed by |
| --- | --- | --- |
| Which Instagram account is the pilot, and a test account for R2 demos | Not set | R2 |
| Hosting | One Linux VM with Docker Compose, S3-compatible bucket for media | E11-S02 |
| First day of the week | Saturday, per account | E01 |
| Content language of the pilot account | Persian (`fa`) | E00-S03 |
| Brand inputs: logo files, colours, fonts, tone of voice | Entered in the brand profile | E06 |
| Company feed endpoint and format | RSS or a JSON endpoint | E03-S01 |
| Thresholds: outperforming at 1.5× baseline, underperforming at 0.6×, two revise loops | As stated | E07, E10 |
| When a due post counts as overdue | 2 hours after its time | E08-S05 |
| Panel error messages: the API currently returns Persian messages while the panel is English | Panel shows its own English text keyed by error `code` | E00-S02 |
| When Phase 2 starts, and whether the company can hold a Meta developer account and app | After the Phase 1 pilot sign-off | Phase 2 |

## 8. Phase 2 — Instagram API

Phase 2 connects Social Hub to Meta's official Instagram API with Instagram Login. Its full design is in [INSTAGRAM-INTEGRATION.md](INSTAGRAM-INTEGRATION.md); its stories are already specified.

| Story | What it adds | Est. (BE · FE) |
| --- | --- | --- |
| [E00-S04](epics/E00-foundation/S04-instagram-connection.md) | Meta app setup spike (eligibility, app, tester roles), provider layer (`graph_api`, `manual`, `fake`), OAuth connect, encrypted tokens with refresh, Connection tab | 4 · 1.5 |
| [E08-S03](epics/E08-schedule-and-publish/S03-publish-worker.md) | Dispatcher and publish worker with Meta's container flow, send-time gates, `publishing_enabled` stop switch | 3.5 · 0.5 |
| [E08-S04](epics/E08-schedule-and-publish/S04-verify-retry-and-fallback.md) | Verify before retry, publish failures, retry, automatic switch to manual delivery | 3 · 1.5 |
| [E09-S01](epics/E09-analytics-refresh/S01-post-metric-snapshots.md) | Metric collector at every checkpoint (1 h … 7 d) through the insights API | 3 · 0 |
| [E09-S02](epics/E09-analytics-refresh/S02-follower-tracking.md) | Daily follower snapshot through the API | 1 · 0 |
| E08-S01, E08-S02, E09-S03, E11 additions | Connection and capability gates in scheduling; "Publish now" and "Retry" on the calendar; "Refresh metrics"; Meta settings, public bucket and egress in deployment; API failure scenarios in acceptance | about 1.5 · 1 · QA 1 |
| [E02-S03](epics/E02-trend-research/S03-instagram-public-signals.md) | Public hashtag and account signals; needs the Facebook Login adapter `graph_api_fb` | Not estimated |

Phase 2 starts with E00-S04's setup spike. If the company cannot use Meta's platform, Phase 1's manual route remains the product and nothing else changes.

What Phase 1 leaves ready for Phase 2:

- `Publication.delivery` already exists; Phase 1 writes only `manual`. Phase 2 adds `provider` and the worker that claims those rows.
- `MetricSnapshot.source` and `AccountSnapshot.source` already exist; Phase 1 writes only `manual`. Phase 2 adds `provider` rows at the same checkpoints, so evaluations, reports and baselines need no change.
- `Publication.status` keeps `publishing`, `verifying` and `failed` as reserved values, and the item pipeline keeps the matching transitions, so adding the worker does not change the state machine.
- The checkpoint pointer on a publication (`next_metrics_checkpoint`, `next_metrics_at`) is the same field the Phase 2 collector advances.
- Final images are exported as JPEG and videos as H.264/AAC MP4 with the `moov` atom first, which is what both the Instagram app and the API accept.
