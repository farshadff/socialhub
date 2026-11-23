# E06-S01 — Asset library and rights metadata

| | |
| --- | --- |
| Epic | E06 Assets and copy |
| Priority | Must |
| Estimate | BE 2 d · FE 2.5 d |
| Depends on | E00-S03, E00-S06 |
| Needed by | E06-S02, E06-S03, E06-S04, E06-S05, E06-S07, E07-S02 |

## User story

As an operator, I want to upload images, video clips and music once, record where each file comes from and whether we may use it, and find them again when producing content, so that every asset in a post has known rights.

## Context

Production needs files: photos and backgrounds for frames, footage for reels, music, and finished assets made outside the system. The rights check in step 07 (E07-S02) can only pass if every file carries rights information, so that information is captured here, at upload.

An asset belongs to an account. It is either a **library asset** (`content_item` is null, reusable across items) or an **item asset** (attached to one content item). Files produced by the system (rendered frames, generated images, final videos) are also `Asset` rows; they are created by other stories and listed here read-only.

## Scope

**In**

- Upload with validation, probing, checksum, thumbnail and rights metadata.
- List, filter, read, edit metadata, delete when unused.
- Library page and three shared components: `AssetUploader`, `AssetPicker`, `RightsTag`.

**Out (later)**

- Folders, tags, bulk edit, bulk upload beyond the multi-file dropzone.
- Image editing, trimming, transcoding.
- Stock-library search and licence lookup.
- Chunked or resumable upload.

## Behaviour and rules

1. **Kinds and limits.** The kind is derived from the detected MIME type, never from the client's claim.

   | Kind | Accepted MIME types | Extensions | Max size | Other limits |
   | --- | --- | --- | --- | --- |
   | `image` | `image/jpeg`, `image/png`, `image/webp` | jpg, jpeg, png, webp | 20 MB | Shortest side ≥ 320 px, longest side ≤ 8,000 px |
   | `video` | `video/mp4`, `video/quicktime` | mp4, mov | 500 MB | Duration 1 s – 10 min; must contain a video stream |
   | `audio` | `audio/mpeg`, `audio/mp4`, `audio/wav` | mp3, m4a, wav | 30 MB | Duration 1 s – 10 min |
   | `document` | `application/pdf` | pdf | 20 MB | Used only as licence proof |

2. **Detection.** The server reads the first bytes (magic numbers) to detect the type, and checks that the extension belongs to the same kind. A mismatch, an unknown type or a broken file returns `400 unsupported_media`. A file over the limit returns `413 payload_too_large`.
3. **Probing.** Images are opened with Pillow (width, height; EXIF orientation is applied to the stored dimensions). Video and audio are probed with `ffprobe` (width, height, duration, codecs, frame rate). `duration_ms` is set for video and audio. Codec and frame rate go into `meta.probe`.
4. **Checksum and duplicates.** The SHA-256 of the file is computed while it streams to storage. If an asset with the same `account`, `checksum`, `content_item` and `role` already exists, nothing new is stored: the existing asset is returned with `200` and `"duplicate": true`.
5. **Storage key.** `accounts/{account_id}/{yyyy}/{mm}/{asset_id}-{slug}.{ext}`, where `slug` is the original file name lowercased, non-alphanumerics replaced by `-`, truncated to 60 characters. The original name is kept in `original_filename`.
6. **Thumbnail.** Images get a JPEG thumbnail 480 px wide. Videos get a JPEG poster from the frame at 1 second (or the first frame for shorter clips), 480 px wide. Audio and documents have none. Thumbnails are stored next to the file with the suffix `-thumb.jpg`.
7. **Roles on upload.** A person can upload with role `source`, `background`, `clip`, `music` or `final`. `frame` and `cover` are created only by the system. The role must fit the kind: `music` needs `audio`; `clip` needs `video`; `background` needs `image`; `final` needs `image` or `video`; `source` accepts any kind.
8. **Origin.** A person can set `uploaded` or `licensed`. `ai_generated` and `rendered` are set only by the system and can never be chosen or changed through the API.
9. **Rights defaults and requirements.**

   | Origin | Default `rights_status` | Required when saved as `cleared` |
   | --- | --- | --- |
   | `uploaded` | `unknown` | `license_note` of at least 3 characters (for example "Shot in-house") |
   | `licensed` | `cleared` | `license_note`; `source_url` and `rights_expires_at` optional |
   | `ai_generated` | `cleared` | Set by E06-S05; `license_note` is "Generated with {model}" |
   | `rendered` | Worst status among its inputs | Set by the renderer; earliest input expiry is copied |

   "Worst" is ordered `expired` > `restricted` > `unknown` > `cleared`.
