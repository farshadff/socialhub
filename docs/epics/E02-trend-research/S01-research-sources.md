# E02-S01 — Research sources watchlist

| | |
| --- | --- |
| Epic | E02 Trend research |
| Priority | Must |
| Estimate | BE 1 d · FE 1.5 d · QA 0 d |
| Depends on | E00-S02, E00-S03 |
| Needed by | E02-S02, E02-S05; E02-S03 (later) adds kinds |

## User story

As an operator, I want to keep a list of the searches and feeds worth watching for an Instagram account, so that every research run looks in the right places without me retyping them.

## Context

Research needs to know where to look. Each Instagram account has its own watchlist because each speaks to a different audience. The operator arrives with an account already created (E00-S03) and nothing else. This story delivers the watchlist and the `/research` page shell with its four tabs; the other tabs are filled by E02-S05.

## Scope

**In:**

- `ResearchSource` table and CRUD API.
- Normalization and validation of the value for each kind.
- A computed `available` flag so the panel can show which sources a run can actually use.
- The `/research` page with tabs Topics, Signals, Sources, Runs; the Sources tab is complete, the other three show a placeholder until E02-S05.

**Out (later):**

- Testing a source before saving it.
- Bulk import of sources from a file.
- Sharing a watchlist between accounts.
- Suggesting sources with AI.

## Behaviour and rules

1. A source belongs to one account and has a `kind`, a `value`, a `label` and an `active` flag.
2. Creatable kinds are `web_search` and `rss`. Any other value returns `400 validation_error` on `kind` with code `invalid_choice`. That includes `manual`, which is a `TrendSignal` kind only, and the Instagram hashtag and account kinds, which are reserved for E02-S03 and not part of the MVP.
3. `kind` cannot change after creation. A `PATCH` that sends a different `kind` returns `400 validation_error` on `kind` with code `immutable`.
4. The value is normalized before validation and stored normalized:

   | Kind | Normalization | Validation |
   | --- | --- | --- |
   | `web_search` | Trim; collapse runs of whitespace to one space | 3–200 characters |
   | `rss` | Trim; lowercase scheme and host | Absolute `http` or `https` URL, at most 500 characters, host present, host is not an IP literal and not `localhost` |

5. `label` is optional, at most 80 characters. When empty it is set to a display form of the value: the query itself, or the feed's host.
6. (`account`, `kind`, `value`) is unique. A duplicate returns `400 validation_error` on `value` with code `unique`.
7. Limits per account, counted over active sources only. Exceeding one returns `400 validation_error` on `active` with code `limit_reached`:

   | Kind | Maximum active |
   | --- | --- |
   | `web_search` | 8 |
   | `rss` | 15 |

   The web search limit keeps one run within the AI gateway's 20-call guard (two calls per source plus one synthesis call).
8. A new source is active by default. Deactivating a source keeps it and its history; a run ignores it.
9. Deleting a source is permanent. Its signals stay; their `source` becomes null.
10. `last_run_at` and `last_status` are read-only here. Runs write them (E02-S02).
11. Each source is returned with two computed fields:
    - `available` — whether a run can use this kind right now.
    - `unavailable_reason` — `null` or `provider_not_configured`.

    `research.services.sources.availability(kind)` decides: `rss` is always available; `web_search` is available when the text AI provider is configured (`fake` counts).
12. Both roles can read and change the watchlist.
13. An archived account's sources are readable but cannot be created or changed (`409 invalid_transition`).

## Data

Uses `ResearchSource` exactly as in [DATA-MODEL.md](../../DATA-MODEL.md). No new stored fields. `available` and `unavailable_reason` are serializer-only.

Database constraints: unique (`account`, `kind`, `value`); index on (`account`, `active`).

## API

All paths are under `/api/v1/`. Signed-in users of either role.

### `GET /research/sources/`

Query: `account` (required), `kind` (comma-separated), `active` (`true` or `false`), `ordering` (`kind`, `label`, `-last_run_at`; default `kind,label`), `page`, `page_size`.

