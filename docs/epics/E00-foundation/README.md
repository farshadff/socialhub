# E00 — Foundation

## Goal

Not a workflow step. This epic builds the things every step needs before it can run: people can sign in, an Instagram account exists with its brand profile and a working connection, AI calls go through one gateway, and long actions run as tracked background jobs with files in storage. When E00 is done, the team can start E01 without touching infrastructure again.

It also contains the largest risk check in the plan: the week-1 spike that proves the unofficial Instagram provider can log in, publish and read insights on a throwaway account.

## Scope

**In the MVP**

- Sign-in with a session cookie and CSRF; two derived roles (admin, operator); users created by an admin through Django admin or `createsuperuser`.
- The panel shell: Social Hub navigation, theme tokens, account switcher, shared components (`StatusTag`, `ContentText`, `DateTime`), English error text keyed by error code, removal of the template's demo pages.
- Instagram accounts with their settings (`publishing_enabled`, `autopilot`, `posting_rules`) and one brand profile each.
- The Instagram provider layer (`instagrapi`, `manual`, `fake`, a `graph_api` stub), encrypted sessions, per-account proxy, login and challenge flow, daily verification.
- The AI gateway for Claude and OpenAI with a prompt registry, a fake provider, and the `AIRun` log.
- `JobRun`, the job polling endpoint, `JobButton`/`JobProgress`, and the media storage setting (local or S3-compatible).

**Left for later**

- User management screens, password reset by email, single sign-on, fine-grained permissions.
- Workspaces and multi-tenancy.
- Spend caps, model routing and prompt editing in the panel.
- The real `graph_api` adapter.
- Notifications outside the panel.

## Stories

| ID | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E00-S01](S01-sign-in.md) | Sign in and keep a session | Must | 1.5 | 1.5 | |
| [E00-S02](S02-panel-shell.md) | Panel shell, navigation and design tokens | Must | 0 | 3 | |
| [E00-S03](S03-accounts-and-brand.md) | Manage Instagram accounts and brand profile | Must | 2 | 2.5 | |
| [E00-S04](S04-instagram-connection.md) | Connect an Instagram account (provider layer and spike) | Must | 4 | 1.5 | |
| [E00-S05](S05-ai-gateway.md) | AI gateway for Claude and OpenAI | Must | 3 | 0.5 | |
| [E00-S06](S06-jobs-and-media-storage.md) | Background jobs, run tracking and media storage | Must | 2 | 1 | |
| | **Total** | | **12.5** | **10** | |

## Flow

1. **E00-S01** adds the auth endpoints and replaces the panel's demo identity with a real session. Everything after it assumes a signed-in user.
2. **E00-S06** adds `JobRun`, the Celery task base and `GET /jobs/{id}/`. S04 and S05 both return jobs, so S06's backend lands before their endpoints.
3. **E00-S02** strips the template and builds the shell every later page sits in. It needs only `GET /auth/me/` and `GET /accounts/` (it can start on mocks).
4. **E00-S03** adds accounts and brand profiles; the account switcher from S02 starts returning real data.
5. **E00-S04** starts on day 1 with the spike script, in parallel with everything else, then builds the provider layer and the Connection tab.
6. **E00-S05** adds the AI gateway, the System page and the AI test call.

```text
day 1 ──► S04 spike (script only, throwaway account) ─────► go / no-go by end of week 1
S01 ─► S06 (backend) ─┬─► S04 provider layer + Connection tab
                      └─► S05 AI gateway + System page
S01 ─► S02 shell ─► S03 accounts + brand ─► S04 / S05 / S06 panel parts
```

## Owns

| Kind | Items |
| --- | --- |
| Tables | `InstagramAccount`, `BrandProfile`, `AccountConnection`, `JobRun`, `AIRun` (and Django's `auth.User`) |
| Django apps | `accounts`, `instagram`, `ai`; additions to `core` |
| Endpoints | `/auth/*`, `/accounts/*`, `/accounts/{id}/brand/*`, `/fonts/`, `/accounts/{id}/connection/*`, `/system/status/`, `/system/ai-test/`, `/ai/runs/`, `/jobs/*` |
| Panel pages | `/user/login`, `/settings/accounts`, `/settings/accounts/:id` (tabs Profile, Brand, Connection, Automation), `/settings/system` |
| Panel components | Layout shell, account switcher, `StatusTag`, `ContentText`, `DateTime`, `JobButton`, `JobProgress`, error text map |
| Background tasks | `instagram.login`, `instagram.challenge`, `instagram.verify`, daily `instagram.verify_all`, `system.ai_test`, daily `ai.prune_payloads` |
| AI tasks | `system.ping` |
| Settings | `SOCIALHUB_ENCRYPTION_KEY`, `SOCIALHUB_IG_*`, `SOCIALHUB_AI_*`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SOCIALHUB_MEDIA_BACKEND` and the S3 settings |

## Depends on / needed by

- **Depends on:** nothing. The existing scaffold (Django/DRF, Celery, Redis, PostgreSQL, Ant Design Pro) is the starting point.
- **Needed by:** every other epic. Specific gates: E00-S04's spike result gates E02-S03, E08-S03 and E09-S01; E00-S05 gates every AI task from E02 on; E00-S06 gates every endpoint that returns a job and E06-S01's uploads.

## Done when

On a fresh checkout with the documented environment variables:

1. An admin signs in, creates an Instagram account, fills its brand profile and uploads a logo.
2. The admin connects the account with the `fake` provider locally and with `instagrapi` on the throwaway account in the spike environment, including a challenge code round trip, and sees the capabilities list.
3. The admin opens Settings → System, sees which providers and keys are configured, runs the AI test, watches the job progress to success, and sees two rows in the AI call log.
4. An operator signs in and can read everything above but cannot create accounts, connect, or change the publishing and autopilot switches.
5. The sidebar shows exactly the navigation map in DESIGN-SYSTEM.md; no template demo page is reachable.
6. The spike report is written with a go or no-go decision for each capability.

## Later

- `Workspace` above `InstagramAccount` for multiple teams.
- A real user administration page and password reset.
- The `graph_api` provider implementation behind the interface that already exists.
- Spend caps on top of the `AIRun` cost data.
- A generic audit log fed by the same service functions that already write `ContentEvent`.
