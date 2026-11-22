# E00-S03 — Manage Instagram accounts and brand profile

| | |
| --- | --- |
| Epic | E00 Foundation |
| Priority | Must |
| Estimate | BE 2 d · FE 2.5 d · QA 0 d |
| Depends on | E00-S01, E00-S02; file storage setting from E00-S06 for logo uploads |
| Needed by | E00-S04, and every account-scoped story (E01 onward); the brand profile is read by E04-S03, E05-S01, E06-S02, E06-S06, E07-S03, E07-S04 |

## User story

As an admin, I want to add each Instagram account we manage and describe its brand once — logo, colours, fonts, voice, rules — so that every plan, brief, rendered asset and check for that account uses the same identity without anyone retyping it.

## Context

Almost every record in the product belongs to an `InstagramAccount`. This story creates the account record, its settings and its `BrandProfile`. It does not connect to Instagram; that is E00-S04. The account is useful before it is connected: plans, research, briefs and scripts all work with an unconnected account.

## Scope

**In**

- Create, list, read, update, archive and restore Instagram accounts.
- Account settings: timezone, content language, first day of the week, `publishing_enabled`, `autopilot`, `posting_rules`.
- One brand profile per account: logos, colours, fonts, tone of voice, audience, pillars, default hashtags, banned terms, CTA examples, displayed handle, AI disclosure policy.
- The bundled font list.
- Panel: Settings → Accounts list, and the account page with Profile, Brand and Automation tabs.

**Out (later)**

- Deleting an account and its data.
- Several brand profiles per account, brand profile versions, importing a brand kit file.
- Uploading custom fonts.
- Per-user access to specific accounts.

## Behaviour and rules

### Accounts

1. Only admins create accounts. Creating one also creates its `BrandProfile` (with the defaults in rule 12) and its `AccountConnection` (`provider` from `SOCIALHUB_IG_DEFAULT_PROVIDER`, `status = disconnected`) in the same transaction.
2. `handle`: a leading `@` and surrounding spaces are stripped, the value is lowercased, and it must match `^[a-z0-9._]{1,30}$`. It is unique across all accounts including archived ones.
3. `handle` can be changed only by an admin and only while the connection status is `disconnected`. Otherwise the API returns `409 invalid_transition`. The reason: the OAuth callback and the daily verification in E00-S04 compare the Instagram username with the handle, so a connected account's handle must keep matching it. Changing the handle never calls Instagram.
4. `display_name`: 1–80 characters.
5. `timezone`: a valid IANA name (checked with `zoneinfo`). Omitted on create means `SOCIALHUB_DEFAULT_ACCOUNT_TIME_ZONE`.
6. `content_language`: `fa` or `en`; default `fa`. `week_start_day`: 0–6 with 0 = Monday; default 5 (Saturday).
7. Changing `timezone` or `week_start_day` affects only plans and slots created afterwards. Existing plans keep their dates and times.
8. `posting_rules` limits: `min_gap_minutes` 15–1440, `max_feed_per_day` 1–10, `max_stories_per_day` 1–20, `max_revisions` 0–5. A `PATCH` may send a subset of keys; they are merged into the stored object. Unknown keys are rejected.
9. `autopilot` holds exactly three booleans: `selection`, `brief`, `script`. Partial updates are merged. Unknown keys are rejected.
10. `publishing_enabled`, `autopilot` and `status` can be changed only by admins. An operator sending any of them gets `403 permission_denied` and nothing is saved. Operators can change the other fields.
11. Turning `publishing_enabled` on requires the connection status to be `connected` or `expiring` (a `manual` connection is always `connected`). Otherwise `409 instagram_not_connected`. Turning it off is always allowed.
12. Archiving (`status = archived`) sets `publishing_enabled` to false in the same update. Archived accounts are excluded from the account switcher and from all scheduled background work. Restoring sets `status = active` and leaves publishing off. Accounts are never deleted through the API.
13. The list is ordered by `handle`. Filters: `status` (default returns both; the switcher asks for `active`), `search` (matches `handle` and `display_name`, case-insensitive).

### Brand profile