```json
{
  "count": 4,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 21,
      "account": 3,
      "kind": "web_search",
      "value": "specialty coffee trends Iran",
      "label": "Coffee trends",
      "active": true,
      "last_run_at": "2026-11-21T08:14:52Z",
      "last_status": "ok",
      "available": true,
      "unavailable_reason": null,
      "created_at": "2026-11-18T10:02:11Z",
      "updated_at": "2026-11-21T08:14:52Z"
    },
    {
      "id": 22,
      "account": 3,
      "kind": "rss",
      "value": "https://perfectdailygrind.com/feed/",
      "label": "perfectdailygrind.com",
      "active": true,
      "last_run_at": "2026-11-21T08:15:03Z",
      "last_status": "error:timeout",
      "available": true,
      "unavailable_reason": null,
      "created_at": "2026-11-18T10:03:40Z",
      "updated_at": "2026-11-21T08:15:03Z"
    },
    {
      "id": 23,
      "account": 3,
      "kind": "web_search",
      "value": "ترند قهوه دمی در کافه‌های تهران",
      "label": "قهوه دمی",
      "active": true,
      "last_run_at": "2026-11-21T08:15:40Z",
      "last_status": "empty",
      "available": true,
      "unavailable_reason": null,
      "created_at": "2026-11-18T10:05:02Z",
      "updated_at": "2026-11-21T08:15:40Z"
    },
    {
      "id": 24,
      "account": 3,
      "kind": "rss",
      "value": "https://dailycoffeenews.com/feed/",
      "label": "dailycoffeenews.com",
      "active": false,
      "last_run_at": null,
      "last_status": null,
      "available": true,
      "unavailable_reason": null,
      "created_at": "2026-11-18T10:06:27Z",
      "updated_at": "2026-11-19T09:41:00Z"
    }
  ]
}
```

Errors: `400 validation_error` on `account` when missing; `404 not_found` when the account does not exist.

### `POST /research/sources/`

Request:

```json
{
  "account": 3,
  "kind": "rss",
  "value": " HTTPS://Sprudge.com/feed/ ",
  "label": ""
}
```

Response `201`:

```json
{
  "id": 25,
  "account": 3,
  "kind": "rss",
  "value": "https://sprudge.com/feed/",
  "label": "sprudge.com",
  "active": true,
  "last_run_at": null,
  "last_status": null,
  "available": true,
  "unavailable_reason": null,
  "created_at": "2026-11-22T09:12:00Z",
  "updated_at": "2026-11-22T09:12:00Z"
}
```

Error example, duplicate value:

```json
{
  "error": {
    "code": "validation_error",
    "message": "اطلاعات واردشده معتبر نیست.",
    "fields": [{"path": "value", "code": "unique", "message": "این مقدار قبلاً ثبت شده است."}],
    "request_id": "5e0b6b3a-3f0b-4a5e-9b1b-7a2c3d4e5f60",
    "retryable": false
  }
}
```

| Case | Status and code | Field |
| --- | --- | --- |
| Missing `account`, `kind` or `value` | `400 validation_error` | `required` on the field |
| `kind` is not `web_search` or `rss` | `400 validation_error` | `kind`: `invalid_choice` |
| Value fails the rule for its kind | `400 validation_error` | `value`: `invalid`, `min_length` or `max_length` |
| Duplicate | `400 validation_error` | `value`: `unique` |
| Active limit reached | `400 validation_error` | `active`: `limit_reached` |
| Account archived | `409 invalid_transition` | — |

### `PATCH /research/sources/{id}/`

Changeable fields: `value`, `label`, `active`. The same normalization, uniqueness and limit rules apply. Reactivating a source counts against the limit.

Request:

```json
{"active": false}
```

Response `200`: the full source object as above.

Errors: as for create, plus `400 validation_error` on `kind` with code `immutable`, and `404 not_found`.

