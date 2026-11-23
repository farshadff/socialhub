# E00-S02 — Panel shell, navigation and design tokens

| | |
| --- | --- |
| Epic | E00 Foundation |
| Priority | Must |
| Estimate | BE 0 d · FE 3 d · QA 0 d |
| Depends on | E00-S01 (session); works on a mock of `GET /accounts/` until E00-S03 lands |
| Needed by | Every story with a panel part |

## User story

As an operator, I want one consistent panel where the menu follows our weekly workflow and I can switch between Instagram accounts, so that I always know where I am and which account I am working on.

## Context

`frontend/` is a [Refine](https://refine.dev) app (`@refinedev/core` 5, `@refinedev/antd` with Ant Design 5, `@refinedev/react-router`, Vite) started from Refine's official `base-antd` starter. It already has Social Hub's name, logo and theme tokens, the Social Hub data provider for the Django API (`src/providers/data-provider.ts`), Refine's `ThemedLayout` with a light/dark switch, and one Overview page that shows API readiness and the local demo sample. This story builds the rest of the shell described in [DESIGN-SYSTEM.md](../../DESIGN-SYSTEM.md): the navigation map, top bar with account switcher, account scoping in the data provider, the shared display components, and the single place that turns API error codes into English text.

It is frontend-only. After it, a feature story adds a page by replacing one placeholder component; it never touches layout, theme or error handling.

## Scope

**In**

- The Refine resources, route tree and sidebar from the navigation map, with a placeholder page for every route a later story owns.
- `frontend/src/theme.ts` stays the single source of tokens; bundled `Vazirmatn` font.
- Sidebar header with logo and name; top bar with account switcher, reserved slot for the attention count, user menu.
- Global account state, and account scoping inside the data provider.
- Shared components: `StatusTag`, `ContentText`, `DateTime`, `AccountGate`, `PageError`, `PlaceholderPage`.
- Error handling: English text by error code, field errors into forms, conflict handling.

**Out (later)**

- The pages themselves (each belongs to its own story).
- The attention count data (E11-S01); `JobButton`, `JobProgress` (E00-S06); `MediaPreview` (E06-S07).
- Persian panel UI, right-to-left layout, Jalali dates.
- Mobile layout.

## Behaviour and rules

### Starting point

1. The Refine starter's demo `posts` pages, `@refinedev/simple-rest` and Refine devtools are already gone, and nothing from Ant Design Pro remains. Do not add `@ant-design/pro-components`, Umi or another UI kit.
2. Keep and build on what exists: `socialHubDataProvider`, `ColorModeProvider`, `Header`, `Title`, `PageFrame` and the Overview page (which stays on `/overview` until E11-S01 replaces it).
3. Error pages: unknown paths render Refine's `ErrorComponent` (404) from the catch-all route; `src/pages/errors/forbidden.tsx` and `server-error.tsx` render an Ant Design `Result` with status `403` and `500`. None of them is a resource, so none is in the menu.
4. English only. No Refine `i18nProvider` is configured; labels are written in English in the resources and pages.
5. Refine telemetry stays off (`options.disableTelemetry: true`); Refine devtools are not added.
6. `package.json` keeps exact versions. Add packages only when a rule here needs them (for example `@testing-library/react` and `jsdom` for component tests, `@playwright/test` for the smoke test).

### Navigation

7. The sidebar shows exactly these items, in this order, with these icons (Ant Design icon names; the component is `<Name>Outlined` from `@ant-design/icons`). Each item is a Refine resource in `src/App.tsx` with `meta.label` and `meta.icon`; groups use a parent resource and `meta.parent`:

| Label | Route | Icon | Access |
| --- | --- | --- | --- |
| Overview | `/overview` | `dashboard` | all |
| Weekly plan | `/plans` | `schedule` | all |
| Research | `/research` | `radarChart` | all |
| Selection | `/selection` | `filter` | all |
| Content | `/content` | `appstore` | all |
| Review | `/review` | `audit` | all |
| Calendar | `/calendar` | `calendar` | all |
| Analytics | `/analytics/posts` (group with children Posts, Account) | `lineChart` | all |
| Reports | `/reports` | `fileText` | all |
| Library | `/library` | `picture` | all |
| Settings | `/settings/accounts` (group with children Accounts, System) | `setting` | System is admin-only |

8. Detail routes are the `show` (or `edit`) route of their section's resource, so they are not menu items and the parent stays highlighted: `/plans/:planId`, `/content/:id`, `/review/:taskId`, `/analytics/posts/:publicationId`, `/reports/:id`, `/settings/accounts/:id`.
9. `/` redirects to `/overview`. Unknown paths show the 404 page.
10. Every route that a later story owns renders `PlaceholderPage` with the page title and the text "This page arrives with {story ID}." Menu labels come from each resource's `meta.label`.
11. An `accessControlProvider` (`src/providers/access-control.ts`) answers from the signed-in user's role (E00-S01): `can({ resource: "system" })` is false for operators. Refine's sider then hides Settings → System, and its route is wrapped in `<CanAccess fallback={<Forbidden />}>`, so direct navigation shows the 403 page.
12. Browser tab title is "{Page title} · Social Hub", set by `DocumentTitleHandler` from the resource label (already in place). The favicon and `manifest.json` already use the Social Hub logo and name.

### Theme

13. `frontend/src/theme.ts` exports the token object from DESIGN-SYSTEM.md section 2 (already in place). `ColorModeProvider` passes it to Ant Design's `ConfigProvider` with the light or dark algorithm. No other file contains a literal colour, font family or radius.
14. `Vazirmatn` variable font (woff2) lives in `frontend/public/fonts/` with an `@font-face` rule in `src/index.css` (imported by `src/index.tsx`) and `font-display: swap`. It is already the last entry of the font stack in `src/theme.ts`. Nothing loads from a font CDN.
15. Light theme is the default. The Light/Dark choice moves from the top-bar switch into the user menu (Light theme, Dark theme), still through `useColorMode` and stored under `socialhub.colorMode`, as documented in `frontend/AGENTS.md`.
16. Layout stays Refine's `ThemedLayout` with a fixed, collapsible `ThemedSider`. A `Footer` passed to `ThemedLayout` shows "Social Hub" and the app version from `package.json` (exposed by Vite `define`).

### Account context

17. A React context `src/contexts/account.tsx` (`AccountProvider`, `useAccount()`) holds `accounts` (active accounts, loaded with Refine `useList` on resource `accounts`, filter `status=active`, page size 100), `currentAccountId`, `currentAccount`, `setCurrentAccount(id)` and `refreshAccounts()`.
18. On load the current account is, in order: the ID in local storage key `socialhub.currentAccountId` if it is still in the list; otherwise the first account by handle; otherwise none.
19. The top-bar switcher is an Ant Design `Select` (width 220 px, searchable by handle and display name). Each option shows `@handle` and the display name in secondary text. With one account it still shows, so the user sees the context. With none it shows the disabled placeholder "No accounts".
20. Changing the account stores the new ID, invalidates every account-scoped query in Refine's TanStack Query cache (`useInvalidate`, or `invalidateQueries` on the client from `@tanstack/react-query`'s `useQueryClient`), and keeps the user on the same list page. On a detail page (a route with an ID), it navigates to that section's list page, because the record belongs to the other account.
21. The data provider adds `account={currentAccountId}` to every request except the resources that are not account-scoped (docs/API.md: `accounts`, `fonts`, `system/*`, `auth/*`; `ai/runs` only when the page asks). It reads the ID through a getter that `AccountProvider` keeps current, so no page builds the `account` parameter by hand. `useAccountId()` is exported for pages that build a custom URL.
22. `AccountGate` wraps account-scoped pages. With no current account it renders the "No account selected" state: for admins, "Add your first Instagram account to get started." with the button "Add account" linking to `/settings/accounts`; for operators, "No Instagram account is set up yet. Ask an admin to add one."
23. Right of the spacer the top bar shows, in order, the attention count (rule 24) and the user menu. Accounts have no Instagram connection in Phase 1, so the top bar shows no connection or publishing state.
24. The attention count is an `AttentionBadge` component placed in the top bar that renders nothing until E11-S01 gives it data.
25. Data fetching convention for all later stories: Refine data hooks through the Social Hub data provider. `useTable` drives tables; `useForm`, `useModalForm` and `useDrawerForm` drive forms; `useList`, `useOne` and `useCustom` read; `useCreate`, `useUpdate`, `useDelete` and `useCustomMutation` write. Refine owns the query keys. The query client is configured once through `<Refine options={{ reactQuery: { clientConfig } }}>` with one retry for queries, no retry for mutations and no refetch on window focus. Pages never call `fetch` directly. Each area keeps its TypeScript types and its hooks for endpoints that are not plain CRUD (actions such as `POST /plans/{id}/activate/`) in `src/services/socialhub/<area>.ts`, built on `useCustom` and `useCustomMutation`; the "services" named in later stories are these files.