14. Defaults at creation: `colors` `{"primary": "#111111", "secondary": "#666666", "accent": "#1677FF", "background": "#FFFFFF", "text": "#111111"}`; `fonts` `{"heading": "vazirmatn", "body": "vazirmatn"}`; `handle_display` `"@{handle}"`; `ai_disclosure` `generated_only`; all lists empty; texts empty; no logos.
15. Operators and admins can both edit the brand profile.
16. `PUT` replaces all editable fields; every field in the request example below is required. The logo fields are read-only URLs in responses; a `PUT` may send `"logo_light": null` or `"logo_dark": null` to remove a logo, and any other value for them is ignored.
17. `colors`: all five keys required, each `^#[0-9A-Fa-f]{6}$`, stored uppercase.
18. `fonts.heading` and `fonts.body` must be keys returned by `GET /fonts/`.
19. Text and list limits:

| Field | Limit |
| --- | --- |
| `tone_of_voice`, `audience_summary` | up to 2,000 characters each |
| `content_pillars` | up to 10 items, 1–80 characters each |
| `default_hashtags` | up to 30 items; a leading `#` is stripped; each must match `^[^\s#]{1,100}$`; duplicates removed case-insensitively |
| `banned_terms` | up to 100 items, 1–80 characters each |
| `cta_examples` | up to 10 items, 1–200 characters each |
| `handle_display` | 1–40 characters |

20. The response includes `warnings`, a list that does not block saving. One warning exists in the MVP: `low_contrast` on `colors.text` when the contrast ratio between `text` and `background` is below 4.5:1.
21. The response includes `complete`: true when `logo_light` is set, `tone_of_voice` is not empty and both fonts are set. Other stories use it to nudge, not to block.
22. Logo upload: multipart field `file` plus `variant` (`light` or `dark`). Accepted types: PNG (256–4096 px on each side) and SVG. Maximum 2 MB. An SVG containing a `<script>` element, an `on…` event attribute, or an external reference (`href`/`xlink:href` not starting with `#` or `data:`) is rejected. Rejections return `400 unsupported_media`. A new upload replaces the previous file for that variant.
23. `light` is the logo used on light backgrounds; `dark` is used on dark backgrounds. When only one exists, renderers use it for both.

### Fonts

24. `GET /fonts/` returns the fonts bundled in `backend/apps/core/fonts/`. The MVP set, all under open licences: `vazirmatn`, `noto-sans-arabic`, `noto-naskh-arabic`, `inter`, `noto-sans`. Each has regular (400) and bold (700) files. The same files are used by the render templates in E06-S02.

## Data

Tables `InstagramAccount`, `BrandProfile`, `AccountConnection` (created here, used in E00-S04) as defined in [DATA-MODEL.md](../../DATA-MODEL.md) section 2. No new fields.

New setting: `SOCIALHUB_IG_DEFAULT_PROVIDER` (`fake` locally; `graph_api` when hosted).

Computed, not stored: `connection_status`, `connection_provider` and `brand_complete` on the account representation; `complete` and `warnings` on the brand representation.

## API

Conventions and error shape: [API.md](../../API.md).

### `GET /api/v1/accounts/`

Query: `status`, `search`, `page`, `page_size`.

```json
{
  "count": 1,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 1,
      "handle": "greenhome.ir",
      "display_name": "Green Home",
      "timezone": "Asia/Tehran",
      "content_language": "fa",
      "week_start_day": 5,
      "status": "active",
      "publishing_enabled": false,
      "autopilot": { "selection": false, "brief": false, "script": false },
      "posting_rules": {
        "min_gap_minutes": 120,
        "max_feed_per_day": 2,
        "max_stories_per_day": 5,
        "max_revisions": 2
      },
      "notes": "",
      "connection_status": "disconnected",
      "connection_provider": "graph_api",
      "brand_complete": false,
      "created_at": "2026-11-23T08:12:40Z",
      "updated_at": "2026-11-23T08:12:40Z"
    }
  ]
}
```

### `POST /api/v1/accounts/` — admin

Request:

```json
{
  "handle": "@GreenHome.ir",
  "display_name": "Green Home",
  "timezone": "Asia/Tehran",
  "content_language": "fa",
  "week_start_day": 5,
  "notes": ""
}
```

Only `handle` and `display_name` are required. Response `201`: the account object above.

