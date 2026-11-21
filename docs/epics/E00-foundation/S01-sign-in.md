# E00-S01 — Sign in and keep a session

| | |
| --- | --- |
| Epic | E00 Foundation |
| Priority | Must |
| Estimate | BE 1.5 d · FE 1.5 d · QA 0 d |
| Depends on | — (existing scaffold) |
| Needed by | Every other story; first E00-S02, E00-S03, E00-S06 |

## User story

As a team member, I want to sign in to the panel with my username and password and stay signed in while I work, so that only our team can see and change our Instagram work.

## Context

The scaffold has Django session authentication switched on in DRF (`SessionAuthentication`, `IsAuthenticated` by default) but no API to sign in, and the panel fakes a "Local Admin" identity in `frontend/src/app.tsx`. The template's login page talks to Ant Design Pro mock endpoints. This story adds the four auth endpoints, the two-role rule, and a real sign-in page.

There is no registration and no user administration screen in the MVP. An admin creates users with `python manage.py createsuperuser` (admins) or in Django admin at `/admin/` (operators).

## Scope

**In**

- `GET /auth/csrf/`, `POST /auth/login/`, `POST /auth/logout/`, `GET /auth/me/`.
- Role derived from `is_superuser`: `admin` or `operator`.
- Reusable DRF permission classes for admin-only endpoints.
- Failed-login throttling.
- Panel: sign-in page, session bootstrap, redirect to sign-in when the session ends, sign-out, CSRF header on every mutating request.

**Out (later)**

- Password reset by email, "remember me" options, two-factor authentication for panel users.
- User list, invite and deactivate screens (Django admin covers this).
- Single sign-on.

## Behaviour and rules

