# Frontend guide for AI contributors

This file applies to `frontend/`. Follow the repository-root `AGENTS.md` as well, when present.

## Project stack

- The Social Hub operator panel, built on Refine 5 with `@refinedev/antd` and Ant Design 5. It started from Refine's `examples/base-antd` starter.
- Runtime: React 19, TypeScript, Vite 8, React Router 7, TanStack Query 5 (used through Refine's data hooks).
- Use Refine hooks and `@refinedev/antd` components with plain Ant Design components. Do not add Ant Design Pro / Pro Components, a second UI framework or another styling system.
- Use npm and keep `package-lock.json` in sync with `package.json`. Versions are pinned exactly. Node 22.12 or newer; Docker uses Node 24.
- The UI language is English and the layout is left-to-right. Content previews (captions, scripts) use `dir="auto"`.

## Where to make changes

- `src/App.tsx`: `<Refine>` providers, `resources` (sidebar items and their routes), the route tree and `ThemedLayout`.
- `src/theme.ts`: Ant Design tokens from docs/DESIGN-SYSTEM.md section 2. No other file contains a literal colour, font family or radius.
- `src/providers/data-provider.ts`: the only place that talks HTTP to the API. It handles DRF paging, filters, ordering, CSRF and the API error envelope. Pages use Refine hooks (`useTable`, `useForm`, `useModalForm`, `useList`, `useOne`, `useCustom`, `useCustomMutation`), never `fetch`.
- `src/services/socialhub/<area>.ts`: an area's TypeScript types and hooks for non-CRUD endpoints (actions), built on `useCustom` / `useCustomMutation`.
- `src/pages/<section>/`: route pages. Keep page-only types next to the page.
- `src/components/`: shared components listed in docs/DESIGN-SYSTEM.md section 6. Reuse them instead of building a second version.
- `vite.config.ts`: dev proxy for `/api/v1/` (`SOCIALHUB_API_PROXY_TARGET`) and the Vitest config.

## Rules for AI changes

- Read the relevant page, route, provider and API contract (`docs/API.md`, `docs/openapi.yaml`) before editing. Keep changes limited to the requested behaviour.
- Every page uses `PageFrame`; a page that is only a full-page create or edit form uses Refine's `Create` / `Edit`. Tables use `useTable` with Ant Design `Table`; forms use `useForm` / `useModalForm` / `useDrawerForm` with Ant Design `Form`.
- Only call documented backend endpoints. Handle loading, empty and error states; do not invent endpoint behaviour, permissions, authentication or publishing capabilities.
- Keep user-facing text in English, sentence case.
- Do not add secrets, real credentials, analytics IDs or production URLs. Refine telemetry stays disabled (`options.disableTelemetry`).
- Preserve accessibility: semantic Ant Design controls, visible labels, keyboard operation, accessible names on icon buttons.
- Do not run tests unless asked. When you validate, report exactly which checks ran; a successful build is not proof of product acceptance.

## Theme behaviour

- Light is the default. The switch in the top bar toggles dark mode by changing the Ant Design algorithm in `ColorModeProvider`; the choice is stored under `socialhub.colorMode`.
- Components read colours from tokens (`theme.useToken()`), so both modes work without extra styles.

## Docker preview

- From the repository root, `docker compose up --build -d` starts the stack. The panel is at <http://localhost:5173>.
- The container runs the Vite dev server, bind-mounts `frontend/` and keeps dependencies in the `frontend_node_modules` named volume.
- If dependencies change, rebuild the image and remove the `frontend_node_modules` volume so it is refilled. Do not remove data volumes as part of frontend work.
