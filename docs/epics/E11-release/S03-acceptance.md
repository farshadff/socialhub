# E11-S03 — End-to-end acceptance and pilot dry run

| | |
| --- | --- |
| Epic | E11 Release |
| Priority | Must |
| Estimate | BE 1 d · FE 1 d · QA 4 d |
| Depends on | Every story in E00–E10; E11-S01; E11-S02 |
| Needed by | Go-live (exit gate of the MVP) |

## User story

As the product owner, I want proof that the whole ten-step workflow runs end to end — automatically on every change, and once for real on a throwaway Instagram account — so that I can connect a valuable account knowing the system plans, produces, checks, publishes, measures and feeds back without a developer stepping in.

## Context

Each story tests its own rules with unit and API tests. None of them proves that the steps connect: that an approved script really becomes a rendered asset that passes the checks, lands on the calendar, publishes once, collects metrics and returns as a finding in next week's plan. This story adds that proof in two forms:

1. **An automated acceptance suite** that drives the API of the full Compose stack (real Postgres, Redis, Celery workers, render worker with Chromium and FFmpeg) with fake AI and fake Instagram providers, a controllable clock and scriptable failures. It runs in CI.
2. **A pilot dry run**: one real plan week on the production deployment from E11-S02, with real Claude, OpenAI and Instagram (`instagrapi`) on a disposable account, followed by a go-live checklist.

The six points of "Definition of done for the MVP" in [ROADMAP.md](../../ROADMAP.md) section 4 are the pass criteria. Rules about publishing safety come from E08-S03 and E08-S04; QC outcomes from E07; feedback loops from E10.

Names follow the E11 README: the suite lives in `backend/tests/acceptance/`, the seed is `manage.py seed_demo --profile acceptance`, and the pilot checklist is `docs/operations/PILOT-DRY-RUN.md`.

## Scope

**In**

- Test-only hooks in the API (reset, fakes, clock, run a periodic task, idle check), compiled in only when `SOCIALHUB_TESTING_HOOKS=true`.
- A controllable clock shared by the API and every worker.
- The `acceptance` seed profile.
- A Compose overlay for the acceptance stack and a fixture HTTP host for RSS and JSON feeds.
- 22 API scenarios (AC-01 to AC-21 and AC-12b) covering all ten workflow steps, the three QC outcomes, publishing failures, both feedback loops and manual fallback.
- A short Playwright smoke of the panel against the same stack.
- A CI job that runs both.
- `docs/operations/PILOT-DRY-RUN.md`: day-by-day pilot checklist, pass criteria, issue log template, go-live checklist; executed and signed.

**Out (later)**

- Load, soak and performance tests.
- Visual regression tests of rendered assets (the design check and the pilot cover appearance).
- Contract tests against live Instagram in CI. Real-provider checks happen only in the pilot.
- Chaos testing of Postgres or Redis outages (the runbook procedures in E11-S02 are tried by hand).

## Behaviour and rules

### The acceptance stack

1. The stack is `compose.yaml` plus `compose.acceptance.yaml`, started with `docker compose -f compose.yaml -f compose.acceptance.yaml up -d --build`. The overlay:
   - sets `SOCIALHUB_TESTING_HOOKS=true`, `SOCIALHUB_AI_TEXT_PROVIDER=fake`, `SOCIALHUB_AI_IMAGE_PROVIDER=fake`, `SOCIALHUB_IG_ALLOWED_PROVIDERS=fake,manual`, `SOCIALHUB_IG_RESEARCH_PROVIDER=fake`, `SOCIALHUB_MEDIA_BACKEND=local`;
   - removes the `scheduler` service (profile `never`): periodic tasks are run explicitly by the suite so time is deterministic;
   - adds a `fixtures` service (`python -m http.server 8080` over `backend/tests/acceptance/fixtures/http/`) serving `feed.xml` (RSS, 6 items) and `items.json` (JSON feed, 4 items);
   - sets `SOCIALHUB_FETCH_ALLOW_HOSTS=fixtures` so the outbound fetch guard (E02-S02, E03-S01) lets workers read the fixture host; the setting is ignored unless testing hooks are on;
   - adds an `acceptance` service (backend image, `command: pytest backend/tests/acceptance -m acceptance -p no:cacheprovider`) that talks to `http://backend:8000` over HTTP only. It never imports models or opens the database: the suite tests the product through its API, as an operator would.
2. The render worker is the real one. Feed posts, image stories and motion reels are rendered with Chromium and FFmpeg in every run.
3. Startup rule from E11-S02 rule 9 stays in force: testing hooks and fake providers are refused when `DJANGO_DEBUG=false`. The overlay keeps `DJANGO_DEBUG=true`.

### One clock for every process

4. Business code reads the time only through `django.utils.timezone.now()`. A lint check in CI fails on `datetime.now(`, `datetime.utcnow(`, `time.time(` and `date.today(` inside `backend/apps/` outside `apps/core/clock.py`.
5. When testing hooks are on, `apps.core.clock` replaces `django.utils.timezone.now` at app start with a function that returns real UTC time plus an offset stored in Redis under `testing:clock:offset_seconds` (cached per process for one second). API, `worker`, `render-worker` and the `acceptance` runner therefore agree on "now". `auto_now` fields follow the same clock.
6. The clock only moves forward. Setting it to an earlier instant returns `400 validation_error` (code `clock_backwards`); a reset sets it freely.
7. Nothing in the pipeline may depend on Celery ETAs or countdowns for business timing. Retries, backoff, verification, metrics and evaluation are all driven by `next_attempt_at`, `next_metrics_at` and periodic tasks, which is what E08 and E09 specify. A scenario that hangs on a real-time wait is a defect in the owning story.

