# Social Hub admin preview

This frontend is based on [Ant Design Pro](https://github.com/ant-design/ant-design-pro), upstream version 6.0.3 at commit `42f2cb1d303380909ea04c73b5e60679d09c321a`. Its default locale is English (`en-US`). The `/dashboard/analysis` route is customized as a Social Hub overview and reads the local Django readiness and demo endpoints.

Start the full local stack from the repository root with `docker compose up --build -d`, then run `docker compose exec backend python manage.py migrate`. Open <http://localhost:5173>.

The preview uses a local demo identity, synthetic fixture data, and Ant Design Pro's local mocks on its other template pages. Social Hub login and publishing are not implemented.
