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

`frontend/` is the Ant Design Pro 6 template with Social Hub's name and logo on it. Its menu still lists the template's demo pages (dashboard, forms, lists, profile, result, exception, account, chatbot), which call mock endpoints. This story removes them and builds the shell described in [DESIGN-SYSTEM.md](../../DESIGN-SYSTEM.md): the navigation map, theme tokens, top bar with account switcher, the shared display components, and the single place that turns API error codes into English text.

It is frontend-only. After it, a feature story adds a page by replacing one placeholder component; it never touches layout, theme or error handling.

## Scope

**In**

- Remove template demo pages, routes, mocks and unused template components.
- The route tree and sidebar from the navigation map, with a placeholder page for every route a later story owns.
- `frontend/config/theme.ts` as the single source of tokens; bundled `Vazirmatn` font.
- Top bar: logo and name, account switcher, connection indicator, publishing indicator, reserved slot for the attention count, user menu.
- Global account state and the helper that adds `account` to API calls.
- Shared components: `StatusTag`, `ContentText`, `DateTime`, `AccountGate`, `PageError`, `PlaceholderPage`.
- Error handling: English text by error code, field errors into forms, conflict handling.

**Out (later)**

- The pages themselves (each belongs to its own story).
- The attention count data (E11-S01); `JobButton`, `JobProgress` (E00-S06); `MediaPreview` (E06-S07).
- Persian panel UI, right-to-left layout, Jalali dates.
- Mobile layout.

## Behaviour and rules

### Template removal

1. Delete these page directories and their routes, mocks, tests and services: `src/pages/Welcome*`, `Admin.tsx`, `dashboard/`, `form/`, `list/`, `profile/`, `result/`, `account/`, `chatbot/`, `table-list/`, `user/register*`, `src/services/ant-design-pro/`, `frontend/mock/*`, `config/oneapi.json`.
2. Delete template components that nothing imports afterwards: `ArticleListContent`, `AvatarList`, `StandardFormRow`, `TagSelect`, `RightContent/LangDropdown`, `RightContent/VersionDropdown`, and `src/utils/chinaDivision*`.
3. Remove dependencies that become unused: `china-division`, `topojson-client`, `d3`, `@ant-design/x`, `@ant-design/x-markdown`, `@ant-design/x-sdk`, `highlight.js`, `mockjs` and their type packages. Keep `@ant-design/plots`, `@tanstack/react-query`, `dayjs`.
4. Keep `src/pages/exception/403`, `404`, `500` as pages but remove them from the menu.
5. Keep only the `en-US` locale maintained. Delete `bn-BD`, `id-ID`, `ja-JP`, `pt-BR`, `zh-CN`, `zh-TW`. Leave `fa-IR` in place untouched as the seam for a later Persian panel; it is not selectable.
6. `cloudflare-worker/` and the build tooling are left alone.

### Navigation

7. The sidebar shows exactly these items, in this order, with these icons (Ant Design icon names):

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

8. Detail routes exist but are hidden from the menu (`hideInMenu`) and highlight their parent: `/plans/:planId`, `/content/:id`, `/review/:taskId`, `/analytics/posts/:publicationId`, `/reports/:id`, `/settings/accounts/:id`.
9. `/` redirects to `/overview`. Unknown paths show the 404 page.
10. Every route that a later story owns renders `PlaceholderPage` with the page title and the text "This page arrives with {story ID}." Menu labels come from `src/locales/en-US/menu.ts`.
11. `/settings/system` has `access: 'canAdmin'`. Operators do not see it in the menu, and direct navigation shows the 403 page.
12. Browser tab title is "{Page title} · Social Hub". The favicon and `manifest.json` name use the Social Hub logo and name.

### Theme

13. `frontend/config/theme.ts` exports the token object from DESIGN-SYSTEM.md section 2. `config/config.ts` (Ant Design `theme`) and `config/defaultSettings.ts` (`colorPrimary`) both import from it. No other file contains a literal colour, font family or radius; the template's Tailwind utility classes with literal colours disappear with the demo pages.
14. `Vazirmatn` variable font (woff2) lives in `frontend/public/fonts/` with an `@font-face` rule in `src/global.less` and `font-display: swap`. It is appended to the Ant Design default font stack. Nothing loads from a font CDN.
15. Light theme is the default; the existing Light/Dark choice in the avatar menu and the Pro `SettingDrawer` keep working as documented in `frontend/AGENTS.md`.
16. Layout stays `mix` with a fixed sidebar. The footer shows "Social Hub" and the app version from `package.json`; the template's links are removed.