10. **Expiry.** `rights_expires_at` is a date in the account timezone. The API returns `rights_status = expired` for a `cleared` asset whose date has passed; the stored value is not rewritten. Everything that reads rights uses this effective value (model property `effective_rights_status`).
11. **Editing.** Only `role` (within rule 7), `rights_status`, `license_note`, `source_url`, `rights_expires_at` and `content_item` (attach a library asset to an item or detach it) can be changed. Files are never replaced; upload a new asset instead. System-created assets (`ai_generated`, `rendered`) accept only `license_note` edits.
12. **In use.** An asset is in use when any `ContentVersion` references it as `final_asset`, `cover_asset`, `music_asset`, in `frames[].asset_id`, `frames[].background_asset_id` or `clips[].asset_id`. The serializer exposes this as `in_use`.

12a. **Assets of a version.** The shared resolver `production.services.rights.version_input_assets(version)` returns every asset a version uses: the references in rule 12 plus, recursively, each asset's `meta.inputs`, without duplicates. It is the one place that answers "which assets does this version depend on" for disclosure (E06-S05, E06-S06), the rights check (E07-S02) and the publisher (E08-S03).
13. **Delete.** Allowed only when the asset is not in use; the file and thumbnail are removed from storage. Deleting an asset in use returns `409 state_conflict` with the referencing content items in `error.details.used_by`.
14. **Account scope.** `account` is required on list and upload. When `content_item` is given it must belong to the same account, otherwise `400 validation_error`.
15. **URLs.** `url` and `thumbnail_url` are signed, short-lived URLs when storage is private and plain media URLs locally. The panel never stores them.

## Data

`Asset` as defined in [DATA-MODEL.md](../../DATA-MODEL.md), in the `content` app.

Additions this story needs:

| Field | Type | Notes |
| --- | --- | --- |
| `Asset.thumbnail` | file, null | JPEG thumbnail or video poster |
| `Asset.meta.probe` | JSON key | `{"video_codec", "audio_codec", "fps", "has_audio"}` for video and audio |

Indexes: (`account`, `content_item`, `kind`), (`account`, `checksum`).

## API

All endpoints require a signed-in user. Operators and admins have the same rights here.

### `POST /api/v1/assets/`

Multipart form upload.

| Part | Required | Notes |
| --- | --- | --- |
| `file` | yes | One file |
| `account` | yes | |
| `content_item` | no | Omit for a library asset |
| `role` | no | Default `source` |
| `origin` | no | `uploaded` (default) or `licensed` |
| `rights_status` | no | Default from rule 9 |
| `license_note`, `source_url`, `rights_expires_at` | no | |

Response `201` (or `200` with `"duplicate": true`):

```json
{
  "id": 311,
  "account": 3,
  "content_item": null,
  "kind": "image",
  "role": "background",
  "url": "https://media.example.test/accounts/3/2026/11/311-rooftop-sunset.jpg?sig=…",
  "thumbnail_url": "https://media.example.test/accounts/3/2026/11/311-rooftop-sunset-thumb.jpg?sig=…",
  "original_filename": "Rooftop Sunset.JPG",
  "mime": "image/jpeg",
  "bytes": 2483112,
  "width": 4000,
  "height": 3000,
  "duration_ms": null,
  "checksum": "9f2c1e…b7a4",
  "origin": "uploaded",
  "rights_status": "cleared",
  "license_note": "Shot in-house by our team",
  "source_url": "",
  "rights_expires_at": null,
  "meta": {},
  "in_use": false,
  "duplicate": false,
  "created_by": {"id": 2, "name": "Sara"},
  "created_at": "2026-11-23T08:14:02Z",
  "updated_at": "2026-11-23T08:14:02Z"
}
```

