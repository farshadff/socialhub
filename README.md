# Social Hub local development

This is the container-first foundation for the internal Instagram MVP. It currently includes a Django/DRF API, an English operator panel built on Refine with Ant Design, PostgreSQL, Redis, a Celery worker, a separate render worker, and one Celery Beat scheduler.

The build plan is in [docs/](docs/README.md). Phase 1, the current work, covers the AI agents, content creation, scheduling and the operator panel; posting and metrics are done by hand. The Instagram API (account connection, automated publishing, API metrics) is Phase 2 — see [docs/ROADMAP.md](docs/ROADMAP.md).

The local source/model adapters return deterministic synthetic data. External publishing is intentionally unavailable: `SOCIALHUB_PUBLISHING_ENABLED=false`, the only publisher is `disabled`, and startup fails if the publisher is changed or enabled. Do not put provider credentials in this checkout.

## Requirements

- Docker Engine with Docker Compose v2
- Enough free memory and disk space for the application and renderer images

Host Python and Node installations are not needed for the documented path.

## First start

From the repository root:

```sh
cp .env.example .env
docker compose up --build -d
docker compose exec backend python manage.py migrate
```

`.env.example` contains local-only credentials and fixture-provider defaults. Keep the publisher set to `disabled` and `SOCIALHUB_PUBLISHING_ENABLED=false`; do not use these placeholder credentials outside local development.

The initial image build includes Python/JavaScript dependency installation, Chromium, FFmpeg, and Noto fonts for the render-worker image. The scheduler is a single Compose service. Migrations run explicitly after PostgreSQL is healthy; workers do not race migrations during startup.

Open the dashboard at <http://localhost:5173>. The API is at <http://localhost:8000/api/v1/>. Readiness is at <http://localhost:8000/api/v1/health/ready/>; the deterministic provider sample is at <http://localhost:8000/api/v1/demo/>. The Vite development server proxies `/api/v1/` requests to Django. Its overview page shows API, database, Redis, fixture provider, and publishing status.

Create an admin only if you need the Django admin at <http://localhost:8000/admin/>:

```sh
docker compose exec backend python manage.py createsuperuser
```

Useful operations:

```sh
docker compose logs -f backend frontend worker render-worker scheduler
docker compose restart
docker compose down
```

`docker compose down` preserves the named PostgreSQL and media volumes. `docker compose down -v` deletes those volumes and their data.

## Services

| Service | Local role | Host address |
| --- | --- | --- |
| `frontend` | Refine + Ant Design panel on the Vite development server, English UI | `127.0.0.1:5173` |
| `backend` | Django/DRF API and Django admin | `127.0.0.1:8000` |
| `postgres` | Durable application database | `127.0.0.1:5432` |
| `redis` | Celery broker and short-lived coordination | `127.0.0.1:6379` |
| `worker` | Default Celery queue | Internal service only |
| `render-worker` | Isolated `render` queue; Chromium, FFmpeg and Noto fonts included | Internal service only |
| `scheduler` | The one local Celery Beat process | Internal service only |

Database and media use named volumes. Redis is disposable and is not the source of truth. The app containers run as an unprivileged user. The frontend and API ports bind to loopback for local development.

## Dependency and rendering notes

Python dependencies are pinned with hashes in [backend/requirements.lock](backend/requirements.lock); their direct constraints are in [backend/pyproject.toml](backend/pyproject.toml). JavaScript dependencies are pinned in [frontend/package-lock.json](frontend/package-lock.json) and exact package versions in [frontend/package.json](frontend/package.json).

The renderer image provides system Chromium, FFmpeg, and Noto fonts. The browser automation library, final Persian font, and production rendering approach remain subject to the US-004 Persian/rendering spike. This image is a local prerequisite layer, not an accepted rendering benchmark.

The development containers use Django's runserver and Vite's dev server. This Compose file is for local development; hosted deployment, secure production settings, secrets injection, and release/rollback are separate work.

## Current API skeleton

- `GET /api/v1/health/live/` confirms the Django process is responding.
- `GET /api/v1/health/ready/` checks PostgreSQL and Redis and returns only dependency status, not connection details.
- `GET /api/v1/demo/` returns one clearly synthetic company-feed item and fixed model output, plus provider mode. It never calls an external source or model.
- The synthetic source item is stored in `backend/apps/core/fixtures/demo_source_items.json` and loaded by the fixture adapter. It is sample UI data, not source evidence or publishable content.
- The Django admin is available for local development. Product login flows, staff permissions, and migrations for product entities are later increments.

## API errors and contract

The current API contract is documented in [docs/openapi.yaml](docs/openapi.yaml). API errors use a Persian safe message, an English machine code, optional field paths, a request ID in both the body and `X-Request-ID`, and a retryability flag. Session-authenticated API views use `403 authentication_required` for an unauthenticated session; permission denials use `403 permission_denied`. New API views require authentication by default, while the local health and demo endpoints are explicitly public.

The Social Hub overview fetches readiness and local demo data through the same-origin `/api/v1/` proxy, using the panel's Refine data provider (`frontend/src/providers/data-provider.ts`). The panel has no mock data.

## Versions checked for this scaffold

The initial compatible set is Python 3.14, Django 6.1.3, Django REST framework 3.18.3, Celery 5.6.2, Node 24.20.0, React 19.3.1, Vite 8, React Router 7, Refine 5 (`@refinedev/core` 5.0.12, `@refinedev/antd` 6.0.3) and Ant Design 5.29. The panel started from Refine's official `examples/base-antd` starter (refinedev/refine commit `2352eb5b6539e2f39ad9aef652279ad1dcf2c467`); see [frontend/README.md](frontend/README.md). `@refinedev/antd` supports Ant Design 5 only, so the panel moves to Ant Design 6 when Refine does.