| Case | HTTP | Code | Field |
| --- | --- | --- | --- |
| Operator calls it | 403 | `permission_denied` | |
| Handle fails the pattern | 400 | `validation_error` | `handle` / `invalid` |
| Handle already exists | 400 | `validation_error` | `handle` / `unique` |
| Unknown timezone | 400 | `validation_error` | `timezone` / `invalid` |
| `week_start_day` outside 0–6 | 400 | `validation_error` | `week_start_day` / `min_value` or `max_value` |

### `GET /api/v1/accounts/{id}/`

Response `200`: the account object. Unknown ID: `404 not_found`.

### `PATCH /api/v1/accounts/{id}/`

Any subset of `display_name`, `timezone`, `content_language`, `week_start_day`, `notes`, `posting_rules`, and for admins `handle`, `status`, `publishing_enabled`, `autopilot`.

Request (admin turns on publishing and one autopilot switch):

```json
{
  "publishing_enabled": true,
  "autopilot": { "brief": true },
  "posting_rules": { "min_gap_minutes": 180 }
}
```

Response `200`: the updated account object.

| Case | HTTP | Code | Notes |
| --- | --- | --- | --- |
| Operator sends an admin-only field | 403 | `permission_denied` | Nothing saved |
| `publishing_enabled: true` while the connection is not `connected` or `expiring` | 409 | `instagram_not_connected` | |
| `handle` change while connected | 409 | `invalid_transition` | `details.status` is the connection status and `details.reason` is `"connection_not_disconnected"` |
| Rule value out of range | 400 | `validation_error` | Path such as `posting_rules.min_gap_minutes` |
| Unknown key in `autopilot` or `posting_rules` | 400 | `validation_error` | Path such as `autopilot.publish` / `invalid` |

### `GET /api/v1/accounts/{id}/brand/`

```json
{
  "account": 1,
  "logo_light": "http://localhost:8000/media/accounts/1/brand/logo-light-9f2c1a7b.png",
  "logo_dark": null,
  "colors": {
    "primary": "#0B6E4F",
    "secondary": "#21295C",
    "accent": "#F2A541",
    "background": "#FFFFFF",
    "text": "#1B1B1B"
  },
  "fonts": { "heading": "vazirmatn", "body": "vazirmatn" },
  "tone_of_voice": "Warm, practical and encouraging. Short sentences. Speaks to the reader as 'you'. No slang, no exaggeration.",
  "audience_summary": "Homeowners aged 28–45 in large cities who want lower energy bills and a healthier home.",
  "content_pillars": ["Energy saving tips", "Before and after", "Customer stories", "Myths and facts"],
  "default_hashtags": ["خانه_سبز", "صرفه_جویی_انرژی"],
  "banned_terms": ["guaranteed", "cheapest"],
  "cta_examples": ["Save this for your next renovation.", "Send this to someone who is redecorating."],
  "handle_display": "@greenhome.ir",
  "ai_disclosure": "generated_only",
  "complete": true,
  "warnings": [],
  "updated_at": "2026-11-23T09:01:12Z"
}
```

### `PUT /api/v1/accounts/{id}/brand/`

Request: the same object without `account`, `logo_light`, `logo_dark` (unless clearing with `null`), `complete`, `warnings`, `updated_at`.

```json
{
  "colors": {
    "primary": "#0b6e4f",
    "secondary": "#21295C",
    "accent": "#F2A541",
    "background": "#FFFFFF",
    "text": "#BBBBBB"
  },
  "fonts": { "heading": "vazirmatn", "body": "noto-sans-arabic" },
  "tone_of_voice": "Warm, practical and encouraging.",
  "audience_summary": "Homeowners aged 28–45 in large cities.",
  "content_pillars": ["Energy saving tips"],
  "default_hashtags": ["#خانه_سبز"],
  "banned_terms": [],
  "cta_examples": [],
  "handle_display": "@greenhome.ir",
  "ai_disclosure": "generated_only"
}
```

Response `200`: the brand object, here with normalised values and a warning:

```json
{
  "account": 1,
  "logo_light": "http://localhost:8000/media/accounts/1/brand/logo-light-9f2c1a7b.png",
  "logo_dark": null,
  "colors": {
    "primary": "#0B6E4F",
    "secondary": "#21295C",
    "accent": "#F2A541",
    "background": "#FFFFFF",
    "text": "#BBBBBB"
  },
  "fonts": { "heading": "vazirmatn", "body": "noto-sans-arabic" },
  "tone_of_voice": "Warm, practical and encouraging.",
  "audience_summary": "Homeowners aged 28–45 in large cities.",
  "content_pillars": ["Energy saving tips"],
  "default_hashtags": ["خانه_سبز"],
  "banned_terms": [],
  "cta_examples": [],
  "handle_display": "@greenhome.ir",
  "ai_disclosure": "generated_only",
  "complete": true,
  "warnings": [
    { "path": "colors.text", "code": "low_contrast", "message": "Text on background contrast is 1.92:1; 4.5:1 or more is recommended." }
  ],
  "updated_at": "2026-11-23T09:20:44Z"
}
```

| Case | HTTP | Code | Field |
| --- | --- | --- | --- |
| A colour is missing or malformed | 400 | `validation_error` | `colors.accent` / `required` or `invalid` |
| Unknown font key | 400 | `validation_error` | `fonts.heading` / `does_not_exist` |
| List too long or item too long | 400 | `validation_error` | `content_pillars` / `max_length`, or `banned_terms.3` / `max_length` |
| Hashtag with a space | 400 | `validation_error` | `default_hashtags.0` / `invalid` |

### `POST /api/v1/accounts/{id}/brand/logo/`

Multipart: `file`, `variant`. Response `200`: the brand object with the new URL.

| Case | HTTP | Code |
| --- | --- | --- |
| Not PNG or SVG; PNG outside size limits; unsafe SVG | 400 | `unsupported_media` |
| Larger than 2 MB | 413 | `payload_too_large` |
| `variant` missing or not `light`/`dark` | 400 | `validation_error` (`variant`) |

### `GET /api/v1/fonts/`

Not paginated.

```json
{
  "results": [
    {
      "key": "vazirmatn",
      "name": "Vazirmatn",
      "scripts": ["arabic", "latin"],
      "weights": [400, 700],
      "files": {
        "400": "http://localhost:8000/static/fonts/vazirmatn-400.woff2",
        "700": "http://localhost:8000/static/fonts/vazirmatn-700.woff2"
      }
    },
    {
      "key": "inter",
      "name": "Inter",
      "scripts": ["latin"],
      "weights": [400, 700],
      "files": {
        "400": "http://localhost:8000/static/fonts/inter-400.woff2",
        "700": "http://localhost:8000/static/fonts/inter-700.woff2"
      }
    }
  ]
}
```

## Background work

None.

## AI

None.

## Panel

### `/settings/accounts` — Accounts

- `PageContainer` title "Accounts"; primary action "Add account" (admins only).
- `ProTable`, server-side paging. Columns: Handle (`@handle`, links to the account page), Display name, Language ("Persian" / "English"), Timezone, Connection (`StatusTag kind="connection"`), Publishing (`StatusTag kind="publishing"`: "On" success, "Off" error, matching the top bar), Status (`StatusTag kind="account"`). Search form: text search; Status select (Active — default, Archived, All).
- Empty state: "No Instagram accounts yet. Add the first account your team manages." with "Add account" for admins.
- "Add account" opens a `ModalForm`:

| Field | Component | Notes |
| --- | --- | --- |
| Instagram handle | `ProFormText` with `@` prefix | Required; help text "Letters, numbers, dots and underscores" |
| Display name | `ProFormText` | Required |
| Timezone | `ProFormSelect`, searchable list of IANA names | Prefilled with the current account's timezone, or the browser's when there is no account |
| Content language | `ProFormRadio.Group` Persian / English | Default Persian |
| First day of the week | `ProFormSelect` Monday…Sunday | Default Saturday |

  Submit button "Add account". On success: message "Account added", refresh the account model, select the new account, go to its page on the Brand tab.

### `/settings/accounts/:id` — Account page