### Account context

17. A Umi model `src/models/account.ts` holds `accounts` (active accounts from `GET /accounts/?status=active&page_size=100`), `currentAccountId`, `currentAccount`, `setCurrentAccount(id)` and `refreshAccounts()`.
18. On load the current account is, in order: the ID in local storage key `socialhub.currentAccountId` if it is still in the list; otherwise the first account by handle; otherwise none.
19. The top-bar switcher is an Ant Design `Select` (width 220 px, searchable by handle and display name). Each option shows `@handle` and the display name in secondary text. With one account it still shows, so the user sees the context. With none it shows the disabled placeholder "No accounts".
20. Changing the account stores the new ID, invalidates every TanStack Query whose key starts with the old account ID, and keeps the user on the same list page. On a detail page (a route with an ID), it navigates to that section's list page, because the record belongs to the other account.
21. `src/utils/accountRequest.ts` exports `withAccount(params)` and a `useAccountId()` hook. All account-scoped service calls use them, so no page builds the `account` parameter by hand.
22. `AccountGate` wraps account-scoped pages. With no current account it renders the "No account selected" state: for admins, "Add your first Instagram account to get started." with the button "Add account" linking to `/settings/accounts`; for operators, "No Instagram account is set up yet. Ask an admin to add one."
23. The publishing indicator sits to the right of the spacer: a `StatusTag`-styled tag reading "Publishing on" (success) or "Publishing off" (error) from `currentAccount.publishing_enabled`. Clicking it goes to `/settings/accounts/{id}?tab=automation`. It is hidden when there is no account. Just left of it, a connection indicator shows `StatusTag kind="connection"` for `currentAccount.connection_status` when that is `expiring`, `needs_attention` or `disconnected`, with the tooltip "Instagram connection: {label}". Clicking it goes to `/settings/accounts/{id}?tab=connection`. It is hidden when the connection is `connected` (a `manual` connection is always `connected`) and when there is no account.
24. The attention count is an `AttentionBadge` component placed in the top bar that renders nothing until E11-S01 gives it data. E11-S01's items include the connection types `connection_needs_attention`, `connection_expiring` and `connection_disconnected`; the badge counts them like any other item.
25. Data fetching convention for all later stories: `ProTable`'s `request` prop for tables; TanStack Query (`useQuery`, `useMutation`) for everything else, with query keys shaped `[accountId, resource, params]`. One `QueryClientProvider` is added in `rootContainer` with `retry: false` for mutations and one retry for queries, and no refetch on window focus.

### Shared components

26. `StatusTag` (`src/components/StatusTag`): props `kind` and `status`. `kind` is one of the kinds listed in DESIGN-SYSTEM.md section 3 (the list grows as epics add statuses, for example `item`, `plan`, `slot`, `candidate`, `topic`, `job`, `qc`, `review`, `publication`, `connection`, `publishing`, `verdict`, `goal`, `account`, `research_run`, `research_source`, `feed_item`, `feed_source`, `script`, `ai_run`). It looks up colour and label in one map implementing that section; epics add their entries to the map rather than defining their own colours. This story ships the `connection` entries, because the top bar uses them: `connected` green "Connected", `expiring` orange "Expiring soon", `needs_attention` orange "Needs attention", `disconnected` grey "Disconnected". An unknown pair renders a grey tag with the raw value in sentence case, and logs a console warning in development.
27. `ContentText` (`src/components/ContentText`): renders user or AI content with `dir="auto"`, `lang` from the current account's `content_language`, and the content font stack (`Vazirmatn` first when the language is `fa`). Props: `as` (`span`, `p`, `div`), `ellipsis` (rows), `preserveLineBreaks`. Captions, briefs, scripts, topic titles and feed item text always go through it.
28. `DateTime` (`src/components/DateTime`): props `value` (ISO UTC string) and `format` (`datetime` default `D MMM YYYY, HH:mm`; `date`; `time`; `relative`). It converts to the current account's timezone with dayjs `utc` and `timezone` plugins and shows a tooltip "{UTC value} UTC · {timezone name}". A null value renders "—".
29. `PageError` (`src/components/PageError`): an Ant Design `Result` with the English text for the error code, a "Retry" button calling the supplied refetch, and the `request_id` in small secondary text ("Reference: …").
30. `PlaceholderPage`: a `PageContainer` with the title and an `Empty` with the story text from rule 10.

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
| `instagram_not_connected` | This account isn't connected to Instagram, or its connection needs attention. Check Settings → Accounts → Connection. |
| `instagram_permission_missing` | Instagram hasn't granted the permission this needs. Connect the account again and allow every permission. |
| `publishing_disabled` | Publishing is switched off for this account. |
| `service_unavailable` | The service is temporarily unavailable. Try again shortly. |
| `service_timeout` | The service took too long to respond. Try again. |
| `upstream_error` | A connected service didn't respond. Try again. |
| `csrf_failed` | Your session expired. Reload the page. |
| `server_error` | Something went wrong on our side. Share the reference with support. |
| `request_error` | That request couldn't be processed. |