Errors:

| Case | Status and code |
| --- | --- |
| `file` or `account` missing; role does not fit kind; `cleared` without `license_note`; `origin` is a system value | `400 validation_error` with `fields` |
| Type not accepted, extension mismatch, unreadable file, dimension or duration outside limits | `400 unsupported_media`; `error.details.reasons` lists each violation, for example `["duration_too_long: 742 s, max 600 s"]` |
| File larger than the kind's limit | `413 payload_too_large` |
| `content_item` from another account | `400 validation_error` on `content_item` |

### `GET /api/v1/assets/`

Query: `account` (required), `content_item` (an ID, or `null` for library assets only), `kind`, `role`, `origin`, `rights_status` (effective value; comma-separated allowed), `in_use` (`true`/`false`), `q` (matches `original_filename` and `license_note`), `ordering` (`-created_at` default, `created_at`, `bytes`, `-bytes`), `page`, `page_size`.

```json
{
  "count": 2,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 318, "account": 3, "content_item": null, "kind": "audio", "role": "music",
      "url": "https://media.example.test/accounts/3/2026/11/318-calm-loop.m4a?sig=…",
      "thumbnail_url": null, "original_filename": "calm-loop.m4a", "mime": "audio/mp4",
      "bytes": 1840221, "width": null, "height": null, "duration_ms": 92000,
      "checksum": "41aa…09ce", "origin": "licensed", "rights_status": "cleared",
      "license_note": "Licence #A-2231, social use", "source_url": "https://music.example.test/track/2231",
      "rights_expires_at": "2027-11-01",
      "meta": {"probe": {"audio_codec": "aac", "has_audio": true}},
      "in_use": true, "created_by": {"id": 2, "name": "Sara"},
      "created_at": "2026-11-23T08:20:11Z", "updated_at": "2026-11-23T08:20:11Z"
    },
    {
      "id": 311, "account": 3, "content_item": null, "kind": "image", "role": "background",
      "url": "…", "thumbnail_url": "…", "original_filename": "Rooftop Sunset.JPG", "mime": "image/jpeg",
      "bytes": 2483112, "width": 4000, "height": 3000, "duration_ms": null,
      "checksum": "9f2c…b7a4", "origin": "uploaded", "rights_status": "cleared",
      "license_note": "Shot in-house by our team", "source_url": "", "rights_expires_at": null,
      "meta": {}, "in_use": false, "created_by": {"id": 2, "name": "Sara"},
      "created_at": "2026-11-23T08:14:02Z", "updated_at": "2026-11-23T08:14:02Z"
    }
  ]
}
```

### `GET /api/v1/assets/{id}/`

Returns one asset in the same shape, plus `used_by`:

```json
{
  "id": 318,
  "…": "same fields as above",
  "used_by": [{"content_item": 42, "title": "Three signs your budget is leaking", "version": 1, "as": "music_asset"}]
}
```

### `PATCH /api/v1/assets/{id}/`

```json
{
  "rights_status": "cleared",
  "license_note": "Written permission from the photographer, email 2026-11-20",
  "source_url": "https://photos.example.test/p/8812",
  "rights_expires_at": "2027-06-30"
}
```

Returns `200` with the asset. Errors: `400 validation_error` for fields that cannot be edited (rule 11), an expiry date in the past with `rights_status = cleared`, or `cleared` without a note.

### `DELETE /api/v1/assets/{id}/`

`204` when unused. In use:

```json
{
  "error": {
    "code": "state_conflict",
    "message": "…",
    "fields": [],
    "details": {"used_by": [{"content_item": 42, "version": 1, "as": "music_asset"}]},
    "request_id": "6d0c1c0a-51a2-4d0a-9a56-0e7c2f7c1b11",
    "retryable": false
  }
}
```

## Background work

None. Upload, probing and thumbnail creation run inside the request so that a bad file is rejected immediately. `ffprobe` and one-frame poster extraction read only file headers and one frame, so they stay fast for large clips. The request handler streams the upload to a temporary file; it never holds it in memory.

Operational note: the `backend` image must contain `ffprobe`/`ffmpeg` (today only the render image does). The upload endpoint has a 120-second timeout; the reverse-proxy body limit is set in E11-S02 to at least 512 MB for this path.

## AI

None.

## Panel

### Library page — `/library`

`PageFrame` titled "Library" with the description "Images, clips and music for this account, with their usage rights." Primary action: **Upload**.

- **Filter bar** (above the grid): search box; `Segmented` for kind (All, Images, Video, Audio, Documents); selects for Rights (Cleared, Unknown, Restricted, Expired), Origin (Uploaded, Licensed, AI generated, Rendered) and Scope (Library only — default, All, Used, Unused).
- **Grid/list toggle.** Grid shows cards with the thumbnail (audio and documents show an icon), file name, size or duration, `RightsTag`, and an "In use" tag. List is a `Table` (`useTable`) with columns Preview, Name, Kind, Role, Size, Dimensions/Duration, Origin, Rights, Expires, Added, Used.
- **Asset drawer** (click a card or row): large preview (`<img>`, `<video controls>`, `<audio controls>`, or a link for PDF), a `Descriptions` block with file facts, an editable form for Role, Rights status, Licence note, Source URL, Expiry date, a "Used in" list linking to `/content/:id`, and **Save**, **Download**, **Delete**.
- **Delete** uses `Modal.confirm`: "Delete {file name}? This cannot be undone." It is disabled with the tooltip "Used in {n} item(s)" when `in_use`.

### `AssetUploader`

A modal with an Ant Design `Upload.Dragger` (multiple files) and one shared metadata form applied to all files in the batch:

| Field | Control | Default |
| --- | --- | --- |
| Use as | Select: Source, Background, Clip, Music, Final asset | By context (library: Source) |
| Where it comes from | Radio: "We made it or own it" (`uploaded`) / "Licensed from someone else" (`licensed`) | We made it or own it |
| We may use this on Instagram | Checkbox, sets `rights_status = cleared` | Unchecked for uploaded, checked for licensed |
| Licence note | Text area, required when the box is checked | |
| Source URL | Input, shown for licensed | |
| Rights expire on | Date picker, shown for licensed | |

Files upload one at a time with a progress bar each. Per-file result: a green tick, "Already in the library" for duplicates, or the reason from `error.details.reasons`. Client-side checks (extension and size from the table in rule 1) run before sending so obvious mistakes fail instantly. The modal's **Done** button closes it and refreshes the caller.

### `AssetPicker`

A modal used by E06-S04, E06-S05 and E06-S07 to choose an existing asset. Props: `accountId`, `kind`, `role?`, `contentItemId?`, `onSelect(asset)`. It shows two tabs — "This item" and "Library" — as a thumbnail grid with search, a `RightsTag` on each card, and an **Upload new** button that opens `AssetUploader` with the role preset. Assets whose rights are `restricted` or `expired` can be selected only after confirming "This asset's rights are {status}. The rights check will fail unless you fix them."

### `RightsTag`

A tag built on `StatusTag`: Cleared (green), Unknown (orange), Restricted (red), Expired (red). Tooltip shows the licence note and expiry date.

### States