### `DELETE /research/sources/{id}/`

Response `204`. Errors: `404 not_found`; `409 job_in_progress` when a research run for the account is `running` (the source may be in use), with the job in `error.details.job`.

## Background work

None.

## AI

None.

## Panel

**Route:** `/research`, sidebar item "Research". The active tab is kept in the query string: `/research?tab=sources`. Default tab is `topics`.

**Page frame:** `PageContainer` titled "Research" with the description "Find what your audience is paying attention to, and keep the evidence." Tabs: Topics, Signals, Sources, Runs. In this story the Topics, Signals and Runs tabs render an `Empty` with the text "Coming with the research workspace." The header's primary action ("Run research") is added by E02-S02.

**Sources tab:** a `ProTable` inside a `ProCard`.

| Column | Content |
| --- | --- |
| Kind | Tag with icon: "Web search", "RSS feed" |
| Value | `ContentText`. Feed URLs as a link that opens in a new tab (`rel="noopener noreferrer"`) |
| Label | Plain text |
| Active | `Switch`; toggling sends `PATCH {active}` immediately and reverts on error |
| Last run | `DateTime`, or "Never" |
| Last result | `StatusTag`: `ok` → "OK" (green), `empty` → "Nothing new" (grey), `error:*` → "Failed" (red) with the reason in a tooltip (table below) |
| Availability | Shown only when `available` is false: warning tag "Not available" with tooltip "The AI provider is not configured." (`provider_not_configured`) |
| Actions | "Edit", "Delete" |

Toolbar filters: Kind (multi-select), Active (All / Active / Inactive). Toolbar button: "Add source" (primary).

Tooltip text for `last_status`:

| Value | Text |
| --- | --- |
| `error:timeout` | "The source did not respond in time." |
| `error:http_<status>` | "The source answered with HTTP {status}." |
| `error:invalid_feed` | "This address is not a readable RSS or Atom feed." |
| `error:blocked_url` | "This address cannot be fetched." |
| `error:provider_error`, `error:transient` | "The provider failed. It will be tried again on the next run." |
| `error:refused` | "The AI declined this search. Rephrase the query." |
| `error:provider_not_configured` | "The AI provider is not configured." |

**Add / edit modal** (`ModalForm`, title "Add source" or "Edit source"):

| Field | Control | Notes |
| --- | --- | --- |
| Kind | `Select`, required | Disabled when editing |
| Value | `Input`, required | Label and placeholder change with kind: "Search query" / "e.g. specialty coffee trends"; "Feed address" / "https://example.com/feed/" |
| Label | `Input`, optional | Helper: "Shown in lists. Leave empty to use the value." |
| Active | `Switch`, default on | |

Client-side validation mirrors rule 4 so most mistakes are caught before the request. Server field errors are shown under the matching field. Buttons: "Save", "Cancel". On success: `message.success("Source saved")` and the table reloads.

**Delete:** `Popconfirm` "Delete this source? Signals already collected from it are kept." Confirm button "Delete". On success: "Source deleted".

**States:**

| State | Behaviour |
| --- | --- |
| Loading | Table skeleton |
| Empty | "No research sources yet. Add the searches and feeds you want to watch." with button "Add source" |
| Error | Inline `Result` with Retry and the `request_id` |
| No account selected | The shared "Pick or create an account" prompt |
| Limit reached | The modal shows the field error "You can have at most {n} active {kind} sources. Deactivate one first." |
| Run in progress | Delete is disabled with tooltip "A research run is using the sources." |
| Archived account | "Add source", switches and row actions are hidden |

## Acceptance criteria

