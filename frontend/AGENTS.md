# Frontend guide for AI contributors

This file applies to `frontend/`. Follow the repository-root `AGENTS.md` as well, when present.

## Project stack

- This is the Social Hub panel, based on Ant Design Pro 6.0.3 (upstream commit `42f2cb1d303380909ea04c73b5e60679d09c321a`). The template's demo pages, mocks and extra locales were removed in E00-S02.
- Runtime: React 19, TypeScript, Umi Max 4, Ant Design 6, and Ant Design Pro Components 3.
- Use the existing Ant Design and Pro Components patterns for layout, forms, tables, feedback, icons, and design tokens. Avoid adding a second UI framework or styling system without a clear project need.
- Use npm and keep `package-lock.json` in sync with `package.json`. The project requires Node.js 22 or newer; Docker uses Node 24.
- The product UI language is English (`en-US`) and the layout is left-to-right (LTR). Preserve these defaults in `config/config.ts` and user-visible copy.

## Where to make changes

- `config/config.ts`: Umi Max, locale, Ant Design provider, plugins, and global app configuration.
- `config/theme.ts`: the only source of design tokens (colour, radius, type, the Vazirmatn font stack). `config/config.ts` and `config/defaultSettings.ts` import it. No file under `src/` contains a literal colour, font family or radius; `src/utils/hexColors.test.ts` fails on hex colours under `src/`. Use `theme.useToken()` / `antd-style` tokens and Ant Design presets.
- `config/routes.ts`: the route tree and sidebar from `docs/DESIGN-SYSTEM.md` section 5. Menu labels and page titles come from `src/locales/en-US/menu.ts` as `menu.<name>` (nested: `menu.<group>.<name>`). A page not built yet renders `PlaceholderPage`; its story replaces the page file. Detail routes use `hideInMenu`; admin-only routes use `access: 'canAdmin'`.
- `config/defaultSettings.ts`: Pro layout defaults (`mix`, fixed sidebar, light theme, logo, title).
- `src/app.tsx`: session bootstrap from `GET /auth/me/`, layout and top bar, request setup, the one `QueryClientProvider`, and the Pro SettingDrawer.
- `src/requestErrorConfig.ts`: the request layer. It adds `X-CSRFToken` to mutating requests, turns every failure into an `ApiError`, and sends the browser to sign-in on `403 authentication_required`.
- `src/services/socialhub/`: hand-written, typed API clients, one file per area (`http.ts` is the shared client; `auth.ts`, `accounts.ts`, `jobs.ts`, …). Call the API only through `api` / `apiRequest` from `http.ts`; never build URLs to another host.
- `src/pages/`: route pages. Keep page-specific components and types next to the page.
- `mock/`: Umi mocks for endpoints whose backend has not landed (active with `npm start`, off with `npm run dev`). Delete a mock in the story that delivers the endpoint.
- `config/proxy.ts`: local development proxy for `/api/v1/`. Docker sets `SOCIALHUB_API_PROXY_TARGET` to the backend service.

## Panel conventions