32. Field-level text is chosen by `fields[].code`: `required` "This is required.", `blank` "This can't be empty.", `invalid` "This value isn't valid.", `min_value` "This is below the minimum.", `max_value` "This is above the maximum.", `min_length` "This is too short.", `max_length` "This is too long.", `does_not_exist` "That choice isn't available.", `unique` "This is already in use." Unknown field codes fall back to the API's field `message`.
33. `applyFieldErrors(form, error)` sets errors on Ant Design form fields from `fields[].path` (dot paths become name arrays, numeric segments become indexes). Paths that match no field are shown in an error `Alert` at the top of the form.
34. Default handling in the request layer: failed queries are rendered by the page (`PageError`); failed mutations show `notification.error` with the code's text and the reference, unless the caller handles the error itself. A `409` also triggers the caller's reload callback. No mutation is retried automatically.
35. An `OfflineBanner` (already in the scaffold) stays; its text is "You're offline. Changes can't be saved."

## Data

None. Reads `InstagramAccount` fields `id`, `handle`, `display_name`, `timezone`, `content_language`, `publishing_enabled`, `status` and the computed `connection_status` through `GET /accounts/` (see E00-S03).

## API

No new endpoints. Uses `GET /auth/me/` (E00-S01) and `GET /accounts/` (E00-S03). Until E00-S03's backend is merged, a Umi mock at `frontend/mock/accounts.ts` returns two sample accounts in the documented shape, one `connected` and one `needs_attention`; the mock is deleted in E00-S03.

## Background work

None.

## AI

None.

## Panel

This whole story is the panel shell; the rules above are the specification. Summary of what a user sees after it:

- **Top bar:** logo and "Social Hub" · account switcher · (space) · connection tag when the connection is not healthy · "Publishing on/off" tag · user avatar with menu (Light theme, Dark theme, Sign out).
- **Sidebar:** the eleven items of rule 7.
- **Content area:** `PageContainer` with the page title. Every page not yet built shows the placeholder.
- **States:** no account (rule 22), loading accounts (the switcher shows a loading state and pages show skeletons), accounts failed to load (`PageError` in the content area with Retry), not allowed (403 page).

## Acceptance criteria