1. **Roles.** A user's role is `admin` when `is_superuser` is true, otherwise `operator`. The role is computed, never stored. `is_staff` only controls access to Django admin and has no meaning in the API.
2. **Sign-in input.** `username` (1–150 characters, trimmed, matched case-insensitively) and `password` (1–128 characters, not trimmed).
3. **Sign-in success.** Valid credentials for an active user create a session (Django's `login()`, which rotates the session key) and return the user. The response also returns a fresh CSRF token because Django rotates it on login.
4. **Sign-in failure.** Wrong username, wrong password and inactive user all return the same response: `400` with code `invalid_credentials`. The response never says which part was wrong.
5. **Throttling.** After 5 failed attempts for the same username-and-IP pair within 15 minutes, further attempts return `429 rate_limited` with a `Retry-After` header, until the window passes. A successful sign-in clears the counter. Counters live in the Redis cache.
6. **Session lifetime.** 14 days of inactivity (`SESSION_COOKIE_AGE = 1209600`, `SESSION_SAVE_EVERY_REQUEST = True` so activity extends it). The cookie is HTTP-only, `SameSite=Lax`, and `Secure` whenever `DJANGO_DEBUG` is false.
7. **CSRF.** `GET /auth/csrf/` sets the `csrftoken` cookie and returns the token. Every `POST`, `PUT`, `PATCH`, `DELETE` — including `POST /auth/login/` — must carry `X-CSRFToken`. A missing or wrong token returns the existing `403 csrf_failed`.
8. **Signed out.** Any protected endpoint called without a valid session returns the existing `403 authentication_required`.
9. **Sign-out.** `POST /auth/logout/` deletes the session and returns `204`. Calling it without a session also returns `204`.
10. **Deactivation.** Setting `is_active = false` on a user ends access on the next request: Django's session authentication rejects inactive users, so the response is `403 authentication_required`.
11. **Admin-only endpoints.** Use `apps.core.permissions.IsAdmin`. An operator calling one gets `403 permission_denied`.
12. **Public endpoints.** Only `/auth/csrf/`, `/auth/login/`, `/health/live/`, `/health/ready/` and the API root are public. The scaffold's public `/demo/` endpoint is removed in this story.

## Data

- Django's `auth.User`; no new tables. See [DATA-MODEL.md](../../DATA-MODEL.md) section 2.
- Sessions stay in the database (`django.contrib.sessions`, already installed).
- New settings in `backend/config/settings.py`: `CACHES` with a Redis backend on `REDIS_URL` (needed for throttle counters shared between processes), `SESSION_COOKIE_AGE`, `SESSION_SAVE_EVERY_REQUEST`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SESSION_COOKIE_SAMESITE`, `CSRF_COOKIE_HTTPONLY = False` (the panel must read the token).

Full user representation, returned only by the `/auth/*` endpoints:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | int | |
| `username` | text | |
| `full_name` | text | `first_name` and `last_name` joined; falls back to `username` |
| `email` | text | May be empty |
| `role` | text | `admin` or `operator` |

Every other endpoint that refers to a user (`created_by`, `actor`, `resolved_by`, `started_by` and similar) returns the short reference `{"id", "name"}`, where `name` is `full_name`.

## API

Conventions and the error shape are in [API.md](../../API.md).

### `GET /api/v1/auth/csrf/` — public

Sets the `csrftoken` cookie.

```json
{ "csrf_token": "Q0b5Zq1n3rVYc8yHnJm2T4uKxWlPa7dE" }
```

### `POST /api/v1/auth/login/` — public, CSRF required

Request:

```json
{ "username": "sara", "password": "correct horse battery staple" }
```

Response `200`:

```json
{
  "user": {
    "id": 3,
    "username": "sara",
    "full_name": "Sara Moradi",
    "email": "sara@example.com",
    "role": "operator"
  },
  "csrf_token": "p9LkT2vXc4mN8sQeR1yUz6BdHfJ0aWgo"
}
```

Errors:

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| Missing or empty `username` or `password` | 400 | `validation_error` | `fields` lists each path with `required` or `blank` |
| Wrong credentials or inactive user | 400 | `invalid_credentials` | `fields` empty, `retryable` false |
| Too many failed attempts | 429 | `rate_limited` | `Retry-After` in seconds, `retryable` true |
| Missing or wrong CSRF token | 403 | `csrf_failed` | Existing behaviour |

Example failure:

```json
{
  "error": {
    "code": "invalid_credentials",
    "message": "نام کاربری یا گذرواژه نادرست است.",
    "fields": [],
    "request_id": "5d0d4a4e-2a39-4a0e-a8f0-6f3f0d1b7c11",
    "retryable": false
  }
}
```

### `POST /api/v1/auth/logout/`

No body. Response `204`, no content. The session cookie is cleared.

### `GET /api/v1/auth/me/`

Response `200`:

```json
{
  "user": {
    "id": 1,
    "username": "admin",
    "full_name": "admin",
    "email": "",
    "role": "admin"
  }
}
```

Without a session: `403 authentication_required`.

## Background work

None.

## AI

None.

## Panel

### Route `/user/login`

- No layout (`layout: false`), centred card, max width 400 px, on the page background token.
- Top of the card: the Social Hub logo (`/socialhub.svg`, 48 px) and the name "Social Hub", then the line "Sign in to continue".
- `LoginForm` from Pro Components with two fields and one button:

| Field | Component | Rules |
| --- | --- | --- |
| Username | `ProFormText`, user icon, `autoComplete="username"`, autofocus | Required: "Enter your username" |
| Password | `ProFormText.Password`, lock icon, `autoComplete="current-password"` | Required: "Enter your password" |

- Button: "Sign in", full width, shows a loading state while the request runs. Enter submits.
- Remove everything else the template login page has: the phone tab, captcha, "auto login", "forgot password", third-party icons, the language selector.

States:

| State | Behaviour |
| --- | --- |
| First load | Call `GET /auth/csrf/`; if it fails, show an inline `Alert`: "Can't reach the server. Check your connection and try again." with a Retry button |
| `invalid_credentials` | Inline error `Alert` above the fields: "Wrong username or password." Password field is cleared and focused |
| `rate_limited` | Inline error `Alert`: "Too many attempts. Try again in {n} minutes." using `Retry-After`; the button is disabled until then |
| `csrf_failed` | Fetch a new token once and resubmit silently; if it fails again show "Your session expired. Reload the page." |
| Success | Store the returned user in initial state, then go to the `redirect` query parameter if it is a same-origin path (keep the template's `getSafeRedirectUrl`), otherwise `/overview` |
| Already signed in | Visiting `/user/login` with a valid session redirects to `/overview` |

### Session bootstrap (`src/app.tsx`)

1. `getInitialState` calls `GET /auth/me/` with `skipErrorHandler`.
2. On `200`, `currentUser` is `{ id, name: full_name, username, email, access: role }`.
3. On `403 authentication_required`, `currentUser` is undefined and, unless the current path starts with `/user/`, the app redirects to `/user/login?redirect=<current path and query>`.
4. `src/access.ts` keeps `canAdmin` and derives it from `currentUser.access === 'admin'`.
5. The layout's `onPageChange` repeats the redirect check so a session that ends mid-use sends the user to sign-in on the next navigation.

### Request layer (`src/requestErrorConfig.ts`)

- A request interceptor reads the `csrftoken` cookie and sets `X-CSRFToken` on every non-`GET` request. If the cookie is missing it first calls `GET /auth/csrf/`.
- A response handler: on `403` with code `authentication_required` from any endpoint other than `/auth/me/`, clear `currentUser` and redirect to `/user/login?redirect=…` with the message "Your session ended. Sign in again."
- The full error-code-to-text map is built in E00-S02; this story adds only the two behaviours above and replaces the template's `success/errorCode` response format handling with the Social Hub error shape.

### Sign out

The avatar menu in the top bar has one account action, "Sign out". It calls `POST /auth/logout/`, clears initial state and goes to `/user/login`. Remove the template's "Center" and "Settings" items; keep the theme choice.

## Acceptance criteria

1. Given an active user with correct credentials, when they submit the sign-in form, then they land on `/overview` (or the `redirect` path) and `GET /auth/me/` returns their role.
2. Given a wrong password, when they submit, then the page shows "Wrong username or password.", no session cookie is set, and the response code is `invalid_credentials`.
3. Given an inactive user with the correct password, when they submit, then the result is identical to criterion 2.
4. Given 5 failed attempts for one username from one IP within 15 minutes, when a sixth is made, then the API returns `429 rate_limited` with `Retry-After` and the page shows the wait time.
5. Given no session, when any protected page is opened directly, then the browser goes to `/user/login?redirect=<that page>` and returns there after sign-in.
6. Given a signed-in operator, when they call an admin-only endpoint, then the API returns `403 permission_denied`.
7. Given a signed-in user, when they choose "Sign out", then the session is deleted server-side and a following `GET /auth/me/` returns `403 authentication_required`.
8. Given a `POST` without `X-CSRFToken`, when it reaches any endpoint including login, then the API returns `403 csrf_failed`.
9. Given a superuser, when they sign in, then `role` is `admin`; given a non-superuser, `role` is `operator`.
10. Given the stack is running, when `GET /api/v1/demo/` is called, then it returns `404 not_found`.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S01-BE1 | Create the `accounts` app and auth endpoints | New app `backend/apps/accounts/` registered in `INSTALLED_APPS`. `views_auth.py` with `csrf`, `login`, `logout`, `me`; `UserSerializer` with derived `role` and `full_name`; `urls.py` mounted at `api/v1/auth/`. Login is `AllowAny` plus `ensure_csrf_cookie`/`csrf_protect`. Add the Persian message for `invalid_credentials` to `apps/core/errors.py`. API tests for every row of the error table. | 0.5 |
| E00-S01-BE2 | Permissions, session and cache settings | `apps/core/permissions.py` with `IsAdmin` and `IsAdminOrReadOnly`. Settings from the Data section, including Redis `CACHES`. Remove the `/demo/` view, URL, its fixture loader call and the matching `openapi.yaml` path. Tests: operator gets `permission_denied` on a dummy admin view; inactive user loses access. | 0.5 |
| E00-S01-BE3 | Failed-login throttle and contract | `LoginThrottle` keyed on lowercase username + client IP, 5 per 15 minutes, counting only failures and reset on success. Add the four endpoints, `User` schema and `invalid_credentials` to `docs/openapi.yaml`. Throttle tests with a frozen clock. | 0.5 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S01-FE1 | Auth service and request layer | `src/services/socialhub/auth.ts` (`getCsrf`, `login`, `logout`, `getMe`) with types. CSRF request interceptor and `authentication_required` handling in `src/requestErrorConfig.ts`; replace the template's `ResponseStructure` handling with the Social Hub error shape. Unit tests for the interceptor and redirect. | 0.5 |
| E00-S01-FE2 | Sign-in page | Rewrite `src/pages/user/login/index.tsx` to the spec: two fields, states table, safe redirect. Delete the register and register-result pages and their routes. Component test for each state. | 0.5 |
| E00-S01-FE3 | Session bootstrap and sign-out | `getInitialState` from `GET /auth/me/`, redirect rules, `access.ts`, avatar menu with "Sign out". Update `src/app.test.tsx` and `src/access.test.ts`; update `e2e/login.spec.ts` to sign in against the real API. | 0.5 |

### Test

None beyond the tests inside each subtask.

## Test notes

- **API tests (pytest + DRF client with `enforce_csrf_checks=True`):** csrf endpoint sets cookie; login success rotates session key; the three failure cases return identical bodies apart from `request_id`; throttle window and reset; logout idempotent; `me` with and without session; inactive user; role derivation.
- **Panel tests (Vitest):** interceptor adds header only to mutating requests; `authentication_required` triggers one redirect, not a loop, when `/auth/me/` itself returns it; login page states.
- **End to end (Playwright, existing `e2e/login.spec.ts`):** sign in as a seeded admin, see the shell, sign out, get redirected when opening a protected route.
- Fixture: a management command or pytest fixture that creates `admin` (superuser) and `operator` users for tests; reused by later stories.

## Later

- Password reset and user invitations: add endpoints under `/auth/` and a Users page under Settings; the role rule and permission classes stay.
- More roles: replace the derived role with Django groups inside `IsAdmin`-style permission classes; views do not change.
- Single sign-on: an additional authentication backend; the session contract with the panel stays the same.
