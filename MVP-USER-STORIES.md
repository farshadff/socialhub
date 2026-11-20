# MVP delivery stories and subtasks

US-001 and US-005 are In progress; US-002 and US-003 are Blocked pending US-001 acceptance and external access. US-005 was started at the requester’s direction while the remaining US-001 review inputs are pending. Remaining work is Todo. Current discovery artifacts are listed in [discovery/README.md](discovery/README.md). Product scope and technical contracts remain in [MVP roadmap](MVP-ROADMAP.md) and [Phase 1 PRD](<Social Hub.md>).

This is the execution backlog: 46 ordered stories/discovery items/enablers, broken into individually checkable subtasks. Use [story CSV](MVP-STORIES.csv) for parent issues and [subtask CSV](MVP-SUBTASKS.csv) for children. The original [74-task inventory](MVP-BACKLOG.csv) stays unchanged as the source traceability reference. These are different views of the same work; do not schedule or estimate both inventories separately.

## How to deliver one increment at a time

1. Start at US-001 and work down the order. A story can start when its explicit dependencies are accepted and required access/decisions exist. Independent items may start earlier after checking those dependencies; numeric order is the recommended serial path. Dependencies include earlier stories transitively, so a short dependency list still carries their prerequisites.
2. Refine only the next story: confirm external access, resolve proposed defaults, assign the people and split a subtask further if needed. Choose one primary owner for the story; the subtask owner columns identify contributing disciplines.
3. Finish its subtasks, verify every acceptance example and perform its demo on the stated supported path. Record the environment, release/revision, result and evidence link. A story is not accepted just because its backend or UI is merged.
4. Mark the story accepted and release its working increment to the appropriate local/staging/shadow/test/pilot environment. Do not enable production publishing before the relevant account/format gates. Then move to the next story.
5. Close an original task only when all slices mapped to that original ID are accepted. Reused IDs mean split coverage, not repeated implementation. The mapping at the end makes these shared obligations visible.

The normal story target is a small end-to-end change deliverable within a few working days. Discovery and technical enablers are labelled honestly because their output is validated evidence or infrastructure. US-037 deliberately keeps the first external send and its essential safety guarantees together; preparation is delivered separately in US-036. If a story exceeds sprint capacity, split at an acceptance boundary while keeping incomplete behavior disabled. New story count does not increase the roadmap's scope or reset its estimates. Assign fresh story estimates after refinement; do not sum repeated original-task estimates.

Use Todo -> In progress -> Review -> Validation -> Done, or Blocked with cause/owner. A blocked provider approval is not permission to invent a success. Fixtures are valid for deterministic CI, while capability and actual publish/metric acceptance require authorized real-platform evidence.

## Release boundaries

| Checkpoint | Required result | Gate |
| --- | --- | --- |
| Foundation | US-001–US-006 plus US-008 and its dependencies | M0: capability/source/Persian evidence, local stack, API/errors, initial CI and observability accepted; feature-specific extensions arrive with their owning stories |
| First feature increment | US-007 sign-in and a Persian RTL shell | Usable staff entry; no content automation implied |
| First end-to-end content demo | US-021 after its dependencies | Company source -> verified dataset -> Persian infographic -> explained checks -> shadow calendar; image-only, not M1 completion |
| Full core shadow pilot | US-033 and dependencies | M1: core formats, both sourcing paths, controls and native review; publishing remains manual |
| Hosted pilot | US-034/US-035 | Hosted environment security and recovery prerequisites accepted before hosted use/autonomy respectively |
| Authorized publishing tests | US-036–US-039 | Container preparation, guarded test-account sends and real metric validation; no general rollout |
| Autonomous core pilot | US-043 and all prior stories | M2: all core formats, reports, learning and account-specific qualification accepted |
| Complete Phase 1 | US-046 and all prior stories | M3: image/video/mixed carousels and final operations/acceptance complete |

US-034 is placed in the serial order before publishing tests; it can be pulled forward after its listed dependencies so the shadow pilot can run on hosting. US-033 itself may be accepted in the documented local/test environment until hosting is ready. Never expose an unsecured partial stack to users.

These story checkpoints refine the roadmap's original epic-level sequence. A foundation or core milestone accepts the slices needed for that checkpoint; it does not wait for future carousel/reporting extensions of a shared original task. The original task can remain open until all mapped slices close. This keeps milestone acceptance separate from closing the complete source-task inventory.

Caption-led output is the required initial media path. US-032's controls/decision evidence are mandatory; optional speech/generated-clip integrations are only required if enabled. Enabled options need their own tested quality, cost, rights and disclosure evidence. Disabled options remain visibly unavailable and cannot be invoked by models.

## Shared definition of done

- The whole user outcome works across its API, worker, state and Persian UI where applicable; an enabler has reproducible evidence instead of a pretend user feature.
- Relevant permissions, centralized errors, revision safety, audit, budgets and publication controls remain enforced. New actions extend the same shared components rather than introducing parallel frameworks.
- Appropriate calculation/state/permission/concurrency/render/browser checks pass. Test only behavior relevant to the change and its unresolved risks; do not add redundant tests for document edits.
- Each screen includes relevant loading/empty/error/stale states, keyboard access and actual RTL/date/digit behavior. Each asynchronous action has durable progress and an actionable terminal state.
- Changed API schemas/types, migration/rollback notes and operating instructions are current. Evidence labels fixture versus staging versus authorized real service.
- The story's acceptance criteria and demo pass; its owner records acceptance. Existing publishing/autonomy gates still determine where it may be released.

Owner abbreviations: BE backend; FE frontend; INT integrations/AI/media; UX design; QA validation; FA native Persian reviewer; OPS operations; PO product owner. Admin is the authorized operational role, not a new engineering role.

The schemas, stack, error payload, 0–1 check scores, account/month budget definitions and proposed operating thresholds are specified in the roadmap. This breakdown does not introduce new product features or mandatory optional providers.

## Ordered story index