### Driving periodic work

8. The suite emulates Celery Beat. `GET /testing/run-task/` returns the Beat schedule; after every clock step the harness runs, once, each task whose next fire time in fake time has passed, by calling `POST /testing/run-task/`. A task runs synchronously in the API process; any jobs it enqueues run on the real workers.
9. After running tasks the harness waits until `GET /testing/idle/` reports idle twice in a row one second apart (no messages in the `default`, `render` and `publish` queues and no `JobRun` in `queued` or `running`). The wait times out after 180 seconds, and the timeout fails the scenario with the list of active jobs.
10. Large jumps use coarse steps: the harness never runs a periodic task more than once per step. Every periodic task in the product processes all due work when it runs, so a coarse step is equivalent to many fine ones; scenarios that test timing precisely (publish backoff, checkpoint tolerance) use one-minute steps around the instants that matter.

### Fakes the suite can script

11. `POST /testing/fakes/` pushes scripted behaviour into Redis. The fake AI provider (E00-S05) and the fake Instagram provider (E00-S04) consult these scripts first, then their normal behaviour (fixture variants, caption markers such as `[qc:clean]`, password-driven login outcomes). Entries are consumed in order; `times` defaults to 1.
12. AI entries name a task and either a fixture `variant` (a `fixture.<variant>.json` file, as in E00-S05 rule 30) or literal `data` validated against the task's schema, or an `error` (`provider_error`, `refused`, `timeout`). An optional `account` limits the entry to calls for that account.
13. Instagram entries name an account, a provider method and a scenario:

    | Scenario | Methods | Behaviour |
    | --- | --- | --- |
    | `ok` | any | Normal deterministic success (the default) |
    | `timeout_after_publish` | `publish_*` | Creates the post in the fake remote account, then raises `AmbiguousResult` |
    | `fail_transient` | `publish_*` | Raises `TransientError`; posts nothing |
    | `appears_late` | `publish_*` | Creates the post but hides it from listings for `delay_seconds` of fake time, then raises `AmbiguousResult` |
    | `media_rejected` | `publish_*` | Raises `MediaRejected` |
    | `session_required` | any | Raises `SessionRequired` |
    | `challenge_required` | any | Raises `ChallengeRequired` |
    | `rate_limited` | any | Raises `RateLimited` with `retry_after_seconds` |
    | `values` | `media_insights`, `account_stats` | Returns the given numbers; `unavailable` may list metrics the fake should report as unavailable |

14. `GET /testing/fakes/?account={id}` returns the fake remote account (posts and active stories), per-method call counts and unconsumed script entries. Scenarios assert "exactly one post on Instagram" from this, never from the product's own records.

### Seed profile `acceptance`

15. `python manage.py seed_demo --profile acceptance [--autopilot on|off]`, also run by `POST /testing/reset/`, creates exactly:

    | Record | Values |
    | --- | --- |
    | Users | `e2e-admin` (superuser) and `e2e-operator`; passwords from `SOCIALHUB_E2E_PASSWORD` |
    | Account `brand` | handle `e2e_brand`, timezone `Asia/Tehran`, `week_start_day` 5 (Saturday), `content_language` `fa`, `publishing_enabled` true, `autopilot` all on or all off per the flag (default off), `posting_rules` defaults |
    | Brand profile | colours, fonts `vazirmatn` for heading and body, light and dark logos (fixture PNGs), tone of voice, audience summary, 3 pillars, `default_hashtags` `["e2etest", "homedecor"]`, `banned_terms` `["cheap"]`, `handle_display` `@e2e_brand`, `ai_disclosure` `generated_only` |
    | Connection | provider `fake`, status `connected`, all five capabilities true |
    | Account `manual` | handle `e2e_manual`, same settings, connection provider `manual`, status `connected` |
    | Slot template (both accounts) | Sat 10:00 story, Sat 19:00 reel, Mon 12:30 feed post, Tue 10:00 story, Wed 19:00 reel, Thu 12:30 feed post, Fri 10:00 story |
    | Research sources (`brand`) | 2 `web_search` queries, 1 `rss` (`http://fixtures:8080/feed.xml`), 1 `instagram_hashtag` |
    | Feed sources (`brand`) | 1 `rss` and 1 `json_api` (`http://fixtures:8080/items.json`) with field mapping |
    | History (`brand`) | A closed plan for the week of 2026-10-03 and one for 2026-10-10, with 6 published reels and 6 published feed posts, each with `24h` and `7d` snapshots (reach, views, likes, comments, saves, shares) and evaluations; daily `AccountSnapshot`s for the 60 days before the clock start |
    | Clock | `2026-11-27T06:00:00Z` (Friday 09:30 in Tehran), the day before the first test week starts on Saturday 2026-11-28 |

16. History numbers are fixed so baselines are known: reel reach at `24h` = 3,000, 3,500, 4,000, 4,200, 5,000, 6,000 (median 4,100); reel reach at `7d` = 4,800, 5,600, 6,000, 6,300, 7,500, 9,000 (median 6,150); feed post saves at `24h` = 40, 55, 60, 70, 80, 95 (median 65). They sit inside the 60-day baseline window of E10-S01 for the test weeks.
17. The response of a reset lists the seeded IDs so tests never guess them:

```json
{
  "profile": "acceptance",
  "now": "2026-11-27T06:00:00Z",
  "users": {"admin": 1, "operator": 2},
  "accounts": {"brand": 1, "manual": 2},
  "plans": {"history": [1, 2]},
  "research_sources": [1, 2, 3, 4],
  "feed_sources": [1, 2]
}
```

### Scenarios

18. Every scenario starts with `POST /testing/reset/`, so scenarios are independent and can run in any order. Scenarios that need an earlier step's result reach it through a shared helper (for example `prepare_scheduled_item(format="reel")`) that performs those steps through the API, not through fixtures.
19. Scenario catalogue. "Op" is the operator session, "Ad" the admin session. Status names are the stored values from [DATA-MODEL.md](../../DATA-MODEL.md).

| ID | Covers | Setup | Steps | Expected |
| --- | --- | --- | --- | --- |
| AC-01 | Step 01 plan | Reset, autopilot off | Op `POST /plans/` `{account: brand, week_start: "2026-11-28"}`; read it; `PATCH /plans/{id}/` with objective, audience, success metrics `reach, saves, shares` and a goal for each (`reach` week_total 60,000; `saves` per_post feed_post 120; `shares` week_total 300; `reach` per_post reel 5,000); `POST /plans/{id}/activate/` | Plan created as `draft` with 7 `open` slots generated from the template; `readiness.can_activate` true after the patch; activation returns `active`; `GET /plans/current/?account=brand` returns it |
| AC-02 | Step 02 research | AC-01 helper | Op `POST /research/runs/` `{account: brand, plan}`; wait for the job; list `/research/signals/` and `/research/topics/`; `PATCH` two topics to `shortlisted`; run research again | Run `completed`; signals from each source with `url` set; at least 3 topics with hooks and an `evidence_score`; second run creates no duplicate signal (same `count` for unchanged sources) and keeps both shortlisted topics |
| AC-03 | Step 03 selection | AC-02 helper; `POST /feeds/sources/{id}/sync/` for both feed sources; mark 3 feed items `eligible` | Op `POST /selection/rank/` `{plan}`; `GET /candidates/?plan=`; `GET /selection/proposal/?plan=`; `POST /selection/confirm/` with the proposal and header `Idempotency-Key: ac03-1`; repeat the same request | Candidates ranked 1..n with all three scores and a rationale; confirm returns `201` with one item per assignment, each `selected` with a reserved slot; source topics and feed items `used`; the repeated request returns the same body and `GET /content-items/?plan=` count is unchanged |
| AC-04 | Step 04 formats and briefs | AC-03 helper | Op `GET /formats/`; `PATCH /content-items/{id}/` role `educate` on the feed post; `POST /plans/{id}/briefs/generate/`; read each brief; `PUT` the reel's brief with a new key message and `base_version` 1; `PUT` again with `base_version` 1; `POST /content-items/{id}/brief/approve/` for every item | Each item has brief version 1 (`origin` ai); the first edit creates version 2; the second edit returns `409 version_conflict`; after approval every item is `briefed` |
| AC-05 | Step 05 script | AC-04 helper | Op `POST /content-items/{id}/script/generate/` per item; read the script; `PUT` a changed frame headline on the reel; `POST /content-items/{id}/script/generate/` with feedback on the story; `POST /content-items/{id}/script/approve/` per item | Script packages pass the format rules (feed post and image story 1 frame; reel 4–8 frames); edit and regeneration create new versions; on approval each item becomes `scripted`, then `in_production` with an active `production.start` job, without another call |
| AC-06 | Step 06 production | AC-05 helper (feed post, image story, motion reel) | Wait for production jobs; `GET /content-items/{id}/production/`; `PUT /content-items/{id}/production/frames/2/` new headline on the reel; `POST /content-items/{id}/production/render/` for frame 2; `POST /content-items/{id}/production/submit/` per item | Each version `render_status` `ready` with a `final_asset`; reel asset is MP4 1080×1920 with its duration from the script, a cover asset, caption and hashtags; story has no caption; re-render replaces frame 2 and the final asset and leaves the other frame assets unchanged; submit moves each item to `in_check` |
| AC-07 | Step 07 QC — Pass | AC-06 helper, default clean fixtures | Wait for `qc.run`; `GET /content-items/{id}/checks/` | One `QCRun` per item, `outcome` `pass`, five `QCResult` rows; version `passed`; item `scheduled`; a `Publication` exists with `scheduled_at` equal to the slot time; slot `scheduled` |
| AC-08 | Step 07 QC — Revise | AC-05 helper for one feed post; fakes: `copy.generate` variant `too-long` × 1 (caption of 2,400 characters) | Wait through production, QC and revision | Run 1 `revise` with a format finding on caption length; item went `needs_revision` → `in_production`; version 2 exists with a `change_note`, caption ≤ 2,200 characters, same frame assets as version 1; run 2 `pass`; `revision_count` 1; item `scheduled` |
| AC-09 | Step 07 QC — Escalate and the three review decisions | Three feed-post items prepared to production; fakes: `qc.facts` variant `unsupported-number` × 3 | Wait for QC; `GET /review-tasks/?account=brand&status=open`; Op `POST /review-tasks/{a}/resolve/` `{decision: "approve", decision_note: "Figure checked with the source owner"}`; `{decision: "request_changes", instructions: "Remove the 37% figure"}` on task b; `{decision: "reject", decision_note: "Off-brand"}` on task c | Each run `escalate` with `facts.unsupported_numeric`; 3 open tasks with reason `qc_escalated`, items `in_review`; after approve: item a `scheduled`, a `ContentEvent` of type `review_decision` names the operator; after request changes: item b `needs_revision`, a new version is produced and checked (default fixture passes) and ends `scheduled`; after reject: item c `cancelled`, its slot `open` |
| AC-10 | Revise limit | One feed post; fakes: `copy.generate` variant `too-long` × 3 | Wait | Exactly `max_revisions` (2) automatic revisions, then a review task with reason `max_revisions`; item `in_review`; three `QCRun` rows |
| AC-11 | Step 08 publish on time | AC-07 helper (feed post, image story, reel scheduled); clock just before the earliest slot | Advance in one-minute steps to 3 minutes after the last slot of the three, running Beat tasks | Each publication `published` within 2 minutes of `scheduled_at` (fake time), with `permalink`, `remote_media_pk`, `published_via` `provider`; item and slot `published`; `next_metrics_checkpoint` `1h`; fake remote account shows exactly 3 media; each `publish_*` method called once |
| AC-12 | Publish timeout must not duplicate | Reel scheduled; fakes: `publish_reel` `timeout_after_publish` | Advance past the slot time by 3 minutes in one-minute steps | Attempt 1 outcome `verified_live`; publication `published`; `publish_reel` called once; fake remote account has 1 reel; no review task |
| AC-12b | Late appearance | Reel scheduled; fakes: `publish_reel` `appears_late` with `delay_seconds` 150 | Advance 15 minutes in one-minute steps | First verification `not_found`, the pre-send check on the next attempt finds the post, nothing is sent again; publication `published`; `publish_reel` called once |
| AC-13 | Fail three times, then retry | Feed post scheduled; fakes: `publish_feed_image` `fail_transient` × 3 | Advance 45 minutes in one-minute steps; then Op `POST /publications/{id}/retry/` with `Idempotency-Key`; advance 3 minutes | Sends at about +0, +2 and +10 minutes; final check 30 minutes after the third; publication and item `failed`; one open review task `publish_failed`; after retry: the pre-send verification runs first, the post is sent once, publication `published`, review task `resolved` with decision `approve`; fake remote account has 1 post |
| AC-14 | Publishing switch off | Story scheduled at 10:00 Tehran | Ad `PATCH /accounts/{brand}/` `{publishing_enabled: false}`; advance to 10:05; check; Ad switch on at 10:30; advance 3 minutes. Variant: switch on at 12:30 instead | While off: no provider call, publication `scheduled` with `blocked_reason` `publishing_paused`, overview attention shows it. Switched on within two hours: published by 10:33. Variant (more than two hours late): not sent; moved to a new time as E08-S03 rule 5 specifies, and sent at that time |
| AC-15 | Session challenge | Feed post scheduled; fakes: `publish_feed_image` `challenge_required` | Advance past the slot; check; Ad `POST /accounts/{brand}/connection/login/` with fake password `challenge`; `POST /accounts/{brand}/connection/challenge/` `{code: "123456"}`; advance 3 minutes | Connection `challenge_required`; publication still `scheduled` with `blocked_reason` `session_problem`; `attempt_count` 0 (session errors are not counted); overview lists the connection problem; after the code the connection is `connected`, the publication is sent once and ends `published` |
| AC-16 | Manual fallback | Account `manual`: one feed post taken through AC-03..AC-07 helpers | Advance past the slot; read the publication; Op `POST /publications/{id}/mark-published/` `{permalink: "https://www.instagram.com/p/DC0aBcDeFgH/", published_at: <slot time + 4 min>, verify: false}`; Op `POST /analytics/posts/{id}/snapshots/` with `24h` numbers | No provider publish call; publication waits for manual posting and appears in the attention list; after mark-published: `published`, `published_via` `manual`, item and slot `published`, `next_metrics_at` set; the manual snapshot is stored with `source` `manual` |
| AC-17 | Step 09 analytics | AC-11 published reel and story; fakes: `media_insights` `values` for each checkpoint; `account_stats` `values` per day (followers 10,000 → 10,040 → 10,095); for the story, `session_required` from +50 minutes to +3 hours | Advance in 10-minute steps to +7 hours, then 1-hour steps to +8 days | Reel snapshots at `1h`, `6h`, `24h`, `72h`, `7d`, each with `age_minutes` within the tolerance of E09-S01; reach, saves and shares stored or listed in `unavailable`; story: `1h` recorded as skipped with no numbers, `6h` and `23h` captured once the provider recovers; one `AccountSnapshot` per local day at 00:10 Tehran with `follower_change` 40 and 55; `GET /analytics/account/` reports the period change |
| AC-18 | Step 10 evaluation | AC-17 state; reel `24h` reach 6,400, `7d` reach 9,800; reel brief `success_metric` `reach`; goal `reach` per_post reel 5,000 | Run `analytics.evaluate_due` through the Beat emulator | `24h` evaluation: `value` 6,400, `goal_result` `met`, `baseline_value` 4,100, `baseline_sample_size` 6, `baseline_ratio` 1.56, `verdict` `outperforming`; `7d` evaluation: baseline 6,150, ratio 1.59, `outperforming`; the story's `23h` evaluation is `insufficient_data` (no story history), with `goal_result` still computed |
| AC-19 | Loop 1: weekly findings → next plan | AC-18 state with all seven week slots run through AC-11 and AC-17 helpers; fakes: `report.weekly_findings` `data` with 4 findings citing the week's real publication IDs (one with `plan_field` `goals` and `suggested_change` `{metric: "saves", scope: "per_post", format: "feed_post", target_value: 150}`) | Advance to 2026-12-07 02:00 UTC (week end + 2 days) and run Beat; read `/weekly-reports/?plan=`; Op `PATCH /weekly-reports/{id}/` accepting 3 findings and dismissing 1; `POST /weekly-reports/{id}/accept/`; `POST /weekly-reports/{id}/apply-to-plan/` `{}`; read the new plan; `PATCH /plans/{new}/` applying the goal finding | Plan `closed` automatically with `plan_closed`; report `draft` whose `totals` equal the harness's own sums from the snapshots it scripted (reach total, goal attainment, `follower_change` across the week, counts by format and verdict); after apply: a `draft` plan for 2026-12-05 with 3 `carried_findings` in state `pending`, `source_report` set, report `applied_plan` set; after the patch: the saves goal is 150 and the finding is `applied`; the closed plan's goals and slots are unchanged |
| AC-20 | Loop 2: outperformer → repurpose → selection | AC-18 state (reel `7d` outperforming) | Read `/repurpose-tasks/?account=brand`; wait for the `repurpose.suggest` job; activate the next plan from AC-19 (or create one); Op `POST /selection/rank/`; read candidates; confirm the repurpose candidate into a slot | Exactly one `open` task for the reel with `reason` stating the ratio, then `suggested_angle` and `suggested_formats` filled; after ranking: a candidate of kind `repurpose` with an evidence score and the task `in_selection`; after confirm: a content item exists from it and the task is `used`; evaluating again creates no second task |
| AC-21 | Golden path on autopilot | Reset with `--autopilot on`; one slot only (delete the others); clean fixtures | Op creates and activates the plan; Op starts one research run; then only the Beat emulator runs until 8 days after the slot | With no further API call by a person: candidates ranked and confirmed, brief and script approved automatically, rendered, submitted, passed, scheduled, published, five snapshots and two evaluations created; every status change is a `ContentEvent` with `actor` null |