### Shared components

26. `StatusTag` (`src/components/StatusTag`): props `kind` and `status`. `kind` is one of the kinds listed in DESIGN-SYSTEM.md section 3 (the list grows as epics add statuses, for example `item`, `plan`, `slot`, `candidate`, `topic`, `job`, `qc`, `review`, `publication`, `verdict`, `goal`, `account`, `research_run`, `research_source`, `feed_item`, `feed_source`, `script`, `ai_run`). It looks up colour and label in one map implementing that section; epics add their entries to the map rather than defining their own colours. An unknown pair renders a grey tag with the raw value in sentence case, and logs a console warning in development.
27. `ContentText` (`src/components/ContentText`): renders user or AI content with `dir="auto"`, `lang` from the current account's `content_language`, and the content font stack (`Vazirmatn` first when the language is `fa`). Props: `as` (`span`, `p`, `div`), `ellipsis` (rows), `preserveLineBreaks`. Captions, briefs, scripts, topic titles and feed item text always go through it.
28. `DateTime` (`src/components/DateTime`): props `value` (ISO UTC string) and `format` (`datetime` default `D MMM YYYY, HH:mm`; `date`; `time`; `relative`). It converts to the current account's timezone with dayjs `utc` and `timezone` plugins and shows a tooltip "{UTC value} UTC · {timezone name}". A null value renders "—".
29. `PageError` (`src/components/PageError`): an Ant Design `Result` with the English text for the error code, a "Retry" button calling the supplied refetch, and the `request_id` in small secondary text ("Reference: …").
30. `PlaceholderPage`: a `PageFrame` with the title and an `Empty` with the story text from rule 10.

