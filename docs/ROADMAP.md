# Social Hub MVP roadmap — Instagram workflow

Prepared 2026-11-22. Source of scope: `Social_Hub_Instagram_Workflow (2).pdf` (the one-page "Instagram automation" workflow). This roadmap delivers exactly that workflow as an MVP: ten steps, two feedback loops and three quality-check outcomes. Anything the page does not show is out of scope unless the workflow cannot run without it.

All estimates in this document are planning estimates in ideal working days. They have not been validated by the team that will build it.

## 1. What the MVP delivers

One sentence: an operator sets a weekly plan for an Instagram account, the system researches trends, selects and produces content, checks it, publishes it across the week's slots, measures results, and feeds the findings into the next week.

| # | Workflow step (from the PDF) | What the MVP does | Epic |
| --- | --- | --- | --- |
| 01 | Set the weekly plan — audience, goals, slots, success metrics | Operator creates one plan per account per week with audience, goals with numeric targets, posting slots and the success metrics that matter | [E01](epics/E01-weekly-plan/README.md) |
| 02 | Research public trends — find emerging hooks and topics, record sources and signals | A research run collects signals from web search, RSS feeds and manual entries, stores every source, and groups them into trend topics with hook ideas | [E02](epics/E02-trend-research/README.md) |
| 03 | Select content — rank suggestions and feed items by research evidence and goal fit | Trend topics, company feed items and repurpose tasks become candidates, ranked by evidence and goal fit, then assigned to the week's slots | [E03](epics/E03-content-selection/README.md) |
| 04 | Choose formats — assign a role and brief to each Reel, Story, or feed post | Each selected item gets a format, a role in the week and a written brief | [E04](epics/E04-formats-and-briefs/README.md) |
| 05 | Script & storyboard — scenario, shot list, frame sequence, design notes | AI writes a script package per item; the operator can edit it in a storyboard editor | [E05](epics/E05-script-and-storyboard/README.md) |
| 06 | Produce assets & copy — create video, motion, or design; draft captions and hashtags | Templates render brand-consistent images and motion videos; footage can be assembled; AI drafts caption and hashtags | [E06](epics/E06-assets-and-copy/README.md) |
| 07 | Check the output — design, copy, facts, rights, format | Five checks run on every produced version and end in Pass, Revise or Escalate | [E07](epics/E07-quality-check/README.md) |
| 08 | Schedule & publish — sequence posts across slots, verify live posts before retrying | Passed items are scheduled automatically, published by a worker, and verified on Instagram before any retry | [E08](epics/E08-schedule-and-publish/README.md) |
| 09 | Refresh analytics — reach, saves, shares; follower change by account | Metrics are pulled at fixed post ages; followers are recorded daily per account | [E09](epics/E09-analytics-refresh/README.md) |
| 10 | Evaluate performance — compare with the goal and similar posts at the same age | Each post gets a verdict against its goal and a same-age baseline; a weekly report summarises findings | [E10](epics/E10-evaluate-and-feedback/README.md) |
| Loop | Weekly findings → 01 Weekly plan | Accepted findings pre-fill next week's plan | E10 |
| Loop | Outperforming posts → 03 Selection via a repurpose task | Outperformers create repurpose tasks that enter the next ranking as candidates | E10 |
| Outcomes | Pass / Revise / Escalate | Pass schedules automatically; Revise returns to production and rechecks; Escalate opens a human review task | E07 |

Two supporting epics exist only because the workflow cannot run without them: [E00 Foundation](epics/E00-foundation/README.md) (sign-in, accounts, Instagram connection, AI gateway, jobs) and [E11 Release](epics/E11-release/README.md) (overview page, deployment, end-to-end acceptance).

## 2. Scope rules

### In the MVP

