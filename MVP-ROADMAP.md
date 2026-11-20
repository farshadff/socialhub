# Social Hub MVP implementation roadmap

Planning date: 19 November 2026. Status: implementation has started with the US-005 local scaffold and US-006 API error contract; container and application validation remain pending because Docker, Django/DRF and npm are unavailable in the current workspace.

Product source: [Social Hub Phase 1 PRD](<Social Hub.md>). The PRD remains the authority for product behavior. Technical choices, estimates, operating defaults and thresholds below are implementation proposals unless the PRD explicitly supplies them.

This roadmap delivers the internal Instagram product in the PRD with a Python/Django/DRF backend, React frontend, Persian RTL dashboard, and Docker-based local development. It prioritizes a working vertical slice, reusable templates and a small deployment. All 16 functional requirements remain in scope. An intermediate pilot is not completion of the full MVP.

For implementation, use the ordered [MVP delivery stories and subtasks](MVP-USER-STORIES.md): 46 delivery items (37 user stories, 3 spikes, 5 technical enablers and 1 discovery item) with 189 subtasks, acceptance criteria, dependencies and demos. Import the [parent stories](MVP-STORIES.csv) and [child subtasks](MVP-SUBTASKS.csv) into the team's tracker after mapping local parent IDs. All work starts as Todo; assignees, estimates and sprints are set during refinement.

The original [74-task backlog CSV](MVP-BACKLOG.csv) remains the implementation inventory used for traceability. The delivery-story document maps every original task to its slices. These artifacts cover the same work: estimate and schedule the delivery stories once, while retaining this roadmap for scope, architecture and contracts.

## 1. Product outcome and scope

The MVP is successful when a small operations team can configure company-managed Instagram accounts, let the system research and produce source-backed Persian content, inspect exceptions, and allow checked content to publish automatically. Results must return to reporting and evidence-based calendar tests. Routine operation must not require approval of each post.

### Included

- Admin and operations sign-in; account configuration and admin-only integrations.
- Company-feed sourcing and scheduled industry-trend research, clustering, ranking and repeat avoidance.
- Claim/source provenance, numerical extraction, calculations in code, and chart-ready datasets.
- Configurable models and fallbacks for the PRD's agent roles; stage reuse, budgets and run history.
- Persian scripts, storyboards, scenes, captions, overlays, covers, infographics, animated charts and template-based video assembly.
- Reels, image Stories, video Stories and single-image feed posts first; image, video and mixed carousels after the core formats stabilize.
- Media uploads, previews, crop previews, bounded edits and targeted scene regeneration.
- Independent Persian review, automated checks, rights/disclosure checks, and scheduled native-speaker audits.
- Automatic planning, scheduling, idempotent publishing, quota handling, reconciliation and bounded recovery.
- Shadow-to-autonomous onboarding, global/account pause, sensitive-topic holds, audit and exception exports.
- Available Instagram metrics, weekly reports, comparable observation windows, and evidence-gated automated tests.
- Local Docker environment, CI, centralized errors, structured logs, basic deployment, backup/restore and operating instructions.

### Explicitly outside this MVP

- YouTube, LinkedIn, X and the PRD's later distribution phases.
- Public customer signup, subscriptions, billing, organizations/tenant administration or complex permissions.
- Social inbox, comment management, ads, influencer discovery or features absent from the PRD.
- A general visual workflow builder, autonomous agent framework, vector database, generalized RAG platform or multi-provider marketplace.
- A full timeline video editor, arbitrary motion-design tool or separate searchable asset-library product.
- Kubernetes, microservices, event streaming, event sourcing, multi-region failover or a custom observability platform.

Internal asset records and a few replaceable connector interfaces are necessary for the included features; they do not become separate products.

### Delivery boundaries

| Gate | Deliverable | Allowed operation | Completion condition |
| --- | --- | --- | --- |
| M0 — feasibility and foundation | Real integration evidence, Persian benchmark, local stack and agreed contracts | Development and sandbox only | Initial E00/E01 slices accepted through US-001–US-006 and US-008 with its dependencies; no unresolved capability blocker hidden in a mock; later feature-specific foundation extensions follow their owning stories |
| M1 — core shadow pilot | End-to-end sourcing, production, checks, calendar and exception handling for core formats | System produces/checks; staff publish manually | Required shadow slices of E02–E08 and minimum E10 accepted through US-033 and dependencies; core formats demonstrated; no autonomous sends; later report-specific extensions do not block this checkpoint |
| M2 — autonomous core pilot | Reliable publishing, operational controls, metrics, reports and learning loop | Admin enables each qualified account | E09–E12 accepted and E14 core rollout gates passed |
| M3 — complete Phase 1 MVP | Carousels plus completed acceptance/operations evidence | Qualified accounts and formats operate autonomously | E13 and all E14 work accepted; all PRD rows traced and tested |

Optional generated clips may remain disabled when owned footage/templates meet the brief. Caption-led edits satisfy the PRD's alternative to voiceover. Neither optional path may be presented as supported until it has passed its own evaluation.

## 2. Small, changeable technical architecture

### Stack and version policy

| Area | Decision | Reason and boundary |
| --- | --- | --- |
| Backend | Python, Django, Django REST framework; modular monolith | One deployable application, familiar ORM/admin, explicit business services and straightforward migrations |
| Version baseline | Django 6.1.3 and DRF 3.18.3 are the official releases observed on the planning date; start with a supported Python 3.14 patch | Recheck compatibility with renderer/provider SDKs during E01; pin exact resolved versions in the backend lockfile. Python 3.14 is a proposed compatibility choice |
| Frontend | Latest stable React and React DOM, TypeScript, Vite | Official React documentation currently identifies the 19.3 series. Resolve the latest stable patch at bootstrap; pin React/React DOM together, never use canary by default |
| UI | One RTL-capable component system, preferably MUI with its RTL configuration; React Router, TanStack Query and a small form/schema library | Select once after the Persian prototype. Use component/theme overrides; avoid building a design-system package or adding a second component library |
| Data | PostgreSQL | Canonical state for jobs, budgets, publishing attempts, evidence, audit and metrics |
| Background work | Celery workers, Redis broker, one Celery Beat scheduler | Long-running research, model calls, rendering, publishing and metrics stay outside requests. PostgreSQL records state; Redis is not the source of truth |
| Media | Django storage interface; local named-volume storage; private object storage for hosted environments | Persist originals and rendered outputs. Provide scoped, expiring media URLs reachable by the publisher when needed |
| Rendering | Small versioned templates using HTML/SVG/chart data with a Persian-capable browser renderer and FFmpeg assembly | Benchmark shaping and scene reuse first. No custom editing engine; generate visual text in the renderer instead of asking image models to draw Persian |
| Secrets | Existing managed secrets service for hosted credentials; gitignored local environment files or mounted development secrets | Database stores secret references/metadata, not raw platform/provider credentials. No custom vault |
| Errors | One DRF error contract, structured JSON logs and one hosted error tracker such as Sentry | Correlate frontend, API and worker failures without building monitoring infrastructure |
| Delivery | Root Docker Compose for local; same application images on one small hosted stack | Separate API, worker, render worker and scheduler processes; use managed services where convenient. Hosting provider selected in E00 |

