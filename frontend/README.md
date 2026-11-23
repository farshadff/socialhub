# Social Hub panel

The Social Hub panel, based on [Ant Design Pro](https://github.com/ant-design/ant-design-pro) 6.0.3 (commit `42f2cb1d303380909ea04c73b5e60679d09c321a`). English, left-to-right. The template's demo pages were removed in E00-S02; the route tree follows `docs/DESIGN-SYSTEM.md`.

Start the full local stack from the repository root with `docker compose up --build -d`, run `docker compose exec backend python manage.py migrate`, and create a user (`createsuperuser`, or `seed_users` for local and E2E use). Open <http://localhost:5173> and sign in.

`npm start` serves the panel with Umi mocks on (files in `mock/` stand in for endpoints whose backend has not landed); `npm run dev` turns mocks off. Contributor rules are in `AGENTS.md`.
