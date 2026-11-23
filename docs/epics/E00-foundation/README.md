# E00 — Foundation

## Goal

Not a workflow step. This epic builds the things every step needs before it can run: people can sign in, an Instagram account exists with its brand profile, AI calls go through one gateway, and long actions run as tracked background jobs with files in storage. When E00 is done, the team can start E01 without touching infrastructure again.

In Phase 1 an account has no connection to Instagram. The Meta app setup, Instagram Login and the provider layer are E00-S04, which is Phase 2 ([ROADMAP.md](../../ROADMAP.md) section 8).

## Scope

**In Phase 1**

- Sign-in with a session cookie and CSRF; two derived roles (admin, operator); users created by an admin through Django admin or `createsuperuser`.
- The panel shell: Social Hub navigation, theme tokens, account switcher, shared components (`StatusTag`, `ContentText`, `DateTime`), English error text keyed by error code, removal of the template's demo pages.
- Instagram accounts with their settings (handle, timezone, content language, `autopilot`, `posting_rules`) and one brand profile each. No connection to Instagram.
- The AI gateway for Claude and OpenAI with a prompt registry, a fake provider, and the `AIRun` log. It also removes the scaffold's provider and publisher guard.
- `JobRun`, the job polling endpoint, `JobButton`/`JobProgress`, and the media storage setting (local, or a private S3-compatible bucket read through presigned URLs).

**Phase 2 (Instagram API)**

- E00-S04: the Meta app setup spike, the Instagram provider layer (`graph_api` on Meta's official Instagram API with Instagram Login, `manual`, `fake`), the OAuth connect flow, encrypted long-lived tokens with weekly refresh, daily verification, the Connection tab and the `publishing_enabled` switch.

**Left for later (both phases)**

- User management screens, password reset by email, single sign-on, fine-grained permissions.
- Workspaces and multi-tenancy.
- Spend caps, model routing and prompt editing in the panel.
- The Facebook Login adapter (`graph_api_fb`) for hashtag search and business discovery (E02-S03).
- Notifications outside the panel.

## Stories

| ID | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E00-S01](S01-sign-in.md) | Sign in and keep a session | Must | 1.5 | 1.5 | |
| [E00-S02](S02-panel-shell.md) | Panel shell, navigation and design tokens | Must | 0 | 3 | |
| [E00-S03](S03-accounts-and-brand.md) | Manage Instagram accounts and brand profile | Must | 2 | 2.5 | |
| [E00-S04](S04-instagram-connection.md) | Connect an Instagram account (Meta app setup, OAuth, provider layer) | Phase 2 | (4) | (1.5) | |
| [E00-S05](S05-ai-gateway.md) | AI gateway for Claude and OpenAI | Must | 3 | 0.5 | |
| [E00-S06](S06-jobs-and-media-storage.md) | Background jobs, run tracking and media storage | Must | 2 | 1 | |
| | **Phase 1 total** | | **8.5** | **8.5** | |

Figures in brackets are Phase 2 estimates and are not in the total.

## Flow

1. **E00-S01** adds the auth endpoints and replaces the panel's demo identity with a real session. Everything after it assumes a signed-in user.
2. **E00-S06** adds `JobRun`, the Celery task base, `GET /jobs/{id}/` and media storage. S05 returns jobs and S03 stores logos, so S06's backend lands before their endpoints.
3. **E00-S02** builds the shell every later page sits in on the Refine panel. It needs only `GET /auth/me/` and `GET /accounts/` (it can start on a fixture data provider).
4. **E00-S03** adds accounts and brand profiles; the account switcher from S02 starts returning real data.
5. **E00-S05** adds the AI gateway, removes the scaffold's provider guard, and adds the System page and the AI test call.

```text
S01 ─► S06 (backend) ─┬─► S03 logo uploads
                      └─► S05 AI gateway + System page
S01 ─► S02 shell ─► S03 accounts + brand ─► S05 / S06 panel parts
```

## Owns

| Kind | Items |
| --- | --- |
| Tables | `InstagramAccount`, `BrandProfile`, `JobRun`, `AIRun` (and Django's `auth.User`) |
| Django apps | `accounts`, `ai`; additions to `core` |
| Endpoints | `/auth/*`, `/accounts/*`, `/accounts/{id}/brand/*`, `/fonts/`, `/system/status/`, `/system/ai-test/`, `/ai/runs/`, `/jobs/*` |
| Panel pages | `/user/login`, `/settings/accounts`, `/settings/accounts/:id` (tabs Profile, Brand, Automation), `/settings/system` (tabs Status, AI calls, Jobs) |
| Panel components | Layout shell, account switcher, `StatusTag`, `ContentText`, `DateTime`, `JobButton`, `JobProgress`, error text map |
| Background tasks | `system.ai_test`, daily `ai.prune_payloads`, `core.sweep_stale_jobs` every 5 minutes, daily `core.prune_jobs` |
| AI tasks | `system.ping` |
| Settings | `SOCIALHUB_AI_*`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SOCIALHUB_JOB_TIMEOUT_OVERRIDES`, `SOCIALHUB_MEDIA_BACKEND`, `SOCIALHUB_MEDIA_URL_TTL_SECONDS`, `SOCIALHUB_WORK_DIR` and the S3 settings |
| Documents | None |

## Depends on / needed by

- **Depends on:** nothing. The existing scaffold (Django/DRF, Celery, Redis, PostgreSQL, and the Refine + Ant Design panel) is the starting point.
- **Needed by:** every other epic. Specific gates: E00-S05 gates every AI task from E02 on; E00-S06 gates every endpoint that returns a job, E06-S01's uploads and the posting pack downloads in E08-S05.

## Done when

On a fresh checkout with the documented environment variables:

1. An admin signs in, creates an Instagram account, fills its brand profile and uploads a logo.
2. With the `s3` backend pointed at a private bucket, the uploaded logo opens in the panel through a presigned URL.
3. The admin opens Settings → System, sees which providers and keys are configured, runs the AI test, watches the job progress to success, and sees two rows in the AI call log.
4. An operator signs in and can read everything above but cannot create accounts, change the handle, or change the autopilot switches.
5. The sidebar shows exactly the navigation map in DESIGN-SYSTEM.md; no template demo page is reachable.
6. The backend starts without the scaffold's old provider and publisher variables.

## Later

- `Workspace` above `InstagramAccount` for multiple teams.
- A real user administration page and password reset.
- Phase 2: the Instagram connection (E00-S04): `AccountConnection`, the provider layer, Instagram Login, encrypted tokens, the Connection tab, the `publishing_enabled` switch, and the `instagram` block on the System page.
- The Facebook Login adapter (`graph_api_fb`) for public research signals (E02-S03), behind the provider interface E00-S04 adds.
- Spend caps on top of the `AIRun` cost data.
- A generic audit log fed by the same service functions that already write `ContentEvent`.