### Errors

31. `src/utils/errorText.ts` maps every API error code to English text. Unknown codes fall back to the API's `message`.

| Code | Text |
| --- | --- |
| `validation_error` | Some fields need attention. |
| `invalid_credentials` | Wrong username or password. |
| `authentication_required` | Your session ended. Sign in again. |
| `permission_denied` | You don't have permission to do this. |
| `not_found` | We couldn't find that. It may have been removed. |
| `method_not_allowed` | That action isn't supported here. |
| `rate_limited` | Too many requests. Wait a moment and try again. |
| `state_conflict` | This changed while you were working. We've reloaded the latest version. |
| `invalid_transition` | That action isn't available in the current status. |
| `job_in_progress` | Something is already running for this item. Wait for it to finish. |
| `version_conflict` | A newer version exists. We've loaded it; reapply your change if still needed. |
| `payload_too_large` | That file or request is too large. |
| `unsupported_media` | That file type or size isn't supported. |
| `provider_not_configured` | A required integration isn't set up. Ask an admin to check Settings → System. |
| `provider_error` | An external service failed. Try again in a few minutes. |
| `service_unavailable` | The service is temporarily unavailable. Try again shortly. |
| `service_timeout` | The service took too long to respond. Try again. |
| `upstream_error` | A connected service didn't respond. Try again. |
| `csrf_failed` | Your session expired. Reload the page. |
| `server_error` | Something went wrong on our side. Share the reference with support. |
| `request_error` | That request couldn't be processed. |

