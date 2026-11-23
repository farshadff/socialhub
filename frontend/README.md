# Social Hub panel

The operator panel, built on [Refine](https://github.com/refinedev/refine) with its Ant Design UI package. It started from Refine's official `examples/base-antd` starter (refinedev/refine `main` at commit `2352eb5b6539e2f39ad9aef652279ad1dcf2c467`) with the demo `posts` pages removed.

Stack: React 19, TypeScript, Vite 8, React Router 7, Refine core 5 (`@refinedev/core`, `@refinedev/antd`, `@refinedev/react-router`), Ant Design 5 and TanStack Query 5 (Refine's data cache). `@refinedev/antd` 6 supports Ant Design 5 only, so the panel stays on Ant Design 5 until Refine supports 6.

## Run it

Start the whole stack from the repository root with `docker compose up --build -d` and open <http://localhost:5173>. Vite proxies `/api/v1/` to Django.

Without Docker (Node 22.12 or newer):

```sh
npm ci
SOCIALHUB_API_PROXY_TARGET=http://localhost:8000 npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 with the `/api/v1/` proxy |
| `npm run build` | Type-check and build `dist/` |
| `npm run lint` | Biome lint and `tsc` |
| `npm test` | Vitest unit tests |
| `npm run refine -- <command>` | Refine CLI, for example `swizzle` or `update` |

## Layout

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | `<Refine>` setup: providers, resources (the sidebar), routes, layout |
| `src/theme.ts` | Design tokens; the only file with literal colours, fonts or radii |
| `src/providers/data-provider.ts` | Refine data provider for the Django REST API (`docs/API.md`) |
| `src/contexts/color-mode.tsx` | Light/dark choice, stored in local storage |
| `src/components/` | Shared components (`Header`, `Title`, `PageFrame`, …) |
| `src/pages/` | One folder per section |

Product rules for screens are in [docs/DESIGN-SYSTEM.md](../docs/DESIGN-SYSTEM.md). Contributor rules are in [AGENTS.md](AGENTS.md).
