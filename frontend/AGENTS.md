# Frontend guide for AI contributors

This file applies to `frontend/`. Follow the repository-root `AGENTS.md` as well, when present.

## Project stack

- This is the Social Hub admin preview, based on Ant Design Pro 6.0.3 (upstream commit `42f2cb1d303380909ea04c73b5e60679d09c321a`).
- Runtime: React 19, TypeScript, Umi Max 4, Ant Design 6, and Ant Design Pro Components 3.
- Use the existing Ant Design and Pro Components patterns for layout, forms, tables, feedback, icons, and design tokens. Avoid adding a second UI framework or styling system without a clear project need.
- Use npm and keep `package-lock.json` in sync with `package.json`. The project requires Node.js 22 or newer; Docker uses Node 24.
- The product UI language is English (`en-US`) and the layout is left-to-right (LTR). Preserve these defaults in `config/config.ts` and user-visible copy.

## Where to make changes

- `config/config.ts`: Umi Max, locale, Ant Design provider, plugins, and global app configuration.
- `config/routes.ts`: route tree and page titles/icons. Page modules live under `src/pages/` and are matched by their route component paths.
- `config/defaultSettings.ts`: Ant Design Pro layout defaults, title, logo, and default theme.
- `src/app.tsx`: runtime initial state, global layout, request setup, and Pro SettingDrawer.
- `src/pages/`: route pages. Keep page-specific API calls and types next to the page when they are only used there.
- `src/services/ant-design-pro/`: generated API clients and types. Update the OpenAPI input/configuration and regenerate these files with `npm run openapi`; do not hand-edit generated output.
- `config/proxy.ts`: local development proxy for `/api/v1/`. Docker sets `SOCIALHUB_API_PROXY_TARGET` to the backend service.

## Rules for AI changes

- Read the relevant page, route, service, and API contract before editing. Reuse existing components and conventions, and keep changes limited to the requested behavior.
- Keep user-facing text in English. Do not reintroduce Chinese or Persian UI copy, RTL layout, or browser-language overrides unless the product requirements explicitly change.
- Treat the current preview as a local scaffold: it uses a demo identity, synthetic fixtures, and template mocks on pages that are not connected to the Social Hub API. Do not present fixtures or mock actions as real account data or completed operations.
- Only call documented backend endpoints. Handle loading, empty, and error states in the UI; do not invent endpoint behavior, permissions, authentication, or publishing capabilities.
- Do not add secrets, real credentials, analytics IDs, or production service URLs to frontend source or examples.
- Preserve accessibility: use semantic Ant Design controls, visible labels, keyboard-operable interactions, and clear feedback for state changes.
- Keep route and component changes compatible with the current Umi Max/Ant Design versions. Avoid broad template cleanup or dependency upgrades as part of a feature task.
- Do not run tests unless the user asks. For requested validation, report exactly which build, lint, type, container, or browser checks were run; a successful build is not proof of runtime or product acceptance.

## Theme behavior

- The profile menu provides Light and Dark theme choices. The current choice is persisted in browser local storage and is also available in the Pro SettingDrawer.
- Use the Ant Design Pro setting value `light` for Light and `realDark` for Dark. ProLayout passes the dark mode through its Pro Config provider, which applies Ant Design's dark algorithm to the layout and its page content. Keep the profile menu and SettingDrawer synchronized when changing theme behavior.
- The default remains Light for new browsers. Do not replace the built-in theme handling with sidebar-only colors or another independent theme state.

## Docker preview

- From the repository root, `docker compose up --build -d` starts the local stack. The frontend is available at <http://localhost:5173> and maps to container port `8000`.
- The frontend container serves the Umi Max development app, bind-mounts `frontend/`, and stores dependencies in the `frontend_pro_node_modules` named volume.
- The frontend proxies `/api/v1/` to the backend container. Keep the browser-facing API path relative; do not point browser code directly at a container hostname.
- If dependencies change, rebuild the frontend image and refresh the named dependency volume as needed. Do not remove project data volumes as part of ordinary frontend work.