1. Given a signed-in user, when the panel loads, then the sidebar lists exactly the items in rule 7 in order, and no template demo page is reachable by menu or by URL (old URLs show the 404 page).
2. Given an operator, when they look at Settings, then System is not listed, and opening `/settings/system` shows the 403 page.
3. Given two active accounts, when the user picks the second in the switcher and reloads the browser, then the second is still selected.
4. Given the stored account ID no longer exists, when the panel loads, then the first account by handle is selected and stored.
5. Given no accounts, when an admin opens `/plans`, then the page shows "Add your first Instagram account to get started." with a working "Add account" button; an operator sees the ask-an-admin text and no button.
6. Given the current account has `publishing_enabled` false, when any page is shown, then the top bar shows a red "Publishing off" tag that links to the account's Automation tab.
7. Given a Persian caption passed to `ContentText`, when it renders, then it is right-aligned and reads right-to-left inside the left-to-right page, in `Vazirmatn`.
8. Given a UTC timestamp and an account in `Asia/Tehran`, when `DateTime` renders it, then it shows Tehran local time and the tooltip shows the UTC value and the timezone name.
9. Given `StatusTag` with `kind="item"` and `status="needs_revision"`, when it renders, then it is an orange tag reading "Needs revision".
10. Given an API error with code `provider_not_configured` on a mutation, when it returns, then a notification shows the English text from rule 31 and the reference ID.
11. Given a `validation_error` with `fields[0].path = "goals.0.target_value"`, when `applyFieldErrors` runs on a form with that field, then the error appears under that field.
12. Given a search of `frontend/src` for hex colour literals, when run after this story, then the only matches are inside `config/theme.ts` (which lives outside `src`) — that is, none in `src`.
13. Given the dark theme is chosen from the avatar menu, when pages render, then all shell elements and shared components remain readable (no hard-coded light colours).
14. Given the current account's `connection_status` is `needs_attention`, when any page is shown, then the top bar shows an orange "Needs attention" connection tag that links to the account's Connection tab; given it is `connected`, then no connection tag is shown.

## Subtasks

### Backend

None.

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S02-FE1 | Remove the template and build the route tree | Apply rules 1–6. Rewrite `config/routes.ts` to rules 7–11 with `PlaceholderPage`; update `src/locales/en-US/menu.ts`; title, favicon, manifest, footer (rules 12, 16). Remove unused dependencies and refresh `package-lock.json`. `npm run lint` and `npm run build` pass. | 0.5 |
| E00-S02-FE2 | Theme tokens and font | `config/theme.ts`; wire into `config/config.ts` and `config/defaultSettings.ts`; bundle `Vazirmatn` and `@font-face` (rules 13–15). Check light and dark. | 0.5 |
| E00-S02-FE3 | Account context and top bar | `src/models/account.ts`, `src/utils/accountRequest.ts`, `src/services/socialhub/accounts.ts` (list only), `AccountSwitcher`, connection and publishing indicators, `AttentionBadge` shell, `AccountGate`, `QueryClientProvider` in `rootContainer`, temporary accounts mock (rules 17–25). Unit tests for selection order and switching. | 0.75 |
| E00-S02-FE4 | Shared display components | `StatusTag` with the full colour and label map, `ContentText`, `DateTime`, `PlaceholderPage` (rules 26–28, 30). Tests: every status in DESIGN-SYSTEM.md section 3 maps to the expected colour; direction and timezone cases. | 0.5 |
| E00-S02-FE5 | Error handling | `src/utils/errorText.ts`, field text map, `applyFieldErrors`, `PageError`, default mutation and conflict handling in `src/requestErrorConfig.ts` (rules 29, 31–35). Update `src/requestErrorConfig.test.ts`. | 0.5 |
| E00-S02-FE6 | Shell checks and contributor notes | Playwright smoke test: sign in, walk every sidebar item, check titles; keyboard walk through top bar and menu with visible focus. Update `frontend/AGENTS.md`: services live in `src/services/socialhub/`, tokens in `config/theme.ts`, data-fetching convention, shared components to reuse. | 0.25 |

### Test

None beyond the tests inside each subtask.

## Test notes

- Vitest component tests for `StatusTag` (table-driven from the mapping), `ContentText` (`dir`, `lang`, font), `DateTime` (Tehran, UTC, null), `AccountSwitcher` (selection order, persistence, detail-page redirect), `applyFieldErrors` (nested and indexed paths, unmatched paths).
- Playwright: navigation smoke test for admin and operator roles; old template URLs return the 404 page.
- A lint rule or a small test that fails on hex colour literals under `src/`.
- Manual check at 1280 × 720 in light and dark themes.

## Later

- Persian panel: enable `fa-IR`, switch the layout direction, and replace `errorText.ts` with locale messages; components already use tokens and logical layout from Ant Design.
- Jalali dates: one change inside `DateTime`.
- Workspace switcher above the account switcher when multi-tenancy arrives; `withAccount` stays the single place that scopes requests.