20. Every scenario finishes with three global assertions: no `JobRun` ended `failed` unless the scenario expects it; no item is left in `publishing` or `in_check`; and for every `published` publication of the scenario the fake remote account holds exactly one matching media item.

### Panel smoke

21. `frontend/e2e/acceptance.spec.ts` runs with Playwright against the same stack after the API suite, using `PLAYWRIGHT_BASE_URL=http://frontend:8000`. A `beforeAll` calls the testing hooks over HTTP to reset with autopilot on and prepare data with the AC helpers' API sequence (ported as small TypeScript helpers). Checks, one test each:

    | ID | Flow |
    | --- | --- |
    | P01 | Sign in as `e2e-operator`; the Overview shows this week's plan and the attention count |
    | P02 | Open `/plans/:planId`; the Slots tab shows seven slots in a week grid starting on Saturday |
    | P03 | Open an item at `/content/:id`; the Production tab shows the rendered preview; the Checks tab shows five results |
    | P04 | Open `/review`; approve an escalated task with a note; the item's status tag changes to Scheduled |
    | P05 | Open `/calendar`; the scheduled publication appears on its day; publish-now asks for confirmation naming the item |
    | P06 | Open `/analytics/posts/:publicationId` for a published post; snapshots and the last-sync time are shown |
    | P07 | Open `/reports/:id`; accept a finding; "Apply to next plan" opens the new draft plan with the finding banner |