- One internal team, two roles (admin, operator), several Instagram accounts.
- Formats: Reel, Story (image or video), single-image feed post.
- Production modes: `design` (rendered image), `motion` (rendered frames animated into video), `video` (uploaded footage assembled), plus manual upload of a finished asset as an escape hatch.
- AI through two providers: Claude (reasoning, writing, checking, vision) and OpenAI (image generation). Keys come from environment variables.
- Instagram through Meta's official Instagram API with Instagram Login (OAuth connect per account), behind an adapter with a manual fallback. See [INSTAGRAM-INTEGRATION.md](INSTAGRAM-INTEGRATION.md).
- English, left-to-right operator panel on the existing Ant Design Pro scaffold. Content language is set per account (default Persian), and rendering is right-to-left safe.

### Deliberately out of the MVP

Each of these is a later extension. The architecture leaves a seam for it; no code is written for it now.

| Left out | Seam that keeps it cheap to add later |
| --- | --- |
| Carousels, feed videos, story stickers/polls | `format` and `media_kind` enums plus the format registry (E04-S01) |
| Public Instagram trend signals (hashtag search, other accounts' posts) | A Facebook Login adapter (`graph_api_fb`) behind the same provider interface; E02-S03 keeps the design (INSTAGRAM-INTEGRATION.md section 8) |
| Other platforms (YouTube, LinkedIn, X) | `InstagramAccount` becomes one kind of channel; provider interface is per platform |
| Multi-tenant workspaces, billing, fine-grained permissions | Every record hangs off an account; a `workspace` foreign key can be added on the account |
| Spend caps, per-role model routing UI, prompt management UI | The AI gateway already logs cost and reads models and prompts from configuration |
| Comment/DM inbox, ads, influencer tools | Not part of the workflow |
| Automated A/B tests | Weekly findings are recommendations a person accepts |
| Jalali calendar display, Persian panel UI | Locale files exist in the scaffold; dates are stored in UTC with account timezone |
| Notifications by email or chat | In-panel attention list only (E11-S01) |
| AI-generated video clips and voiceover | New asset origins and one more production step behind the same orchestration |
| Full audit log | `ContentEvent` records each item's history; a general audit table can be added |

### Priorities inside the MVP

Every story is tagged **Must** or **Should**. Must stories form the working product. Should stories improve automation and can slip to a fast follow without breaking the flow:

- E06-S04 Footage-based video assembly (reels still ship through motion mode or a manually uploaded final video).
- E06-S05 AI image generation (designs still render with uploaded or library images and brand backgrounds).

## 3. Epics, stories and estimates

BE = backend days, FE = frontend days, QA = test days beyond the tests each task already includes.

| Story | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| **E00** | **Foundation** | | **12.5** | **10** | |
| E00-S01 | Sign in and keep a session | Must | 1.5 | 1.5 | |
| E00-S02 | Panel shell, navigation and design tokens | Must | 0 | 3 | |
| E00-S03 | Manage Instagram accounts and brand profile | Must | 2 | 2.5 | |
| E00-S04 | Connect an Instagram account (Meta app setup, OAuth, provider layer) | Must | 4 | 1.5 | |
| E00-S05 | AI gateway for Claude and OpenAI | Must | 3 | 0.5 | |
| E00-S06 | Background jobs, run tracking and media storage | Must | 2 | 1 | |
| **E01** | **Weekly plan** | | **4.5** | **5.5** | |
| E01-S01 | Create and edit the weekly plan | Must | 2 | 2.5 | |
| E01-S02 | Posting slots and slot template | Must | 1.5 | 2 | |
| E01-S03 | Activate, close and duplicate a plan | Must | 1 | 1 | |
| **E02** | **Trend research** | | **6.5** | **5** | |
| E02-S01 | Research sources watchlist | Must | 1 | 1.5 | |
| E02-S02 | Collect signals from web search, RSS and manual entry | Must | 3 | 0.5 | |
| E02-S03 | Collect public Instagram signals (moved out of the MVP) | Later | 0 | 0 | |
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
| **E08** | **Schedule and publish** | | **10.5** | **6** | |
| E08-S01 | Automatic scheduling and sequencing | Must | 2.5 | 0 | |
| E08-S02 | Calendar and manual controls | Must | 1.5 | 4 | |
| E08-S03 | Publish worker for each format | Must | 3.5 | 0.5 | |
| E08-S04 | Verify before retry, failures and manual fallback | Must | 3 | 1.5 | |
| **E09** | **Analytics refresh** | | **5.5** | **4** | |
| E09-S01 | Post metric snapshots at fixed ages | Must | 3 | 0 | |
| E09-S02 | Follower tracking per account | Must | 1 | 0 | |
| E09-S03 | Analytics views, manual refresh and manual entry | Must | 1.5 | 4 | |
| **E10** | **Evaluate and feed back** | | **8.5** | **6.5** | |
| E10-S01 | Evaluate posts against goal and same-age baseline | Must | 3 | 1.5 | |
| E10-S02 | Weekly findings report | Must | 2.5 | 2.5 | |
| E10-S03 | Apply findings to the next weekly plan | Must | 1.5 | 1.5 | |
| E10-S04 | Repurpose tasks for outperforming posts | Must | 1.5 | 1 | |
| **E11** | **Release** | | **5.5** | **4** | **4** |
| E11-S01 | Overview page and attention list | Must | 1.5 | 2.5 | |
| E11-S02 | Production deployment and operations basics | Must | 3 | 0.5 | |
| E11-S03 | End-to-end acceptance and pilot dry run | Must | 1 | 1 | 4 |
| | **Total** | | **100.5** | **73.5** | **4** |

Dropping the two Should stories removes 4 BE and 2 FE days. E02-S03 needs hashtag search, which the official API offers only with Facebook Login; it stays specified for later and is not counted.

## 4. Delivery plan

About 178 ideal days of work. With two backend developers, one frontend developer and one full-stack developer who leans frontend, that is roughly ten calendar weeks. A smaller team takes proportionally longer; the release order stays the same.

| Release | Weeks | Epics | You can demo |
| --- | --- | --- | --- |
| R0 Foundation | 1–2 | E00 | Sign in, add an account with its brand profile, connect it to Instagram, run a test AI call, watch a background job finish |
| R1 Plan & select | 3–4 | E01, E02, E03, E04 | Set a weekly plan, run research, rank candidates, fill the week's slots, get a brief for every item |
| R2 Create & publish | 5–8 | E05, E06, E07, E08 | An item goes from brief to script, rendered asset and caption, through the five checks, onto the calendar and live on a test Instagram account |
| R3 Measure & reuse | 9–10 | E09, E10, E11 | Metrics arrive at each post age, posts get verdicts, the weekly report feeds the next plan, an outperformer returns as a repurpose candidate |

### Ordering and dependencies

```text
E00 ─┬─ E01 ─┬─ E02 ─┐
     │       └─ E03 ◄┘ ── E04 ── E05 ── E06 ── E07 ── E08 ── E09 ── E10
     │                                                         └── E11
     └─ E00-S04 Meta app setup spike gates E08-S03, E09-S01
```

- **Week 1 gate — E00-S04 spike.** Confirm the company can hold a Meta developer account and app, set the app up with Instagram Login, give the pilot account a tester role, then connect it and prove each format can be published from our media bucket and that insights and follower counts come back. If App Review turns out to be needed, start it the same week. If the company cannot use Meta's platform at all, the `manual` provider carries publishing and metrics while the rest of the product is built. This is the largest risk in the plan, so it runs first.
- **Walking skeleton first.** In each release, connect the steps end to end with the thinnest version of each story before deepening any one of them. In R2 that means one feed post rendered from one template, checked and published, before motion video or the revise loop is polished.
- **Frontend can start early.** The API index in [API.md](API.md) is the contract. Frontend builds against mocks from that contract while backend lands endpoints.
- **Parallel tracks in R2.** Rendering (E06-S02/S03) and the checks (E07-S02..S04) depend only on the data model, so they can be built side by side. The publish worker (E08-S03) depends only on E00-S04 and can also start early.

### Definition of done for the MVP

1. On a real test account, one week runs through all ten steps without a developer touching the database.
2. A check that returns Revise sends the item back to production and rechecks it; a check that returns Escalate creates a review task that an operator can resolve.
3. A simulated timeout during publishing does not create a duplicate post.
4. Metrics for a published post appear at each age checkpoint, and the post gets a verdict.
5. An accepted weekly report pre-fills the next plan, and an outperforming post appears as a repurpose candidate in the next ranking.
6. The deployment runbook in E11-S02 restores the system from a backup.

## 5. Automation levels

The PDF describes an automated flow where people see only escalations. The MVP supports that and also lets a team start cautiously. Three per-account switches (`autopilot`) decide whether a step waits for a person:

| Switch | Off (default at launch) | On |
| --- | --- | --- |
| `selection` | Operator confirms the proposed slot assignments | Top-ranked proposal is confirmed automatically |
| `brief` | Operator approves each brief | Brief is approved when generated |
| `script` | Operator approves each script | Script is approved when generated |

Quality-check outcomes are always automatic, exactly as the PDF states. `publishing_enabled` on the account is the stop switch: when it is off, nothing is sent to Instagram and due items wait.

## 6. Risks

| Risk | Effect | Response |
| --- | --- | --- |
| The company cannot register a Meta developer account or app (for example because of sanctions rules) | No automated publishing or metrics | First item of the week-1 spike; the `manual` provider keeps the weekly workflow running (operator posts and pastes the link, types metrics) |
| App Review or Business Verification is required | Publishing waits days to weeks | Use development mode with tester roles for company accounts; start review in week 1 if roles are not possible |
| Servers or admins cannot reach Instagram's API from where they are | Connect, publish and metrics fail | Host the backend where `graph.instagram.com` is reachable or set `SOCIALHUB_IG_HTTP_PROXY`; admins need browser access to instagram.com to connect an account |
| Meta cannot download our media | Containers fail | Public HTTPS bucket with signed URLs; the spike publishes from the planned bucket |
| API details differ from what this plan assumes (metric names, limits, quota) | Rework in E08 and E09 | Items marked "confirm in setup" in INSTAGRAM-INTEGRATION.md are checked in week 1; pinned API version; metric map in one module |
| Rendered Persian text looks wrong | Assets fail the design check or look unprofessional | Text is rendered by the browser from templates with bundled fonts, never drawn by an image model; a fixed set of right-to-left samples is part of the template tests |
| AI output quality varies | More revise loops and escalations | Structured outputs with schemas; revise loop capped at two; every prompt is versioned so changes can be compared |
| Metrics are not available for some formats or account types | Evaluation has gaps | Snapshots record which metrics were unavailable; evaluations return `insufficient_data` instead of guessing; manual entry exists |
| Frontend volume is the bottleneck | R1 and R2 slip | Reuse Pro Components tables and forms; one item workspace shell with tabs; no custom design work beyond the tokens in [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) |

## 7. Decisions needed from the product owner

None of these block starting E00. Each has a default that the specs already use.

| Decision | Default used in the specs | Needed by |
| --- | --- | --- |
| Meta developer account and Meta app owned by the company; who administers it | Not set | Week 1 |
| Which professional (Business or Creator) Instagram account is the pilot, and a test account for the spike; both get tester roles on the app | Not set | Week 1 |
| Hosting location that can reach Instagram's API, and a public HTTPS bucket for media | One VM outside any blocked network, S3-compatible bucket | Week 1 |
| First day of the week | Saturday, per account | E01 |
| Content language of the pilot account | Persian (`fa`) | E00-S03 |
| Brand inputs: logo files, colours, fonts, tone of voice | Entered in the brand profile | E06 |
| Company feed endpoint and format | RSS or a JSON endpoint | E03-S01 |
| Thresholds: outperforming at 1.5× baseline, underperforming at 0.6×, two revise loops | As stated | E07, E10 |
| Hosting | One Linux VM with Docker Compose | E11-S02 |
| Panel error messages: the API currently returns Persian messages while the panel is English | Panel shows its own English text keyed by error `code` | E00-S02 |
