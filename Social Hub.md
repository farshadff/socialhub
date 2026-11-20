# Social Hub Phase 1 PRD

## 1. Summary

Social Hub is an internal tool that runs Persian content production for company-managed Instagram accounts with as little human work as possible. It researches trends and company data, produces and checks content, publishes on schedule and measures results. People step in only for exceptions.

Phase 1 covers Instagram. Reels, Stories and feed posts come first, built mainly as video and infographics (animated charts and motion graphics). Three principles shape the design:

- **Automation first.** Agents and application services handle sourcing, production, checking, scheduling and publishing. Staff configure rules once and handle only the exceptions that automated recovery cannot resolve.
- **Data-driven, trend-based content.** Every item starts from researched company data or a scored industry trend, and every claim traces to a source.
- **Persian language quality.** Persian copy, captions and on-screen text pass dedicated language checks before anything is scheduled.

## 2. Delivery phases

| Phase | Priority | Functions |
| --- | --- | --- |
| 1. Instagram production and publishing | Reels, Stories and single-image feed posts, as video and infographics | Research trends and company data automatically. Produce original Persian Reels, video Stories, animated charts, infographics and motion-graphics explainers. Support image Stories and single-image feed posts. Add image, video or mixed carousels once the core formats are stable. Check, schedule and publish automatically. Track performance and turn findings into calendar tests. |
| 2. Long-form YouTube | Longer Persian videos and explainers | Research packs, chapter outlines and scene scripts. Assemble footage, graphics and Persian narration or subtitles. Produce thumbnails, descriptions and chapters. Check, upload and schedule automatically. Track retention. Turn approved segments into Instagram clips. |
| 3. Wider distribution | LinkedIn and X, then more efficient reuse | Adapt cleared content for other platforms. Add connectors, a searchable asset library, multi-account campaign planning and account-specific automation rules. |

## 3. Functional requirements

### 3.1 Platform and research

| ID | Feature | Requirement |
| --- | --- | --- |
| 01 | Back office and access | Admins and a small operations team sign in to the back office. Each account has a source mode, Persian tone, brand kit, permitted formats, posting limits and automation rules. Admins manage integrations. Staff can view drafts, the calendar, exceptions and reports, but routine operation needs no manual steps. |
| 02 | Company API sourcing | Select eligible items from configured company feeds. Retain the source ID or link. Define eligibility rules per feed, such as freshness, status and exclusion lists. |
| 03 | Trend research | Monitor approved industry sources, search and social signals, and relevant sector accounts on a continuous schedule. Cluster related items into topics. Score each topic for timeliness, relevance to the account, audience fit and strength of evidence. Retain supporting links. Rank topics for upcoming slots, avoid repeating covered topics, and leave a slot open if nothing suitable is found. |
| 04 | Data analysis | For each selected topic, extract figures, dates and claims from original sources and record the source of each. Calculate comparisons and changes in code, not in a model. Produce chart-ready datasets for infographics and animated charts. Flag and exclude conflicting or unsupported figures. |
| 05 | Model and agent settings | Admins assign an approved model and fallback to each agent role. Providers are configurable. Log model, version, cost and output per run. Retry failed stages without regenerating assets that passed checks. Enforce spend caps per draft, per account and per month. |
| 06 | Audit, notifications and kill switch | Keep an audit trail of every publish, hold, override and rule change. Notify admins only of holds, failures and budget alerts. Provide a global and a per-account pause. |

### 3.2 Production

| ID | Feature | Requirement |
| --- | --- | --- |
| 07 | Video, motion graphics and infographics | Create a Persian script, storyboard and shot list. Combine owned footage, template animation, source-driven charts and optional generated clips. Build infographics and animated charts directly from the datasets in 04. Support Persian captions and either approved voiceover or a caption-led edit. Re-render only the scenes a check flags. Provide previews and optional edits in the back office. Cap generated seconds per draft. |
| 08 | Instagram formats | Create or upload media for Reels, image and video Stories and single-image feed posts as the priority formats. Support image, video or mixed carousels after them. Generate editable Persian captions, overlays and cover copy. Preview crops. Flag unsupported publishing options. |
| 09 | Persian language quality | A Persian reviewer agent, separate from the writer, checks every item. Define and test: right-to-left layout, correct use of the zero-width non-joiner, a consistent numeral style (Persian or Latin digits, set per account), calendar handling (Gregorian or Jalali, set per account), formal or colloquial register, and a glossary of approved terms and brand names. A fixed Persian regression set must pass whenever a model or prompt changes. Native-speaker audits of a small sample run on a set schedule. |
| 10 | Disclosure and rights | Record the origin of each asset: owned, licensed or generated. Apply the platform's AI-content labelling where required. Block assets with missing or expired rights. |

### 3.3 Checking and publishing

| ID | Feature | Requirement |
| --- | --- | --- |
| 11 | Calendar and checks | Plan slots from account rules and pick eligible content automatically. Check source evidence, Persian language, brand fit, media quality, usage rights and platform constraints before scheduling. Each check returns pass, fail or uncertain, a score and a reason. Recheck changed content before publishing. Staff can pause, reschedule or cancel. |
| 12 | Scheduled publishing | Publish items that pass checks at their scheduled time, without per-post sign-off. Make publishing idempotent so a retry never creates a duplicate post. Respect platform publishing quotas. Store the platform ID and link. |
| 13 | Status and recovery | Show production, scheduled, published, held and failed states. Try a configured fallback or a targeted revision within retry and budget limits, up to a maximum number of correction loops per item. Verify uncertain sends before retrying. Hold unresolved items and surface the reason in the exception queue, with an export of the media and copy. |

