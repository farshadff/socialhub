# E03-S01 — Feed sources and feed items

| | |
| --- | --- |
| Epic | E03 Content selection |
| Priority | Must |
| Estimate | BE 2.5 d · FE 2 d · QA 0 d |
| Depends on | E00-S02, E00-S03, E00-S06 |
| Needed by | E03-S02 |

## User story

As an operator, I want the company's own news, products or articles to arrive in Social Hub automatically, so that they can compete with trend topics for this week's slots without anyone copying them in by hand.

## Context

Step 03 of the workflow ranks "suggestions and feed items". Suggestions come from research (E02). Feed items are the account's first-party material: a blog, a product catalogue, a news endpoint. This story brings that material in and lets the operator decide which items may be used. Ranking (E03-S02) reads only items with status `eligible`.

When the operator arrives here, the account exists and the panel shell is in place. Nothing else is required.

## Scope

**In**

- Feed sources of kind `rss`, `json_api` and `manual`, per account.
- A reader for RSS and Atom, and a reader for a JSON endpoint with a field mapping.
- Hourly sync of active sources, plus "Sync now".
- Feed items with status `new`, `eligible`, `ignored`, `used`; automatic eligibility by age; manual items.
- The `/selection` page with its four tabs; this story fills "Feed items" and "Feed sources".

**Out (later)**

- Pagination, cursors and incremental fetch for JSON endpoints.
- OAuth or signed requests. The MVP supports one static header from an environment variable.
- Field transforms, per-source eligibility rules beyond age, exclusion lists.
- Deleting or merging individual feed items.

## Behaviour and rules

### Feed sources

1. A source belongs to one account. `kind` is set at creation and cannot change.
2. `name` is 1–80 characters and unique per account (case-insensitive).
3. `url` is required for `rss` and `json_api`, must be `http` or `https`, and is at most 500 characters. It must be empty for `manual`.
4. An account has at most 20 feed sources and at most one `manual` source. The `manual` source is created automatically (name "Manual items") the first time a manual item is added, and cannot be deleted.
5. `config` holds, for every kind:
   - `auto_eligible` (bool, default `true`): new items become `eligible` without a person.
   - `max_age_days` (int 1–365, default 14): an item older than this at first sight is stored as `new`, not `eligible`.
6. `config` holds, for `json_api` only:
   - `items_path` (text, default `""`): dot path to the array of items in the response; empty means the response itself is the array. Example: `data.items`.
   - `fields` (object): dot paths inside one item. `external_id` and `title` are required; `summary`, `url`, `image_url`, `published_at` are optional.
   - `auth_header_env` (text, optional): the name of an environment variable whose value is one HTTP header in the form `Header-Name: value`. The name must start with `SOCIALHUB_FEED_`. The value is never stored, logged or returned.
7. Deleting a source deletes its feed items, unless any of its items is referenced by a candidate. In that case the API returns `409 state_conflict` and the operator deactivates the source instead.
8. Deactivating a source (`active = false`) stops syncing. Its items stay as they are.

### Reading a feed

9. Requests go through the shared `core.http.safe_fetch(url, timeout=15, max_bytes=5 MB, max_redirects=3)` (built in E02-S02), which sends the `User-Agent` from `SOCIALHUB_HTTP_USER_AGENT` (default `SocialHubBot/1.0`) and stops reading after 5 MB (`error:too_large`). A timeout is `error:timeout`; any other connection failure is `error:fetch_failed`.
10. The host must resolve to a public address. `safe_fetch` refuses private, loopback and link-local addresses, before connecting and after each redirect, with `error:blocked_url`. The only bypass is `SOCIALHUB_FETCH_ALLOW_HOSTS`, a list of hosts allowed even when private, honoured only when `DJANGO_DEBUG=true` or the test hooks are on (for local fixture servers).
11. **RSS and Atom** are parsed with `feedparser`. Mapping per entry:

    | Feed item field | Source, in order of preference |
    | --- | --- |
    | `external_id` | `id` (guid) → `link` → SHA-256 of `title` + `published` |
    | `title` | `title`, HTML stripped, trimmed to 300 characters |
    | `summary` | `summary` → first `content` value; HTML stripped, whitespace collapsed, trimmed to 2,000 characters |
    | `url` | `link` |
    | `image_url` | `media_content` or `media_thumbnail` URL → image `enclosure` → first `<img src>` in the summary HTML |
    | `published_at` | `published_parsed` → `updated_parsed`; stored in UTC; null if absent |