22. Selectors use roles and accessible names. Where a control has none, the fix is an accessible name in the component, not a test-only attribute.

### CI

23. One CI job, `acceptance`, runs on every pull request and on every push to `main`: build images, start the acceptance stack, run the API suite, run the panel smoke, collect logs. The whole job must finish within 25 minutes; the API suite target is 15 minutes.
24. On failure the job uploads: the pytest report (JUnit XML and HTML), `docker compose logs` for every service, Playwright traces, and the rendered media of failed scenarios from the media volume.
25. A failing acceptance job blocks merging to `main`. A flaky scenario is fixed or quarantined with a linked issue within one working day; quarantine never lasts past the next release.

### Pilot dry run

26. The pilot runs on the production deployment (E11-S02) with real providers, on a disposable Instagram professional account created for the purpose, with its own fixed proxy. No valuable account is connected until the go-live checklist is signed.
27. Volume is small on purpose: one plan week with 2 feed posts, 2 reels and 3 stories, matching the posting rules.
28. Autopilot starts **off** for the first half of the week so each approval endpoint is used by a person, and is switched **on** (selection, brief, script) from day 4 to exercise the automatic path on real providers.
29. Nobody uses the Django shell, `psql` or Django admin edits during the pilot, except creating users. Any such intervention is logged as a `blocker` issue: it means the product could not do something it must.
30. The checklist below is written into `docs/operations/PILOT-DRY-RUN.md`, filled in as the week runs, and signed by the product owner and the person running operations.

**Day-by-day checklist** (day 1 is the plan's first day; the account's week starts on Saturday)