| State | Display |
| --- | --- |
| Loading | Skeleton cards |
| Empty library | `Empty`: "No assets yet. Upload images, clips or music to use in production." with **Upload** |
| No results for filters | `Empty`: "Nothing matches these filters." with **Clear filters** |
| Upload rejected | Per-file error text; other files continue |
| Error loading | Inline `Result` with Retry and the `request_id` |

## Acceptance criteria

1. Given a 3 MB JPEG, when I upload it to the library as Background with "We may use this" checked and a licence note, then the asset appears with its thumbnail, 4000 × 3000 dimensions and a green Cleared tag.
2. Given a text file renamed to `photo.jpg`, when I upload it, then the upload fails with `unsupported_media` and nothing is stored.
3. Given a 12-minute MP4, when I upload it, then it fails with `unsupported_media` and the reason names the duration limit.
4. Given a file I already uploaded to the same place with the same role, when I upload it again, then I get the existing asset with `duplicate: true` and storage holds one file.
5. Given an uploaded asset with origin `uploaded`, when I try to save `rights_status = cleared` with an empty licence note, then I get `validation_error` on `license_note`.
6. Given a licensed asset whose expiry date was yesterday, when I list assets, then its `rights_status` is `expired` and filtering by `rights_status=expired` returns it.
7. Given an asset used as the music of a content version, when I delete it, then I get `409 state_conflict` naming the content item and the file is still in storage.
8. Given an unused asset, when I delete it, then the row, the file and the thumbnail are gone.
9. Given an MP4 clip, when it is uploaded, then `duration_ms`, `width`, `height` and `meta.probe.fps` are filled and a poster thumbnail exists.
10. Given I try to PATCH `origin` to `ai_generated`, then I get `validation_error`.
11. Given the library page with no assets, then I see the empty state and the Upload action.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S01-BE1 | Asset model and migration | `content/models.py`: `Asset` with the new `thumbnail` field, indexes, `effective_rights_status`, `in_use` query helper (`content/assets/usage.py`), `version_input_assets` resolver (rule 12a) with a unit test on nested `meta.inputs`. Add `ffmpeg` to `backend/Dockerfile`. | 0.5 d |
| E06-S01-BE2 | Upload pipeline | `content/assets/upload.py`: type detection, per-kind limits, streaming checksum, Pillow and `ffprobe` probing, thumbnail and poster, storage key, duplicate rule. Unit tests with sample files. | 0.75 d |
| E06-S01-BE3 | API | `AssetViewSet` (list, create, retrieve, partial update, destroy), serializers, filters, rights rules 9–11, delete guard, signed URLs, `openapi.yaml` entries. API tests for every error case. | 0.75 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E06-S01-FE1 | Asset service and types | `src/services/socialhub/assets.ts`, multipart upload with progress, `RightsTag`. | 0.25 d |
| E06-S01-FE2 | `AssetUploader` | Dragger, shared metadata form, per-file progress and results, client-side pre-checks. | 0.75 d |
| E06-S01-FE3 | Library page | `/library` route, filter bar, grid and table views, paging, empty and error states. | 0.75 d |
| E06-S01-FE4 | Asset drawer | Preview, metadata form, "Used in" list, download, delete with guard. | 0.5 d |
| E06-S01-FE5 | `AssetPicker` | Two-tab picker with search, rights warning, upload shortcut. | 0.25 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- Fixture files in `backend/apps/content/tests/files/`: a valid JPEG, PNG, WebP, a 3-second MP4 with audio, a silent MOV, an MP3, a PDF, a text file with a `.jpg` name, a truncated MP4.
- Unit: detection, each limit, EXIF rotation, checksum, slug, duplicate rule, effective rights with a frozen date.
- API: scope by account, every row of the error table, PATCH restrictions, delete guard with a `ContentVersion` fixture referencing the asset in each of the six places listed in rule 12.
- Panel: uploader happy path and rejection, picker selection, delete disabled when in use.

## Later

- Chunked upload and background probing for files above 500 MB.
- Tags and folders (add a `tags` JSON field and a filter).
- A daily job that warns before rights expire (the effective status already handles the expiry itself).
