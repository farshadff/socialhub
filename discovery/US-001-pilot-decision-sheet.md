# US-001 — Pilot scope and observable success criteria

**Status:** In progress; decision draft for product-owner review  
**Prepared:** 2026-11-19  
**Authority:** [Phase 1 PRD](../Social%20Hub.md), [roadmap proposed defaults](../MVP-ROADMAP.md#8-decisions-and-proposed-operating-defaults), and [US-001](../MVP-USER-STORIES.md#us-001)

This sheet separates PRD scope from roadmap recommendations. On 2026-11-19, the requester selected the recommended system for the operating defaults below. These are accepted as configurable pilot starting values, not as new PRD requirements. Items the recommendation explicitly leaves undecided remain open.

## Pilot boundary

| Decision | Current draft | State / owner |
| --- | --- | --- |
| Product phase | Phase 1, Instagram only. YouTube and wider distribution remain later phases. | PRD scope |
| Pilot accounts | Recommended starting range of 1–3 company-managed Instagram accounts selected. No account identity, final count, or accountable owner has been supplied. | Starting range accepted; PO + OPS to identify account(s) and owner |
| Source modes | `combined` selected for the pilot. In the roadmap proposal this combines the company feed with approved trend inputs. The company feed and trend sources are not yet identified or accessible. | Selected by requester; PO + INT to finalize sources after US-003 |
| Account timezone | `Asia/Tehran` selected for the pilot. | Selected by requester; apply to each account once identified |
| Accounting timezone | Not selected. The financial monthly budget window needs its own explicit timezone decision; it is not inferred from the account posting timezone. | Open; PO + OPS before paid runs |
| Calendar preference | Jalali or Gregorian display preference remains unspecified; timezone does not determine calendar display. | Open; PO to choose per account |
| Initial formats | Reels, image and video Stories, and single-image feed posts. Image, video, and mixed carousels are deferred until core formats are stable. No format override was supplied. | PRD scope; current proposal retained |
| Production approach | Persian infographic, animated chart, owned-footage/caption-led video, and short motion explainer; caption-led by default. Optional generated clips start disabled. | Templates from roadmap are proposed; PO + UX + INT to confirm |
| Brand inputs | Per-account brand kit, tone/register, glossary, numeral/calendar preferences, approved logo/colors/fonts, and asset origin/rights evidence are needed. Specific values/assets were not supplied. | PO/editorial owner to provide; FA to review Persian terms |
| Routine operation | Automated research, production, checks, scheduling, publishing, and measurement; staff handle exceptions. Per-post approval is not the target operating model. | PRD scope; rollout gates still apply |
| Rollout | Begin in shadow operation; publishing autonomy remains off until account-specific qualification and explicit admin enablement. | PRD rollout; no account is qualified yet |
| Hosting and secrets | Hosting provider and secrets-management choice are not stated. Do not put credentials in this repository. | Open; OPS to propose and PO to accept before hosted use |

## The 16 PRD requirements carried into Phase 1

| ID | Requirement | Boundary for this pilot |
| --- | --- | --- |
| 01 | Back office and access | Internal admin/operations access; accounts carry their own rules |
| 02 | Company API sourcing | Eligible items from configured company feeds, retaining source identity |
| 03 | Trend research | Approved industry, search/social, and sector-account inputs; no assumed private access |
| 04 | Data analysis | Source-linked claims; deterministic calculations; conflicting/unsupported figures held |
| 05 | Model and agent settings | Approved role configuration, versions, spend caps, and reusable stage results |
| 06 | Audit, notifications, kill switch | Audited changes/actions, admin alerts, account/global pause |
| 07 | Video, motion graphics, infographics | Templates, captions, charts, previews, and targeted scene correction |
| 08 | Instagram formats | Core formats first; carousels after core stability |
| 09 | Persian language quality | Independent reviewer; RTL, ZWNJ, register, glossary, numeral and calendar preferences |
| 10 | Disclosure and rights | Owned/licensed/generated provenance; block missing/expired rights; apply supported disclosure |
| 11 | Calendar and checks | Slot rules and source, language, brand, media, rights, and platform checks |
| 12 | Scheduled publishing | Idempotent publishing, quota checks, platform IDs and links |
| 13 | Status and recovery | Durable state, bounded recovery, uncertain sends reconciled before retry |
| 14 | Performance tracking | Available post/Story measures, explicit unavailable metrics, sync time and observation window |
| 15 | Performance reports | Weekly comparable views with sample sizes and filters |
| 16 | Actions from analytics | Evidence-backed test proposals; only schedule when account evidence/limits qualify |

Phase 2 YouTube and Phase 3 wider distribution are excluded. Carousel work is a later Phase 1 increment, not removed from the complete MVP.

## Recommended operating values selected for the pilot

The requester asked to use the recommended system on 2026-11-19. The values below are therefore selected as pilot starting defaults. The named PO/QA/OPS owners have not been provided, so role assignment and any later revision remain open. Values remain configurable and do not relax hard publishing gates.

| Measure | Selected starting value | Owner / follow-up |
| --- | --- | --- |
| Pilot capacity | 1–3 accounts; up to 3 planned items per account per day; one active render job per render worker | Selected; PO + OPS to name account(s) and owner |
| Technical retries | Up to 3 transient attempts per stage | Selected; PO + INT to own configuration |
| Content correction | Up to 2 correction loops per item | Selected; PO + INT to own configuration |
| Draft-ready latency | For a template video up to 60 seconds: p95 under 30 minutes at pilot load; plan at least 2 hours before slot | Selected; benchmark with INT before relying on target |
| Dispatch timeliness | Within 2 minutes of due time for ready eligible work; define late-slot behavior | Selected; PO + OPS to define late-slot handling before publishing |
| Shadow exit | At least 20 varied checked items per account across every enabled format; zero critical factual/rights/sensitive-topic/Persian failures and at least 95% human agreement | Selected; PO + FA + QA to run; continue shadow if unmet |
| Native review | Weekly sample of at least 5 items per active account, including every format used; sample all if fewer than 5; critical failure pauses affected automation | Selected; FA + PO to assign reviewer |
| Experiment evidence | At least 10 comparable posts per group over 14 days and matched 48-hour observation; at most one active test/account and one changed variable | Selected as a pilot heuristic, not statistical significance; analytics owner TBD |
| Retention | Draft/intermediate assets/restricted model outputs 90 days; published artifacts/checks/metrics/audit 12 months; redacted operational logs 30 days | Selected; PO + OPS to implement before hosted use |
| Backup/recovery | Daily database/media backup; RPO 24 hours and restore target 4 hours | Selected; OPS + PO to prove before M2 |
| Costs and generated seconds | Currency and draft/account/month caps set from provider benchmark and pilot budget; no amount is available yet. Generated clips disabled initially; enable only after quality/cost/rights evidence and an explicit seconds cap. | Recommended policy selected; currency and amounts remain TBD before paid runs |
| Notifications | One existing team-approved admin channel plus in-product exceptions; no external message sent during this discovery work | Selected; actual approved channel and owner remain TBD |

## Owners and missing inputs

Roles below come from the roadmap. The repository contains no staff names or contact assignments, so the role is named and the person remains an explicit open input.

| Work/input | Responsible role(s) | Named person | Needed to close |
| --- | --- | --- | --- |
| Product scope, pilot account selection, source-mode decisions, and thresholds | PO | Not supplied | Accept this sheet; identify account(s) and owner |
| Meta app, account authorization, login and capability probe | INT + OPS | Not supplied | US-002 access package |
| Company feed and approved research inputs | PO + INT | Not supplied | US-003 source list and permitted credentials/path |
| Brand, rights and sensitive-topic rules | PO/editorial owner + OPS; FA for Persian review | Not supplied | Brand kit, asset rights process, glossary and reviewer |
| Budget currency and accounting timezone | PO + OPS | Not supplied | Choose currency, financial month timezone, and account/month limits before paid runs; account posting timezone is Asia/Tehran |
| Hosting and secrets handling | OPS + PO | Not supplied | Provider choice and deployment/secrets owner |
| Native Persian review | FA + PO | Not supplied | Reviewer identity and audit cadence acceptance |
| Operator prototype review | UX + PO | Not supplied | Two or three intended operators and recorded feedback |

No account identity, endpoint, brand assets, budget amount, owner name, or review result was inferred. Asia/Tehran is recorded because the requester selected it, not from the workstation timezone.

## Prototype and acceptance evidence

Open [the self-contained Persian prototype](prototype/index.html) in a browser. It demonstrates:

1. editing a draft into a new revision and requesting recheck;
2. viewing a held item and navigating to its affected content;
3. changing a calendar slot, pausing/resuming an account, and reviewing eligible work before any resumed scheduling.

The prototype is illustrative and stores state only in the current page. It has not been reviewed by intended operators. US-001 remains In progress until the account and named owners are recorded, remaining source/brand/calendar inputs are assigned, and operator feedback is captured.