1. Given an account with no sources, when I open `/research?tab=sources`, then I see the empty state with an "Add source" button.
2. Given the add modal, when I save kind "RSS feed" with value `HTTPS://Sprudge.com/feed/`, then the source is stored as `https://sprudge.com/feed/`, labelled `sprudge.com`, and listed as active.
3. Given a source `https://sprudge.com/feed/` exists, when I add `https://SPRUDGE.com/feed/` again, then I see a "this value already exists" error under the value field and nothing is created.
4. Given eight active web search sources, when I add a ninth, then the request fails with `limit_reached` and the modal explains the limit; when I add it as inactive, it is saved.
5. Given kind "RSS feed", when I enter `ftp://example.com/feed` or `http://127.0.0.1/feed`, then the value is rejected.
6. Given an existing source, when I send `PATCH` with a different `kind`, then I get `400` with code `immutable` on `kind`.
7. Given a source with collected signals, when I delete it, then the source disappears and its signals remain with no source.
8. Given an active source, when I switch it off, then the next research run does not visit it and its row shows it as inactive.
9. Given a request without `account`, when I call `GET /research/sources/`, then I get `400 validation_error` on `account`.
10. Given I am signed in as an operator, when I add, edit and delete sources, then all three work.
11. Given the text AI provider is not configured, when I view a web search source, then it shows the "Not available" tag with the explanation; RSS sources show no tag.
12. Given a create request with `kind = manual` or an Instagram hashtag or account kind, when I send it, then I get `400 validation_error` with `invalid_choice` on `kind`.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E02-S01-BE1 | App and model | Create `apps/research` (app config, `urls.py` included under `/api/v1/research/`). `ResearchSource` model with constraints and index, migration, Django admin registration. | 0.25 d |
| E02-S01-BE2 | Normalization and validation | `research/services/sources.py`: `normalize_value(kind, raw)`, per-kind validators, default label, active-limit check, `availability(kind)`. Unit tests for every row of rule 4, including Persian search queries and feed URLs with upper-case hosts. | 0.25 d |
| E02-S01-BE3 | Serializer and viewset | `ResearchSourceSerializer` (immutable `kind`, computed `available` and `unavailable_reason`), `ResearchSourceViewSet` with account scoping, filters, ordering; delete guard while a run is active (returns false until E02-S02 adds runs). | 0.25 d |
| E02-S01-BE4 | Contract and API tests | Add the four endpoints and the `ResearchSource` schema to `docs/openapi.yaml`. API tests for list, create, update, delete, each error row, both roles, archived account. | 0.25 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E02-S01-FE1 | Page shell and services | Route `/research` in `config/routes.ts`, `src/pages/research/index.tsx` with `PageContainer`, four tabs bound to `?tab=`, placeholders for three tabs. `src/services/socialhub/research.ts` with typed calls for sources. | 0.5 d |
| E02-S01-FE2 | Sources table | `src/pages/research/SourcesTab.tsx`: `ProTable` with columns, filters, inline active switch with optimistic update and rollback, last-result tag with tooltip map, availability tag. All page states. | 0.5 d |
| E02-S01-FE3 | Add, edit, delete | `SourceFormModal.tsx` with kind-dependent label, placeholder and client validation; server field errors mapped to fields; delete with `Popconfirm`. Component tests for validation and the limit message. | 0.5 d |

### Test

None. Tests are part of each subtask.

## Test notes

- Unit: normalization table (trim, whitespace collapse, lowercase scheme and host); validators (length limits, IP-literal and `localhost` hosts rejected); label defaults; limit counting ignores inactive sources; every kind other than `web_search` and `rss` rejected.
- API: uniqueness is checked after normalization; `PATCH` to active respects the limit; list requires `account`; ordering and filters; `available` reflects a patched `availability` function.
- Panel: empty state; modal field switching by kind; optimistic switch rolls back on a `400`; tooltip text for each `last_status` family.
- Fixtures: one account with one source of each kind.

## Later

- "Test source" button: run the collector once for a single source and show what it would return. The collectors in E02-S02 already work per source.
- Import and export of the watchlist as CSV.
- Per-source settings (results per run, language) in a `config` JSON field.
- Instagram hashtag and account sources come back with E02-S03, which adds their normalization rows, limits, kind tags and status tooltips.