32. Field-level text is chosen by `fields[].code`: `required` "This is required.", `blank` "This can't be empty.", `invalid` "This value isn't valid.", `min_value` "This is below the minimum.", `max_value` "This is above the maximum.", `min_length` "This is too short.", `max_length` "This is too long.", `does_not_exist` "That choice isn't available.", `unique` "This is already in use." Unknown field codes fall back to the API's field `message`.
33. The data provider turns `fields[]` into Refine's `HttpError.errors`, keyed by `path`, with the text from rule 32. Forms built with `useForm`, `useModalForm` or `useDrawerForm` then show each error under its field without extra code. `applyFieldErrors(form, error)` does the same for an Ant Design form that Refine does not drive (dot paths become name arrays, numeric segments become indexes). Paths that match no field are shown in an error `Alert` at the top of the form.
34. Default handling: failed queries are rendered by the page (`PageError`); failed mutations show an error notification through Refine's notification provider (`useNotificationProvider` from `@refinedev/antd`) with the code's text and the reference, unless the caller passes its own `errorNotification`. A `409` also triggers the caller's reload callback. No mutation is retried automatically.
35. An `OfflineBanner` component shows "You're offline. Changes can't be saved." while the browser reports it is offline.

## Data

None. Reads `InstagramAccount` fields `id`, `handle`, `display_name`, `timezone`, `content_language` and `status` through `GET /accounts/` (see E00-S03).

## API

No new endpoints. Uses `GET /auth/me/` (E00-S01) and `GET /accounts/` (E00-S03). Until E00-S03's backend is merged, a fixture data provider at `frontend/src/providers/accounts-fixture.ts` (registered as a second Refine data provider and used only by `AccountProvider` while `VITE_SOCIALHUB_ACCOUNTS_FIXTURE=true`) returns two sample accounts in the documented shape; it is deleted in E00-S03.

## Background work

None.

## AI

None.

## Panel

This whole story is the panel shell; the rules above are the specification. Summary of what a user sees after it:

- **Sidebar header:** logo and "Social Hub".
- **Top bar:** account switcher · (space) · attention count (empty until E11-S01) · user avatar with menu (Light theme, Dark theme, Sign out).
- **Sidebar:** the eleven items of rule 7.
- **Content area:** a `PageFrame` with the page title. Every page not yet built shows the placeholder.
- **States:** no account (rule 22), loading accounts (the switcher shows a loading state and pages show skeletons), accounts failed to load (`PageError` in the content area with Retry), not allowed (403 page).

## Acceptance criteria

1. Given a signed-in user, when the panel loads, then the sidebar lists exactly the items in rule 7 in order, and unknown URLs show the 404 page.
2. Given an operator, when they look at Settings, then System is not listed, and opening `/settings/system` shows the 403 page.
3. Given two active accounts, when the user picks the second in the switcher and reloads the browser, then the second is still selected.
4. Given the stored account ID no longer exists, when the panel loads, then the first account by handle is selected and stored.
5. Given no accounts, when an admin opens `/plans`, then the page shows "Add your first Instagram account to get started." with a working "Add account" button; an operator sees the ask-an-admin text and no button.
6. Given a current account, when any page is shown, then the sidebar header shows the logo and name, and the top bar shows, left to right, the account switcher, the attention count slot and the user menu, and nothing else.
7. Given a Persian caption passed to `ContentText`, when it renders, then it is right-aligned and reads right-to-left inside the left-to-right page, in `Vazirmatn`.
8. Given a UTC timestamp and an account in `Asia/Tehran`, when `DateTime` renders it, then it shows Tehran local time and the tooltip shows the UTC value and the timezone name.
9. Given `StatusTag` with `kind="item"` and `status="needs_revision"`, when it renders, then it is an orange tag reading "Needs revision".
10. Given an API error with code `provider_not_configured` on a mutation, when it returns, then a notification shows the English text from rule 31 and the reference ID.
11. Given a `validation_error` with `fields[0].path = "goals.0.target_value"`, when `applyFieldErrors` runs on a form with that field, then the error appears under that field.
12. Given a search of `frontend/src` for hex colour literals, when run after this story, then the only matches are inside `src/theme.ts`.
13. Given the dark theme is chosen from the avatar menu, when pages render, then all shell elements and shared components remain readable (no hard-coded light colours).