- Title `@handle`, subtitle display name, tags for connection and publishing in the header. Header action for admins: "Archive account" (or "Restore account"), with `Modal.confirm`: "Archive @{handle}? Publishing is switched off and the account is hidden from the account switcher. Its plans and content are kept."
- Tabs, selected by `?tab=`: **Profile**, **Brand**, **Connection** (E00-S04), **Automation**.
- Every tab: skeleton while loading; `PageError` on failure; `404` shows "This account doesn't exist."; leaving with unsaved changes asks "Discard unsaved changes?".

**Profile tab** — `ProForm`: Instagram handle (read-only with a lock icon and the tooltip "Disconnect the account to change its handle" unless admin and disconnected), Display name, Timezone, Content language, First day of the week, Notes (textarea, 1,000 characters). Under Timezone and First day of the week, helper text: "Changes apply to new plans only." Button "Save changes"; success message "Account saved".

**Brand tab** — one `ProForm` in five cards, one "Save brand profile" button fixed at the bottom of the form:

| Card | Content |
| --- | --- |
| Logos | Two upload boxes: "Logo for light backgrounds" (checkerboard-free white preview) and "Logo for dark backgrounds" (dark preview). Each shows the current logo, "Replace" and "Remove". Upload is immediate (does not wait for Save). Help text: "PNG or SVG, up to 2 MB." |
| Colours | Five Ant Design `ColorPicker`s (hex input enabled): Primary, Secondary, Accent, Background, Text. Beside them a live preview tile: background colour, a heading in the heading font and text colour, body line, an accent bar and a primary button shape. A `low_contrast` warning from the API shows as a warning `Alert` under the Text picker. |
| Fonts | Two `Select`s (Heading font, Body font) from `GET /fonts/`. Each option is rendered in its own font; the preview tile updates. Fonts are loaded with the `FontFace` API from the `files` URLs. |
| Voice and audience | Tone of voice (textarea with counter), Audience (textarea with counter), Handle shown on assets, AI disclosure (`Radio.Group`: "Label AI-generated assets only", "Always label", "Never label"). |
| Lists | Content pillars, Default hashtags (shown with `#`), Banned terms, CTA examples — each a `Select mode="tags"` with a count such as "4 / 10". |

  The Persian text fields use `dir="auto"`. Success message "Brand profile saved". When `complete` is false, an info `Alert` at the top lists what is missing ("Add a logo for light backgrounds", "Describe the tone of voice").

**Automation tab** — editable for admins, read-only for operators with the note "Only admins can change automation settings."

| Control | Detail |
| --- | --- |
| Publishing | `Switch`, label "Publish to Instagram". Help: "When off, nothing is sent to Instagram and due posts wait." Turning on asks `Modal.confirm`: "Turn on publishing for @{handle}? Scheduled posts will be sent to Instagram at their times." Disabled with the tooltip "Connect the account first" when the connection is not `connected` or `expiring`. |
| Autopilot | Three `Switch`es: "Confirm selection automatically", "Approve briefs automatically", "Approve scripts automatically", each with one line explaining what a person no longer does. |
| Posting rules | Four `InputNumber`s: "Minimum gap between posts (minutes)", "Reels and feed posts per day", "Stories per day", "Automatic revisions before human review". |

  Switches save immediately on change with a success message; posting rules save with a "Save rules" button. After any change the account model is refreshed so the top-bar publishing tag updates.

## Acceptance criteria