12. **JSON endpoint**: the reader sends `GET` with `Accept: application/json` and the optional header, parses the body, walks `items_path`, and applies `fields`. A dot path may use numeric segments for arrays (`images.0.url`). `published_at` accepts ISO 8601 or Unix seconds. An item missing `external_id` or `title` is skipped and counted in `skipped`.
13. At most 200 items are processed per sync, newest first when `published_at` is known.
14. `payload` stores the original entry trimmed to 8 KB.

### Storing items

15. Items are upserted on (`source`, `external_id`).
    - New item: status is `eligible` when `auto_eligible` is true and `published_at` is null or within `max_age_days`; otherwise `new`.
    - Existing item: `title`, `summary`, `url`, `image_url`, `published_at` and `payload` are refreshed when they changed. `status` is never changed by a sync.
16. After a sync the source gets `last_synced_at` and `last_status`: `ok` (at least one item read), `empty` (valid feed, no items), or `error:<code>` with code one of `timeout`, `fetch_failed`, `http_<status>`, `blocked_url`, `too_large`, `parse_failed`, `mapping_failed`, `auth_header_missing`.
17. A failed sync leaves existing items untouched.

### Feed item status

18. Allowed changes:

    | From | To | Who |
    | --- | --- | --- |
    | `new` | `eligible`, `ignored` | Operator |
    | `eligible` | `ignored` | Operator |
    | `ignored` | `eligible` | Operator |
    | `eligible` | `used` | System, when selection is confirmed (E03-S03) |
    | `used` | `eligible` | Operator, only when no content item that is not `cancelled` references the item; system, when an item is cancelled with `release_candidate` (E03-S04) |

    Any other change returns `409 invalid_transition` with `details.status` and `details.allowed_statuses`.
19. A manual item is created with status `eligible`, `external_id` `manual-<uuid>`, and the account's `manual` source. Its `title` (3–300 characters) is required; `summary` (≤ 2,000), `url`, `image_url` and `published_at` are optional.
20. Only manual items can have their text fields edited. Synced items are read-only except for `status`.

## Data

Uses `FeedSource` and `FeedItem` from [DATA-MODEL.md](../../DATA-MODEL.md), app `selection`.

Additions to record in DATA-MODEL.md:

- `FeedSource.config` gains `auto_eligible` and `max_age_days` for every kind (rule 5).
- Index on `FeedItem (account, status, published_at desc)`.
- Unique constraint on `FeedSource (account, lower(name))`.

## API

All endpoints follow [API.md](../../API.md). Operators and admins may use all of them.

### `GET /feeds/sources/?account={id}`

Filters: `kind`, `active`. Ordering: `name` (default), `-last_synced_at`.

```json
{
  "count": 2,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 7,
      "account": 3,
      "kind": "rss",
      "name": "Company blog",
      "url": "https://example.com/blog/rss.xml",
      "config": {"auto_eligible": true, "max_age_days": 14},
      "active": true,
      "last_synced_at": "2026-11-22T08:00:04Z",
      "last_status": "ok",
      "item_counts": {"new": 0, "eligible": 6, "ignored": 2, "used": 3},
      "created_at": "2026-11-20T10:12:00Z",
      "updated_at": "2026-11-22T08:00:04Z"
    },
    {
      "id": 8,
      "account": 3,
      "kind": "json_api",
      "name": "Product catalogue",
      "url": "https://api.example.com/v1/products?sort=-created",
      "config": {
        "auto_eligible": true,
        "max_age_days": 30,
        "items_path": "data.items",
        "fields": {
          "external_id": "id",
          "title": "name",
          "summary": "description",
          "url": "links.web",
          "image_url": "images.0.url",
          "published_at": "created_at"
        },
        "auth_header_env": "SOCIALHUB_FEED_CATALOGUE_AUTH",
        "auth_header_present": true
      },
      "active": true,
      "last_synced_at": "2026-11-22T08:00:06Z",
      "last_status": "error:http_401",
      "item_counts": {"new": 0, "eligible": 0, "ignored": 0, "used": 0},
      "created_at": "2026-11-21T09:00:00Z",
      "updated_at": "2026-11-22T08:00:06Z"
    }
  ]
}
```

`auth_header_present` is read-only and says whether the named environment variable is set on the server.

### `POST /feeds/sources/`

```json
{
  "account": 3,
  "kind": "json_api",
  "name": "Product catalogue",
  "url": "https://api.example.com/v1/products?sort=-created",
  "config": {
    "items_path": "data.items",
    "fields": {"external_id": "id", "title": "name", "summary": "description", "url": "links.web"},
    "auth_header_env": "SOCIALHUB_FEED_CATALOGUE_AUTH"
  },
  "active": true
}
```