Version evidence: [React versions](https://react.dev/versions), [Django downloads](https://www.djangoproject.com/download/), [DRF release notes](https://www.django-rest-framework.org/community/release-notes/), [Django/Python compatibility](https://docs.djangoproject.com/en/6.1/faq/install/). These are a planning snapshot; E01 owns exact compatible package versions and lockfiles.

Implementation references: [MUI RTL setup](https://mui.com/material-ui/customization/right-to-left/) and [DRF custom exception handling](https://www.django-rest-framework.org/api-guide/exceptions/). The theme must configure both component direction and RTL styles, including portal-based dialogs.

### Monorepo structure

```text
/
  backend/
    config/                  # Django settings, URLs, Celery setup
    apps/
      core/                  # errors, audit, permissions, common utilities
      accounts/              # account rules, brand kits, integration metadata
      research/              # feeds, signals, topics, claims, datasets
      production/            # drafts, revisions, stages, scenes, checks, assets
      publishing/            # slots, attempts, platform connector, reconciliation
      analytics/             # observations, reports, test proposals
    tests/
    pyproject.toml
    <dependency lockfile>
    Dockerfile
  frontend/
    src/
      app/                   # routes, providers, theme, session
      features/              # account, calendar, content, exceptions, reports
      components/            # shared dashboard components
      lib/                   # API client, errors, dates, Persian text helpers
    tests/
    package.json
    <package manager lockfile>
    Dockerfile
  docs/                      # contracts, decisions, benchmark, runbook
  compose.yaml
  .env.example
  README.md
  MVP-ROADMAP.md
```

This is a target layout, not a claim that these files already exist. Each Django app owns its models, serializers, services and tasks. Use short service functions for state transitions and external side effects. Avoid generic repositories over the ORM, a shared cross-language domain layer or premature internal packages. A fixed pipeline and typed provider/connector functions are enough.

### Local Docker contract

- Services: `frontend`, `backend`, `worker`, `render-worker`, `scheduler`, `postgres`, `redis`; optional development mail capture only when the notification transport needs it.
- API/worker/scheduler share the backend image. Render worker uses an image including FFmpeg, browser dependencies and a bundled licensed Persian font. Independent render concurrency prevents large videos from starving publication jobs.
- A fresh checkout needs Docker and Compose, not a host Python/Node installation. Document environment-file creation, image build, migrations, initial admin creation and sample-data commands.
- `docker compose up --build` starts the stack after documented bootstrap. API and frontend reload in development. Database/media persist through ordinary restart; destructive volume reset is an explicit command.
- Default local mode uses deterministic sample feeds, fake model/publisher adapters and publishing disabled. Real-service tests are opt-in and visibly identify the target account.
- Health checks and readiness handle database/broker startup; migrations are a deliberate one-off operation, not raced across every worker startup. CI executes the meaningful backend, frontend and browser checks in containers.

## 3. Product and domain contracts

### Roles and account rules

Use two roles for this internal MVP: **admin** and **operations**. Both can see operational screens. Operations can inspect/edit drafts, reschedule/cancel work, handle supported recovery actions, export held content and pause/dismiss tests. Admins additionally manage users, integrations, credentials, models, rules, budgets, overrides, autonomy and global/account kill switches. Do not expose override controls that bypass the hard publishing gates below. Staff access is granted by an admin; public registration is excluded.

Each account rule set includes source mode, approved feeds/sources, freshness/status/exclusion rules, Persian tone/register/glossary, numeral style, calendar, timezone, brand kit, allowed formats, slot plan/posting limits, sensitive topics, check thresholds, retry/correction limits, model routing, spending limits and experiment evidence thresholds. Source-mode choices (`company`, `trends`, `combined`) are a proposed interpretation to resolve in E00.

Keep a validated, versioned rule document with a schema and sensible form fields. Record the rule version on production runs. Rule changes invalidate relevant checks for unpublished content; avoid a general rules-expression language.

### Minimum persistence model

These are logical records, not a requirement to create a table for every row. Use normal relational constraints for identity, money and state, with JSON for versioned agent outputs and flexible scene specifications.

| Record | Minimum content and invariants |
| --- | --- |
| User / Account / AccountRuleVersion | Roles; internal Instagram account identity; active rule version; timezone; mode; pause and autonomy flags. Never trust an account ID supplied by the browser without permission checking |
| Integration / Feed / ApprovedSource | Connector type, endpoint, secret reference, eligibility mapping, allowed domain/account, sync cursor/time and health; no embedded credentials |
| SourceItem / Topic / TopicEvidence | Stable external identity, canonical link, fetched/source timestamps, retained evidence excerpt or snapshot where permitted, cluster key, component scores and coverage history |
| Claim / DatasetVersion | Source-backed value/text, unit, date, source locator and verification status; structured rows, calculation inputs/formula/version and conflicts. Money/ratios use explicit units and precision |
| Draft / ContentRevision | Account, topic, source mode, format, brief, current revision, script/caption/cover, workflow state and hold reason. Checks and output assets refer to a specific revision |
| Scene / Asset | Stable scene ID, ordered timing/specification and dependency fingerprints; immutable asset hash, storage key, origin, rights document/expiry, disclosure metadata and render version |
| StageRun / ModelRoleConfig | Stage, revision, model/provider/version, prompt version, schema version, attempt, inputs/outputs, latency, usage, cost, status, dependency hashes and error reference |
| BudgetLedger / Reservation | Draft/account/month scope, currency, reserved and actual cost, generated seconds, provider request identifier and reconciliation status; atomic enforcement across workers |
| CheckResult | Check type, revision and input hashes, rule/checker versions, pass/fail/uncertain, normalized score, reason, affected claims/scenes and remediation |
| Slot / PublicationAttempt | Account/time/format, draft revision, unique local publication intent, platform container/media ID, provider status, request/reconciliation timestamps and final URL when available |
| MetricObservation | Published ID, metric name, value or unavailable status/reason, provider/API version, observed time, observation age/window and last successful sync |
| TestProposal / CalendarTest | Evidence posts, cohort/window, sample size, proposed variable, baseline, success metric, eligibility, budget/slot limits and active/paused/dismissed/completed state |
| AuditEvent / Notification | Actor or service, action, account/resource, time, reason, relevant before/after values and correlation ID; alert deduplication/delivery state |

### Workflow and revision safety

```text
Source candidates -> ranked topic + evidence -> verified claims/dataset
  -> planned brief -> copy/storyboard/scenes -> assets/render
  -> source + Persian + brand + media + rights + platform checks
  -> ready -> scheduled -> publishing -> published -> metrics -> reports/tests

Any production/check step -> bounded retry or targeted revision -> affected checks
Unresolved/uncertain/policy/budget condition -> held -> corrected and rechecked
Exhausted technical recovery -> failed -> explicit recovery or export
Cancellation -> cancelled; never automatically revived
```

- Dashboard states: `production`, `ready`, `scheduled`, `publishing`, `published`, `held`, `failed`, `cancelled`. Internal stage and uncertain-send status remain separate fields so a timeout is not mistaken for a safe retry.
- Scheduling requires all required checks to pass at or above account thresholds for the current revision. `uncertain` never counts as pass. Model scores are configured decision signals, not proof of calibrated probability; benchmark thresholds against human labels.
- Editing copy, sources, a dataset, scenes or assets creates a new immutable revision, invalidates dependent outputs/checks and prevents the old scheduled revision from being sent. Reuse unaffected assets only when their dependency hashes still match.
- Rights expiry, changed account policies, token validity, current quota, pause state, mode and current revision are checked again at send time. Hard gates include missing evidence, unsupported/conflicting figures, missing/expired rights, unmet required disclosure, failed/uncertain checks, sensitive-topic rules, exhausted budget, unsupported format and active pause.
- A manual override can select another eligible topic, change an editable input or request a bounded recheck with an audited reason. It cannot turn a hard failure into an autonomous publish. Any future policy exception requires a separate explicit product decision.
- Every stage has a timeout, retry count, correction-loop count, spend ceiling and terminal result. A failure for one account or format does not stop other queues/accounts.

Budget configuration must define three independent scopes: lifetime cost per draft, cost per account over its configured accounting period, and total cost per calendar month across accounts. E00 fixes the accounting timezone and currency. Reserve a bounded worst-case amount using provider request/token/duration limits before paid work; reconcile actual provider usage and attributable rendering/regeneration costs afterward. Do not release a reservation after an ambiguous paid response until reconciliation resolves it. Enforce generated seconds separately from monetary cost.

Check scores use a documented 0–1 scale, higher meaning better compliance. Deterministic checks may use 1 for pass and 0 for fail; an uncertain result remains blocking regardless of its score. Thresholds are set per check/account against benchmark evidence rather than copied from an uncalibrated model response.

### Publishing safety contract

1. A due-slot job obtains a database-backed account/intent lease and atomically claims the unique local publication intent. Repeated task deliveries reuse it.
2. It validates the current revision and every send-time hard gate, including an unpaused account in autonomous mode. Shadow mode never issues a publish call.
3. It checks current platform quota, creates/reuses the recorded media container(s), waits for valid media readiness and persists identifiers before progressing. Remote calls occur outside long database transactions; leases and conditional transitions protect concurrency.
4. Immediately before the external send, it rechecks pause/cancellation and dispatch authorization. A kill switch blocks future sends; a request already accepted by the remote platform cannot be recalled by this control.
5. It stores the platform media ID and link on success. If the response is lost, it enters reconciliation, inspects the recorded container/publication status and available platform records, and never blindly resends.
6. If reconciliation cannot prove whether a send happened, it holds the intent for an operator. Reliability means no unsafe retry; a database key alone cannot provide exactly-once delivery across a remote API.
7. Recovery after worker crashes, expired leases or Redis restart uses PostgreSQL intent state and a periodic due/reconciliation sweep. A retry cannot create a second local intent or duplicate a confirmed remote publication.

External platform behavior must be validated, not assumed. Meta documents distinct container creation, status, publishing and quota endpoints, and requires reachable media URLs for fetch-based publishing. E00 records actual capabilities for the selected login flow, account type and API version. [Meta content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing).

## 4. API, centralized errors and operational reporting

### API conventions

- All application endpoints under `/api/v1/`; explicit DRF permissions; allowlisted filters and bounded pagination. Use generated OpenAPI types for the TypeScript client.
- Use Django sessions with secure HTTP-only cookies, CSRF protection and same-origin frontend/API routing. The login endpoint is explicitly CSRF-protected. Development proxy preserves this behavior. No JWT infrastructure is needed for this internal browser product.
- API timestamps are ISO 8601 UTC; send account timezone separately. Calendar/numeral formatting happens at the presentation boundary. Numeric inputs normalize supported Persian/Latin digits while preserving original editorial text.
- Successful resource responses use their documented schema; lists use `{count, next, previous, results}`. Mutations return the updated resource; background actions return `202` with a run ID and status URL.
- Use revision/ETag or an explicit `expected_revision` for edits, rescheduling and recovery. Stale writes return `409` rather than overwriting another operator's changes.
- Use server-side idempotency for create/retry commands with side effects. UI disabling alone is insufficient. Poll status at a modest interval; sockets/live collaboration are unnecessary.

| Endpoint family | Minimum operations |
| --- | --- |
| `/auth/` | CSRF initialization, login, logout, current session; admin-managed staff lifecycle |
| `/accounts/` | List/detail, validated rule updates, brand kit, pause/resume, shadow/autonomous transition and capability/health summary |
| `/integrations/`, `/model-roles/` | Admin configure/test/rotate secret reference; approved models/fallbacks and benchmark status |
| `/research/` | Candidates/topics, component scores, evidence, claims/datasets and source health |
| `/drafts/` | List/detail, revision edit, media upload, preview/crop, stage runs, check results, bounded stage/scene retry and held-content export |
| `/calendar/`, `/slots/` | Date-range list, planned/open slots, reschedule/cancel, readiness and hold reasons |
| `/exceptions/` | Filtered held/failed/uncertain sends; permitted remediation with reasons and run links |
| `/publications/` | Attempt/reconciliation history and platform record; no bypass-publish endpoint |
| `/reports/`, `/tests/` | Metrics/report filters and windows, evidence-backed proposals, pause/dismiss test |
| `/audit/`, `/controls/` | Scoped audit history and admin global pause/resume |
| `/health/live`, `/health/ready` | Process/readiness checks; protected operational detail where appropriate |

Exact routes and payloads are written in E01 and extended alongside features; this table defines coverage, not a frozen endpoint count.

### One error contract

```json
{
  "error": {
    "code": "validation_error",
    "message": "اطلاعات واردشده معتبر نیست.",
    "fields": [
      {"path": "posting_limits.daily", "code": "min_value", "message": "مقدار باید بیشتر از صفر باشد."}
    ],
    "request_id": "d2f1f843-9fc5-48a8-8dbe-cea02fc87f79",
    "retryable": false
  }
}
```

- Central DRF exception handler and Django middleware normalize serializer errors, nested/list fields, domain errors, CSRF/auth rejection, missing resources, method errors, throttling, conflicts and uncaught application exceptions. Reverse-proxy failures use a safe frontend fallback when they cannot supply JSON.
- Stable English machine codes; useful Persian operator messages; consistent field paths; `request_id` also in `X-Request-ID`. Never expose stack traces, SQL, raw provider bodies, secrets or unpublished content in public error payloads.
- Document actual session-auth semantics: DRF session authentication may return `403` for unauthenticated requests. Select and test a consistent contract, such as `403 authentication_required` versus `403 permission_denied`, and make the client distinguish codes without assuming every session failure is `401`.
- Status families: `400` validation, `401/403` per the selected auth contract, `404` missing, `409` state conflict, `413` oversized upload, `429` throttled, `502/503/504` external-service failure/unavailability/timeout, `500` unexpected. Include `Retry-After` when applicable.
- Frontend has one API error mapper, field-level feedback, session-expiry handling, a recoverable page error and a render error boundary. Retries depend on machine code and operation safety; never auto-retry a mutation because the page timed out.
- Workers record the same machine error classification, correlation ID, stage/run ID and retryability in run state. A provider outage becomes an actionable exception instead of an unexplained stalled spinner.

### Central reporting with a small operating footprint

Send unexpected frontend/API/worker exceptions to one error tracker, tagged by environment, release, request/run ID, account ID and stage. Emit structured logs with duration, model/version, prompt version, usage, reserved/actual cost and outcome. Keep full agent outputs in restricted application records; log only safe identifiers and redacted summaries. Error reporting is fail-open if the tracker is unavailable.

Keep operational errors, content checks and audit records distinct. Expected validation errors do not page admins. Admin notifications cover holds, failures, budget alerts and health conditions required by the PRD, including repeated failures and metric/source sync gaps. Use one selected delivery transport plus dashboard visibility, deduplicate repeated events and link to a remediation screen. No general notification center product is required.

## 5. Persian RTL product design specification

Design for the operator's daily questions: what needs attention, what will publish next, why something was held, and what action safely fixes it. The default dashboard is an operations overview; raw agent transcripts sit behind details.

### Navigation and screens

| Screen | Required content and interactions |
| --- | --- |
| Sign-in | Persian labels, keyboard-friendly fields, clear invalid-session errors; no public registration |
| Overview | Account selector, prominent global/account mode and pause state, upcoming work, exception count, spend against limits, recent sync health |
| Accounts/settings | Source mode, brand, Persian preferences, posting rules and automation; admin integrations/model/budget controls; test-connection feedback |
| Research | Ranked topics, timeliness/relevance/audience/evidence scores, original-source links and repeat/conflict explanations |
| Content list/detail | Filterable states; media preview and crop; copy editor; scenes and targeted rerender; evidence, checks and run history; current revision clearly identified |
| Calendar | Week/list view first, account timezone and selected Jalali/Gregorian display; visible open/held/ready/scheduled slots; reschedule/cancel using accessible forms |
| Exceptions | Prioritized actionable queue; plain-language reason, affected checks/scenes, bounded retry or edit, export; uncertain send distinctly marked |
| Reports/tests | Account/date/format/topic/time filters, comparable-window charts and sample sizes, unavailable metrics, last sync; test evidence and pause/dismiss actions |
| Audit | Filter by account/action/date/actor; readable reason and link to the affected item |

Use a right-side desktop navigation rail and responsive drawer. Put account context, date range and mode in consistent locations. Progressive disclosure keeps detailed evidence, model output and provider diagnostics available without filling every screen with technical fields.

### Interaction and visual acceptance

- Root `lang="fa"` and `dir="rtl"`; CSS logical properties; RTL-aware components, popovers and focus order. Isolate Latin URLs, handles, identifiers and code with `bdi` or explicit LTR wrappers. Mirror directional icons only when their meaning is directional; do not mirror media controls or charts blindly.
- Use a licensed, bundled Persian font in browser UI and rendered assets. Define spacing, typography, semantic colors, focus styles and density once. Prefer a calm light theme for MVP; dark mode is not required.
- Status uses text and icon as well as color. Suggested labels: در حال تولید، آماده، زمان‌بندی‌شده، در حال انتشار، منتشرشده، متوقف‌شده، ناموفق، لغوشده. Distinguish a held item from an account pause in helper text.
- Forms have visible labels, helpful defaults, inline field errors, a summary for multiple failures and explicit save feedback. Preserve edits on recoverable errors; warn before navigating away from unsaved changes. No silent autosave of editorial changes.
- Global/account pause stays visible to admins. Confirmation names the affected account/scope and consequences. Resume never silently publishes held backlog: preview eligible items, explicitly reschedule and recheck them.
- Show empty, loading, error, offline/stale, permission-limited and partial-data states for every main screen. A legitimate open slot must say no eligible topic, not look like a broken scheduler.
- Calendar display preference and account timezone remain explicit. Convert Jalali input to canonical instants with a tested library; test month/year boundaries. The UI's language is Persian; account digit/calendar preferences also apply to generated content as configured.
- Charts use readable Persian labels, units, source/context, accessible tooltips and a table alternative. Keep chronological/numeric direction explicit; retain comparable windows and sample size next to conclusions.
- Keyboard access, visible focus, screen-reader names, adequate contrast and practical touch targets are required. Check desktop and narrow-screen operational flows; no separate mobile app.
- Previews show actual rendered Persian text, safe areas and format crop. A pretty mockup does not substitute for a rendered font/bidi regression test.

Design deliverables are one short flow map, low-fidelity key screens, a small component/theme sheet and an interactive prototype of exceptions, content review and calendar actions. Validate those with two or three intended operators; avoid weeks of speculative design.

## 6. Scrum backlog

The epic/task inventory below defines the original work packages. Use [the ordered delivery backlog](MVP-USER-STORIES.md) for one-by-one implementation: it splits cross-cutting tasks across complete user outcomes and defines story-level acceptance. Shared task slices are implemented once and extended as features arrive. Release checkpoints accept their required slices; closing an original task waits for all of its mapped slices, including later extensions.

Each epic includes its user outcome, implementation tasks, task-level acceptance and dependencies. Owners are roles, not extra hires: **BE** backend, **FE** frontend, **INT** integrations/media/AI engineer, **UX** designer, **QA** testing owner, **PO** product owner, **FA** native Persian reviewer, **OPS** delivery/operations owner. One person may cover several roles.

Sizes are refinement aids: **S** roughly one engineering day, **M** two to three, **L** four to five, **Spike** a time-boxed investigation. They exclude external waiting and shared review; they are not commitments. Split L tasks when the team cannot demo and accept them within a sprint. Every task starts as `Todo`; no completion is implied by this document.

### E00 — Prove feasibility and close the small set of product decisions

User story: As the product owner, I can see actual publishing, sourcing and Persian-production evidence before the team builds around unsupported assumptions.

Dependencies: none. PRD: 01–05, 07–10, 12, 14; model selection, NFR and rollout sections.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E00-T01 | Lock the scope and decision register | PO records pilot accounts, source-mode meaning, feed examples, approved research channels, initial formats, brand/rights input, budgets, timezone, thresholds and hosting/secrets choice; unknowns have owners and deadlines | PO + BE / S |
| E00-T02 | Prove Meta access and publish/insight capabilities | Record selected login flow, API version, account eligibility, permission/app-review requirements, token lifecycle and media/feature/metric matrix. Demonstrate core formats and metric access on authorized test accounts; where blocked, record exact missing approval and owner. Validate carousel/disclosure options early; no browser-automation fallback | INT / Spike, 3 days |
| E00-T03 | Prove a company feed and approved trend sources | Fetch representative authenticated feed items and examples of approved search, social-signal and sector-account inputs through permitted interfaces; record mappings, freshness, limits, provenance and gaps; do not assume arbitrary Instagram scraping is available | INT + PO / Spike, 2 days |
| E00-T04 | Benchmark Persian roles and rendering before broad build | Evaluate candidate writer/reviewer roles separately on a fixed Persian set, evidence extraction and multimodal checks; render a chart and short caption-led video. Record accuracy, register, bidi/shaping, latency and total cost per accepted asset including reruns. Pin chosen models/prompts; list optional voice/generated-video decisions | INT + FA / Spike, 3 days |
| E00-T05 | Define measurable acceptance defaults and pilot load | Approve the defaults in section 8 or replace them explicitly; record correction limits, shadow sample/accuracy gate, metrics windows, retention, rights/disclosure procedure and native-audit cadence. Confirm which platform constraints block launch | PO + QA + OPS / S |

Exit: feasibility evidence is attached, external blockers are visible, and unsupported requirements are not silently removed. Independent foundation/design work may proceed during platform approval; autonomous release cannot.

### E01 — Monorepo, Docker and consistent application foundations

User story: As an engineer, I can run and change the whole product locally, rely on one API/error contract and ship a traceable build.

Dependencies: E00-T01; version/connector outcomes inform package choices. PRD: access and NFR foundations.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E01-T01 | Bootstrap `/backend` and `/frontend` | Django/DRF, supported Python, latest stable React/React DOM and TypeScript are locked; minimal API-to-UI request works; settings separate local/test/hosted values; secrets absent from source | BE + FE / M |
| E01-T02 | Build Docker development stack | All services in section 2 start from a clean machine using documented commands; migrations/admin/sample seed work; reload works; database/media survive restart; fake providers cannot accidentally publish | BE + OPS / M |
| E01-T03 | Implement API standards and central errors | OpenAPI, pagination, permission defaults, request IDs and error handler cover section 4; nested validation, CSRF, stale revision, throttle, provider timeout and unexpected-error examples are contract-tested | BE / M |
| E01-T04 | Create the frontend API/session/error layer | Typed client, shared field/global error mapping, request-ID display, error boundary and safe retry/session handling work on fixture errors; no raw exception body reaches users | FE / M |
| E01-T05 | Add logs, tracker and health endpoints | A deliberately triggered FE/API/worker error can be correlated in staging; redaction and tracker-outage behavior verified; readiness distinguishes unavailable dependencies | BE + FE / M |
| E01-T06 | Add CI and contributor workflow | Containerized formatting/lint/type checks, migrations check, backend tests, frontend build/tests and critical browser suite run; CI uses fake services and isolated data; setup and PR checklist documented | BE + FE / M |

Exit: fresh-checkout demo and a failing-provider demo work; CI can reject a broken contract.

### E02 — Persian RTL design and dashboard shell

User story: As an operator, I can navigate in Persian, understand current account/mode and take clear actions on narrow or wide screens.

Dependencies: E00-T01; shell implementation uses E01. PRD: back office and operational controls.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E02-T01 | Design core flows and validate prototype | Exception-to-fix, draft edit/recheck, calendar reschedule and pause/resume flows tested with intended operators; feedback recorded; screen hierarchy and Persian labels approved | UX + PO / M |
| E02-T02 | Implement theme and shared RTL components | Persian font, RTL layout, logical spacing, bidi isolation, forms, tables, status chips, dialogs and accessible feedback pass agreed browser checks | FE / M |
| E02-T03 | Build navigation and account/mode context | Sign-in shell, right navigation, account selector and responsive layout work; roles hide unavailable controls while server still enforces permission; no context loss between screens | FE / M |
| E02-T04 | Implement common date/number/chart presentation | Jalali/Gregorian and digit preferences, UTC/timezone conversions, mixed-script examples and chart/table patterns pass fixed boundary cases; sample empty/loading/error/stale states available to every feature | FE + QA / M |

Exit: usable shell and reviewed operational prototype; feature screens ship with their owning epics.

### E03 — Staff access, accounts, integrations and brand rules

User story: As an admin, I can configure an Instagram account once, protect its integrations and grant staff only the tools they need.

Dependencies: E01, E02, E00-T02. PRD: 01, 05, 06, 09 and security.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E03-T01 | Implement staff authentication and two-role permissions | Admin creates/disables staff; login/logout/session expiry and CSRF tested; operations cannot read credentials, change integration/model rules or enable autonomy, including via direct API requests | BE + FE / M |
| E03-T02 | Implement versioned account-rule forms/API | All rule fields in section 3 validate; invalid combinations are rejected; save records actor/version; relevant unpublished checks become stale after policy changes; account filters apply to list/detail/actions | BE + FE / L |
| E03-T03 | Add integrations and credential lifecycle | Admin-only configure/test/reconnect/rotate; raw secret appears only at secret-entry boundary; database/log/export never reveal it; expiry/revocation produces actionable health state; approved rotation procedure demonstrated | BE + INT / M |
| E03-T04 | Add brand kit and rights-aware uploads | Logo/font/colors and permitted owned/licensed assets can be uploaded with type/size checks and origin/rights metadata; invalid/expired assets cannot become usable; previews match saved configuration | BE + FE / M |
| E03-T05 | Add account list, setup status and health | Operator sees missing prerequisites, source/model/publisher health and shadow mode; account cannot enable automation while incomplete; settings changes are audited | FE + BE / M |

Exit: one company account is configured securely without code changes for its normal rule values.

### E04 — Research, topic selection and trusted datasets

User story: As an operator, I can trace an automatically selected topic and every chart value back to an approved original source.

Dependencies: E03, E00-T03; stage execution uses E05 contracts. PRD: 02, 03, 04.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E04-T01 | Implement company-feed ingestion | Scheduled fetch with timeout/cursor/deduplication; configurable freshness/status/exclusion mapping; stable source IDs/links and ingestion health retained; replaying the same feed creates no duplicate item | INT + BE / M |
| E04-T02 | Implement scheduled approved trend inputs | Approved sources, search/social signals and sector-account sources from E00 are collected on configured cadence; supporting links/times retained; source failure is isolated and visible; unsupported source connectors remain explicit blockers | INT / L |
| E04-T03 | Cluster and rank topics | Structured clustering plus deterministic weighted timeliness/relevance/audience/evidence scoring; save component scores and coverage history; enforce freshness/repeat rules and leave slots open when no eligible topic exists | INT + BE / M |
| E04-T04 | Extract and verify claims; calculate datasets | Claims map to original source locators with units/dates; comparisons execute in tested code; conflicting/unsupported figures are excluded and block dependent content; chart data retains calculation lineage | INT + BE / L |
| E04-T05 | Build research/evidence UI | Ranked topics, score explanation, source health, original-source links and claim/dataset conflict status visible; sample company/trend paths and empty-candidate case can be demonstrated | FE / M |

Exit: both sourcing modes produce a justified brief; unsupported numbers cannot flow into a chart.

### E05 — Fixed agent pipeline, model routing and spend controls

User story: As an admin, I can change a model or retry a failed stage without losing checked work or allowing uncontrolled spending.

Dependencies: E01, E03, E00-T04. PRD: 05 and all named agent roles.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E05-T01 | Implement stage runner and output contracts | Fixed dependency graph, validated structured outputs, run IDs, timeouts and persisted state; duplicate task delivery/crash resumes safely; malformed model output cannot advance a stage | BE + INT / L |
| E05-T02 | Configure approved roles and fallbacks | Admin can assign approved provider/model/version/prompt to every PRD role; fallback is explicit, evaluated and logged; writer and Persian reviewer are separate calls/configurations; no hardcoded vendor routing in feature logic | INT + FE / M |
| E05-T03 | Implement fingerprinted artifact reuse | Stage/scene hashes include revision, upstream inputs, model/prompt/rule/template versions; retry preserves valid outputs; editing a chart input invalidates dependent scenes/checks but not unrelated scenes | BE + INT / M |
| E05-T04 | Enforce concurrent budgets and generated seconds | Atomic reservation before paid calls; per-draft, account and monthly caps include retries and concurrent jobs; actual usage reconciles; uncertain provider charges stay reserved; over-cap work is held with a budget alert | BE / L |
| E05-T05 | Implement bounded fallback/correction policy | Distinguish transient/provider/schema/content failures; exponential backoff for safe technical retries; total correction-loop and cost limits survive restarts; exhausted work becomes held/failed with a specific next action | BE + INT / M |
| E05-T06 | Add run inspection and benchmark change gate | UI shows role/model/version/cost/latency/output by run to authorized staff; model or prompt changes cannot be promoted without passing the fixed Persian/role regression set; benchmark evidence is linked | FE + INT / M |

Exit: fault injection and concurrent-spend tests demonstrate bounded recovery and reuse.

### E06 — Persian content, scenes and core media production

User story: As an operator, I can obtain original source-backed Persian Instagram media and make small corrections without rebuilding every scene.

Dependencies: E04, E05, E03 brand assets, E02 preview patterns. PRD: 07, 08, 09, 10.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E06-T01 | Produce brief, copy, storyboard and shot list | Planner/writer/storyboard outputs share one versioned brief and verified claims; editable hook/script/caption/overlay/cover, timed scenes and asset plan respect account tone/glossary and allowed format | INT + BE / L |
| E06-T02 | Implement minimal template set | Deliver a source-data infographic, animated chart, footage-plus-caption video and motion-graphics explainer; each works with brand tokens, Persian text and relevant format crops; templates are code/versioned config, not a designer tool | INT / L |
| E06-T03 | Assemble core format outputs | Renderer produces validated Reel, image Story, video Story and single-image feed output from templates/owned assets; chart graphics come from datasets; save scene outputs, full preview, cover and caption artifacts | INT / L |
| E06-T04 | Implement caption-led audio/subtitle path and optional provider paths | Caption-led output is usable without speech generation; approved narration when used has alignment/pronunciation checks and an alternate caption-led edit. Generated clips are off by default; any enabled provider passes benchmark, rights/disclosure and seconds/cost enforcement | INT + FA / M |
| E06-T05 | Build preview, bounded edits, upload and scene retry | Staff can upload supported media, edit copy and specific scene inputs, preview crop/safe areas and request targeted rerender; new revision invalidates relevant checks; failed scene retry preserves valid scene artifacts | FE + BE / L |
| E06-T06 | Implement asset provenance and disclosure decisions | Every used asset records owned/licensed/generated origin and usable rights; expired/missing rights block output eligibility; required AI disclosure is carried into supported publishing metadata or held if compliance cannot be achieved | BE + INT / M |

Exit: all four priority format paths render actual Persian media; small scene correction demonstrably reuses unaffected scenes.

### E07 — Independent checks and Persian quality gates

User story: As the account owner, I can trust that content with uncertain evidence, poor Persian or invalid rights cannot be scheduled or published automatically.

Dependencies: E04–E06; E00 benchmark/thresholds. PRD: 09, 10, 11 and rollout controls.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E07-T01 | Implement common check contract and aggregate gate | Every required check returns status, normalized score, reason, revision and affected inputs/scenes; only current all-pass results meeting thresholds allow readiness; stale/fail/uncertain is held | BE / M |
| E07-T02 | Implement independent Persian review | Separate reviewer checks grammar, register, glossary, ZWNJ, numeral style, selected calendar and rendered RTL; fixed regression set includes mixed scripts, digits, dates and brand terms; prompt/model changes run it | INT + FA / L |
| E07-T03 | Implement evidence, brand, rights and sensitive-topic checks | Structured claims checked against sources/calculations; brand rules, rights expiry and required disclosure enforced; sensitive topics always hold; test fixtures prove each hard failure blocks readiness | INT + BE / M |
| E07-T04 | Implement media and platform validation | Automated dimensions/codec/duration/file checks plus rendered-text clipping, subtitle timing, continuity and brand review; current format capability matrix used; failing scenes identified for targeted correction | INT / L |
| E07-T05 | Add explainable check UI and native audit workflow | Staff see pass/fail/uncertain, score, reason, source/scene and available fix; native speaker can record sampled-audit findings on a defined schedule; regressions feed benchmark and hold/disable affected automation as needed | FE + FA + QA / M |

Exit: negative fixtures fail closed, corrected revisions recheck, and audited Persian sample meets the agreed gate.

### E08 — Automatic planning and operational calendar

User story: As an operator, I can see what will publish, leave unsuitable slots empty, and safely pause, reschedule or cancel work.

Dependencies: E03–E07. PRD: 11, 13 and planning parts of 16.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E08-T01 | Generate slots from account rules | Recurring task creates unique timezone-aware slots and chooses eligible topic/format under limits; duplicates/repeated topics excluded; no suitable content leaves an open slot with a reason | BE / M |
| E08-T02 | Connect production readiness and scheduling | Planner works ahead using draft-ready target; only current passed revision enters scheduled; late/not-ready work is held or leaves slot open under a documented policy, never sent with bypassed checks | BE + INT / M |
| E08-T03 | Implement calendar and readiness views | Week/list UI with account/date/format/state filters, explicit timezone/calendar and open-slot explanations; detail links to media, evidence/checks and exceptions; keyboard-accessible actions work | FE / M |
| E08-T04 | Implement pause/reschedule/cancel with concurrency safety | Expected-revision checks prevent stale edits; reschedule revalidates limits/readiness; cancellation is respected by queued jobs; in-flight remote-send limits explained; actions audited; resume requires explicit rescheduling of held items | BE + FE / M |

Exit: calendar reflects durable state and cannot schedule stale or failed content.

### E09 — Instagram publishing, quota handling and reconciliation

User story: As an admin, I can enable publishing without per-post sign-off and know that retries and uncertain responses will not cause duplicate posts.

Dependencies: E00-T02, E07, E08, E10 pause/audit primitives. PRD: 08, 12, 13 and reliability.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E09-T01 | Implement version-pinned publishing connector | Credential handling, format capability check, media reachability, container creation/readiness/publish/result mapping work for every core format on authorized test accounts; provider-specific logic stays behind one small adapter | INT / L |
| E09-T02 | Implement durable unique publish intent | Database uniqueness/lease and conditional state transitions handle duplicate jobs and concurrent workers; existing container/intent reused; confirmed remote media ID stored once | BE / L |
| E09-T03 | Implement final gate, quotas and dispatch | Recheck revision/checks/rights/disclosure/mode/pause and platform/account limits at dispatch; quota exhaustion defers/holds within slot policy; no account monopolizes queue; expired token produces a specific integration exception | BE + INT / M |
| E09-T04 | Implement uncertain-send reconciliation | Lost response after remote acceptance, worker crash and expired lease are tested; query existing container/platform evidence; proven success marked published; inconclusive outcome held without another send | INT + BE / L |
| E09-T05 | Persist publication outcome and recovery sweep | Store platform ID/link where returned, timestamps and attempt history; sweep repairs stranded due/reconciling work after broker/worker restart; platform failures isolated by account/format | BE / M |
| E09-T06 | Verify sandbox-to-real-account behavior | Authorized real-account checks cover core formats and send outcomes; compare UI status to actual Instagram record; retain redacted IDs/timestamps as evidence; fake connectors alone do not close this task | INT + QA / M |

Exit: duplicate-delivery, timeout-after-success, quota and pause-race scenarios pass; real-platform evidence exists.

### E10 — Exception handling, audit, alerts and rollout controls

User story: As an operator, I can resolve the small number of exceptions while admins can stop publishing and understand every consequential action.

Dependencies: E01/E03 primitives; integrate incrementally through E05–E09. PRD: 06, 13, audit and autonomy.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E10-T01 | Implement append-only application audit | Publish, hold, override, correction, cancel, rule/model change, secret-reference rotation, pause and autonomy transitions record actor/service, time, target and reason; authorized read-only UI; no secret values | BE + FE / M |
| E10-T02 | Implement global/account kill switches | Admin pause atomically blocks new dispatch authorizations and moves pending scheduled items to held; worker checks persisted state before sends; no auto-resume; in-flight boundary and per-account isolation verified | BE + FE / L |
| E10-T03 | Implement actionable exception queue and export | Held, failed and uncertain-send items show cause, check/run history and safe next actions; export contains media/copy and source/rights/check manifest without secrets; export generation is access-controlled | FE + BE / M |
| E10-T04 | Implement notifications and sync/failure alerts | Selected single transport delivers deduplicated hold/failure/budget/repeated-failure/sync-gap alerts with deep links; success chatter absent; delivery failure visible without blocking production | BE + OPS / M |
| E10-T05 | Implement per-account shadow and autonomy gate | New accounts start shadow; no publish API invoked; manual publication/reference recording supports pilot metrics where available; admin enables autonomy only with passing sample/accuracy/prerequisite evidence; action audited | BE + FE + QA / M |

Exit: staff can handle a failure without shell/database access; pause and shadow prevent new external sends.

### E11 — Performance collection and trustworthy reports

User story: As an operator, I can compare account results without mistaking missing metrics, unequal post ages or tiny samples for performance changes.

Dependencies: E09 publication records, E00 metric capability evidence; manually recorded shadow IDs may be used where supported. PRD: 14, 15.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E11-T01 | Implement version-aware metric collector | Collect supported reach/impressions, engagement, clicks and video metrics by published ID; unsupported/restricted/delayed/missing metrics get explicit status/reason, never zero substitution; last success and observation time retained | INT + BE / L |
| E11-T02 | Implement Story-aware and age-based observation scheduling | Document tested collection/availability window per supported Story metric and API flow; schedule before access closes and preserve observations; missed windows and sync gaps are visible and alertable | INT + BE / M |
| E11-T03 | Implement deterministic weekly/comparable reports | Calculate volume, top posts, comparable-period movement, sample sizes and available metrics by account/date/format/topic/posting time; use equivalent observation windows; exclude incomparable data with explanation | BE / M |
| E11-T04 | Build Persian reports and freshness states | Filters, readable charts/table alternative, source-post links, sample size, window and last sync shown; missing/partial data has clear Persian explanation; test cross-account and boundary-date filtering | FE / M |

Exit: fixture reports reproduce known calculations; supported real metrics sync and Story collection is validated on the chosen API flow. Meta describes multiple access levels for Insights, so approval and actual metric availability are integration gates. [Meta Insights overview](https://developers.facebook.com/docs/insights/overview).

### E12 — Evidence-gated analytics tests and planning feedback

User story: As an account owner, I can let observed performance improve planning while sparse evidence leaves the calendar unchanged.

Dependencies: E11, E08 and E05 analytics role. PRD: 16.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E12-T01 | Produce evidence-backed test proposals | Analytics agent receives code-calculated comparisons and cites exact source posts, window, sample size and success metric; proposes one concrete hook/duration/topic/format/slot change; unsupported conclusions are rejected | INT + BE / M |
| E12-T02 | Gate and automatically schedule eligible tests | Deterministic code enforces account minimum sample/window, supported formats, spend/posting limits, no duplicate/conflicting active test and unchanged hard checks; eligible test enters planner; sparse/ineligible evidence changes no slot | BE / M |
| E12-T03 | Feed bounded findings into topic/planning scores | Persist versioned, explainable adjustments to code-based scoring/planning; changes stay within account limits; no self-modifying prompts or unrestricted policy changes; repeated metric sync does not schedule duplicate tests | BE + INT / M |
| E12-T04 | Build test evidence and pause/dismiss controls | Staff can inspect rationale/source posts and pause/dismiss; planner respects status before dispatch; gather outcome using matched windows and label inconclusive results without declaring a causal win | FE + BE / M |

Exit: one sufficient-data fixture schedules a bounded test; sparse-data, paused and dismissed fixtures leave future planning appropriately unchanged.

### E13 — Carousels after core stability

User story: As an operator, I can produce and publish image, video or mixed carousels using the same quality and reliability guarantees as core formats.

Dependencies: M2 core-format stability and E00 carousel capability validation. PRD: carousel portion of 08 and phase table.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E13-T01 | Add ordered carousel production and preview | Image-only, video-only and mixed sequences use existing scene/assets and editable copy; ordered preview/crops and item limits follow tested capability rules; failed slide correction reuses valid items | INT + FE / L |
| E13-T02 | Add whole-carousel checks and publishing | Validate each child and overall ordered revision/rights/disclosure; persist child/parent container IDs; partial preparation and uncertain parent send reconcile safely; retries create no duplicate public carousel | INT + BE / L |
| E13-T03 | Extend calendar, metrics and acceptance coverage | Format filters/reports and account limits include carousels; unavailable child/aggregate metrics labelled; authorized real-account test covers all three media combinations and failure recovery | FE + QA + INT / M |

Exit: all carousel combinations work through the same gate, operational controls and reports. M3 cannot close without this epic unless the PO explicitly changes the PRD scope.

### E14 — Security, deployment and MVP acceptance

User story: As the team operating the pilot, I can deploy, restore, pause and diagnose the MVP, and prove the requested behavior works.

Dependencies: incremental from E01; M2 requires core gates, M3 requires E13 as well. PRD: all NFRs and rollout.

| ID | Task/specification | Acceptance criteria | Owner / size |
| --- | --- | --- | --- |
| E14-T01 | Close the small security/retention baseline | Permission/CSRF/session cases, upload limits, private media, signed export/media access, credential redaction and source-fetch SSRF protections tested; admin-approved source domains and redirects cannot reach private/internal networks; untrusted source text cannot invoke tools or modify rules. Retention cleanup preserves required published/audit records | BE + QA / M |
| E14-T02 | Deploy a small reproducible staging/pilot stack | Release-tagged images, HTTPS/same-origin routing, secrets injection, one scheduler, health checks, resource/concurrency limits and migrations runbook; frontend/API/worker versions traceable; previous image/config available for rollback | OPS + BE / M |
| E14-T03 | Prove backup, restore and rollback | Database, media and configuration/secret-reference recovery procedures documented; scheduled backup monitored; restore to isolated environment and representative asset retrieval succeed; migration rollback boundary recorded before rollout | OPS + BE / M |
| E14-T04 | Run integrated failure, load and Persian acceptance | Section 9 scenarios pass with recorded environment/results; expected pilot load meets draft-ready target; native reviewer signs off sample; no open duplicate-publication, bypass, evidence/rights or critical Persian defect | QA + FA + team / L |
| E14-T05 | Operate shadow pilot and enable qualified core accounts | Shadow evidence meets approved sample and accuracy thresholds; operator drills cover pause, correction, export, token expiry and uncertain send; admin explicitly enables each qualified account; monitor first autonomous slots and retain results | PO + OPS + QA / M plus observation time |
| E14-T06 | Close full Phase 1 acceptance and handoff | Carousel evidence added; every traceability row closed; alert ownership, budget/retention/rotation/native-audit schedules and restore/runbook handed over; known nonblocking limitations and pilot review date recorded | PO + OPS + QA / M |

Exit: M2 or M3 gates are accepted using evidence appropriate to their scope. Shipping code does not itself prove platform access, Persian quality or shadow readiness.

## 7. Agent-role implementation mapping

All roles in the PRD remain represented. They are prompt/configuration entries and fixed stages; they do not require separate services, chat interfaces or an orchestration framework. Several roles may share an evaluated model while keeping independent contracts and run records.

| PRD role | Implemented behavior | Owning work |
| --- | --- | --- |
| Source researcher | Feed/source reading and linked candidates | E04-T01/T02, E05-T02 |
| Trend analyst | Topic clustering and structured features; scoring in code | E04-T03 |
| Data analyst | Source-linked extraction and chart dataset preparation; calculations in code | E04-T04 |
| Evidence reviewer | Claim/source verification and conflict handling | E04-T04, E07-T03 |
| Content planner | Shared brief, angle/format/slot proposal subject to rules | E06-T01, E08-T01/T02 |
| Persian writer | Hook/script/caption/overlay/cover text | E06-T01 |
| Persian reviewer | Independent linguistic and rendered-text checks | E07-T02 |
| Storyboard agent | Timed scenes, shots and graphics | E06-T01 |
| Asset agent | Owned/licensed asset selection and missing-shot/generated-clip specification | E06-T01/T04/T06 |
| Motion and assembly agent | Structured scene specs for deterministic templates | E06-T02/T03 |
| Audio and subtitle agent | Caption-led variant; approved narration alignment/pronunciation where used | E06-T04, E07-T04 |
| Media reviewer | Visual/layout/timing/continuity review plus automated probes | E07-T04 |
| Analytics agent | Explanation of calculated results and evidence-backed test proposals | E12-T01 |

Scheduling, rendering, arithmetic, budget enforcement, checks aggregation and publishing remain deterministic application services as required by the PRD.

## 8. Decisions and proposed operating defaults

These numbers are deliberately small starting assumptions, not requirements extracted from the PRD. E00-T05 must approve or replace them before relevant implementation is considered ready. Keep them configurable with units and effective dates.

| Decision | Proposed MVP starting point | Owner / due |
| --- | --- | --- |
| Pilot capacity | 1–3 company-managed accounts; up to 3 planned items/account/day; one active render job per render worker | PO + OPS / E00 |
| Initial content templates | One infographic, animated chart, footage/caption and short motion-explainer template; caption-led by default | PO + UX + INT / E00 |
| Source contracts | One representative company-feed connector and a small approved set covering industry sources, search/social signals and sector accounts | PO + INT / E00; missing required access blocks the affected sourcing mode |
| Source freshness and repeat avoidance | Feed-specific windows and topic cooldown, supplied by editorial owner; do not invent an industry-wide value | PO / before E04 |
| Retry/correction policy | Up to 3 transient technical attempts/stage; up to 2 content-correction loops/item; both share spend caps | PO + INT / E00 |
| Model costs | Explicit currency, conservative reservation and actual-cost reconciliation; draft/account/month caps set from benchmark and pilot budget | PO / before paid pipeline runs; no fabricated currency amount |
| Generated clips | Disabled initially; enable only after quality/cost/rights benchmark; explicit seconds/draft cap required to enable | PO + INT / E00 |
| Draft-ready performance | For a template-based video up to 60 seconds, target p95 planning-to-render-ready under 30 minutes at pilot load, excluding provider-wide outages; plan at least 2 hours ahead | PO + INT / approve after E00 rendering benchmark |
| Dispatch timeliness | Target dispatch within 2 minutes of due time for ready eligible work at pilot load; measure provider processing separately; stale/late slot policy must be explicit | PO + OPS / before E08 |
| Shadow exit | At least 20 varied checked items/account, covering every enabled format; zero critical factual/rights/sensitive-topic/Persian failures and at least 95% human agreement with automated check decisions; continue shadow if unmet | PO + FA + QA / E00; small sample is a ramp-up gate, not a safety guarantee |
| Native-speaker audit | Weekly sample of at least 5 items per active account, including one of every format used that week; sample all items if fewer than 5; critical failure pauses affected automation pending investigation | FA + PO / E00 |
| Test evidence | At least 10 comparable posts per comparison group over at least 14 days and a matched 48-hour post observation window; max 1 active test/account, one changed variable; Story windows chosen from actual API capability | PO + analytics owner / before E12; thresholds are a pilot heuristic, not statistical significance |
| Retention | Drafts/intermediate assets and restricted model outputs 90 days; published artifacts/check evidence/metrics/audit 12 months; redacted operational logs 30 days; protect records required for current rights/audits and active tests | PO + OPS / E00 |
| Notification transport | One existing team-approved admin channel, plus in-product exception visibility; no integration message is sent during roadmap preparation | PO + OPS / E00 |
| Backup/recovery | Daily database/media backup; proposed RPO 24 hours and restore target 4 hours; prove against chosen hosting, including secret access recovery | OPS + PO / before M2 |
| Credential rotation | Provider-supported refresh plus a documented rotation interval/owner; expire/revoke/reconnect drill before autonomy | OPS / before M2 |

If the capability spike finds a required platform feature unavailable, record the blocker, affected requirement and legitimate resolution. Manual media export supports exception handling and shadow operation; it does not satisfy an automatic-publishing requirement. A scope reduction needs an explicit PRD decision.

## 9. Acceptance and test strategy

Use deterministic fixture providers in CI so builds are fast, inexpensive and repeatable. Use authorized real integrations for capability evidence and final publishing/metrics acceptance. Record the distinction on every test result. No global coverage percentage substitutes for the critical scenarios below.

| Scenario | Required result | Main owners/tasks |
| --- | --- | --- |
| Fresh local checkout and restart | Entire stack boots with sample data; persistence works; no real publish in default mode | E01-T02/T06 |
| API/FE/worker error contract | Validation/auth/CSRF/throttle/conflict/timeout/500 handled consistently in Persian; correlation preserved, secrets redacted | E01-T03/T04/T05 |
| Company and trend happy paths | Linked source -> verified dataset -> Persian media -> passed checks -> scheduled -> one publication -> metrics/report | E04–E11 |
| All required formats | Reel, image/video Story and single-image feed accepted at M2; image/video/mixed carousels additionally accepted at M3 | E06, E09, E13 |
| Duplicate/stale input | Feed re-fetch, duplicate stage job and concurrent edit produce no duplicate records or stale publication | E04-T01, E05-T01, E08-T04 |
| Evidence failure | Conflicting dates/figures, unsupported claim or missing source cannot produce a publishable chart/item | E04-T04, E07-T03 |
| Persian regressions | ZWNJ, Arabic/Persian character variants, mixed URLs/handles, numeral modes, Gregorian/Jalali boundaries, register, subtitle timing and rendered shaping pass fixed examples | E02-T04, E07-T02/T04 |
| Model/prompt change | Failed regression/benchmark prevents promotion; accepted change invalidates dependent outputs/checks | E05-T03/T06 |
| Scene correction | Only affected scenes and dependent checks change; untouched valid asset hashes remain identical | E05-T03, E06-T05 |
| Concurrent budgets | Two workers cannot overspend draft/account/month caps; unknown charge stays reserved; generated-seconds cap enforced | E05-T04 |
| Rights/disclosure | Missing or expired license, or required unsupported disclosure, holds item before scheduling and at final send gate | E06-T06, E07-T03, E09-T03 |
| Sensitive/uncertain/low score | Every such required check holds; no admin UI/API action bypasses hard gates | E07-T01/T03 |
| No suitable topic | Slot remains open with reason; no invented/repeated fallback content | E04-T03, E08-T01 |
| Shadow/pause/cancel race | No future dispatch authorization after control commits; scheduled work held/cancelled; remote in-flight outcomes reconciled and disclosed | E08-T04, E10-T02/T05 |
| Lost publish response | Remote success followed by timeout yields one public post; inconclusive reconciliation holds without resend | E09-T02/T04 |
| Quota/token/provider failure | Safe bounded retry/defer/hold; actionable alert; another account continues | E05-T05, E09-T03/T05 |
| Worker/broker crash | Durable sweep recovers outstanding jobs; no lost intent, duplicate post or unbounded reservation | E05-T01/T04, E09-T05 |
| Exception correction/export | Operator safely fixes/rechecks or downloads media/copy with provenance/check manifest; export contains no credentials | E10-T03 |
| Metric availability/window | Unsupported or missing metric labelled; Story deadline respected; no zero substitution or unequal-age comparison | E11-T01/T02/T03 |
| Analytics sufficiency | Eligible evidence schedules one bounded test; sparse data leaves calendar unchanged; pause/dismiss honored | E12-T01/T02/T04 |
| Security boundaries | Operations denied admin endpoints; invalid source redirects/private IPs and unsafe uploads blocked; source instructions cannot alter permissions/tools | E03-T01/T03, E14-T01 |
| Restore and release | Isolated restore recovers representative drafts/assets/intent/metrics; rollback instructions exercised without blind retrying old intents | E14-T02/T03 |

Backend tests focus on state transitions, calculations, budgets, concurrency, permissions and retries using PostgreSQL where locking matters. Frontend tests focus on forms, errors, bidi/date formatting and unsafe-action prevention. Browser tests cover the small set of end-to-end operator journeys. Rendering tests compare known Persian samples and inspect actual media. Native review complements automation.

## 10. Sprint sequence and dependency plan

The story backlog is the current execution order. The epic-based sprint table below remains a capacity baseline; refine it using the story dependencies and release checkpoints, including the early single-image shadow increment. Story decomposition does not add scope or create a second set of engineering estimates.

Planning assumption: three hands-on engineers covering BE, FE and integrations/media, with shared UX, QA/operations and a native Persian reviewer. Use two-week sprints. The task sizes sum to roughly 186–255 working days before external waiting and shared review. At three engineers and about 20% capacity reserved for integration fixes/pilot findings, budget approximately 8–11 sprints (16–22 weeks) for the complete PRD. This is an early sizing range, not a delivery promise. Re-estimate after E00 using actual platform access, benchmark and team velocity.

The eight-sprint sequence below is the optimistic baseline. If tasks land toward the upper size range, use sprints 9–11 for the unfinished core/carousel work and acceptance in the same dependency order. M1/M2 gates permit early real-world validation while the full backlog is still being completed.

| Sprint | Sprint goal | Planned work | Review evidence |
| --- | --- | --- | --- |
| 1 | Prove feasibility and run the monorepo | E00; E01 core setup; E02 prototype | Authorized platform/source evidence, Persian sample render, local API/UI, initial decision log |
| 2 | Configure an account and exercise foundations | Finish E01/E02; E03; E04/E05 contracts | Admin/operations permissions, configured account, typed API and central error demonstration |
| 3 | Produce a trusted source-backed draft | E04/E05 core; E06 first infographic/video slice | Both sourcing paths, lineage and calculated chart, persisted stages and bounded model usage |
| 4 | Run core formats in shadow | Finish E06; E07 core; E08; E10 minimum controls | Four core formats, current-revision checks, calendar, hold/export; M1 if gates pass |
| 5 | Prove safe automated dispatch | E09; remaining E10; E14 security/deploy/backup work | Timeout/retry/pause/quota proofs and authorized real sends; continue shadow observation |
| 6 | Close measurement and qualify core autonomy | E11; finish core E14 checks; start E12 | Actual supported metrics/Story schedule, comparable reports and qualified account evidence; M2 only after E12 also closes |
| 7 | Complete learning loop and add carousels | Finish E12; E13 after core stability | Sparse/sufficient-evidence tests, bounded planning feedback, carousel preparations and previews; M2 if all core gates pass |
| 8 | Close complete MVP acceptance | Finish E13; E14 full acceptance and pilot handoff | Three carousel combinations, full traceability, restore/load/native review and M3 decision |

First usable shadow pilot is targeted around sprint 4 in the optimistic baseline. Core autonomy is targeted around sprints 6–7, conditional on evidence and E12 completion. Complete Phase 1 is targeted within sprints 8–11, with observation/external waiting explicitly tracked. A smaller team, slow provider approvals or failed quality benchmarks moves these targets; it does not delete acceptance criteria.

Critical dependency path:

```text
E00 capability/benchmark decisions -> E01 foundation -> E03 account/integration
  -> E04 trusted research + E05 bounded execution
  -> E06 production -> E07 checks -> E08 calendar -> E09 publishing
  -> E11 measurement -> E12 feedback -> M2 core acceptance
  -> E13 carousels -> E14 final acceptance -> M3

E02 design supports each screen as it ships.
E10 controls/audit and E14 security/operations begin early and gate autonomy.
```

Team work can proceed concurrently by discipline without introducing separate services. Sequence work around a complete thin slice, then add the remaining formats, error paths and acceptance evidence. Do not postpone check/revision, budget, pause or publish-intent primitives until after a publishing demo.

### Scrum working agreements

- **Definition of Ready:** task has an owning role, PRD reference, acceptance examples, dependency/contract, designs for affected screens, known external access and a size the team can finish in a sprint. Unresolved discovery becomes a time-boxed spike.
- **Definition of Done:** implementation and migration reviewed; relevant automated checks pass; changed API documented/types refreshed; Persian states and accessibility checked; permissions/errors/logging/audit covered; fake versus real integration evidence labelled; demo accepted; rollback/operations instructions updated when behavior changes.
- **Backlog fields:** ID, epic, story/outcome, PRD reference, scope, acceptance criteria, owner, size/points after refinement, dependencies, priority, status, sprint, evidence link and known blocker. Use `Todo -> In progress -> Review -> Validation -> Done`; use `Blocked` with a named cause/owner.
- **Priority:** launch safety/capability and a working core vertical slice first; remaining core requirements second; carousels after core stability; no new feature enters without identifying its PRD basis or an explicit scope decision.
- **Planning/refinement:** refine one sprint ahead; split tasks by demonstrable outcome. Keep one sprint goal and reduce work in progress. Do not book 100% of engineer time as feature capacity.
- **Review/retro:** demonstrate actual behavior and failed-path recovery, update estimates from observed throughput, and discuss what slowed change. Track external-approval waiting separately from engineering effort.
- **Change control:** refine templates/prompts/configuration freely within accepted behavior. A change that removes a PRD feature or weakens a gate is a PO decision recorded against the affected traceability row.

Suggested ticket template:

```text
ID / title:
Epic / PRD reference:
As [role], I need [behavior], so [outcome].
In scope / explicit boundary:
Inputs, outputs, API/data/design changes:
Acceptance examples (Given / When / Then):
Failure, permission and concurrency behavior:
Dependencies / blocker owner:
Size / assignee / sprint / status:
Validation evidence (fixture / staging / real provider):
Operational or rollback notes:
```

## 11. PRD traceability and release checklist

| PRD | Required behavior | Owning epics | Release evidence |
| --- | --- | --- | --- |
| 01 | Internal access, account configuration, admin integrations, exception-first operation | E02, E03, E10 | Role-denial tests and configured-account operator demo |
| 02 | Eligible company API items with source identity | E04 | Freshness/status/exclusion and replay fixtures plus representative feed |
| 03 | Scheduled approved trend research, clustering/scoring, links, no repeat/open-slot behavior | E04, E08 | All approved input categories mapped; ranked topics and unsuitable-slot test |
| 04 | Source-linked figures/dates/claims, code calculations, chart data, conflict exclusion | E04, E07 | Reproducible calculation and negative-evidence fixtures |
| 05 | Approved role models/fallbacks, version/cost/output logs, stage reuse and spend caps | E05 | Role configuration, failure/reuse and concurrent-cap proofs |
| 06 | Publish/hold/override/rule audit, actionable admin notifications, global/account pause | E10 | Audit examples, delivered test alert and pause-race evidence |
| 07 | Script/storyboard/shot list, footage/templates/charts, Persian subtitles or approved voice, scene retry, edits and generated-seconds cap | E06, E05, E07 | Real rendered template set, scene-hash reuse and optional-provider enforcement |
| 08 | Core formats then image/video/mixed carousels, editable copy/covers, crop and unsupported-option feedback | E06, E09, E13 | Each format's preview/check/publish proof; capability matrix |
| 09 | Separate Persian reviewer, RTL/ZWNJ/digits/calendar/register/glossary, change regression gate and native sample | E00, E02, E05, E07 | Benchmark, rendered regression and scheduled native-review records |
| 10 | Asset origin, required disclosure and blocking missing/expired rights | E03, E06, E07, E09 | Rights/disclosure failure at readiness and send time |
| 11 | Automatic slots, full tri-state checks/scores/reasons, rechecks, pause/reschedule/cancel | E07, E08, E10 | Stale-revision and calendar-control scenarios |
| 12 | Automatic due publishing, no per-post sign-off, no duplicate retry, quotas, ID/link | E09, E10 | Authorized actual publish and lost-response/concurrency proofs |
| 13 | States, bounded fallback/correction, verify uncertain sends, held reasons, media/copy export | E05, E09, E10 | Fault-injection and operator recovery/export demo |
| 14 | Available post/Story metrics by ID, explicit unavailability/sync time/windows | E11 | Real supported metrics and Story-window capture evidence |
| 15 | Weekly reports by account/date/format/topic/time, volume/top/movement/sample/equal windows | E11 | Known-answer report fixtures and Persian UI demo |
| 16 | Findings feed scoring/planning, concrete evidenced tests, minimum sample/window/limits, pause/dismiss, sparse-data no-op | E12 | Eligible/sparse/paused/dismissed planning scenarios |
| NFR security | Secrets management/rotation, admin integration restrictions | E03, E14 | Secret/permission checks and rotation drill |
| NFR reliability | Idempotency and account/format isolation | E05, E09 | Crash/duplicate/quota/isolation scenarios |
| NFR observability | Run version/cost/latency/result; repeated failure/budget/sync alerts | E01, E05, E10 | Correlated run and redacted tracker/alert evidence |
| NFR retention/performance/language | Defined retention, target draft latency and fixed Persian regression | E00, E05, E07, E14 | Cleanup, pilot-load timing and regression results |
| Rollout | Shadow then admin-enabled autonomy; immediate controls; sensitive/low-score holds | E07, E09, E10, E14 | Account qualification record and control drills |

Before M2, accept all core traceability rows, E12 included, with the carousel portion explicitly outstanding. Before M3, every row is accepted with real integration evidence where required, all carousel combinations complete, no critical safety or language defect open, and an operating owner assigned.

The first implementation step is E00's short capability and Persian-production work alongside E01's local skeleton. Its output determines the smallest credible source-to-Persian-media slice; the remaining backlog expands that slice into the complete Phase 1 behavior above.