## Subtasks

### Backend

None.

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S02-FE1 | Resources and route tree | Apply rules 1–6. Add the resources and routes of rules 7–11 in `src/App.tsx` with `PlaceholderPage`; error pages; `accessControlProvider`; footer (rules 12, 16). `npm run lint`, `npm test` and `npm run build` pass. | 0.5 |
| E00-S02-FE2 | Theme and font | Bundle `Vazirmatn` and `@font-face` in `src/index.css`; move the Light/Dark choice into the user menu (rules 13–15). Check light and dark. | 0.5 |
| E00-S02-FE3 | Account context and top bar | `src/contexts/account.tsx`, account scoping in `src/providers/data-provider.ts`, `AccountSwitcher`, `AttentionBadge` shell, `AccountGate`, query client options on `<Refine>`, temporary accounts fixture provider (rules 17–25). Unit tests for selection order, switching and the `account` parameter. | 0.75 |
| E00-S02-FE4 | Shared display components | `StatusTag` with the full colour and label map, `ContentText`, `DateTime`, `PlaceholderPage` (rules 26–28, 30). Tests: every status in DESIGN-SYSTEM.md section 3 maps to the expected colour; direction and timezone cases. | 0.5 |
| E00-S02-FE5 | Error handling | `src/utils/errorText.ts`, field text map, `applyFieldErrors`, `PageError`, field-error mapping and conflict handling in `src/providers/data-provider.ts`, default error notification, `OfflineBanner` (rules 29, 31–35). Extend `src/providers/data-provider.test.ts`. | 0.5 |
| E00-S02-FE6 | Shell checks and contributor notes | Playwright smoke test: sign in, walk every sidebar item, check titles; keyboard walk through top bar and menu with visible focus. Update `frontend/AGENTS.md`: all API access goes through the data provider, tokens in `src/theme.ts`, data-fetching convention, shared components to reuse. | 0.25 |

### Test

None beyond the tests inside each subtask.

## Test notes

- Vitest component tests (jsdom and Testing Library) for `StatusTag` (table-driven from the mapping), `ContentText` (`dir`, `lang`, font), `DateTime` (Tehran, UTC, null), `AccountSwitcher` (selection order, persistence, detail-page redirect), `applyFieldErrors` (nested and indexed paths, unmatched paths).
- Playwright: navigation smoke test for admin and operator roles; an unknown URL returns the 404 page.
- A lint rule or a small test that fails on hex colour literals under `src/`.
- Manual check at 1280 × 720 in light and dark themes.

## Later

- Persian panel: add a Refine `i18nProvider` with `en` and `fa`, set `ConfigProvider` `direction="rtl"` for Persian, and replace `errorText.ts` with locale messages; components already use tokens and logical layout from Ant Design.
- Jalali dates: one change inside `DateTime`.
- Workspace switcher above the account switcher when multi-tenancy arrives; `withAccount` stays the single place that scopes requests.
- Phase 2: a connection indicator and a "Publishing on/off" tag in the top bar, the `connection` and `publishing` `StatusTag` kinds, the connection attention items, and the error texts for `instagram_not_connected`, `instagram_permission_missing` and `publishing_disabled` (E00-S04, E08-S03).
