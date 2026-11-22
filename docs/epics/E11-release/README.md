# E11 — Release

## Goal

Make the ten-step workflow usable and shippable. This epic adds the one page that tells an operator what needs them today, puts the system on a server with backups, and proves the whole flow works end to end before a real account depends on it. None of this is a workflow step in the PDF; the workflow cannot go live without it.

## Scope

**In the MVP**

- An Overview page with this week's plan, item counts by status, an attention list, the next publications and sync health.
- One production environment: a single Linux VM running Docker Compose, with TLS, an environment file for secrets, a media bucket Meta can fetch from over HTTPS, the production redirect URI on the Meta app, daily backups and a tested restore.
- A runbook for the failures that are expected in the first weeks, including expired or invalid Instagram tokens, connect problems, rejected media and the publishing quota.
- An automated end-to-end acceptance suite that runs the whole workflow against fake providers.
- A pilot dry run on a real, disposable Instagram professional account connected through the Meta app in development mode, with a sign-off checklist.

**Left for later**

- Notifications by email or chat. The attention list is in the panel only.
- Staging environment, blue-green deploys, autoscaling, Kubernetes.
- Metrics dashboards and alerting beyond a health endpoint and an optional error tracker.
- Load and performance testing.
- A general audit log and admin reporting.

## Stories

| Story | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E11-S01](S01-overview.md) | Overview page and attention list | Must | 1.5 | 2.5 | |
| [E11-S02](S02-deployment.md) | Production deployment and operations basics | Must | 3 | 0.5 | |
| [E11-S03](S03-acceptance.md) | End-to-end acceptance and pilot dry run | Must | 1 | 1 | 4 |
| | **Total** | | **5.5** | **4** | **4** |

## Flow

1. **E11-S02 starts early.** The production compose file and a first deployment can be done as soon as E00 is finished, so every release (R0–R3) is demonstrated on the server, not on a laptop.
2. **E11-S03's harness starts in R1.** The seed command and the acceptance test skeleton are written once the first pipeline steps exist; scenarios are added as each epic lands. The last scenarios (analytics, both feedback loops) arrive in R3.
3. **E11-S01 is built in R3**, when every source of attention items exists (review tasks, publications, metrics).
4. **The pilot dry run closes the MVP.** It runs on the deployed system with real providers and a throwaway professional account that is an Instagram tester on the Meta app, and takes about two calendar weeks: one full plan week plus the 7-day metric checkpoint of the last posts.

```text
R0            R1                 R2                      R3
E11-S02 ────► deploy each release ─────────────────────► backup + restore test
              E11-S03 harness ──► scenarios per epic ──► full suite ──► pilot dry run ──► sign-off
                                                         E11-S01 overview
```

## Owns

| Kind | Items |
| --- | --- |
| Tables | None |
| Endpoints | `GET /overview/`; test-only `GET`/`POST /testing/fakes/`, `POST /testing/reset/`, `POST /testing/clock/`, `GET`/`POST /testing/run-task/`, `GET /testing/idle/` (disabled unless `SOCIALHUB_TESTING_HOOKS=true`) |
| Panel | `/overview`; the attention count in the top bar |
| Background tasks | `core.tasks.beat_heartbeat` (every minute). Stuck jobs are failed by E00-S06's `core.sweep_stale_jobs` |
| Management commands | `ops_check`, `seed_demo` |
| Files | `compose.prod.yaml`, `deploy/` (nginx, scripts, env example), `docs/operations/RUNBOOK.md`, `docs/operations/PILOT-DRY-RUN.md`, `backend/tests/acceptance/` (with `fixtures/http/`), `compose.acceptance.yaml`, `frontend/e2e/` |
| AI tasks | None |

## Depends on / needed by

- **Depends on:** E11-S01 reads data from E01 (plan, slots, goals), E03-S04 (items), E00-S04 (connection), E00-S06 (jobs), E07-S06 (review tasks), E08 (publications), E09 (snapshots). E11-S02 depends on E00, in particular the Meta app from E00-S04's spike. E11-S03 depends on every epic.
- **Needed by:** nothing inside the MVP; this epic is the exit gate.

## Done when

1. An operator opening `/overview` can tell within ten seconds what is waiting for a person, what publishes next, and whether anything is broken.
2. The system runs on the production VM over HTTPS, survives a reboot, and has been restored once from a backup onto a clean machine with the steps in the runbook.
3. The acceptance suite passes in CI on every change to the main branch.
4. The pilot dry-run checklist is completed and signed, covering the six points of "Definition of done for the MVP" in [ROADMAP.md](../../ROADMAP.md).

## Later

- Notifications: the attention builders in E11-S01 return typed entries; a notifier can send the same entries by email or chat.
- More environments: `compose.prod.yaml` takes all environment-specific values from the env file, so a staging copy is a second env file and a second VM.
- Scaling out: workers are separate services per queue; they can move to more machines once Postgres, Redis and media storage are reachable over the network (managed Postgres, managed Redis, S3-compatible storage).
- Monitoring: `ops_check` prints the numbers a metrics exporter would publish.