### 3.4 Measurement and learning

| ID | Feature | Requirement |
| --- | --- | --- |
| 14 | Performance tracking | Capture available post and Story metrics by published ID: reach or impressions, engagement, clicks and video watch metrics. Label unavailable metrics and show the last sync time. Capture Story metrics on a schedule that fits the window in which the platform exposes them. Record the observation window for every figure. |
| 15 | Performance reports | Report weekly by account, date range, format, topic and posting time. Show publishing volume, top posts, comparable-period movement and sample size. Compare items over equivalent observation windows. |
| 16 | Actions from analytics | Feed performance findings back into trend scoring and planning. Recommend a concrete test of a hook, duration, topic, format or posting slot, showing the source posts, comparison, sample size and success metric. Schedule a test automatically only when it meets the minimum sample and observation window set for the account and stays within account limits. Staff can pause or dismiss tests. Leave the calendar unchanged when evidence is sparse. |

## 4. Workflow

1. Company feed items and monitored industry trends enter research.
2. The system scores topics, selects one and verifies its sources.
3. The data analysis step extracts figures and builds chart-ready datasets.
4. The planner chooses a format and calendar slot.
5. The writer and storyboard agents work from the same brief to produce the Persian script, captions, scenes and an asset plan.
6. The motion agent and renderer produce the video or infographic.
7. Reviewers check facts, Persian language and media.
8. If checks pass, the item is scheduled and published. If a fixable issue is found, only the affected scenes are regenerated, up to the correction limit. If the issue is unresolved, the item is held and appears in the exception queue.
9. Published items feed metrics collection, reports and trend scoring.
10. The analytics agent proposes tests. Tests that meet the evidence rules return to planning.

## 5. Agents and models

One function can use several agents, and one model can serve several roles. The scheduler, renderer, metric calculations and publishing connectors are application services, not agents.

| Agent | Responsibility | Model approach |
| --- | --- | --- |
| Source researcher | Reads configured feeds and approved sources and produces ranked candidates with links, relevance and freshness | Low-cost model for sorting and summaries, with feed or search connectors |
| Trend analyst | Clusters signals into topics, scores timeliness, relevance and audience fit, and avoids repeats | Low-cost model for clustering, with scoring done in code |
| Data analyst | Extracts figures from sources and prepares chart-ready datasets | Stronger model for extraction, with code doing all calculations |
| Evidence reviewer | Maps claims and numbers to original sources, flags conflicts | Stronger model for exceptions, with code comparing structured values and dates |
| Content planner | Combines brief, account rules and performance history into a format, angle and slot | Low-cost model, with a stronger one benchmarked on complex briefs |
| Persian writer | Hook, script, caption, subtitles and on-screen copy | Chosen by native Persian quality and cost per accepted draft |
| Persian reviewer | Checks grammar, register, glossary, numerals and right-to-left text | Chosen separately from the writer, benchmarked on the Persian regression set |
| Storyboard agent | Timed scenes, shots, graphics and reusable assets | Mid-tier model |
| Asset agent | Selects owned footage, prepares prompts or a missing-shot list | Low-cost model, with generated video benchmarked against alternatives |
| Motion and assembly agent | Scene specification with data, overlays, audio and transitions | Low-cost model producing structured output, rendered by templates |
| Audio and subtitle agent | Aligns subtitles to approved narration, checks pronunciation, prepares a caption-led variant | To be selected |
| Media reviewer | Checks right-to-left layout, subtitle timing, clipping, continuity and brand fit | Multimodal model plus automated media checks |
| Analytics agent | Explains calculated results, cites posts, proposes experiments | Low-cost model for summaries, stronger model for complex comparisons |

**Model selection.** Specific model names go stale quickly, so this PRD fixes roles and evaluation criteria, not vendors. Before build, run a benchmark on a Persian test set covering accuracy, naturalness, register, right-to-left rendering and cost per publishable asset, including render and regeneration costs. Pin model versions in production and re-run the benchmark when a version changes. Reuse approved footage and motion templates before buying generated clips.

## 6. Non-functional requirements

- **Security.** Store platform tokens and API keys in a secrets manager. Rotate them on a schedule. Restrict integration settings to admins.
- **Reliability.** Publishing must be idempotent. A failure in one account or format must not block others.
- **Observability.** Log every run with model, version, cost, latency and result. Alert on repeated failures, budget thresholds and sync gaps.
- **Data retention.** Keep drafts, check results, published records and metrics for a defined period.
- **Performance.** Set a target time from slot planning to a render-ready draft, so content is ready before its slot.
- **Language quality.** Maintain a fixed Persian regression set that every model or prompt change must pass.

## 7. Autonomy and rollout

Publishing runs without per-post sign-off, so it needs a short ramp-up and explicit controls.

1. **Shadow period.** For each new account, the system produces and checks content while staff publish manually, until check accuracy meets the configured thresholds.
2. **Autonomous mode.** An admin enables automatic publishing for the account. From then on, staff handle only exceptions.

Controls that apply in every mode:

- **Kill switch.** An admin can stop all publishing, or publishing for one account, immediately. Scheduled items move to held.
- **Sensitive-topic rule.** Account rules can list topics or keywords that are always held in the exception queue instead of published.
- **Confidence threshold.** Checks return a score and a reason. Items below the threshold are held, not published.
- **Audit trail.** Every publish, hold, override and rule change records who or what acted, when and why.