| Order | Story | Type | Demo outcome / gate | Depends on |
| --- | --- | --- | --- | --- |
| 1 | [US-001 — Agree the pilot scope and observable success criteria](#us-001) | Discovery | M0 prerequisite | None |
| 2 | [US-002 — Prove that the pilot Instagram account supports the required operations](#us-002) | Spike | M0 prerequisite | US-001 |
| 3 | [US-003 — Prove access to company data and approved trend inputs](#us-003) | Spike | M0 prerequisite | US-001 |
| 4 | [US-004 — Select a workable Persian model and rendering approach](#us-004) | Spike | M0 prerequisite | US-001, US-003 |
| 5 | [US-005 — Run the whole project locally from a fresh checkout](#us-005) | Technical enabler | M0 foundation | US-001 |
| 6 | [US-006 — Receive consistent Persian errors from the API and dashboard](#us-006) | Technical enabler | M0 foundation | US-005 |
| 7 | [US-007 — Sign in and navigate the Persian RTL dashboard](#us-007) | User story | Core implementation | US-005, US-006 |
| 8 | [US-008 — Trace a failed action and inspect its audit history](#us-008) | User story | Core implementation | US-006, US-007 |
| 9 | [US-009 — Connect an Instagram account and see whether it is ready](#us-009) | User story | Core implementation | US-002, US-007, US-008 |
| 10 | [US-010 — Configure the brand and Persian presentation preferences](#us-010) | User story | Core implementation | US-007, US-008, US-009 |
| 11 | [US-011 — Configure sourcing, posting and automation rules](#us-011) | User story | Core implementation | US-009, US-010 |
| 12 | [US-012 — Choose approved models and safely change their prompts](#us-012) | User story | Core implementation | US-004, US-008, US-011 |
| 13 | [US-013 — Run one production stage and inspect its durable result](#us-013) | Technical enabler | Core implementation | US-005, US-008, US-012 |
| 14 | [US-014 — Keep paid runs and recovery inside account budgets](#us-014) | User story | Core implementation | US-011, US-013 |
| 15 | [US-015 — Browse eligible company-feed candidates and their original sources](#us-015) | User story | Core implementation | US-003, US-009, US-011, US-013, US-014 |
| 16 | [US-016 — Verify claims and build a reproducible chart dataset](#us-016) | User story | Core implementation | US-012, US-014, US-015 |
| 17 | [US-017 — Generate a Persian brief, caption and scene plan](#us-017) | User story | Core implementation | US-010, US-011, US-012, US-014, US-016 |
| 18 | [US-018 — Render a source-driven Persian infographic for a feed post](#us-018) | User story | Core implementation | US-010, US-016, US-017 |
| 19 | [US-019 — Upload media or edit a draft without losing revision safety](#us-019) | User story | Core implementation | US-006, US-017, US-018 |
| 20 | [US-020 — See independent quality checks and understand why an image is held](#us-020) | User story | Core implementation | US-004, US-011, US-012, US-016, US-018, US-019 |
| 21 | [US-021 — Fill a shadow calendar with checked single-image content](#us-021) | User story | Early single-image shadow increment | US-011, US-015, US-020 |
| 22 | [US-022 — Pause, reschedule or cancel work safely](#us-022) | User story | Core implementation | US-008, US-011, US-021 |
| 23 | [US-023 — Resolve an exception or download the content for manual handling](#us-023) | User story | Core implementation | US-008, US-014, US-019, US-020, US-022 |
| 24 | [US-024 — Correct only the affected scene and reuse valid work](#us-024) | User story | Core implementation | US-013, US-014, US-018, US-019, US-020, US-023 |
| 25 | [US-025 — Collect approved industry, search and sector-account signals](#us-025) | User story | Core implementation | US-003, US-011, US-014, US-015 |
| 26 | [US-026 — Choose ranked, relevant trend topics for upcoming slots](#us-026) | User story | Core implementation | US-011, US-016, US-021, US-025 |
| 27 | [US-027 — Produce a caption-led Reel from owned footage](#us-027) | User story | Core implementation | US-017, US-020, US-024 |
| 28 | [US-028 — Turn verified figures into an animated chart](#us-028) | User story | Core implementation | US-016, US-018, US-027 |
| 29 | [US-029 — Produce a short template-based motion explainer](#us-029) | User story | Core implementation | US-017, US-027, US-028 |
| 30 | [US-030 — Prepare an image Story with an accurate crop preview](#us-030) | User story | Core implementation | US-018, US-019, US-020, US-021 |
| 31 | [US-031 — Prepare a caption-led video Story](#us-031) | User story | Core implementation | US-027, US-030 |
| 32 | [US-032 — Keep optional narration and generated clips under explicit controls](#us-032) | User story | Core controls; optional provider implementation only if enabled | US-004, US-014, US-027, US-031 |
| 33 | [US-033 — Audit a native Persian sample and operate all core formats in shadow](#us-033) | User story | M1 complete core shadow pilot | US-020, US-021, US-022, US-023, US-024, US-026, US-027, US-028, US-029, US-030, US-031, US-032 |
| 34 | [US-034 — Use a secure hosted pilot environment with traceable releases](#us-034) | Technical enabler | Before hosted pilot use | US-005, US-008, US-009, US-015, US-023 |
| 35 | [US-035 — Restore pilot data and clean up only records past retention](#us-035) | Technical enabler | Before autonomous release | US-008, US-018, US-023, US-034 |
| 36 | [US-036 — Prepare publish-ready media containers without sending a post](#us-036) | User story | Publishing preparation only | US-002, US-009, US-014, US-020, US-022, US-027, US-030, US-031, US-034 |
| 37 | [US-037 — Publish one due single-image item safely on an authorized test account](#us-037) | User story | Authorized integration test; not general rollout | US-014, US-020, US-021, US-022, US-023, US-024, US-035, US-036 |
| 38 | [US-038 — Publish Reels and image/video Stories through the same safety gates](#us-038) | User story | Core implementation | US-027, US-030, US-031, US-036, US-037 |
| 39 | [US-039 — Collect available post and Story metrics with their observation windows](#us-039) | User story | Core implementation | US-002, US-023, US-033, US-038 |
| 40 | [US-040 — Read weekly reports with fair comparisons and sample sizes](#us-040) | User story | Core implementation | US-010, US-026, US-039 |
| 41 | [US-041 — See a concrete experiment proposal backed by actual posts](#us-041) | User story | Core implementation | US-012, US-026, US-040 |
| 42 | [US-042 — Schedule only qualified tests and feed bounded results back into planning](#us-042) | User story | Core implementation | US-011, US-014, US-022, US-026, US-040, US-041 |
| 43 | [US-043 — Qualify and enable one company account for core autonomous operation](#us-043) | User story | M2 autonomous core pilot | US-033, US-035, US-038, US-039, US-040, US-042 |
| 44 | [US-044 — Produce and publish an image carousel after core stability](#us-044) | User story | M3 carousel increment | US-002, US-024, US-038, US-040, US-043 |
| 45 | [US-045 — Produce and publish video-only and mixed carousels](#us-045) | User story | M3 carousel completion | US-027, US-031, US-044 |
| 46 | [US-046 — Accept and hand over the complete Phase 1 MVP](#us-046) | User story | M3 complete Phase 1 MVP | US-043, US-044, US-045 |

## Story specifications

<a id="us-001"></a>

### US-001 — Agree the pilot scope and observable success criteria

**Type:** Discovery. **Status:** In progress. **Gate:** M0 prerequisite.

As a product owner, I want a short decision sheet and reviewed operator flows, so the team builds the agreed Instagram MVP and can accept each increment.

**Dependencies:** None. **Original tasks:** E00-T01, E00-T05, E02-T01. **PRD:** 01–16; NFR; rollout.

**Acceptance criteria**

- [ ] The sheet identifies pilot accounts, owners, source modes, formats, brand inputs, limits and decisions still awaiting evidence.
- [ ] Thresholds and operating numbers are explicitly proposed or accepted; none are misrepresented as PRD requirements.
- [ ] An intended operator can walk through draft correction, calendar actions and pause/resume using a small Persian prototype.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-001-ST01 | PO | Record the 16 PRD requirements, pilot accounts and excluded later phases in the decision sheet. | In progress |
| US-001-ST02 | PO + OPS | Name owners for platform access, company data, brand/rights input, budget, hosting and native Persian review; record missing inputs. | In progress |
| US-001-ST03 | UX | Sketch content detail, exception and calendar flows with Persian action labels; review with intended operators. | In progress |
| US-001-ST04 | PO + QA | Agree pilot load, correction limits, quality/sample thresholds, notification channel and measurable acceptance examples. | In progress |

**Demo:** Walk through the decision sheet and three Persian operator flows; identify each open decision and owner.

<a id="us-002"></a>

### US-002 — Prove that the pilot Instagram account supports the required operations

**Type:** Spike. **Status:** Blocked (US-001 acceptance, pilot account and authorized Meta app access). **Gate:** M0 prerequisite.

As a product owner, I want an evidence-backed platform capability matrix, so platform restrictions are visible before connector implementation.

**Dependencies:** US-001. **Original tasks:** E00-T02. **PRD:** 01, 08, 10, 12, 14; security.

**Acceptance criteria**

- [ ] Selected login flow, API version, account type, permissions, approval steps and credential lifecycle are recorded.
- [ ] Authorized tests provide evidence for core publishing formats and available post/Story metrics; carousel and disclosure capabilities are also checked.
- [ ] Missing access has a named blocker and resolution owner; a mocked success cannot close an unavailable capability.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-002-ST01 | INT | Prepare the approved developer application, eligible test account and selected login flow. | Blocked |
| US-002-ST02 | INT | Perform minimal authorized core-format, carousel/disclosure and insight capability probes; retain redacted IDs and outcomes. | Blocked |
| US-002-ST03 | INT + OPS | Record permission/approval, token refresh/revocation, quota and media-reachability requirements. | In progress |
| US-002-ST04 | PO | Accept the supported capability matrix or record the affected launch blocker without silently dropping the requirement. | Blocked |

**Demo:** Show redacted authorized platform results and one permission/capability blocker with its resolution path.

<a id="us-003"></a>

### US-003 — Prove access to company data and approved trend inputs

**Type:** Spike. **Status:** Blocked (US-001 acceptance, source selection and permitted access). **Gate:** M0 prerequisite.

As a editorial owner, I want representative source samples and access contracts, so content research starts from data we can actually retrieve and cite.

**Dependencies:** US-001. **Original tasks:** E00-T03. **PRD:** 02, 03, 04.

**Acceptance criteria**

- [ ] A representative company feed can be read with source identity, dates, status and eligibility fields.
- [ ] Approved industry sources, search/social signals and sector-account inputs have permitted retrieval paths or explicit blockers.
- [ ] Samples retain original links and collection times; private or unavailable sources are not assumed accessible.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-003-ST01 | PO + INT | List the first company feed and the small approved source set, including all PRD input categories. | Blocked |
| US-003-ST02 | INT | Fetch redacted representative samples and document authentication, pagination, freshness and request limits. | Blocked |
| US-003-ST03 | INT | Define the common source-item schema and map each sample into it. | In progress |
| US-003-ST04 | PO | Confirm editorial eligibility rules and record unsupported source access as a named blocker. | Blocked |

**Demo:** Show normalized company and trend samples next to their original sources and eligibility fields.

<a id="us-004"></a>

### US-004 — Select a workable Persian model and rendering approach

**Type:** Spike. **Status:** Todo. **Gate:** M0 prerequisite.

As a editorial owner, I want a reproducible Persian quality and cost benchmark, so chosen models and templates can produce usable content at a known pilot cost.

**Dependencies:** US-001, US-003. **Original tasks:** E00-T04, E07-T02, E05-T06. **PRD:** 04, 05, 07, 09; model selection.

**Acceptance criteria**

- [ ] The fixed examples cover claims, register, glossary, ZWNJ, mixed-script RTL, digit/calendar preferences and actual rendered text.
- [ ] Writer and independent reviewer roles are evaluated separately; model/prompt versions, failures, latency and cost per accepted asset are recorded.
- [ ] A source-data chart and short caption-led video render correctly; speech and generated-clip options have explicit enable/disable decisions.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-004-ST01 | FA + INT | Create the fixed Persian/evidence examples and human labels, including deliberately bad examples. | Todo |
| US-004-ST02 | INT | Benchmark candidate role configurations and persist prompts, versions, usage, latency and review results. | Todo |
| US-004-ST03 | INT | Render a chart and short caption-led video using the proposed font, browser renderer and FFmpeg approach. | Todo |
| US-004-ST04 | PO + FA | Select initial configurations and document quality thresholds, total accepted-output cost and optional-provider decisions. | Todo |

**Demo:** Show one accepted and one rejected Persian example, the actual chart/video render, and cost/version results.

<a id="us-005"></a>

### US-005 — Run the whole project locally from a fresh checkout

**Type:** Technical enabler. **Status:** In progress. **Gate:** M0 foundation.

As a developer, I want a Dockerized backend/frontend monorepo with a passing build, so any team member can reproduce the same starting environment.

**Dependencies:** US-001. **Original tasks:** E01-T01, E01-T02, E01-T06. **PRD:** NFR; monorepo/local Docker.

**Acceptance criteria**

- [ ] Documented bootstrap starts /backend, /frontend, PostgreSQL, Redis, workers and one scheduler without host Python/Node.
- [ ] A frontend request reaches Django/DRF; resolved supported dependencies are locked and development reload works.
- [ ] Database/media persist through restart; default sample providers cannot publish externally; basic containerized CI is green.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-005-ST01 | BE + FE | Create the Django/DRF and React/TypeScript skeletons and lock compatible stable dependencies. | In progress |
| US-005-ST02 | BE + OPS | Add Compose, backend/frontend/render images, named volumes, health checks and explicit migrations/admin/sample-data commands. | In progress |
| US-005-ST03 | BE | Seed deterministic sample source/model/publisher adapters with real publication disabled by default. | In progress |
| US-005-ST04 | BE + FE | Add initial containerized lint/build/test jobs and README; run a fresh-bootstrap and restart smoke check. | In progress |

**Demo:** Start from a fresh checkout, open the frontend/API, restart the stack and show persisted sample data.

<a id="us-006"></a>

### US-006 — Receive consistent Persian errors from the API and dashboard

**Type:** Technical enabler. **Status:** In progress. **Gate:** M0 foundation.

As a operator, I want clear validation and failure messages with a support reference, so I can recover without deciphering raw technical errors.

**Dependencies:** US-005. **Original tasks:** E01-T03, E01-T04. **PRD:** 01, 13; observability.

**Acceptance criteria**

- [ ] The API has versioned routes, bounded pagination, permission defaults, OpenAPI and the central machine-code/Persian-message contract.
- [ ] Nested validation, CSRF/auth denial, stale edit, throttle, provider timeout and unexpected failure produce documented safe responses.
- [ ] The shared frontend client renders field/global errors, retains request IDs and retries only when the operation is safe.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-006-ST01 | BE | Implement the DRF exception handler and Django boundary handlers, request ID middleware and documented auth/status semantics. | In progress |
| US-006-ST02 | BE + FE | Generate or derive typed client contracts from OpenAPI and add common field/global error mapping. | In progress |
| US-006-ST03 | FE | Add page/render-error recovery and session-expiry handling, preserving user input on recoverable failures. | In progress |
| US-006-ST04 | QA + BE + FE | Run representative contract and browser fixtures, including non-JSON upstream failure and unsafe-mutation timeout. | Todo |

**Demo:** Submit an invalid form, trigger a safe fixture failure and show the Persian message, field paths and matching request ID.

<a id="us-007"></a>

### US-007 — Sign in and navigate the Persian RTL dashboard

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a staff member, I want a secure Persian dashboard showing my role and current account context, so I can reach operational tools with clear navigation.

**Dependencies:** US-005, US-006. **Original tasks:** E03-T01, E02-T02, E02-T03. **PRD:** 01, 09; security.

**Acceptance criteria**

- [ ] Admin-created staff can log in/out with protected sessions and CSRF; disabled staff cannot continue privileged access.
- [ ] Admin and operations permissions are enforced at the API, including direct requests; there is no public signup.
- [ ] The right-side navigation, font, dialogs, forms, focus order and mixed Persian/Latin text work on wide and narrow screens.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-007-ST01 | BE | Implement admin-managed staff lifecycle, session endpoints, CSRF and two-role permission checks. | Todo |
| US-007-ST02 | FE | Build login/logout/current-session flows and the RTL shell with account selector and visible role/mode context. | Todo |
| US-007-ST03 | FE + UX | Add shared Persian typography, logical spacing, status labels, forms, dialogs, keyboard focus and responsive navigation. | Todo |
| US-007-ST04 | QA | Verify login/expiry/disable/direct-endpoint denial plus RTL, portal, keyboard and narrow-screen cases. | Todo |

**Demo:** Sign in as operations and admin, switch account context and prove direct API denial of an admin action.

<a id="us-008"></a>

### US-008 — Trace a failed action and inspect its audit history

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a admin, I want correlated errors, health and an audit view, so I can explain what happened without exposing credentials or content in logs.

**Dependencies:** US-006, US-007. **Original tasks:** E01-T05, E10-T01. **PRD:** 05, 06; observability.

**Acceptance criteria**

- [ ] A frontend/API/worker failure is traceable by request/run ID, release and environment in the selected tracker and structured logs.
- [ ] Account/rule/control actions produce read-only audit events with actor, time, target and reason.
- [ ] Health shows dependency readiness; logs/tracker redact secrets and sensitive outputs, and tracker outage does not block the application.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-008-ST01 | BE + FE | Configure JSON logs, error tracker tags, worker correlation propagation and frontend exception boundaries. | Todo |
| US-008-ST02 | BE | Implement the reusable audit writer and protected read endpoints; add account/action/date/actor filters. | Todo |
| US-008-ST03 | FE | Build the readable audit list/detail and connect existing actions to their evidence. | Todo |
| US-008-ST04 | QA + OPS | Trigger representative failures and rule actions; verify health, redaction, correlation and tracker-outage behavior. | Todo |

**Demo:** Trigger a worker fixture failure, follow its run/request ID and show a redacted audit event in the dashboard.

<a id="us-009"></a>

### US-009 — Connect an Instagram account and see whether it is ready

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a admin, I want secure connection settings and account health, so I can identify missing access before attempting production.

**Dependencies:** US-002, US-007, US-008. **Original tasks:** E03-T03, E03-T05, E14-T01. **PRD:** 01, 06, 12; security; rollout.

**Acceptance criteria**

- [ ] An admin can configure/test/reconnect the chosen integration and rotate its secret reference; operations cannot access credential controls.
- [ ] Account setup lists required missing capabilities, token health and shadow mode; raw credentials never appear in ordinary reads/logs/exports.
- [ ] Expiry/revocation produces an actionable connection state and a documented refresh/recovery path.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-009-ST01 | BE + INT | Store integration metadata and managed-secret references; implement the chosen credential retrieval boundary. | Todo |
| US-009-ST02 | BE + FE | Build admin-only connect/test/reconnect/rotate forms and safe read-only health for operations. | Todo |
| US-009-ST03 | BE | Create account readiness/mode checks and default every new account to shadow. | Todo |
| US-009-ST04 | QA + OPS | Verify direct permission denial, secret redaction, expiry/revocation and a credential-rotation drill. | Todo |

**Demo:** Connect/test an authorized account, show shadow readiness, then simulate expiry and its recovery instructions.

<a id="us-010"></a>

### US-010 — Configure the brand and Persian presentation preferences

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a admin, I want a saved brand kit and editorial preferences for an account, so generated content uses our identity and language conventions.

**Dependencies:** US-007, US-008, US-009. **Original tasks:** E03-T02, E03-T04, E02-T04. **PRD:** 01, 09, 10.

**Acceptance criteria**

- [ ] Logo/colors/font, tone/register, approved glossary, digit style, calendar and timezone can be saved and previewed.
- [ ] Uploaded brand assets have type/size validation, origin and rights metadata; missing/expired rights make an asset unusable.
- [ ] Persian/Latin digits, Latin handles, Jalali/Gregorian boundaries and timezone conversion are covered by fixed examples; changes create an audited rule version.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-010-ST01 | BE | Add validated versioned brand/editorial settings and rights-aware asset metadata/storage access. | Todo |
| US-010-ST02 | FE | Build brand/language forms with upload feedback and actual mixed-script/date/number previews. | Todo |
| US-010-ST03 | FE + BE | Implement canonical UTC timestamps and shared Persian digit/calendar/timezone boundary helpers. | Todo |
| US-010-ST04 | QA + FA | Verify invalid assets and representative bidi, numeral, glossary and calendar-boundary cases. | Todo |

**Demo:** Change tone, brand and calendar/digits, preview the result and reject an asset with expired rights.

<a id="us-011"></a>

### US-011 — Configure sourcing, posting and automation rules

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a admin, I want validated account rules with visible limits, so production follows an explicit plan instead of hidden defaults.

**Dependencies:** US-009, US-010. **Original tasks:** E03-T02, E03-T05, E00-T05. **PRD:** 01, 02, 03, 05, 06, 09, 11, 16.

**Acceptance criteria**

- [ ] Source mode, eligibility, permitted formats, posting slots/limits, sensitive topics and check thresholds are editable.
- [ ] Retry/correction, budget, shadow and experiment thresholds have explicit units and accepted defaults; invalid combinations cannot save.
- [ ] Rule changes create audit/version records and mark affected unpublished checks stale; incomplete accounts remain visibly unready.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-011-ST01 | BE + PO | Define a small versioned settings schema for source/posting/quality/recovery/budget/evidence rules. | Todo |
| US-011-ST02 | FE | Implement grouped forms with explanations, defaults, field errors and setup-completeness feedback. | Todo |
| US-011-ST03 | BE | Add effective-rule version snapshots and a hook that invalidates dependent unpublished results when rules change. | Todo |
| US-011-ST04 | QA | Verify invalid combinations, stale-rule propagation, role denial and visible limits; record unresolved operating defaults. | Todo |

**Demo:** Save a valid rule set, reject an invalid one and show the new version plus invalidated unpublished checks.

<a id="us-012"></a>

### US-012 — Choose approved models and safely change their prompts

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a admin, I want role-specific model and fallback settings with a regression gate, so I can improve providers without silently reducing Persian quality.

**Dependencies:** US-004, US-008, US-011. **Original tasks:** E05-T02, E05-T06, E07-T02. **PRD:** 05, 09; model selection.

**Acceptance criteria**

- [ ] All 13 PRD roles have provider/model/version/prompt configuration and an explicit evaluated fallback where configured.
- [ ] Writer and Persian reviewer run independently; an unchanged provider may serve several roles without merging their contracts.
- [ ] A failing fixed regression set prevents promotion; accepted changes are versioned, audited and invalidate dependent results.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-012-ST01 | INT + BE | Define role contracts and admin-only provider/model/fallback/prompt configuration using approved secret references. | Todo |
| US-012-ST02 | INT | Turn the benchmark examples into a repeatable role/Persian regression command and record results by version. | Todo |
| US-012-ST03 | FE + BE | Build settings and promotion feedback, showing selected versions and benchmark status. | Todo |
| US-012-ST04 | QA + FA | Demonstrate rejected bad-prompt promotion and accepted configuration change with correct invalidation/audit. | Todo |

**Demo:** Reject a bad prompt promotion; accept a passing version and show independent writer/reviewer configuration.

<a id="us-013"></a>

### US-013 — Run one production stage and inspect its durable result

**Type:** Technical enabler. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want a visible stage run that survives retries and process restarts, so I can tell whether work is running, completed or needs attention.

**Dependencies:** US-005, US-008, US-012. **Original tasks:** E05-T01, E05-T06. **PRD:** 05, 13; reliability/observability.

**Acceptance criteria**

- [ ] A requested stage returns an asynchronous run ID and persists validated inputs/outputs, versions, latency, usage and outcome.
- [ ] Malformed model output cannot advance the pipeline; duplicate delivery or a worker crash does not create conflicting successful results.
- [ ] The dashboard displays running/succeeded/held/failed detail and links to a safe error reason and audit/run history. This increment uses fixture providers; paid production calls stay disabled until US-014 budget controls are accepted.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-013-ST01 | BE + INT | Implement the fixed stage graph, structured output validation and durable state/attempt records. | Todo |
| US-013-ST02 | BE | Add asynchronous start/status endpoints, conditional job claiming, timeouts and restart recovery. | Todo |
| US-013-ST03 | FE | Add run-status/detail components and modest polling with model/version/cost/output visibility. | Todo |
| US-013-ST04 | QA | Exercise a sample stage, duplicate delivery, malformed output, timeout and crash/restart with fixture providers. | Todo |

**Demo:** Run a sample stage, inspect its result, kill/restart the worker and prove safe duplicate-delivery recovery.

<a id="us-014"></a>

### US-014 — Keep paid runs and recovery inside account budgets

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a admin, I want enforced cost/seconds caps and bounded retry behavior, so failures and concurrent jobs cannot create uncontrolled spending.

**Dependencies:** US-011, US-013. **Original tasks:** E05-T04, E05-T05, E10-T04. **PRD:** 05, 06, 07, 13.

**Acceptance criteria**

- [ ] Paid calls reserve bounded cost before execution across draft/account/month scopes; actual costs and generated seconds are recorded.
- [ ] Concurrent jobs cannot reserve past a cap; ambiguous paid responses retain reservations pending reconciliation.
- [ ] Safe transient retry, approved fallback and correction-loop limits survive restart; exhausted work holds with an alertable reason.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-014-ST01 | BE | Implement atomic budget reservations/ledger with currency, accounting timezone, generated seconds and provider request identity. | Todo |
| US-014-ST02 | INT + BE | Apply bounded request limits and usage/cost reconciliation to provider and attributable render work. | Todo |
| US-014-ST03 | BE | Implement failure classification, safe backoff/fallback and persisted retry/correction ceilings; emit deduplicatable budget/failure events. | Todo |
| US-014-ST04 | QA | Verify concurrent cap enforcement, ambiguous charges, seconds caps, exhausted correction loops and recovery after restart. | Todo |

**Demo:** Launch concurrent fixture jobs at the spending cap and show one held reservation plus a bounded retry outcome.

<a id="us-015"></a>

### US-015 — Browse eligible company-feed candidates and their original sources

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want a refreshed candidate list with eligibility reasons, so I can see which company items can enter production and why.

**Dependencies:** US-003, US-009, US-011, US-013, US-014. **Original tasks:** E04-T01, E04-T05, E14-T01. **PRD:** 02, 04; security.

**Acceptance criteria**

- [ ] Configured feed ingestion runs on schedule with freshness/status/exclusion filtering and retained source IDs/links/timestamps.
- [ ] Replay and pagination do not duplicate candidates; failed feeds show stale/error state without blocking other accounts.
- [ ] The Persian research screen exposes eligible/excluded examples and safe source fetching cannot reach disallowed internal addresses.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-015-ST01 | INT + BE | Implement the first feed connector, normalized item model, cursor, timeouts and unique external-identity constraints. | Todo |
| US-015-ST02 | BE | Apply approved-domain/redirect/private-address fetch protections and feed-specific eligibility configuration. | Todo |
| US-015-ST03 | FE | Build candidate/source-health views with evidence links, timestamps, filters and exclusion reasons. | Todo |
| US-015-ST04 | QA + INT | Verify actual representative feed mapping plus fixture replay, stale/excluded item, pagination and blocked-redirect cases. | Todo |

**Demo:** Refresh a representative feed twice and show the same candidate set with inclusion/exclusion reasons.

<a id="us-016"></a>

### US-016 — Verify claims and build a reproducible chart dataset

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want source-linked claims and calculations for a selected candidate, so every number used in content can be explained and reproduced.

**Dependencies:** US-012, US-014, US-015. **Original tasks:** E04-T04, E04-T05, E07-T03. **PRD:** 04, 11.

**Acceptance criteria**

- [ ] Figures, units, dates and textual claims retain an original-source locator and evidence status.
- [ ] Comparisons and percentage changes run in deterministic code; chart-ready values retain their inputs and calculation version.
- [ ] Unsupported or conflicting figures are excluded and block dependent content; evidence and conflicts are visible in the dashboard.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-016-ST01 | INT + BE | Implement schema-validated claim extraction with source locators, units, dates and retained evidence. | Todo |
| US-016-ST02 | BE | Implement tested comparison/change calculations with explicit precision and versioned chart datasets. | Todo |
| US-016-ST03 | INT + FE | Add evidence/conflict review results and the claim/dataset detail panel with original links. | Todo |
| US-016-ST04 | QA | Verify a known-answer calculation and missing-source, contradictory-value/date, unit-mismatch and unsupported-claim cases. | Todo |

**Demo:** Reproduce a chart calculation from source values and show that a contradictory figure blocks dependent content.

<a id="us-017"></a>

### US-017 — Generate a Persian brief, caption and scene plan

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want editable Persian copy and a structured plan from verified information, so the writer and visual stages work from the same approved facts.

**Dependencies:** US-010, US-011, US-012, US-014, US-016. **Original tasks:** E06-T01. **PRD:** 07, 08, 09.

**Acceptance criteria**

- [ ] A selected eligible candidate produces a versioned brief, angle/format, hook, script, caption, overlays and cover copy.
- [ ] Storyboard, timed scenes, shot list and asset plan reference the same brief and verified claims.
- [ ] Outputs respect tone/glossary/digit/calendar settings and the allowed format; failed or unsupported structured output stays held.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-017-ST01 | INT | Implement planner/writer/storyboard/asset contracts with shared brief, evidence and account-rule inputs. | Todo |
| US-017-ST02 | BE | Persist immutable content revisions, copy fields, ordered scene specifications and claim references. | Todo |
| US-017-ST03 | FE | Build the initial draft-detail view with copy/scene/evidence tabs and visible production state. | Todo |
| US-017-ST04 | QA + FA | Generate a representative Persian draft and verify factual linkage, editorial settings and malformed-output rejection. | Todo |

**Demo:** Generate one Persian brief/caption/storyboard and follow a scene claim back to the original evidence.

<a id="us-018"></a>

### US-018 — Render a source-driven Persian infographic for a feed post

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want an actual branded single-image preview generated from the dataset, so I can judge the first complete media output.

**Dependencies:** US-010, US-016, US-017. **Original tasks:** E06-T02, E06-T03, E06-T06, E03-T04. **PRD:** 04, 07, 08, 10.

**Acceptance criteria**

- [ ] A versioned template renders chart values directly from the verified dataset with readable Persian text and brand settings.
- [ ] Output and preview have persisted hashes/storage keys and source/rights/disclosure metadata.
- [ ] Missing/expired input rights or unmet disclosure requirements hold the draft; the preview reflects the actual stored render.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-018-ST01 | INT | Implement the first infographic template and Persian browser/font rendering path against the selected dataset. | Todo |
| US-018-ST02 | BE + INT | Persist asset hashes, scene dependency fingerprints, output metadata and access-controlled preview storage. | Todo |
| US-018-ST03 | BE | Enforce origin, rights expiry and disclosure decisions for every template/asset used. | Todo |
| US-018-ST04 | FE + QA | Show the actual image/crop preview and verify a branded mixed-script render plus rights/disclosure failure fixtures. | Todo |

**Demo:** Open the stored branded infographic beside its dataset and show a rights/disclosure failure staying held.

<a id="us-019"></a>

### US-019 — Upload media or edit a draft without losing revision safety

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want bounded copy/media edits and a clear preview, so I can correct content while the system knows what must be checked again.

**Dependencies:** US-006, US-017, US-018. **Original tasks:** E06-T05, E08-T04, E14-T01. **PRD:** 07, 08, 11, 13.

**Acceptance criteria**

- [ ] Supported uploads and editable copy/overlay/cover fields save as a new immutable revision with safe size/type checks.
- [ ] Stale edits return a conflict; unsaved changes and recoverable failures preserve input and show useful feedback.
- [ ] Changed dependencies mark old outputs/checks stale; old scheduled revision references cannot be silently published.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-019-ST01 | BE | Implement upload validation, revision-aware edit commands and expected-revision conflict handling. | Todo |
| US-019-ST02 | FE | Build explicit save, unsaved-change protection, upload feedback and actual crop/safe-area previews. | Todo |
| US-019-ST03 | BE | Wire dependent-output/check invalidation and prevent publication intents from silently following an edited revision. | Todo |
| US-019-ST04 | QA | Verify two-operator conflict, invalid/oversized upload, recoverable save failure and stale-check behavior. | Todo |

**Demo:** Edit copy in two sessions, show the stale-write conflict, and verify that the changed revision requires new checks.

<a id="us-020"></a>

### US-020 — See independent quality checks and understand why an image is held

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want an explainable pass/fail/uncertain result for every required check, so only evidence-backed, usable Persian content becomes ready.

**Dependencies:** US-004, US-011, US-012, US-016, US-018, US-019. **Original tasks:** E07-T01, E07-T02, E07-T03, E07-T04, E07-T05. **PRD:** 04, 09, 10, 11; rollout.

**Acceptance criteria**

- [ ] Evidence, Persian language, brand, media, rights/disclosure and platform checks record score/reason/current revision and affected inputs.
- [ ] The Persian reviewer runs separately from the writer and checks actual text/render examples, including glossary, ZWNJ, register and digit/calendar rules.
- [ ] Only current all-pass results at account thresholds produce readiness; uncertain, sensitive, stale or hard-failed content holds with a clear explanation.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-020-ST01 | BE | Implement the check-result schema and deterministic aggregate gate tied to revision/input/rule/checker versions. | Todo |
| US-020-ST02 | INT + FA | Implement independent Persian and evidence/brand review using the fixed labelled examples. | Todo |
| US-020-ST03 | INT + BE | Add image technical/visual/platform checks plus rights/disclosure and always-held sensitive-topic rules. | Todo |
| US-020-ST04 | FE | Build check detail with status, score, reason, evidence/scene links and supported remediation actions. | Todo |
| US-020-ST05 | QA | Prove each negative fixture blocks readiness and a corrected current revision can pass without overriding hard gates. | Todo |

**Demo:** Compare passed, failed and uncertain examples and explain why only one becomes ready.

<a id="us-021"></a>

### US-021 — Fill a shadow calendar with checked single-image content

**Type:** User story. **Status:** Todo. **Gate:** Early single-image shadow increment.

As a operator, I want automatically planned image slots and a usable calendar, so I can inspect the first source-to-schedule workflow before any automatic publishing.

**Dependencies:** US-011, US-015, US-020. **Original tasks:** E08-T01, E08-T02, E08-T03, E02-T04, E10-T05. **PRD:** 02, 08, 11; rollout.

**Acceptance criteria**

- [ ] Account rules create unique timezone-aware slots and select eligible nonrepeating company candidates for the enabled image format.
- [ ] Only the current all-pass revision is scheduled; unsuitable or late content leaves an open/held slot with a readable reason.
- [ ] Calendar week/list views show account timezone and calendar preference; shadow mode issues zero publish calls.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-021-ST01 | BE | Implement durable recurring slot generation, eligible candidate selection and uniqueness/repeat constraints. | Todo |
| US-021-ST02 | BE | Connect stage/check readiness to planned slots with explicit planning lead time and late-slot behavior. | Todo |
| US-021-ST03 | FE | Build week/list calendar filters, open/held-slot explanations and links to the draft/evidence/checks. | Todo |
| US-021-ST04 | QA | Demo automatic sample-feed-to-calendar flow, duplicate scheduling, unsuitable candidate, stale revision and shadow no-send cases. | Todo |

**Demo:** Let a sample feed fill a shadow slot, inspect calendar details and prove that no publish call was issued.

<a id="us-022"></a>

### US-022 — Pause, reschedule or cancel work safely

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator or admin, I want clear calendar actions and visible global/account stop controls, so the team can control pending work without accidental restart.

**Dependencies:** US-008, US-011, US-021. **Original tasks:** E08-T04, E10-T02, E10-T01. **PRD:** 06, 11, 13; rollout.

**Acceptance criteria**

- [ ] Operations can reschedule/cancel permitted work; only admins use global/account kill switches.
- [ ] Pause moves pending scheduled items to held and blocks future dispatch authorization; cancellation/stale edits are respected by queued work.
- [ ] Resume shows consequences and requires explicit eligible rescheduling/rechecks; audit records include scope/actor/reason, and remote in-flight limitations are explained.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-022-ST01 | BE | Implement persisted pause flags and revision-safe reschedule/cancel transitions with limit/readiness revalidation. | Todo |
| US-022-ST02 | FE | Build contextual confirmations, persistent mode/pause indicators and an explicit held-backlog rescheduling flow. | Todo |
| US-022-ST03 | BE | Add reusable final-dispatch guard and audit events for control transitions; keep remote calls outside long database transactions. | Todo |
| US-022-ST04 | QA | Verify permissions, queued-job races, stale actions, duplicate clicks and resume-without-auto-send behavior. | Todo |

**Demo:** Pause an account, show scheduled items held, reschedule one eligible item and prove resume alone sends nothing.

<a id="us-023"></a>

### US-023 — Resolve an exception or download the content for manual handling

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want an actionable queue, bounded recovery and a complete export, so routine failures can be handled without database or shell access.

**Dependencies:** US-008, US-014, US-019, US-020, US-022. **Original tasks:** E10-T03, E10-T04, E05-T05, E10-T01. **PRD:** 06, 13.

**Acceptance criteria**

- [ ] Held/failed items show their real cause, affected stage/check and safe recovery action with remaining retry/budget limits.
- [ ] Authorized export contains media/copy and evidence/rights/check manifest, with no secrets; unusable content remains clearly marked.
- [ ] The chosen transport delivers deduplicated hold/failure/budget alerts with dashboard links; recovery is audited and alert-delivery failure is visible.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-023-ST01 | BE + FE | Build exception list/detail filters and safe retry/edit routing using persisted run/check/revision state. | Todo |
| US-023-ST02 | BE | Implement access-controlled asynchronous media/copy/manifest exports and expiry of export access. | Todo |
| US-023-ST03 | BE + OPS | Connect the selected notification transport to deduplicated operational events and delivery state. | Todo |
| US-023-ST04 | QA | Demo exhausted retry, failed notification, authorized export and successful recheck/recovery without hard-gate bypass. | Todo |

**Demo:** Open a held item from an alert, inspect the reason and download the authorized media/copy/evidence export.

<a id="us-024"></a>

### US-024 — Correct only the affected scene and reuse valid work

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want targeted correction with visible reuse, so a small change does not regenerate already accepted assets.

**Dependencies:** US-013, US-014, US-018, US-019, US-020, US-023. **Original tasks:** E05-T03, E05-T05, E06-T05, E10-T03. **PRD:** 05, 07, 11, 13.

**Acceptance criteria**

- [ ] Checks can identify scene/claim targets and launch a bounded targeted correction for a new revision.
- [ ] Dependency fingerprints include upstream data, model/prompt/rule/template versions; valid unaffected asset hashes remain unchanged.
- [ ] Changed outputs and dependent checks rerun before readiness; exhausted correction becomes held with a specific reason.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-024-ST01 | BE + INT | Implement scene/stage dependency fingerprints and explicit invalidation rules for data/copy/template/model changes. | Todo |
| US-024-ST02 | INT | Route checker remediation to targeted stage/scene correction while sharing retry and budget ceilings. | Todo |
| US-024-ST03 | FE | Show affected scenes, correction progress and reused versus regenerated outputs in draft detail. | Todo |
| US-024-ST04 | QA | Verify a multi-scene fixture preserves unaffected hashes and reruns only affected stages/checks; repeat with actual video in US-027. | Todo |

**Demo:** Flag one scene, rerun it and compare stored hashes showing untouched scenes were reused.

<a id="us-025"></a>

### US-025 — Collect approved industry, search and sector-account signals

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want scheduled trend-source updates with supporting links, so research covers the approved sources in addition to company feeds.

**Dependencies:** US-003, US-011, US-014, US-015. **Original tasks:** E04-T02, E04-T05, E14-T01. **PRD:** 03; security.

**Acceptance criteria**

- [ ] The approved source set covers industry sources, search/social signals and sector accounts through permitted supported access.
- [ ] Each signal retains origin, identity/link and source/fetch times; source failures and stale collections are visible and isolated.
- [ ] Source allowlists and safe fetching apply; missing required access stays an explicit blocker rather than becoming fabricated data.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-025-ST01 | INT | Implement the initial permitted connectors and map responses into the shared source-item/evidence contract. | Todo |
| US-025-ST02 | BE | Add scheduled collection, cursors/deduplication, timeout/limits and source health state. | Todo |
| US-025-ST03 | FE | Extend research filters and source-health detail to approved trend inputs and their evidence links. | Todo |
| US-025-ST04 | QA + INT | Validate representative real-access samples and fixture duplicate/outage/stale/private-redirect isolation cases. | Todo |

**Demo:** Show fresh linked signals from each approved input category and a failed source isolated from healthy ones.

<a id="us-026"></a>

### US-026 — Choose ranked, relevant trend topics for upcoming slots

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want explainable topic ranking and automatic nonrepeating selection, so the calendar uses timely relevant topics when evidence is sufficient.

**Dependencies:** US-011, US-016, US-021, US-025. **Original tasks:** E04-T03, E04-T05, E08-T01. **PRD:** 03, 04, 11.

**Acceptance criteria**

- [ ] Related signals form topics with retained original links and deterministic component scores for freshness, relevance, audience fit and evidence.
- [ ] Company/trend/combined modes follow agreed rules, coverage history and repeat avoidance; ranked eligible topics enter the existing verified production flow.
- [ ] No eligible topic means an open slot; scores and exclusion reasons are inspectable without invented claims or reactions.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-026-ST01 | INT + BE | Implement structured clustering and code-based weighted scoring with versioned component values. | Todo |
| US-026-ST02 | BE | Track covered topics and apply eligibility/repeat/source-mode rules to the slot selector. | Todo |
| US-026-ST03 | FE | Show ranked topics, grouped evidence, score breakdown and why a topic was excluded. | Todo |
| US-026-ST04 | QA | Demo the trend-to-verified-draft path and repeated, stale, weak-evidence and no-suitable-topic fixtures. | Todo |

**Demo:** Inspect a ranked topic and score breakdown, then show that repeated/weak topics leave a slot open.

<a id="us-027"></a>

### US-027 — Produce a caption-led Reel from owned footage

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want a complete Persian Reel preview with timed scenes and captions, so video production works using reusable assets and bounded rendering.

**Dependencies:** US-017, US-020, US-024. **Original tasks:** E06-T01, E06-T02, E06-T03, E06-T04, E06-T05, E07-T04. **PRD:** 07, 08, 09, 11.

**Acceptance criteria**

- [ ] The shared brief yields timed video scenes, footage/asset choices, caption/overlay/cover copy and a valid assembled Reel.
- [ ] Persian text, subtitle timing, clipping, continuity, brand and format checks run on the actual rendered output.
- [ ] Flagging one real video scene rerenders only that scene and dependent assembly/checks; preview and crop reflect current stored media.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-027-ST01 | INT | Implement the owned-footage-plus-caption template, timed shot list and caption-led subtitle path. | Todo |
| US-027-ST02 | INT + BE | Render reusable scene clips and assemble using FFmpeg, retaining cover/preview/media metadata. | Todo |
| US-027-ST03 | INT + FE | Extend visual/technical checks and scene/crop preview to the Reel path. | Todo |
| US-027-ST04 | QA + FA | Verify an actual Persian Reel and targeted-scene reuse plus subtitle/clipping/invalid-duration failures. | Todo |

**Demo:** Play the actual Persian Reel, flag one real scene and show only the relevant outputs/checks changing.

<a id="us-028"></a>

### US-028 — Turn verified figures into an animated chart

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want a Persian chart animation driven by the saved dataset, so numerical content stays reproducible throughout video production.

**Dependencies:** US-016, US-018, US-027. **Original tasks:** E06-T02, E06-T03, E07-T04. **PRD:** 04, 07, 08.

**Acceptance criteria**

- [ ] Animated values, labels, units and comparisons come directly from the versioned dataset, with readable Persian text.
- [ ] The template respects brand/safe areas and reuses the video assembly/check/preview workflow.
- [ ] Changing a dataset value invalidates its chart scenes and dependent checks while unrelated scenes remain reusable.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-028-ST01 | INT | Implement one source-driven animated-chart template using dataset values and explicit scale/units. | Todo |
| US-028-ST02 | INT | Integrate animation scene rendering, assembly and current-revision previews. | Todo |
| US-028-ST03 | INT + FA | Add numerical/text visibility and clipping examples to actual-render review. | Todo |
| US-028-ST04 | QA | Compare render values to a known dataset and verify selective invalidation after an input change. | Todo |

**Demo:** Play the chart animation next to the numeric dataset and change one input to demonstrate correct invalidation.

<a id="us-029"></a>

### US-029 — Produce a short template-based motion explainer

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want a coherent Persian motion-graphics explanation, so verified ideas can be presented without new footage for every scene.

**Dependencies:** US-017, US-027, US-028. **Original tasks:** E06-T01, E06-T02, E06-T03, E07-T04. **PRD:** 07, 08, 09.

**Acceptance criteria**

- [ ] A structured storyboard produces a short branded explainer with timed graphics, transitions and readable Persian overlays.
- [ ] Claims remain linked to the brief/evidence and only rights-cleared assets are used.
- [ ] Scene edits reuse valid assets and the same Persian/media/platform checks gate readiness.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-029-ST01 | INT | Implement the initial motion-explainer scene template and structured motion/assembly agent contract. | Todo |
| US-029-ST02 | INT + BE | Connect graphic timings/transitions and captions to the existing renderer/asset lineage. | Todo |
| US-029-ST03 | FE | Expose the motion scene inputs using the bounded editor and real preview. | Todo |
| US-029-ST04 | QA + FA | Demo one complete explainer with source-linked claims, readable text and targeted-scene correction. | Todo |

**Demo:** Play a complete motion explainer and inspect its structured scenes and source-linked claims.

<a id="us-030"></a>

### US-030 — Prepare an image Story with an accurate crop preview

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want a checked Persian image Story, so the same research and production pipeline supports the Story image format.

**Dependencies:** US-018, US-019, US-020, US-021. **Original tasks:** E06-T03, E06-T05, E07-T04. **PRD:** 08, 09, 11.

**Acceptance criteria**

- [ ] An existing verified topic/dataset or permitted uploaded image can produce an image Story using account rules.
- [ ] Actual crop/safe-area preview and current platform/image/Persian/rights checks cover the final asset.
- [ ] Story slots appear in the calendar; unsupported options are explained and shadow still makes zero publish calls.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-030-ST01 | INT + BE | Add the image-Story format profile and template/output configuration from validated capabilities. | Todo |
| US-030-ST02 | FE | Add accurate Story preview/crop and supported format selection to draft/calendar flows. | Todo |
| US-030-ST03 | INT | Apply format-specific image/safe-area validation and existing independent Persian/rights checks. | Todo |
| US-030-ST04 | QA | Demo generated and uploaded image Stories plus unsupported-option and clipping fixtures. | Todo |

**Demo:** Preview generated and uploaded image Stories with safe-area/crop warnings and readiness states.

<a id="us-031"></a>

### US-031 — Prepare a caption-led video Story

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want a checked Persian video Story, so all priority formats can pass through the shadow workflow.

**Dependencies:** US-027, US-030. **Original tasks:** E06-T03, E06-T04, E06-T05, E07-T04. **PRD:** 07, 08, 09, 11.

**Acceptance criteria**

- [ ] A verified brief or permitted video upload produces a valid video Story with readable timed captions.
- [ ] Format-specific duration/codec/crop/timing checks and current independent quality/rights checks are retained.
- [ ] A video-Story scene correction preserves unaffected work and the calendar accurately shows its readiness/hold state.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-031-ST01 | INT | Add the validated video-Story format profile to the reusable scene/assembly pipeline. | Todo |
| US-031-ST02 | FE + BE | Extend upload, preview/crop, editable copy and slot readiness to video Stories. | Todo |
| US-031-ST03 | INT | Run Story-specific media/timing/visual checks on actual outputs. | Todo |
| US-031-ST04 | QA + FA | Demo an actual Persian video Story, invalid-media hold and targeted correction in shadow mode. | Todo |

**Demo:** Play a checked video Story, inspect subtitle timing and correct one scene without rebuilding valid scenes.

<a id="us-032"></a>

### US-032 — Keep optional narration and generated clips under explicit controls

**Type:** User story. **Status:** Todo. **Gate:** Core controls; optional provider implementation only if enabled.

As a admin, I want an evaluated enablement boundary for optional paid media, so caption-led production remains usable and optional generation stays safe and bounded.

**Dependencies:** US-004, US-014, US-027, US-031. **Original tasks:** E06-T04, E06-T06, E05-T04. **PRD:** 05, 07, 09, 10.

**Acceptance criteria**

- [ ] Caption-led output works with speech/clip providers disabled; unsupported optional controls are visibly unavailable.
- [ ] If narration is enabled, approved voice, pronunciation/alignment review and a usable caption-led alternative are demonstrated.
- [ ] If generated clips are enabled, origin/rights/disclosure and seconds/cost caps are enforced; disabled adapters cannot be invoked by a source or model.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-032-ST01 | PO + INT | Record whether optional narration/clips are enabled for the pilot and the benchmark/rights basis for that decision. | Todo |
| US-032-ST02 | BE + FE | Implement explicit provider capability/toggle/seconds-cap controls and block unsupported invocation paths. | Todo |
| US-032-ST03 | INT + FA | For enabled options only, integrate/evaluate approved voice alignment or clip generation under the existing budget and rights contracts. | Todo |
| US-032-ST04 | QA | Verify caption-only success, disabled-provider noninvocation and enabled-provider cap/disclosure/pronunciation cases where applicable. | Todo |

**Demo:** Render with optional services disabled; for any enabled option demonstrate its actual cap and quality/rights checks.

<a id="us-033"></a>

### US-033 — Audit a native Persian sample and operate all core formats in shadow

**Type:** User story. **Status:** Todo. **Gate:** M1 complete core shadow pilot.

As a editorial reviewer, I want a recorded quality sample and manual-publication references, so we can judge production/check accuracy before enabling autonomy.

**Dependencies:** US-020, US-021, US-022, US-023, US-024, US-026, US-027, US-028, US-029, US-030, US-031, US-032. **Original tasks:** E07-T05, E10-T05, E14-T04, E14-T05. **PRD:** 07, 08, 09, 11; rollout.

**Acceptance criteria**

- [ ] All four priority formats run through research, production, checks and the calendar in shadow; no automatic publish call occurs.
- [ ] A native reviewer records sampled findings and agreement with check decisions; critical findings return affected work to held and regression examples.
- [ ] Staff can export/manual-publish permitted output and record the resulting platform ID/reference; audit cadence and shadow evidence are visible.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-033-ST01 | BE + FE | Add native-review sample/results records and a lightweight due-review view using the existing check/audit screens. | Todo |
| US-033-ST02 | BE + FE | Allow authorized manual-publication reference recording in shadow without invoking automated publishing. | Todo |
| US-033-ST03 | FA + QA | Run the scheduled sample across enabled formats and record check agreement, critical findings and regression updates. | Todo |
| US-033-ST04 | PO + QA | Accept the complete core-format shadow demo and retain unresolved qualification conditions; autonomy stays disabled. | Todo |

**Demo:** Review all priority formats in shadow, record native audit results and attach a manual-publication reference.

<a id="us-034"></a>

### US-034 — Use a secure hosted pilot environment with traceable releases

**Type:** Technical enabler. **Status:** Todo. **Gate:** Before hosted pilot use.

As a operator, I want a deployed protected dashboard and bounded worker stack, so the team can use the MVP outside developer machines.

**Dependencies:** US-005, US-008, US-009, US-015, US-023. **Original tasks:** E14-T01, E14-T02, E01-T06. **PRD:** NFR security/reliability/observability.

**Acceptance criteria**

- [ ] A release-tagged frontend/API/worker stack serves HTTPS on one origin with secrets injection, one scheduler and bounded resource/concurrency settings.
- [ ] Session/CSRF/role, private-media/export, upload and source-fetch boundaries pass hosted checks; untrusted source text cannot alter tools/rules.
- [ ] The deployment/migration procedure records image/config versions and rollback boundaries; CI includes the implemented critical browser journeys.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-034-ST01 | OPS + BE | Prepare the small hosted stack, same-origin routing, secrets injection, media access, health and resource/concurrency limits. | Todo |
| US-034-ST02 | BE + QA | Verify hosted session/permission/upload/source-fetch protections and restrict provider actions to fixed typed application capabilities. | Todo |
| US-034-ST03 | OPS | Document and execute release-tagged deployment, explicit migrations and previous-version recovery boundaries. | Todo |
| US-034-ST04 | QA + FE + BE | Run relevant container/browser security and operator journeys against the hosted release; record evidence and versions. | Todo |

**Demo:** Use the hosted release as operations/admin, follow a correlated failure and inspect the release/security evidence.

<a id="us-035"></a>

### US-035 — Restore pilot data and clean up only records past retention

**Type:** Technical enabler. **Status:** Todo. **Gate:** Before autonomous release.

As a operations owner, I want a proven restore and conservative retention process, so we can recover and keep only the agreed history.

**Dependencies:** US-008, US-018, US-023, US-034. **Original tasks:** E14-T03, E14-T01. **PRD:** NFR retention/reliability.

**Acceptance criteria**

- [ ] Database, media, configuration and secret-reference/access recovery are documented and a representative isolated restore succeeds.
- [ ] Scheduled backups are monitored and the proposed recovery targets are measured against the chosen environment.
- [ ] Retention cleanup follows approved periods and preserves active tests, required published/audit/check evidence and rights dependencies.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-035-ST01 | OPS + BE | Implement scheduled database/media backups with integrity/recovery evidence and failure monitoring. | Todo |
| US-035-ST02 | OPS | Restore into an isolated environment and retrieve representative drafts, media, audit and run records. | Todo |
| US-035-ST03 | BE | Implement retention selection/dry-run/deletion with protections for referenced published/rights/test records. | Todo |
| US-035-ST04 | QA + OPS | Verify retention fixtures and document restore timing, release/migration rollback boundaries and secret-access recovery. | Todo |

**Demo:** Restore an isolated backup, open a recovered draft/asset and preview retention selections before cleanup.

<a id="us-036"></a>

### US-036 — Prepare publish-ready media containers without sending a post

**Type:** User story. **Status:** Todo. **Gate:** Publishing preparation only.

As a admin, I want inspectable Instagram preparation results for each core format, so the connector can be validated before automated dispatch is permitted.

**Dependencies:** US-002, US-009, US-014, US-020, US-022, US-027, US-030, US-031, US-034. **Original tasks:** E09-T01, E09-T03. **PRD:** 08, 10, 12, 13.

**Acceptance criteria**

- [ ] The version-pinned adapter validates capability, credential and quota state and prepares containers/readiness for authorized test media.
- [ ] Recorded container IDs are reused safely; expiring media URLs remain reachable for provider ingestion without exposing unrelated media.
- [ ] The preparation flow never publishes a post, and unsupported options, expiry or provider errors map into the existing exception contract.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-036-ST01 | INT | Implement adapter methods for capability/quota, container creation/status and response/error mapping. | Todo |
| US-036-ST02 | BE + INT | Issue scoped publisher-reachable media access and persist container identifiers/readiness tied to immutable revision. | Todo |
| US-036-ST03 | FE | Expose preparation status/history through draft/run details without adding a bypass-publish control. | Todo |
| US-036-ST04 | QA + INT | Verify authorized core-format preparation, ID reuse, expired access, token/quota error and zero-publication behavior. | Todo |

**Demo:** Prepare core media containers, inspect recorded readiness and prove no publish call has occurred.

<a id="us-037"></a>

### US-037 — Publish one due single-image item safely on an authorized test account

**Type:** User story. **Status:** Todo. **Gate:** Authorized integration test; not general rollout.

As a admin, I want one guarded, recoverable automatic single-image send, so the first external side effect has complete duplicate and uncertainty protection.

**Dependencies:** US-014, US-020, US-021, US-022, US-023, US-024, US-035, US-036. **Original tasks:** E09-T02, E09-T03, E09-T04, E09-T05, E09-T06, E10-T02, E10-T05. **PRD:** 06, 11, 12, 13; rollout.

**Acceptance criteria**

- [ ] A due checked single-image revision on an explicitly authorized test account publishes once with durable intent, final hard gates and saved remote ID/link.
- [ ] Duplicate jobs/concurrent workers and response-loss-after-success do not create another public post; inconclusive reconciliation holds without resend.
- [ ] Pause/cancel/shadow/quota/token/rule/revision/rights changes prevent new dispatch authorization; crashes and broker restart recover from durable state.
- [ ] Test-account autonomy has recorded admin qualification and isolated test authorization; company-account rollout remains gated by US-043.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-037-ST01 | BE | Implement unique publication intent, account/intent lease, conditional claiming and expiry recovery using PostgreSQL. | Todo |
| US-037-ST02 | BE + INT | Implement final send-time revalidation and a separate immediate pre-dispatch pause/cancel authorization check. | Todo |
| US-037-ST03 | INT + BE | Dispatch using recorded container identity, persist success and implement ambiguous-response reconciliation with hold on inconclusive evidence. | Todo |
| US-037-ST04 | BE | Add periodic due/reconciliation recovery sweep and explicit test-account shadow/qualified-autonomous controls with audited authorization. | Todo |
| US-037-ST05 | QA | Run duplicate/concurrent, timeout-after-acceptance, worker/broker crash, pause/cancel race, stale-revision and quota/token failure fixtures. | Todo |
| US-037-ST06 | INT + QA | Perform the authorized real single-image test and compare one actual public record to stored IDs/timestamps; preserve redacted evidence. | Todo |

**Demo:** Show one authorized image publication, replay the job and simulate a lost response without creating another post.

<a id="us-038"></a>

### US-038 — Publish Reels and image/video Stories through the same safety gates

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a admin, I want the remaining priority formats on the validated publisher, so the full core format set shares proven retry and control behavior.

**Dependencies:** US-027, US-030, US-031, US-036, US-037. **Original tasks:** E09-T01, E09-T03, E09-T04, E09-T05, E09-T06. **PRD:** 08, 12, 13.

**Acceptance criteria**

- [ ] Authorized real-account Reel, image-Story and video-Story sends retain platform identity, available link and attempt/reconciliation history.
- [ ] Each format applies capability/media readiness/quotas and the same durable-intent/current-check/pause/rights rules.
- [ ] Unsupported options and format/account failures produce actionable holds without blocking another account or format; no new bypass flow is introduced.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-038-ST01 | INT | Extend the validated dispatch adapter across core Reel/image-Story/video-Story container and readiness details. | Todo |
| US-038-ST02 | BE + FE | Map outcomes and platform-link availability into publication, calendar and exception views. | Todo |
| US-038-ST03 | QA | Apply duplicate/lost-response/quota/token and per-account/format-isolation scenarios to the expanded format set. | Todo |
| US-038-ST04 | INT + QA | Perform authorized actual sends for all remaining core formats and retain provider-specific success/failure evidence. | Todo |

**Demo:** Show authorized Reel and image/video Story results plus a format failure isolated from another successful job.

<a id="us-039"></a>

### US-039 — Collect available post and Story metrics with their observation windows

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want freshness-labelled metrics for published IDs, so I can distinguish actual performance from unavailable or missed data.

**Dependencies:** US-002, US-023, US-033, US-038. **Original tasks:** E11-T01, E11-T02, E10-T04. **PRD:** 06, 14; observability.

**Acceptance criteria**

- [ ] Available reach/impression, engagement, click and watch metrics retain published ID, value/status, provider version and observation time/window.
- [ ] Unsupported, restricted, delayed or missing values show explicit reasons and last successful sync; they are never converted to zero.
- [ ] Story collection follows the tested availability window for the selected API flow; missed windows and repeated sync failures are visible and alertable.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-039-ST01 | INT + BE | Implement normalized metric observations and the version/capability-aware collector for actual published IDs. | Todo |
| US-039-ST02 | INT | Document tested Story metric availability and configure age-based collection inside that window. | Todo |
| US-039-ST03 | BE + FE | Schedule/retry safe collection and expose values, unavailable reasons, windows and sync freshness on publication detail. | Todo |
| US-039-ST04 | BE + OPS | Connect repeated failure and sync-gap events to the deduplicated operational alert channel. | Todo |
| US-039-ST05 | QA + INT | Verify real supported post/Story metrics plus restricted/missing/delayed/missed-window and collection-replay fixtures. | Todo |

**Demo:** Show supported real metrics and their windows; contrast with explicit unavailable and missed-Story-window states.

<a id="us-040"></a>

### US-040 — Read weekly reports with fair comparisons and sample sizes

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want a Persian performance report filtered by account and content dimensions, so I can compare results without mixing different post ages or hiding missing data.

**Dependencies:** US-010, US-026, US-039. **Original tasks:** E11-T03, E11-T04, E02-T04. **PRD:** 14, 15.

**Acceptance criteria**

- [ ] Weekly/date-range reports filter by account, format, topic and posting time and show volume, top posts, period movement and sample size.
- [ ] Comparisons use equivalent observation windows and documented calculations; incomparable/partial data is labelled or excluded with explanation.
- [ ] Persian charts and table alternative show units, source-post links and last sync, including empty and stale-data cases.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-040-ST01 | BE | Implement deterministic report queries and calculations with equivalent-age/window cohort selection. | Todo |
| US-040-ST02 | FE | Build account/date/format/topic/time filters and Persian chart/table views with source-post drilldown. | Todo |
| US-040-ST03 | FE + BE | Expose sample sizes, comparison windows, exclusions, last sync and partial/unavailable states. | Todo |
| US-040-ST04 | QA | Verify known-answer fixtures, cross-account isolation, date/calendar boundaries and unequal-window exclusions. | Todo |

**Demo:** Filter a weekly Persian report, open source posts and reproduce one equivalent-window comparison.

<a id="us-041"></a>

### US-041 — See a concrete experiment proposal backed by actual posts

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want an explainable analytics recommendation with evidence, so I can see exactly what change is proposed and why.

**Dependencies:** US-012, US-026, US-040. **Original tasks:** E12-T01, E12-T04. **PRD:** 15, 16.

**Acceptance criteria**

- [ ] The analytics role receives code-calculated comparisons and proposes one hook/duration/topic/format/slot change with a success metric.
- [ ] Each proposal cites actual source posts, baseline/comparison, observation window and sample size; unsupported claims are rejected.
- [ ] The UI labels insufficient evidence and does not change the calendar merely because a recommendation exists.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-041-ST01 | INT + BE | Define a structured proposal contract constrained to real calculated report evidence and supported test variables. | Todo |
| US-041-ST02 | INT | Implement the configured analytics role and reject missing/fabricated post references or unsupported conclusions. | Todo |
| US-041-ST03 | FE | Build proposal detail with comparison, sample/window, metric and linked source posts. | Todo |
| US-041-ST04 | QA | Verify one concrete evidence-backed proposal, sparse-data display and fabricated-evidence rejection with no calendar side effect. | Todo |

**Demo:** Open a one-variable proposal with exact posts/sample/window and show sparse evidence leaving the calendar unchanged.

<a id="us-042"></a>

### US-042 — Schedule only qualified tests and feed bounded results back into planning

**Type:** User story. **Status:** Todo. **Gate:** Core implementation.

As a operator, I want automatic evidence-gated calendar tests I can pause or dismiss, so learning improves planning while sparse evidence leaves the plan unchanged.

**Dependencies:** US-011, US-014, US-022, US-026, US-040, US-041. **Original tasks:** E12-T02, E12-T03, E12-T04. **PRD:** 03, 11, 16.

**Acceptance criteria**

- [ ] Deterministic checks enforce minimum sample/window, one-variable test policy, allowed formats, spend/posting limits and no duplicate/conflicting active test.
- [ ] Qualified proposals enter the existing checked planner; sparse/ineligible evidence and repeated syncs create no calendar change or duplicate experiment.
- [ ] Staff pause/dismiss is respected before future work/dispatch; measured outcomes use matched windows and can remain inconclusive.
- [ ] Versioned bounded findings update topic/planning scores with evidence and audit, without changing prompts, hard gates or account limits.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-042-ST01 | BE | Implement proposal eligibility and durable deduplicated experiment creation under existing slot/budget/quality rules. | Todo |
| US-042-ST02 | BE + FE | Add test state/evidence UI and revision-safe pause/dismiss actions respected by planning and dispatch. | Todo |
| US-042-ST03 | BE + INT | Collect matched-window test outcomes and implement bounded versioned score/planning adjustments with provenance. | Todo |
| US-042-ST04 | QA | Verify sufficient/sparse/budget-limited/duplicate/paused/dismissed fixtures and inconclusive results; assert unchanged calendar where required. | Todo |

**Demo:** Schedule one eligible test, replay evaluation without duplication, then pause/dismiss it and inspect bounded feedback.

<a id="us-043"></a>

### US-043 — Qualify and enable one company account for core autonomous operation

**Type:** User story. **Status:** Todo. **Gate:** M2 autonomous core pilot.

As a admin, I want an explicit evidence-based rollout decision, so the team can let all core formats run while handling exceptions.

**Dependencies:** US-033, US-035, US-038, US-039, US-040, US-042. **Original tasks:** E14-T04, E14-T05, E10-T05, E09-T06, E01-T06. **PRD:** 01–16 core; NFR; rollout.

**Acceptance criteria**

- [ ] Every required core story is accepted, including reports and analytics tests; actual platform, Persian and failure-path evidence is labelled.
- [ ] Shadow sample/accuracy requirements pass for the account and enabled formats; critical factual/rights/sensitive/Persian failures are resolved.
- [ ] An admin enables only the qualified company account; automatic publication requires no per-post sign-off and all pause/budget/hard gates remain active.
- [ ] First autonomous slots are observed, operator drills pass, and unresolved conditions return the account to shadow/paused operation.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-043-ST01 | QA + FA | Run the integrated core regression/failure and actual-render Persian checks; measure draft-ready/dispatch targets at approved pilot load. | Todo |
| US-043-ST02 | PO + QA | Review account-specific shadow sample/check agreement and actual core-format publishing/metric evidence. | Todo |
| US-043-ST03 | OPS + team | Run pause, token expiry, uncertain send, correction/export, backup/restore and provider-outage drills; confirm alert ownership. | Todo |
| US-043-ST04 | BE + FE | Enforce persisted qualification evidence on admin-only shadow-to-autonomous transition, including audit and explicit account scope. | Todo |
| US-043-ST05 | Admin + OPS | Enable the qualified account, monitor first autonomous slots and document outcomes or a return to paused/shadow mode. | Todo |

**Demo:** Review qualification evidence, enable one company account and observe guarded autonomous slots and exception handling.

<a id="us-044"></a>

### US-044 — Produce and publish an image carousel after core stability

**Type:** User story. **Status:** Todo. **Gate:** M3 carousel increment.

As a operator, I want an ordered image carousel using existing evidence and checks, so multi-image content shares the proven production and publishing workflow.

**Dependencies:** US-002, US-024, US-038, US-040, US-043. **Original tasks:** E13-T01, E13-T02, E13-T03. **PRD:** 08, 10, 11, 12, 13, 14, 15.

**Acceptance criteria**

- [ ] Ordered slides use existing source/dataset/copy/rights records with editable copy, item limits and accurate previews/crops.
- [ ] Each child and the whole revision pass checks; child/parent containers are persisted and partial preparation/ambiguous send reconcile without duplication.
- [ ] Calendar, account limits and reports include image carousels and label unavailable aggregate/child metrics; an authorized real test succeeds.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-044-ST01 | INT + FE | Implement ordered image-slide generation/editing and carousel preview/crop using reusable scene assets. | Todo |
| US-044-ST02 | BE + INT | Validate child/whole-carousel revision/rights/disclosure and add durable child/parent preparation and guarded send. | Todo |
| US-044-ST03 | FE + BE | Extend format selection, calendar/limits and metric/report mapping with explicit availability states. | Todo |
| US-044-ST04 | QA + INT | Verify partial child failure, slide-only correction, lost parent response and an actual authorized image-carousel publication. | Todo |

**Demo:** Publish one authorized image carousel and replay a failed/uncertain parent workflow without a duplicate.

<a id="us-045"></a>

### US-045 — Produce and publish video-only and mixed carousels

**Type:** User story. **Status:** Todo. **Gate:** M3 carousel completion.

As a operator, I want ordered video and mixed-media carousel support, so all Phase 1 carousel combinations use the same safe workflow.

**Dependencies:** US-027, US-031, US-044. **Original tasks:** E13-T01, E13-T02, E13-T03. **PRD:** 07, 08, 10, 11, 12, 13, 14, 15.

**Acceptance criteria**

- [ ] Video-only and mixed image/video orders validate item limits, individual media readiness and actual preview/crop/timing.
- [ ] Changing one child invalidates only its dependents and whole-carousel checks; parent publishing retains existing pause/intent/reconciliation safeguards.
- [ ] Actual authorized tests cover both combinations, report availability is honest, and failures do not block another account/format.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-045-ST01 | INT + FE | Extend ordered carousel editing/rendering/preview to video and mixed children. | Todo |
| US-045-ST02 | INT + BE | Apply per-child readiness/media/rights checks and whole-parent current-revision gate to each combination. | Todo |
| US-045-ST03 | BE + FE | Complete video/mixed format, calendar, metrics and report availability mappings. | Todo |
| US-045-ST04 | QA + INT | Verify targeted child retry and ambiguous parent send; retain actual video-only and mixed publication evidence. | Todo |

**Demo:** Show authorized video-only and mixed carousels and a single-child correction with valid siblings reused.

<a id="us-046"></a>

### US-046 — Accept and hand over the complete Phase 1 MVP

**Type:** User story. **Status:** Todo. **Gate:** M3 complete Phase 1 MVP.

As a product owner, I want a traceable complete release with operating ownership, so stakeholders can accept the agreed MVP and the team can maintain it.

**Dependencies:** US-043, US-044, US-045. **Original tasks:** E14-T04, E14-T06, E14-T03. **PRD:** 01–16 complete; NFR; rollout.

**Acceptance criteria**

- [ ] All 16 PRD requirements and NFR/rollout obligations have accepted story evidence, including every carousel combination.
- [ ] No critical duplicate-publication, hard-gate bypass, evidence/rights/security or Persian-quality defect remains open.
- [ ] The delivered release has a tested restore/rollback boundary, operating runbook and named alert/budget/rotation/retention/native-review owners.
- [ ] Known nonblocking limitations, pilot review date and stakeholder acceptance are recorded; later platforms remain outside this release.

**Subtasks — complete in the listed order**

| ID | Owner | Deliverable | Status |
| --- | --- | --- | --- |
| US-046-ST01 | QA + FA | Rerun only the combined acceptance cases affected by the final carousel/release changes and close remaining critical defects. | Todo |
| US-046-ST02 | QA + PO | Complete the PRD/story/original-task evidence matrix and explicitly accept each remaining Phase 1 requirement. | Todo |
| US-046-ST03 | OPS | Exercise restore with publication/metric/carousel records and hand over release recovery, limits and operating schedules. | Todo |
| US-046-ST04 | PO + team | Demonstrate the autonomous end-to-end workflow, exception correction, reports and bounded learning; record final acceptance and review date. | Todo |

**Demo:** Demonstrate complete source-to-publish-to-learning operation and hand over the accepted evidence/runbook.

## Original task to delivery-story mapping

This mapping covers every original task. Accepting one linked story only closes that slice. Check all mapped acceptance criteria before closing the original implementation task; shared infrastructure is implemented once and extended as formats/features arrive.

| Original task | Original specification | Delivery stories |
| --- | --- | --- |
| E00-T01 | Lock the scope and decision register | US-001 |
| E00-T02 | Prove Meta access and publish/insight capabilities | US-002 |
| E00-T03 | Prove a company feed and approved trend sources | US-003 |
| E00-T04 | Benchmark Persian roles and rendering before broad build | US-004 |
| E00-T05 | Define measurable acceptance defaults and pilot load | US-001, US-011 |
| E01-T01 | Bootstrap `/backend` and `/frontend` | US-005 |
| E01-T02 | Build Docker development stack | US-005 |
| E01-T03 | Implement API standards and central errors | US-006 |
| E01-T04 | Create the frontend API/session/error layer | US-006 |
| E01-T05 | Add logs, tracker and health endpoints | US-008 |
| E01-T06 | Add CI and contributor workflow | US-005, US-034, US-043 |
| E02-T01 | Design core flows and validate prototype | US-001 |
| E02-T02 | Implement theme and shared RTL components | US-007 |
| E02-T03 | Build navigation and account/mode context | US-007 |
| E02-T04 | Implement common date/number/chart presentation | US-010, US-021, US-040 |
| E03-T01 | Implement staff authentication and two-role permissions | US-007 |
| E03-T02 | Implement versioned account-rule forms/API | US-010, US-011 |
| E03-T03 | Add integrations and credential lifecycle | US-009 |
| E03-T04 | Add brand kit and rights-aware uploads | US-010, US-018 |
| E03-T05 | Add account list, setup status and health | US-009, US-011 |
| E04-T01 | Implement company-feed ingestion | US-015 |
| E04-T02 | Implement scheduled approved trend inputs | US-025 |
| E04-T03 | Cluster and rank topics | US-026 |
| E04-T04 | Extract and verify claims; calculate datasets | US-016 |
| E04-T05 | Build research/evidence UI | US-015, US-016, US-025, US-026 |
| E05-T01 | Implement stage runner and output contracts | US-013 |
| E05-T02 | Configure approved roles and fallbacks | US-012 |
| E05-T03 | Implement fingerprinted artifact reuse | US-024 |
| E05-T04 | Enforce concurrent budgets and generated seconds | US-014, US-032 |
| E05-T05 | Implement bounded fallback/correction policy | US-014, US-023, US-024 |
| E05-T06 | Add run inspection and benchmark change gate | US-004, US-012, US-013 |
| E06-T01 | Produce brief, copy, storyboard and shot list | US-017, US-027, US-029 |
| E06-T02 | Implement minimal template set | US-018, US-027, US-028, US-029 |
| E06-T03 | Assemble core format outputs | US-018, US-027, US-028, US-029, US-030, US-031 |
| E06-T04 | Implement caption-led audio/subtitle path and optional provider paths | US-027, US-031, US-032 |
| E06-T05 | Build preview, bounded edits, upload and scene retry | US-019, US-024, US-027, US-030, US-031 |
| E06-T06 | Implement asset provenance and disclosure decisions | US-018, US-032 |
| E07-T01 | Implement common check contract and aggregate gate | US-020 |
| E07-T02 | Implement independent Persian review | US-004, US-012, US-020 |
| E07-T03 | Implement evidence, brand, rights and sensitive-topic checks | US-016, US-020 |
| E07-T04 | Implement media and platform validation | US-020, US-027, US-028, US-029, US-030, US-031 |
| E07-T05 | Add explainable check UI and native audit workflow | US-020, US-033 |
| E08-T01 | Generate slots from account rules | US-021, US-026 |
| E08-T02 | Connect production readiness and scheduling | US-021 |
| E08-T03 | Implement calendar and readiness views | US-021 |
| E08-T04 | Implement pause/reschedule/cancel with concurrency safety | US-019, US-022 |
| E09-T01 | Implement version-pinned publishing connector | US-036, US-038 |
| E09-T02 | Implement durable unique publish intent | US-037 |
| E09-T03 | Implement final gate, quotas and dispatch | US-036, US-037, US-038 |
| E09-T04 | Implement uncertain-send reconciliation | US-037, US-038 |
| E09-T05 | Persist publication outcome and recovery sweep | US-037, US-038 |
| E09-T06 | Verify sandbox-to-real-account behavior | US-037, US-038, US-043 |
| E10-T01 | Implement append-only application audit | US-008, US-022, US-023 |
| E10-T02 | Implement global/account kill switches | US-022, US-037 |
| E10-T03 | Implement actionable exception queue and export | US-023, US-024 |
| E10-T04 | Implement notifications and sync/failure alerts | US-014, US-023, US-039 |
| E10-T05 | Implement per-account shadow and autonomy gate | US-021, US-033, US-037, US-043 |
| E11-T01 | Implement version-aware metric collector | US-039 |
| E11-T02 | Implement Story-aware and age-based observation scheduling | US-039 |
| E11-T03 | Implement deterministic weekly/comparable reports | US-040 |
| E11-T04 | Build Persian reports and freshness states | US-040 |
| E12-T01 | Produce evidence-backed test proposals | US-041 |
| E12-T02 | Gate and automatically schedule eligible tests | US-042 |
| E12-T03 | Feed bounded findings into topic/planning scores | US-042 |
| E12-T04 | Build test evidence and pause/dismiss controls | US-041, US-042 |
| E13-T01 | Add ordered carousel production and preview | US-044, US-045 |
| E13-T02 | Add whole-carousel checks and publishing | US-044, US-045 |
| E13-T03 | Extend calendar, metrics and acceptance coverage | US-044, US-045 |
| E14-T01 | Close the small security/retention baseline | US-009, US-015, US-019, US-025, US-034, US-035 |
| E14-T02 | Deploy a small reproducible staging/pilot stack | US-034 |
| E14-T03 | Prove backup, restore and rollback | US-035, US-046 |
| E14-T04 | Run integrated failure, load and Persian acceptance | US-033, US-043, US-046 |
| E14-T05 | Operate shadow pilot and enable qualified core accounts | US-033, US-043 |
| E14-T06 | Close full Phase 1 acceptance and handoff | US-046 |

## Tracker import and working agreement

Import the story file first, then map its stable US identifiers to the tracker's created parent keys before importing subtasks. Parent ID and dependencies are portable local identifiers, not vendor-specific issue IDs. The CSV files use UTF-8 with a BOM, quote multiline acceptance text and leave assignee, estimates, sprint and evidence empty for refinement. They do not create or update any external tracker automatically.

Use this document and these two CSVs as the delivery view. Keep the PRD and roadmap for behavior/contracts, and the original CSV for source mapping. They describe the same scope. Status is a planning snapshot; once a tracker is chosen, designate one authoritative status source and update acceptance evidence there.

Start with US-001. Its deliverable is an agreed pilot decision sheet and reviewed operator flows; it has no story dependencies. US-002–US-004 make the integration/quality assumptions reviewable before broad implementation, and US-005 makes the project runnable. No code implementation or deployment is performed by creating this backlog.