Returns `201` with the source. Missing `config` keys take their defaults.

| Case | Response |
| --- | --- |
| `url` missing for `rss` or `json_api`, or not http(s) | `400 validation_error`, field `url`, code `required` or `invalid` |
| `json_api` without `config.fields.external_id` or `config.fields.title` | `400 validation_error`, field `config.fields.external_id` or `config.fields.title`, code `required` |
| `auth_header_env` not starting with `SOCIALHUB_FEED_` | `400 validation_error`, field `config.auth_header_env`, code `invalid` |
| Name already used in the account | `400 validation_error`, field `name`, code `unique` |
| Twenty sources already exist, or a second `manual` source | `400 validation_error`, field `account`, code `limit_reached` |

### `PATCH /feeds/sources/{id}/`

Accepts `name`, `url`, `config`, `active`. `kind` and `account` are ignored if sent with their current values and rejected (`400`, code `immutable`) otherwise. `config` is replaced as a whole and validated like on create. Returns `200` with the source.

### `DELETE /feeds/sources/{id}/`

Returns `204`. Returns `409 state_conflict` with `details.candidates` (count) when rule 7 applies, and `409 state_conflict` for the `manual` source.

### `POST /feeds/sources/{id}/sync/`

No body. Returns `202` with a job of kind `feeds.sync`, `target_type` `feed_source`.

| Case | Response |
| --- | --- |
| Source is `manual` | `400 validation_error`, field `kind`, code `not_syncable` |
| A sync for this source is already queued or running | `409 job_in_progress` with `details.job` |

Job result on success:

```json
{"created": 4, "updated": 1, "unchanged": 12, "skipped": 0, "eligible": 4, "status": "ok"}
```

On failure the job has `status: "failed"`, `error_code: "feed_sync_failed"` and `error_detail` set to the `last_status` code, for example `http_401`.

### `GET /feeds/items/?account={id}`

Filters: `source`, `status` (comma-separated), `search` (title contains, case-insensitive), `published_after` (date). Ordering: `-published_at` (default, nulls last), `published_at`, `-created_at`.

```json
{
  "count": 6,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 311,
      "account": 3,
      "source": {"id": 7, "name": "Company blog", "kind": "rss"},
      "external_id": "https://example.com/blog/how-we-cut-delivery-time",
      "title": "How we cut delivery time by 30%",
      "summary": "A look at the three changes in our warehouse process that shortened the average delivery from five days to three and a half.",
      "url": "https://example.com/blog/how-we-cut-delivery-time",
      "image_url": "https://example.com/media/delivery.jpg",
      "published_at": "2026-11-21T06:30:00Z",
      "status": "eligible",
      "content_item": null,
      "created_at": "2026-11-21T07:00:03Z",
      "updated_at": "2026-11-21T07:00:03Z"
    }
  ]
}
```

`content_item` is `{"id", "status"}` of the latest content item made from this feed item, or null.

### `POST /feeds/items/`

```json
{
  "account": 3,
  "title": "New showroom opens on 5 December",
  "summary": "Opening hours, address and the launch-day offer.",
  "url": "https://example.com/news/showroom",
  "image_url": "",
  "published_at": null
}
```