1. Given an admin, when they add an account with handle `@GreenHome.ir`, then it is stored as `greenhome.ir`, a brand profile with the defaults and a disconnected connection exist, and the account appears in the switcher.
2. Given an existing handle, when an admin adds it again in any letter case, then the form shows "This is already in use." under the handle field.
3. Given an operator, when they open Settings → Accounts, then there is no "Add account" button, and `POST /accounts/` returns `403 permission_denied`.
4. Given an operator, when they `PATCH` `{"display_name": "X", "publishing_enabled": true}`, then the response is `403 permission_denied` and the display name is unchanged.
5. Given a disconnected account on the `graph_api` provider, when an admin turns on publishing, then the API returns `409 instagram_not_connected` and the switch is disabled in the panel with its tooltip.
6. Given an active account with publishing on, when an admin archives it, then `status` is `archived`, `publishing_enabled` is false, and it disappears from the switcher.
7. Given `posting_rules.min_gap_minutes = 5`, when saved, then the API returns `validation_error` on `posting_rules.min_gap_minutes` and the field shows the error.
8. Given a `PATCH` with `{"autopilot": {"brief": true}}`, when saved, then `selection` and `script` keep their previous values.
9. Given a brand `PUT` with `default_hashtags: ["#خانه_سبز", "خانه_سبز"]`, when saved, then one hashtag `خانه_سبز` is stored.
10. Given text colour `#BBBBBB` on background `#FFFFFF`, when saved, then the save succeeds and a `low_contrast` warning is returned and shown.
11. Given a 3 MB PNG, when uploaded as a logo, then the API returns `413 payload_too_large`; given an SVG with a `<script>` element, then `400 unsupported_media`.
12. Given a valid PNG uploaded as the light logo, when the Brand tab reloads, then the logo shows in the light preview and `complete` reflects it.
13. Given a font key not in `GET /fonts/`, when saved, then the API returns `validation_error` on that font field.
14. Given a connected account, when an admin tries to change its handle, then the API returns `409 invalid_transition` and the panel field is read-only.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S03-BE1 | Models and migration | `InstagramAccount`, `BrandProfile`, `AccountConnection` in `apps/accounts/models.py` with choices, defaults and JSON validators (Pydantic models for `autopilot`, `posting_rules`, `colors`, `fonts`). `services.create_account()` creating the three rows in one transaction. Register in Django admin (`access_token_encrypted` excluded). Model tests. | 0.5 |
| E00-S03-BE2 | Account endpoints | `AccountViewSet` (list, create, retrieve, partial update; no delete) with filters, handle normalisation, merge semantics for JSON fields, admin-only field check, the publishing and handle transition rules, archive side effect, computed fields. Add `invalid_transition` and `instagram_not_connected` messages to `apps/core/errors.py` with support for `error.details`. API tests for every error row. | 0.75 |
| E00-S03-BE3 | Brand profile, logo and fonts | Brand `GET`/`PUT` with all limits, hashtag normalisation, contrast warning, `complete`. Logo upload with type, size, dimension and SVG safety checks, stored under `accounts/{id}/brand/`. Font registry `apps/core/fonts/registry.py` plus font files and `GET /fonts/` served from static files. `openapi.yaml` updated for all endpoints in this story. API tests. | 0.75 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E00-S03-FE1 | Services, list page and add modal | `src/services/socialhub/accounts.ts` (accounts, brand, fonts) with types; `/settings/accounts` table, filters, empty state, "Add account" `ModalForm`; remove the temporary accounts mock from E00-S02. | 0.5 |
| E00-S03-FE2 | Account page and Profile tab | Page shell with header tags, `?tab=` tabs, archive and restore confirm, unsaved-changes guard; Profile form with field errors through `applyFieldErrors`. | 0.5 |
| E00-S03-FE3 | Brand tab | Five cards as specified: logo uploads with previews, colour pickers with live preview tile, font selects with `FontFace` loading, text areas, tag lists with counters, warnings and completeness alert. Component tests for the preview and list limits. | 1.0 |
| E00-S03-FE4 | Automation tab | Publishing switch with confirm and disabled rule, autopilot switches, posting rules form, read-only mode for operators, account model refresh. | 0.5 |

### Test

None beyond the tests inside each subtask.

## Test notes

- **API:** permission matrix (admin and operator against every field group); handle normalisation and uniqueness including archived accounts; JSON merge behaviour; archive forces publishing off; brand limits table-driven; contrast calculation against known pairs (black on white 21:1; `#777777` on white 4.48:1 produces the warning); logo validation with fixture files (valid PNG, tiny PNG, oversized file, clean SVG, SVG with script, SVG with external `href`).
- **Panel:** add-account flow end to end in Playwright (admin), operator read-only checks, Brand tab save with a warning, publishing switch disabled state.
- **Fixtures:** a factory `make_account(connected=False, **overrides)` in `apps/accounts/tests/factories.py`, reused by every later epic.

## Later

- Custom font upload: add an `Asset`-backed font source to the font registry; `fonts` keys stay strings.
- Brand profile history: version the row the way briefs are versioned; consumers already read the profile at job time.
- Workspaces: add `workspace` to `InstagramAccount` and filter `AccountViewSet` by membership.
- Hard delete with data export.