- **Session.** `initialState.currentUser` is `{ id, name, username, email, access }` with `access` `admin` or `operator`. `src/access.ts` exposes `canAdmin`; hide admin-only actions with it rather than letting operators hit `403 permission_denied`.
- **Account scope.** The current account is the `account` model (`useModel('account')`). Use `useCurrentAccount()`, `useAccountId()` and `withAccount(params)` from `src/utils/accountRequest.ts`; never build the `account` parameter by hand. Wrap account-scoped pages in `AccountGate`.
- **Data fetching.** `ProTable`'s `request` for tables; TanStack Query (`useQuery`, `useMutation` from `@tanstack/react-query`) for everything else, with query keys `[accountId, resource, params]` (`accountQueryKey`). Switching account invalidates every key that starts with the old account ID. Queries retry once; mutations never retry; no refetch on window focus.
- **Errors.** English text comes from `src/utils/errorText.ts` by error `code` (`errorText`, `fieldErrorText`, `jobErrorText`); add new codes there. A failed query renders `PageError` (with Retry and the request reference). A failed `useMutation` without its own `onError` shows a notification with the code's text and reference by default; pass `meta: { onConflict }` to reload on `409`. Code that awaits `api.*` directly handles the error itself with `notifyError` and, for forms, `applyFieldErrors(form, error)`, showing the returned unmatched messages in an `Alert` above the form.
- **Shared components (reuse, don't rebuild).** `StatusTag` (all status colours and labels; add new kinds and values to `docs/DESIGN-SYSTEM.md` section 3 first, then to `StatusTag/statusMap.ts`), `ContentText` (captions, briefs, scripts, topic titles: `dir="auto"` and the content font), `DateTime` (account timezone, UTC tooltip), `PageError`, `PlaceholderPage`, `TabPlaceholder`, `AccountGate`, `AccountSwitcher`, `AttentionBadge`, `JobButton`/`JobProgress`/`useJob`/`useActiveJob` (E00-S06; `src/hooks/useJob.ts`, job types and `jobKindLabel` in `src/services/socialhub/jobs.ts`).
- **Forms with unsaved changes.** Call `useUnsavedChangesGuard(dirty)` from `src/utils/unsavedChanges.ts`; it asks "Discard unsaved changes?" before any in-app navigation (including a `?tab=` change) and on reload.
- **Account settings.** After changing an account, refresh the `account` model (`refreshAccounts()`) so the switcher and the top-bar connection and publishing tags follow; `src/pages/settings/accounts/[id]/useAccountUpdate.ts` does both. Brand fonts from `GET /fonts/` load with `loadBrandFont` / `brandFontStack` (`src/utils/brandFonts.ts`).
- **Component tests.** `src/utils/testing.tsx` has `withQueryClient`, `apiError`, `testModel` (for a mocked `useModel`), `testJob`, `TEST_ACCOUNT`, and `hex()` so test files carry no hex colour literal.
- **Page frame.** Every page is a `PageContainer` with a title and its primary action on the right; content sits in `ProCard`s. Handle loading (skeletons), empty, error, no account and not-allowed states as `docs/DESIGN-SYSTEM.md` section 7 describes.

## Rules for AI changes

- Read the relevant page, route, service, and API contract before editing. Reuse existing components and conventions, and keep changes limited to the requested behavior.
- Keep user-facing text in English. Do not reintroduce Chinese or Persian UI copy, RTL layout, or browser-language overrides unless the product requirements explicitly change.
- Sign-in is real (`/auth/*`). Mocks under `mock/` stand in only for endpoints whose backend has not landed; do not present mock data as real account data or completed operations.
- Only call documented backend endpoints. Handle loading, empty, and error states in the UI; do not invent endpoint behavior, permissions, authentication, or publishing capabilities.
- Do not add secrets, real credentials, analytics IDs, or production service URLs to frontend source or examples.
- Preserve accessibility: use semantic Ant Design controls, visible labels, keyboard-operable interactions, and clear feedback for state changes.
- Keep route and component changes compatible with the current Umi Max/Ant Design versions. Avoid dependency upgrades as part of a feature task.
- Do not run tests unless the user asks. For requested validation, report exactly which build, lint, type, container, or browser checks were run; a successful build is not proof of runtime or product acceptance.

## Theme behavior

- The avatar menu holds the Light and Dark theme choices and "Sign out". The current choice is persisted in browser local storage and is also available in the Pro SettingDrawer.
- Use the Ant Design Pro setting value `light` for Light and `realDark` for Dark. ProLayout passes the dark mode through its Pro Config provider, which applies Ant Design's dark algorithm to the layout and its page content. Keep the profile menu and SettingDrawer synchronized when changing theme behavior.
- The default remains Light for new browsers. Do not replace the built-in theme handling with sidebar-only colors or another independent theme state.

## Docker preview

- From the repository root, `docker compose up --build -d` starts the local stack. The frontend is available at <http://localhost:5173> and maps to container port `8000`.
- The frontend container serves the Umi Max development app, bind-mounts `frontend/`, and stores dependencies in the `frontend_pro_node_modules` named volume.
- The frontend proxies `/api/v1/` to the backend container. Keep the browser-facing API path relative; do not point browser code directly at a container hostname.
- If dependencies change, rebuild the frontend image and refresh the named dependency volume as needed. Do not remove project data volumes as part of ordinary frontend work.