Returns `201` with the item (status `eligible`, source = the account's manual source).

### `PATCH /feeds/items/{id}/`

```json
{"status": "ignored"}
```

Accepts `status` for every item, and `title`, `summary`, `url`, `image_url`, `published_at` for manual items. Returns `200` with the item.

| Case | Response |
| --- | --- |
| Status change not in rule 18 | `409 invalid_transition`, `details.allowed_statuses` lists the statuses allowed from the current one |
| `used` → `eligible` while an active content item references it | `409 invalid_transition`, `details.content_item` |
| Text field sent for a synced item | `400 validation_error`, field name, code `read_only` |

## Background work

| Task | Queue | Schedule | Behaviour |
| --- | --- | --- | --- |
| `feeds.sync_active_sources` | `default` | Hourly, minute 0 | For every active `rss` or `json_api` source of an `active` account, creates a `JobRun` (kind `feeds.sync`, `created_by` null) and enqueues `feeds.sync_source`. Skips a source that already has a queued or running sync job. |
| `feeds.sync_source(job_id, source_id)` | `default` | On demand | Fetches, maps and upserts as in rules 9–17. |

- **Idempotency:** upsert on (`source`, `external_id`) makes a repeated sync harmless.
- **Retries:** `timeout`, `fetch_failed` and HTTP 5xx retry inside the task twice with 10- and 60-second pauses. HTTP 4xx, parse and mapping errors do not retry. The next hourly run tries again.
- **Isolation:** one source failing does not stop the others; each source has its own job.
- **Housekeeping:** scheduled `feeds.sync` jobs that succeeded are deleted after 7 days by the job pruning task from E00-S06; failed ones stay 30 days.

## AI

None.

## Panel

Route `/selection`, tabs "Feed items" and "Feed sources". This story creates the page with its four tabs (`?tab=candidates|proposal|feed-items|feed-sources`); "Candidates" and "Proposal" show a placeholder until E03-S03.

### Feed items tab

- `Table` (`useTable`) with server-side paging (20 per page).
- Columns: Title (`ContentText`, opens `url` in a new tab; summary in an expandable row), Source, Published (`DateTime`, "—" when null), Status (`StatusTag`: New grey, Eligible cyan, Ignored grey, Used green), Content item (link "Open item" when present), Actions.
- Filters in the table search form: Source (select), Status (multi-select, default New and Eligible), Search.
- Row actions by status: New → "Mark eligible", "Ignore"; Eligible → "Ignore"; Ignored → "Mark eligible"; Used → "Mark eligible" (shown only when `content_item` is null or cancelled).
- Bulk actions on selected rows: "Mark eligible", "Ignore". They call `PATCH` per row and report "5 updated, 1 could not be changed".
- Primary action: "Add item" opens a `Modal` form (`useModalForm`) with Title, Summary, Link, Image link, Published date. Success message: "Item added".
- Empty state: "No feed items yet. Add a feed source or add an item by hand." with buttons "Add feed source" (switches tab) and "Add item".

### Feed sources tab

- `Table` (`useTable`), no paging needed (≤ 20 rows).
- Columns: Name, Kind (RSS, JSON endpoint, Manual), Link (truncated, copy button), Active (switch; calls `PATCH`), Last sync (`DateTime` plus a tag: OK green, Empty grey, Error red with the code in a tooltip), Items (eligible / total), Actions.
- Row actions: "Sync now" (`JobButton`; on success shows "4 new, 1 updated"; on failure shows the mapped error text), "Edit", "Delete" (`Modal.confirm`: "Delete Company blog and its 11 items?").
- Primary action: "Add source" opens a `Modal` form (`useModalForm`):
  - Kind (radio: RSS or Atom feed, JSON endpoint), Name, Link, "Make new items eligible automatically" (switch, on), "Only items newer than" (number, days, 14).
  - For JSON endpoint: Items path, and one input per field path (ID, Title, Summary, Link, Image link, Published date) with ID and Title required, plus "Auth header variable" with helper text "Name of a server environment variable holding one header, for example `SOCIALHUB_FEED_CATALOGUE_AUTH`. Ask an admin to set it."
- After creating a source, the panel starts a sync automatically and shows its progress in the row.
- Error text by `last_status` code:

  | Code | Text |
  | --- | --- |
  | `timeout` | "The feed did not answer within 15 seconds." |
  | `fetch_failed` | "The feed could not be reached." |
  | `http_<status>` | "The feed answered with HTTP {status}." |
  | `parse_failed` | "The feed is not valid RSS, Atom or JSON." |
  | `mapping_failed` | "The items path or a field path does not match the response." |
  | `too_large` | "The feed is larger than 5 MB." |
  | `blocked_url` | "This address is not allowed." |
  | `auth_header_missing` | "The auth header variable is not set on the server." |

### States

| State | Behaviour |
| --- | --- |
| Loading | Table skeleton |
| No account selected | Prompt to pick an account |
| Error | Inline `Result` with Retry |
| Sync running | "Sync now" shows progress; Edit and Delete are disabled with tooltip "A sync is running" |
| `409` on delete | Notification: "This source has items used by candidates. Turn it off instead." |

## Acceptance criteria

1. Given an account without sources, when I add an RSS source with a valid link, then the source is saved, a sync starts, and its items appear on the Feed items tab.
2. Given a feed with one item published 3 days ago and one published 40 days ago, and default settings, when the sync finishes, then the first item is `eligible` and the second is `new`.
3. Given a synced item with status `ignored`, when the feed is synced again with a changed title, then the title is updated and the status is still `ignored`.
4. Given a JSON endpoint whose response is `{"data": {"items": [{"id": "p1", "name": "Lamp"}]}}`, `items_path` `data.items` and fields `external_id: id`, `title: name`, when the sync runs, then one item with external ID `p1` and title "Lamp" is stored.
5. Given a JSON source whose `items_path` does not exist in the response, when the sync runs, then the job fails, `last_status` is `error:mapping_failed`, and existing items are unchanged.
6. Given a source link that resolves to `127.0.0.1` and the host not listed in `SOCIALHUB_FETCH_ALLOW_HOSTS`, when the sync runs, then it fails with `error:blocked_url` and no request is sent.
7. Given an active source, when the hourly task runs twice within the same minute, then only one sync job exists for the source.
8. Given an eligible item, when I choose "Ignore", then its status is `ignored` and it no longer appears with the default filter.
9. Given an item with status `used` linked to a content item in status `briefed`, when I try to mark it eligible, then the API returns `409 invalid_transition` and the panel shows that the item is in use.
10. Given no manual source, when I add an item by hand, then a source "Manual items" exists and the item is `eligible`.
11. Given a source whose items are referenced by a candidate, when I delete it, then the API returns `409 state_conflict` and nothing is deleted.
12. Given an operator account, when they open either tab, then all actions in this story are available to them.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E03-S01-BE1 | Models and migration | Create app `selection` with `FeedSource` and `FeedItem`, constraints and index from the Data section, config validation model (`FeedSourceConfig` Pydantic), Django admin registration. | 0.5 |
| E03-S01-BE2 | Feed source API | Viewset for list, create, patch, delete with the validation table, `item_counts` annotation, `auth_header_present`, delete guard. Extend `openapi.yaml`. | 0.5 |
| E03-S01-BE3 | Feed readers | `selection/readers/base.py` (`FeedReader` protocol, `RawItem`), `rss.py` (feedparser mapping), `json_api.py` (dot-path walker, date parsing, header from environment), fetching through `core.http.safe_fetch` (E02-S02) with the timeout, size cap and redirect limit above; mapping of its errors to the status codes in rule 16. `feedparser` is already added by E02-S02. | 0.75 |
| E03-S01-BE4 | Sync service, task and schedule | `selection.services.feeds.sync(source)` with upsert and status rules, `feeds.sync_source` task with `JobRun` updates and retries, `feeds.sync_active_sources` beat entry, `POST …/sync/` endpoint with the in-progress guard. | 0.5 |
| E03-S01-BE5 | Feed item API | List with filters and ordering, manual create (auto-creates the manual source), patch with the transition table and read-only rules. | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E03-S01-FE1 | Selection page scaffold | Route `/selection`, `PageFrame`, four tabs bound to `?tab=`, placeholders for Candidates and Proposal, typed services for feeds in `src/services/socialhub/feeds.ts`, status labels in `StatusTag`. | 0.25 |
| E03-S01-FE2 | Feed sources tab | Table, active switch, add and edit `Modal` form (`useModalForm`) with kind-dependent fields, "Sync now" with `JobButton`, delete confirm, error text map. | 0.75 |
| E03-S01-FE3 | Feed items tab | Table with filters, expandable summary, row and bulk status actions, "Add item" form. | 0.75 |
| E03-S01-FE4 | States and tests | Empty, loading, error and conflict states; component tests for the kind-dependent form and the status actions. | 0.25 |

### Test

None beyond the tests inside each subtask.

## Test notes

- **Reader unit tests** with fixture files in `selection/tests/fixtures/`: RSS 2.0, Atom, a feed with HTML summaries and media thumbnails, a feed without guids, a JSON response with nested paths, a JSON response with Unix timestamps, malformed XML, a 6 MB body.
- **Host guard tests:** loopback, private range, link-local, and a public host that redirects to a private one.
- **Sync service tests:** create, update without status change, age-based eligibility, `auto_eligible` off, 200-item cap, failure leaves items untouched.
- **API tests:** every row of the validation and error tables; the transition table for items; operator permission.
- **Task tests:** hourly task skips sources with an active job, inactive sources and archived accounts.
- **Panel tests:** form shows JSON fields only for the JSON kind; row actions match status; bulk action reports partial failure.

## Later

- Pagination and incremental sync: add `cursor` handling to `json_api.py` and a `sync_cursor` key in `config`.
- More kinds (sitemap, Google Sheet, webhook push): a new reader class and enum value; storage and the panel table stay the same.
- Per-source eligibility rules (categories, keywords, exclusion lists): extend `config` and the status rule in `selection.services.feeds`.
- Image import: `image_url` can be downloaded into an `Asset` with `origin = uploaded` when production needs it (E06-S01 owns assets).