| Day | Actions | Check |
| --- | --- | --- |
| −3 | Deploy the release tag; restore rehearsal from E11-S02 done and recorded; set keys; `ops_check` clean; create users | `GET /system/status/` shows both AI providers configured; "Run AI test" succeeds and shows a cost |
| −2 | Connect the throwaway account (`instagrapi`, proxy set); answer any challenge; verify capabilities; set brand profile, slot template, research and feed sources; publishing switch **off** | Connection `connected`; capabilities recorded; record any capability that is false |
| −1 | Create and activate the plan; run research; rank; confirm; generate and approve briefs and scripts by hand; let production and checks run. Induce a Revise: edit one caption to contain a banned term before submit. Induce an Escalate: add an unsupported figure ("37% of buyers") to another caption; resolve with request changes. Generate one AI background image (the real-provider check E06-S05 asks for) | All 7 items reach `scheduled`; the Revise item shows run 1 `revise` and run 2 `pass`; the Escalate item shows a review task and ends `scheduled` after rework; rendered Persian text reads right-to-left with brand fonts, logo and handle inside the safe area |
| 1 | Switch publishing **on** before the first slot. Watch the first story and the reel publish | Each published within 2 minutes; permalink opens the right post; Instagram shows one post per publication; caption and hashtags correct; AI disclosure applied where required |
| 2 | Watch the feed post publish (first real check per format for E08-S03). Check the day-1 posts' `1h`, `6h`, `24h` snapshots and `24h` evaluations | Snapshots arrive without a click; unavailable metrics are named, not zero; evaluations show goal results (verdicts may be `insufficient_data` on a new account) |
| 3 | Switch publishing **off** 10 minutes before the day's story; confirm nothing is sent and the item shows "Publishing off"; post the story by hand from the downloaded asset; `mark-published` with its link; switch publishing back on | No send while off; manual publication `published` via manual; metrics for it can be entered by hand |
| 4 | Switch autopilot on (selection, brief, script). Skip one future open slot's item (cancel it) so the slot reopens; run research and ranking | The slot is filled, briefed, scripted, rendered, checked and scheduled with no approval click |
| 5 | Watch the second reel publish (automatic item from day 4). Check the `72h` snapshots of day-1 posts. Check follower snapshots for days 1–4 | Follower figure once per local day; change shown; missing days shown as missing |
| 6 | Watch the second feed post publish. Run `instagram.verify` from the panel; note any challenge and how it was cleared | Connection stays `connected`, or the challenge is cleared through the panel within the runbook's steps |
| 7 | Last story publishes. Review the Overview at morning and evening | Attention list matches reality (open tasks, blocked items, sync gaps) |
| 8 | Week ended. Close the plan (no force needed). Read the draft report; check one total by hand against the snapshots; accept findings and the report; apply to next plan. Create a repurpose task by hand from the best post; rank the next plan | Report totals match the hand check; 3–7 findings cite real posts; next draft plan carries the accepted findings; the repurpose task appears as a `repurpose` candidate |
| 9 | Day-1 posts reach `7d`; check snapshots and evaluations. Download a backup taken during the week and confirm it is off the VM | `7d` snapshots and evaluations present; `ops_check` reports the last backup within 26 hours |
| 10 | Fill the issue log totals; sign-off meeting | Pass criteria below |

**Pass criteria** (map to "Definition of done for the MVP")

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | The week ran through all ten steps with no database intervention | Checklist days −1 to 9 ticked; zero `blocker` issues of type "manual DB" |
| 2 | A Revise returned to production and passed on recheck; an Escalate created a review task that was resolved | Item IDs and QC run IDs recorded on day −1 |
| 3 | No duplicate posts | Count of Instagram posts and stories on the account equals the count of `published` publications; AC-12 and AC-12b green in the CI run of the release tag |
| 4 | Metrics at every checkpoint and an evaluation per post | Analytics page screenshots of one reel and one story; any missed checkpoint has an issue entry |
| 5 | Report pre-filled the next plan; an outperformer path reached selection | Day 8 records; AC-19 and AC-20 green in CI |
| 6 | Restore from backup works | Rehearsal record in the runbook (date, dump, duration, operator) |

The pilot passes when all six hold and no `blocker` or `major` issue is open. `major` issues may be accepted by the product owner with a written workaround and a fix date.

**Issue log template** (a table in `PILOT-DRY-RUN.md`)

| ID | Day | Step | Severity | What happened | Expected | Evidence | Owner | Status | Fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-001 | 2 | 09 | major | `24h` snapshot for the day-1 reel captured at 31 h | Within the `24h` tolerance | publication 14, job `3c9e…`, request ID `d2f1…`, screenshot | Backend | Open | — |

Severity: `blocker` (the workflow cannot continue without a developer, or data is wrong or duplicated on Instagram), `major` (a step needs a workaround), `minor` (cosmetic or wording).

### Go-live checklist

31. Signed before the first valuable account is connected:

| Area | Check |
| --- | --- |
| Pilot | Pass criteria met and signed; open issues accepted in writing |
| Backups | Daily backup running and copied off the VM; one restore rehearsed and recorded with its duration |
| Secrets | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SOCIALHUB_ENCRYPTION_KEY`, S3 credentials and `DJANGO_SECRET_KEY` set in `.env.prod` and stored in the password manager; nothing secret in the repository |
| Configuration | `python manage.py check --deploy` clean; `ops_check` exits 0; no provider set to `fake`; `SOCIALHUB_TESTING_HOOKS` absent; AI price table covers the configured models |
| Account | Brand profile complete (logos, colours, fonts, tone, banned terms, hashtags, disclosure); slot template and `posting_rules` reviewed; research and feed sources set; fixed proxy configured |
| Switches | `publishing_enabled` **off** at connection, turned on by an admin only after the first plan is scheduled and reviewed; autopilot `selection`, `brief`, `script` **off** at launch (ROADMAP section 5) |
| People | Admin and operator users created; the operator has walked through the runbook's failure table; someone is reachable for Instagram challenges during the first week |
| Release | The release tag passed the CI acceptance job; the previous tag is noted for rollback |

## Data

None. Test-only state lives in Redis under the `testing:` prefix (`testing:clock:offset_seconds`, `testing:fakes:ai`, `testing:fakes:ig:{account_id}`, `testing:fake_remote:{account_id}`) and disappears with a reset. No table or field is added.

## API

All endpoints below exist only when `SOCIALHUB_TESTING_HOOKS=true`; otherwise their routes are not registered and return `404 not_found`. All require an admin session. They are not added to `docs/openapi.yaml`; they are documented in `backend/tests/acceptance/README.md`.

### `POST /api/v1/testing/reset/`

```json
{"profile": "acceptance", "autopilot": "off", "clock": "2026-11-27T06:00:00Z"}
```

Flushes every application table (sequences reset), deletes media under `accounts/`, clears `testing:*` keys and Celery queues, then runs the seed profile. Returns `200` with the seed IDs (rule 17). Because it signs out every session, the harness signs in again afterwards.

| Case | Response |
| --- | --- |
| Unknown profile | `400 validation_error`, field `profile`, code `invalid_choice` |
| Jobs still running | Waits up to 30 seconds for idle, then returns `409 job_in_progress` |

### `POST /api/v1/testing/clock/`

```json
{"advance_seconds": 3600}
```

or `{"set": "2026-11-28T06:25:00Z"}`. Returns `200`:

```json
{"now": "2026-11-27T07:00:00Z", "offset_seconds": -187200}
```

`400 validation_error` with code `clock_backwards` when `set` is earlier than the current fake time.

### `GET /api/v1/testing/run-task/`

```json
{
  "now": "2026-11-27T07:00:00Z",
  "schedule": [
    {"task": "publishing.dispatch_due", "every_seconds": 60},
    {"task": "analytics.collect_due_metrics", "every_seconds": 600},
    {"task": "analytics.dispatch_follower_snapshots", "every_seconds": 600},
    {"task": "analytics.evaluate_due", "every_seconds": 900},
    {"task": "feeds.sync_active_sources", "every_seconds": 3600},
    {"task": "planning.close_finished_plans", "crontab": "0 2 * * *"},
    {"task": "selection.expire_repurpose_tasks", "crontab": "0 3 * * *"},
    {"task": "instagram.verify_all", "crontab": "0 3 * * *"},
    {"task": "core.sweep_stale_jobs", "every_seconds": 300},
    {"task": "core.tasks.beat_heartbeat", "every_seconds": 60}
  ]
}
```

The list is read from `CELERY_BEAT_SCHEDULE`, so it always matches what production runs. The names above are those used by the owning stories at the time of writing.

### `POST /api/v1/testing/run-task/`

```json
{"task": "publishing.dispatch_due"}
```

Runs the task function synchronously in the API process and returns `200`:

```json
{"task": "publishing.dispatch_due", "result": {"claimed": 1, "verifying": 0, "blocked": 0}, "duration_ms": 412}
```

`400 validation_error` with code `unknown_task` for a name that is not in the Beat schedule. An exception inside the task returns `500` with the error class name in `error.details.exception`; the harness fails the scenario.

### `GET /api/v1/testing/idle/`

```json
{"idle": false, "queues": {"default": 0, "render": 1, "publish": 0}, "active_jobs": [{"id": "0b8f6f0e-6a0b-4d3e-9a52-0c1f4f9d2a11", "kind": "production.render", "status": "running"}]}
```

### `POST /api/v1/testing/fakes/`

```json
{
  "ai": [
    {"task": "copy.generate", "variant": "too-long", "times": 1, "account": 1},
    {"task": "report.weekly_findings", "data": {"summary": "…", "findings": []}, "times": 1}
  ],
  "instagram": [
    {"account": 1, "method": "publish_reel", "scenario": "timeout_after_publish"},
    {"account": 1, "method": "media_insights", "scenario": "values", "values": {"reach": 6400, "views": 9100, "likes": 410, "comments": 22, "saves": 95, "shares": 61}, "times": 1},
    {"account": 1, "method": "account_stats", "scenario": "values", "values": {"followers": 10040, "following": 120, "media_count": 19}}
  ],
  "clear": false
}
```

`clear: true` empties existing scripts first. Returns `200` with the queued entries. Validation: unknown task, method or scenario → `400 validation_error` with the path, for example `instagram.0.scenario`; `data` that fails the task's schema → `400 validation_error` with the schema path under `ai.1.data`.

### `GET /api/v1/testing/fakes/?account=1`

```json
{
  "instagram": {
    "calls": {"publish_reel": 1, "list_recent_media": 2, "media_insights": 0},
    "remote_media": [
      {"pk": "3499001112223334445", "code": "DC0aBcDeFgH", "media_type": "reel", "caption_fingerprint": "9f1c…", "taken_at": "2026-11-28T15:30:41Z", "visible": true}
    ],
    "active_stories": [],
    "pending": []
  },
  "ai": {"pending": [{"task": "report.weekly_findings", "times": 1}]}
}
```

## Background work

None in production. In the acceptance stack the `scheduler` service is not started; the harness runs periodic tasks through `POST /testing/run-task/` (rules 8–10). Jobs enqueued by those tasks run on the real `worker` and `render-worker` services.

## AI

None. The suite uses the fake providers only. Fixture variants it relies on, which the owning stories must ship: `copy.generate` → `too-long`; `qc.facts` → `unsupported-number`; defaults for every task that pass all checks; `report.weekly_findings` and `repurpose.suggest` defaults valid against their schemas. Real Claude and OpenAI calls happen only in the pilot.

## Panel

No new screens. The panel smoke (rule 21) may require accessible names on controls that lack them; those fixes are part of FE3. `PILOT-DRY-RUN.md` asks for screenshots of the Overview, an item's Checks tab and an analytics post page as evidence.

## Acceptance criteria

1. Given a clean checkout with Docker, when `docker compose -f compose.yaml -f compose.acceptance.yaml up -d --build` and the `acceptance` service run, then all 22 scenarios (AC-01 to AC-21 and AC-12b) pass and the run takes less than 15 minutes on the CI runner.
2. Given the acceptance stack, when any scenario finishes, then the three global assertions of rule 20 hold.
3. Given AC-12, when the fake provider times out after posting, then `publish_reel` was called once and the fake remote account holds exactly one reel.
4. Given `SOCIALHUB_TESTING_HOOKS` is unset, when `POST /api/v1/testing/reset/` is called, then the response is `404`; given `DJANGO_DEBUG=false` and hooks set, then the backend refuses to start (E11-S02 rule 9).
5. Given a business module calls `datetime.now()`, when CI runs, then the lint check fails and names the file.
6. Given the clock is advanced by one hour through `POST /testing/clock/`, when a worker reads `timezone.now()`, then it sees the same fake time as the API within one second.
7. Given the panel smoke, when it runs after the API suite, then P01–P07 pass using role-based selectors only.
8. Given a pull request that breaks AC-07, when CI runs, then the `acceptance` job fails, uploads logs and blocks the merge.
9. Given the pilot week, when it ends, then `PILOT-DRY-RUN.md` contains the filled checklist, the issue log and signatures, and the six pass criteria are each backed by the listed evidence.
10. Given the go-live checklist, when the product owner signs it, then every row is ticked or has a written, accepted exception.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E11-S03-BE1 | Testing hooks and clock | `apps/testing` (installed only with hooks on): reset, clock, run-task (GET and POST), idle, fakes (GET and POST) with validation; `apps/core/clock.py` offset patch of `timezone.now`; Redis-backed script reading in the fake AI and fake Instagram providers; lint rule for direct time calls | 0.5 |
| E11-S03-BE2 | Seed profile and acceptance stack | `seed_demo --profile acceptance` with the records and fixed history numbers of rules 15–16; `compose.acceptance.yaml` with the `fixtures` and `acceptance` services and no scheduler; `SOCIALHUB_FETCH_ALLOW_HOSTS` honoured only with hooks on; fixture `feed.xml` and `items.json` | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E11-S03-FE1 | Playwright acceptance setup | Project `acceptance` in `playwright.config.ts`, base URL from env, sign-in helper, TypeScript helpers that call the testing hooks and prepare data | 0.25 |
| E11-S03-FE2 | Smoke specs | `frontend/e2e/acceptance.spec.ts` with P01–P07 | 0.5 |
| E11-S03-FE3 | Accessible names and CI step | Add missing accessible names found while writing the specs; panel smoke step and trace upload in the CI job | 0.25 |

### Test

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E11-S03-QA1 | Harness and CI job | `backend/tests/acceptance/` client with CSRF sign-in, `reset`, `script_fakes`, `advance(duration, step)` with the Beat emulator, `settle()`, global assertions of rule 20, shared helpers (`prepare_plan`, `prepare_selected`, `prepare_briefed`, `prepare_scripted`, `prepare_scheduled_item`); README; the `acceptance` CI job with artefact upload | 0.5 |
| E11-S03-QA2 | Scenarios AC-01 to AC-07 | Plan, research, selection with idempotency, formats and briefs with version conflict, script, production with partial re-render, QC pass | 1 |
| E11-S03-QA3 | Scenarios AC-08 to AC-16 | Revise, escalate with the three decisions, revise limit, publish on time, timeout without duplicate, late appearance, fail and retry, switch off with both variants, challenge, manual fallback | 1 |
| E11-S03-QA4 | Scenarios AC-17 to AC-21 | Analytics with the provider outage, evaluation numbers, loop 1 with totals checked against scripted values, loop 2, golden path on autopilot | 0.75 |
| E11-S03-QA5 | Pilot dry run | Write `docs/operations/PILOT-DRY-RUN.md`; run the 13 days of the checklist with operations; keep the issue log; run the go-live checklist; collect signatures | 0.75 |

QA5's estimate covers the hands-on time; the pilot spans about two calendar weeks because of the plan week and the `7d` checkpoint.

## Test notes

- The suite drives HTTP only; it never imports Django models. This keeps it honest about what an operator can do and lets it run against any deployment with hooks enabled.
- Waits are always `settle()` or a job poll with a timeout, never a fixed sleep.
- Expected numbers in AC-18 and AC-19 come from the values the scenario scripted, computed again in the test, so a change in a formula shows up as a failing assertion with both numbers.
- Rendering is real, so the first run on a cold runner is slower; the CI job caches the built images.
- When a scenario fails, the harness prints the item's `GET /content-items/{id}/events/` timeline and the failed jobs' `error_code` before the assertion message.
- The acceptance suite does not replace story-level tests. If a scenario finds a defect, the fix comes with a story-level test that reproduces it.

## Later

- Run the suite nightly against a staging copy with real AI providers and a sandbox Instagram account, reporting cost per run.
- Visual snapshots of rendered frames with a perceptual-diff threshold, once templates stabilise.
- Load tests with several accounts and a full week of slots, measuring render queue time and publish timeliness.
- Chaos scenarios (Redis restart mid-publish, worker killed during render) built on the same harness, extending the expired-lease paths of E08-S04.
- A pilot checklist variant for adding each new account after go-live, shortened to the connection, first week and switches.
