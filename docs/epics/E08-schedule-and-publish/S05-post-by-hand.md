# E08-S05 — Post by hand: posting pack and mark as published

| | |
| --- | --- |
| Epic | E08 Schedule and post |
| Priority | Must |
| Estimate | BE 1.5 d · FE 1.5 d · QA 0 d |
| Depends on | E08-S01, E08-S02, E00-S03, E00-S06, E06-S07 |
| Needed by | E09-S03, E09-S04, E10-S01, E11-S01, E11-S03 |

## User story

As an operator, I want everything I need to post an item ready in one place, a clear flag when a post is due or overdue, and one step to record the post once it is live, so that I can post each item in the Instagram app on time and the system knows it is published.

## Context

In Phase 1 Social Hub does not talk to Instagram. Every publication that E08-S01 creates has `delivery = manual`: a person posts it in the Instagram app. This story gives that person a posting pack (the final file, the reel cover and the full caption) from the moment the item is scheduled, flags the publication as due when its time passes and as overdue two hours later, and records the post when the operator pastes its link. Marking a publication published is the hand-over to analytics: it sets the first metric-entry checkpoint that E09-S04 asks for.

The operator arrives from the overview attention list, the calendar drawer or the item's Publishing tab (E08-S02). The publication is `scheduled` and has an approved content version with a final asset.

## Scope

**In:**

- `posting_pack` on `GET /publications/{id}/`: signed download URLs with readable file names, the full caption, hashtags, alt text (E06-S06), format and media kind.
- `due_state` and `overdue_at` (the rule that E08-S02 shows on the calendar and E11-S01 puts on the attention list).
- `POST /publications/{id}/mark-published/` with link validation and normalisation.
- The effects of marking published, including the metric pointer.
- Panel: the "Post by hand" card, the "Mark as published" dialog, the published card.

**Out (later):**

- Looking the post up on Instagram to get its media ID (Phase 2, E08-S04).
- Editing the link of a published publication from the panel.
- Reminders outside the panel (email, chat, push).
- Sending the file to a phone from the panel.

## Behaviour and rules

### Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `SOCIALHUB_MANUAL_POST_OVERDUE_MINUTES` | 120 | How long after `scheduled_at` a post that is not marked published counts as overdue |

### Posting pack

1. `posting_pack` is built by `publishing.services.manual.posting_pack(publication)` and returned only by `GET /publications/{id}/` (and by the responses of the actions that return the detail object). It is not in the list response, so the list does not sign URLs it does not need. It is present while the publication is `scheduled` or `published`, and null when it is `cancelled`.
2. Fields:

| Field | Value |
| --- | --- |
| `asset_url` | Signed URL of `content_version.final_asset`, made by `core.storage.media_url(file, download_name=asset_filename)` (E00-S06). On the S3 backend the signature carries `response-content-disposition: attachment; filename="{asset_filename}"`, so the browser saves the file under that name; on the `local` backend the panel's `download` attribute sets the name. Valid for `SOCIALHUB_MEDIA_URL_TTL_SECONDS` |
| `asset_filename` | `{handle}-{format}-{content_item_id}.{ext}`: `format` with `_` written as `-` (`feed-post`), `ext` from the asset's MIME type (`jpg` for `image/jpeg`, `mp4` for `video/mp4`). Example `greenhome.ir-reel-42.mp4` |
| `cover_url` | Signed URL of `content_version.cover_asset`, made the same way. Reels with a cover asset only; otherwise null |
| `cover_filename` | `{handle}-reel-{content_item_id}-cover.jpg`, or null |
| `caption` | `publishing.services.captions.full_caption(version, format)` (E08-S01 rule 18): the caption, a blank line and the hashtags. Null for stories |
| `hashtags` | The version's hashtags without `#`, in order. Empty list for stories |
| `format` | `reel`, `story` or `feed_post` |
| `media_kind` | `image` or `video`, from the final asset |

3. The handle in the file name is the account's handle at the time of the request.

### Due and overdue

4. `publishing.services.manual.due_state(publication, now)` is the only place the rule lives. The serializers (E08-S02), the calendar and the attention list builder (E11-S01) call it.
5. **Due:** the publication is `scheduled`, `scheduled_at <= now`, and `now < overdue_at`, where `overdue_at = scheduled_at + SOCIALHUB_MANUAL_POST_OVERDUE_MINUTES`. Flag "Post by hand — due" (warning).
6. **Overdue:** the publication is `scheduled` and `overdue_at <= now`. Flag "Post by hand — overdue" (error). Before `scheduled_at` the state is `upcoming`; for any other status it is null.
7. Nothing moves automatically. A due or overdue publication stays `scheduled` with its slot until a person marks it published, reschedules it or cancels it (E08-S02). No task runs at the due time; the state is computed whenever the publication is read.
8. Every due or overdue publication is an attention list entry of type `publication_due_by_hand` with `data.overdue` true or false (E11-S01 builds the entry). `publishing.services.manual.due_publications(account, now)` returns these publications, oldest `scheduled_at` first, for that builder.

### Mark as published

9. `POST /publications/{id}/mark-published/` is allowed when `mark_published` is in `allowed_actions` (`status = scheduled`), whether or not the time has come: an operator who posted early can record it at once. Otherwise `409 invalid_transition` with `details.status` and `details.allowed_actions`.
10. `permalink` is required and must be a link to one post on the account. `publishing.services.manual.parse_permalink(url, format, handle)` accepts:

| Format | Accepted paths on `instagram.com` or `www.instagram.com` (https only) |
| --- | --- |
| `feed_post` | `/p/{code}/`, `/{username}/p/{code}/` |
| `reel` | `/reel/{code}/`, `/reels/{code}/`, `/{username}/reel/{code}/`, `/p/{code}/` |
| `story` | `/stories/{username}/{story_id}/` |

The query string (for example `?igsh=…` from the app's share link) and the fragment are dropped, and the trailing slash is optional. `code` matches `[A-Za-z0-9_-]{5,40}`; `story_id` is digits. When a username is present it must equal the account's handle, case-insensitive. Anything else fails with field code `invalid`; a handle mismatch fails with `wrong_account`.
11. The stored values:
    - `permalink`: `https://www.instagram.com/p/{code}/` for feed posts, `https://www.instagram.com/reel/{code}/` for reels (whichever path was pasted), `https://www.instagram.com/stories/{handle}/{story_id}/` for stories.
    - `remote_shortcode`: the `code` for feed posts and reels, the `story_id` for stories.
    - `remote_media_id` is not set; it stays null in Phase 1.
12. A `remote_shortcode` already stored on another publication returns `400 validation_error` on `permalink` with code `unique`. A partial unique index on `Publication.remote_shortcode` (where not null) backs the check.
13. `published_at` is optional and defaults to now. It may not be in the future (code `max_value`) and may not be more than 7 days before `scheduled_at` (code `min_value`).
14. Effects, in one transaction under the publication row lock (E08-S02 rule 19):
    - Publication: `status = published`, `published_via = manual`, `permalink`, `remote_shortcode`, `published_at`.
    - Slot, if any: `status = published`.
    - Item: `scheduled → published` through the pipeline service.
    - Metric pointer: `analytics.services.checkpoints.start_metrics_pointer(publication)` (E09-S04) sets `next_metrics_checkpoint = "24h"` and `next_metrics_at = published_at + 24 hours` for reels and feed posts, `"23h"` and `published_at + 23 hours` for stories. When that time has already passed (a post marked late, or a back-dated `published_at`), the checkpoint is due for entry at once; E09-S04 brings the pointer up to date in the same call.
    - One `ContentEvent` of type `publish_attempt`, actor the user, message "Marked as published", `data = {"via": "manual", "permalink": …, "published_at": …}`.
15. No call to Instagram is made. The system trusts the operator's link; the link format, handle and uniqueness checks are the safeguards.
16. A published publication cannot be marked again or un-published through the API (`409 invalid_transition`). A wrong link is corrected by an admin in the Django admin (E08-S01-BE1), which writes the same fields.
17. Operators and admins can mark publications as published.

## Data

`Publication`, `PlanSlot`, `ContentItem`, `ContentVersion`, `Asset`, `ContentEvent`, `InstagramAccount.handle` as in [DATA-MODEL.md](../../DATA-MODEL.md).

This story writes on `Publication`: `status` (`published`), `published_via` (`manual`), `permalink`, `remote_shortcode` (shortcode, or story ID for stories), `published_at`, `next_metrics_checkpoint`, `next_metrics_at`. `remote_media_id` stays null.

New in DATA-MODEL.md section 9: partial unique index on `Publication.remote_shortcode` where not null. `posting_pack`, `due_state` and `overdue_at` are computed and not stored.

## API

### `GET /publications/{id}/` — `posting_pack`

Permission: signed in. The detail object of E08-S02 with `posting_pack` filled. A scheduled reel that is due:

```json
{
  "id": 31,
  "account": 1,
  "content_item": {"id": 42, "title": "Three mistakes first-time buyers make", "status": "scheduled", "role": "educate"},
  "format": "reel",
  "delivery": "manual",
  "scheduled_at": "2026-11-23T15:30:00Z",
  "status": "scheduled",
  "due_state": "due",
  "overdue_at": "2026-11-23T17:30:00Z",
  "permalink": null,
  "published_at": null,
  "allowed_actions": ["reschedule", "cancel", "mark_published"],
  "posting_pack": {
    "asset_url": "https://media.example.test/accounts/1/2026/11/310-three-mistakes.mp4?response-content-disposition=attachment%3B%20filename%3D%22greenhome.ir-reel-42.mp4%22&X-Amz-Expires=21600&X-Amz-Signature=9f1c…",
    "asset_filename": "greenhome.ir-reel-42.mp4",
    "cover_url": "https://media.example.test/accounts/1/2026/11/311-cover.jpg?response-content-disposition=attachment%3B%20filename%3D%22greenhome.ir-reel-42-cover.jpg%22&X-Amz-Expires=21600&X-Amz-Signature=4b2e…",
    "cover_filename": "greenhome.ir-reel-42-cover.jpg",
    "caption": "سه اشتباه رایج در خرید خانه اول که می‌شود از آن‌ها دور ماند.\n\n#خانه_اول #مشاوره_املاک",
    "hashtags": ["خانه_اول", "مشاوره_املاک"], "alt_text": "…",
    "format": "reel",
    "media_kind": "video"
  },
  "…": "remaining fields as in E08-S02"
}
```

An image story:

```json
"posting_pack": {
  "asset_url": "https://media.example.test/accounts/1/2026/11/301-rent-or-buy.jpg?response-content-disposition=attachment%3B%20filename%3D%22greenhome.ir-story-40.jpg%22&X-Amz-Expires=21600&X-Amz-Signature=c71a…",
  "asset_filename": "greenhome.ir-story-40.jpg",
  "cover_url": null,
  "cover_filename": null,
  "caption": null,
  "hashtags": [], "alt_text": null,
  "format": "story",
  "media_kind": "image"
}
```

A cancelled publication has `"posting_pack": null`.

### `POST /publications/{id}/mark-published/`

Permission: signed in. Request:

```json
{
  "permalink": "https://www.instagram.com/reel/DC0aBcDeFgH/?igsh=MWQ1ZGUxMzBkMA==",
  "published_at": "2026-11-23T15:41:00Z"
}
```

`published_at` may be left out; it then defaults to the time of the request. A story:

```json
{"permalink": "https://instagram.com/stories/greenhome.ir/3497612345678901234?utm_source=ig_story_item_share"}
```

Response `200`: the publication as in `GET /publications/{id}/`.

```json
{
  "id": 31,
  "account": 1,
  "content_item": {"id": 42, "title": "Three mistakes first-time buyers make", "status": "published", "role": "educate"},
  "slot": {"id": 77, "scheduled_at": "2026-11-23T15:30:00Z", "status": "published"},
  "format": "reel",
  "delivery": "manual",
  "scheduled_at": "2026-11-23T15:30:00Z",
  "status": "published",
  "due_state": null,
  "overdue_at": null,
  "remote_shortcode": "DC0aBcDeFgH",
  "permalink": "https://www.instagram.com/reel/DC0aBcDeFgH/",
  "published_at": "2026-11-23T15:41:00Z",
  "published_via": "manual",
  "next_metrics_checkpoint": "24h",
  "next_metrics_at": "2026-11-24T15:41:00Z",
  "allowed_actions": [],
  "posting_pack": {"asset_url": "https://media.example.test/…", "asset_filename": "greenhome.ir-reel-42.mp4", "cover_url": "https://media.example.test/…", "cover_filename": "greenhome.ir-reel-42-cover.jpg", "caption": "…", "hashtags": ["خانه_اول", "مشاوره_املاک"], "alt_text": "…", "format": "reel", "media_kind": "video"},
  "…": "remaining fields as in E08-S02"
}
```

Error example:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request is not valid.",
    "fields": [{"path": "permalink", "code": "wrong_account", "message": "The link belongs to another Instagram account."}],
    "request_id": "0b9e6c3a-41f2-4d7e-a3c5-7e1d2f9a6b10",
    "retryable": false
  }
}
```

| Case | Response |
| --- | --- |
| `permalink` missing, not https, not on `instagram.com`, not a single post, or the wrong link type for the format | `400 validation_error`, field `permalink`, code `invalid` |
| Username in the link is not the account's handle | `400 validation_error`, field `permalink`, code `wrong_account` |
| The post is already recorded on another publication | `400 validation_error`, field `permalink`, code `unique` |
| `published_at` in the future | `400 validation_error`, field `published_at`, code `max_value` |
| `published_at` more than 7 days before `scheduled_at` | `400 validation_error`, field `published_at`, code `min_value` |
| Status is not `scheduled` (already published or cancelled) | `409 invalid_transition`, `details: {"status", "allowed_actions"}` |
| Not found | `404 not_found` |

## Background work

None. Due and overdue are computed on read; the metric-entry checkpoints are advanced by E09-S04's task.

## AI

None.

## Panel

### "Post by hand" card (`PostingPackCard`)

Shown while the publication is `scheduled`, on the Publishing tab of `/content/:id` and in the calendar entry drawer (E08-S02). A `Card` titled "Post by hand".

**Alert** at the top, by `due_state`:

| `due_state` | Type | Text |
| --- | --- | --- |
| `upcoming` | info | "Post this on @{handle} at {scheduled time}. The file and caption are ready below." |
| `due` | warning | "Due since {scheduled time}. Post it on @{handle}, then paste the link." |
| `overdue` | error | "Overdue since {scheduled time}. Post it now, or reschedule or cancel it." |

**Body:**

| Element | Behaviour |
| --- | --- |
| Preview | `MediaPreview` of the final asset in the format's aspect ratio |
| Details | `Descriptions`: Account (@handle), Format (Reel, Story, Feed post), Scheduled for (account time, with the timezone name) |
| "Download video" / "Download image" | Label by `media_kind`. Each click re-reads `GET /publications/{id}/` and opens the fresh `asset_url`, so a page left open for hours still downloads |
| "Download cover" | Only when `cover_url` is set |
| Caption box | `caption` through `ContentText`, read-only, with "Copy caption" (copies the text exactly). For stories the box is replaced by the line "Stories have no caption." |
| "Copy hashtags" | Link button under the caption box: copies the hashtags with `#`, separated by spaces. Hidden when there are none |
| "Copy alt text" | Link button under "Copy hashtags": copies `alt_text` for Instagram's accessibility setting ("Advanced settings → Write alt text"). Hidden when it is empty |
| Checklist | "1. Post it on @{handle} as a {format}." "2. Open the post and copy its link (for a story: open it, tap More, Copy link)." "3. Paste the link with Mark as published." |
| "Mark as published" | Primary button; opens the dialog below |

Messages: copy success `message.success("Caption copied")` or `"Hashtags copied"`; clipboard refused `message.error("Could not copy. Select the text and copy it by hand.")`; download re-read fails `message.error("The file could not be prepared. Try again.")`.

### "Mark as published" dialog (`MarkPublishedModal`)

`Modal` form (`useModalForm`) titled "Mark as published", opened from the card, the drawer's action buttons or the schedule card.

| Field | Control | Rules |
| --- | --- | --- |
| Link to the post | `Input`, placeholder by format: `https://www.instagram.com/p/…`, `https://www.instagram.com/reel/…`, `https://www.instagram.com/stories/{handle}/…` | Required. Client-side check that it starts with `https://www.instagram.com/` or `https://instagram.com/` ("Paste the link from Instagram, starting with https://www.instagram.com/") |
| Posted at | Date-time picker in the account timezone, default now | Not in the future; not more than 7 days before the scheduled time |

Submit button "Mark as published"; it is disabled while the request runs. Field error texts by code: `invalid` → "This does not look like a link to a single Instagram {format}."; `wrong_account` → "This link belongs to another account. Post it on @{handle}."; `unique` → "This post is already recorded for another item."; `max_value` → "The time cannot be in the future."; `min_value` → "The time cannot be more than 7 days before the scheduled time." A `409` shows `message.warning("This publication changed. Reloading.")` and reloads.

Success: `message.success("Marked as published")`, the dialog closes, the tab or drawer reloads and shows the published card.

### Published card

Replaces the "Post by hand" card once the publication is `published`:

- "Published at {time}" in account time, and "Posted by hand".
- The permalink as a link, with "View on Instagram" (opens in a new tab) and "Copy link".
- "Metrics due: {checkpoint label} on {next_metrics_at}" with a link to `/analytics/posts/{publicationId}` (E09-S03). Hidden when `next_metrics_checkpoint` is null.

### States

| State | Display |
| --- | --- |
| Loading | Skeleton in the card |
| Preview fails to load (expired URL) | `MediaPreview` calls `onUrlExpired`; the card re-reads the publication once |
| `posting_pack` null (cancelled) | No card; E08-S02 shows the cancelled state |

## Acceptance criteria

1. Given a reel scheduled with a cover, when `GET /publications/{id}/` is called, then `posting_pack` has a signed `asset_url` and `cover_url`, the file names `{handle}-reel-{item id}.mp4` and `{handle}-reel-{item id}-cover.jpg`, `caption` equal to `full_caption`, the hashtags, `alt_text` from the version, `format` `reel` and `media_kind` `video`; on the S3 backend the signed URL carries an attachment disposition with that file name.
2. Given an image story, then `posting_pack.caption` is null, `hashtags` is empty, `cover_url` is null, and the panel shows "Stories have no caption."
3. Given a feed post scheduled for tomorrow, then the posting pack is available today and `due_state` is `upcoming`.
4. Given a scheduled publication 30 minutes past its time, then `due_state` is `due`, and `due_publications(account)` returns it so the overview lists it as `publication_due_by_hand` with `data.overdue = false`; at 121 minutes it is `overdue` with `data.overdue = true`; it is still `scheduled` and its slot is still `scheduled`.
5. Given a due reel, when `mark-published` is called with `https://www.instagram.com/reel/DC0aBcDeFgH/?igsh=x` and no `published_at`, then the publication is `published` with `published_via = manual`, `permalink` `https://www.instagram.com/reel/DC0aBcDeFgH/`, `remote_shortcode` `DC0aBcDeFgH`, `published_at` now, `remote_media_id` null, `next_metrics_checkpoint` `24h` at `published_at + 24 h`; the slot and item are `published`; one `ContentEvent` of type `publish_attempt` with `data.via = "manual"` exists; it is no longer on the attention list.
6. Given a reel and the link `https://www.instagram.com/reels/DC0aBcDeFgH/`, then the stored permalink is `https://www.instagram.com/reel/DC0aBcDeFgH/`.
7. Given a story on `greenhome.ir` and the link `https://instagram.com/stories/GreenHome.ir/3497612345678901234?utm_source=x`, then the publication is `published` with `remote_shortcode` `3497612345678901234`, the normalised story permalink, and `next_metrics_checkpoint` `23h` at `published_at + 23 h`.
8. Given a feed post and a `/reel/` link, a profile link `https://www.instagram.com/greenhome.ir/`, an `http://` link or a link on another host, then the response is `400` on `permalink` with code `invalid` and nothing changes.
9. Given a story link for another username, then the response is `400` on `permalink` with code `wrong_account`.
10. Given a shortcode already recorded on another publication, then the response is `400` on `permalink` with code `unique`.
11. Given `published_at` one hour in the future, then the response is `400` with code `max_value`; given `published_at` 8 days before `scheduled_at`, then code `min_value`.
12. Given a publication already published or cancelled, when `mark-published` is called, then the response is `409 invalid_transition`.
13. Given a feed post marked published with `published_at` 30 hours ago, then `next_metrics_checkpoint` is `24h` with `next_metrics_at` 6 hours ago, so E09-S04 lists it as due for entry.
14. Given the Publishing tab of a due reel, when the operator clicks "Download video" after the page has been open for seven hours, then the publication is re-read and the file downloads under `{handle}-reel-{item id}.mp4`; "Copy caption" puts the full caption on the clipboard.
15. Given the dialog, when the API returns `wrong_account`, then the field shows "This link belongs to another account. Post it on @{handle}."

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S05-BE1 | Posting pack and due state | `apps/publishing/services/manual.py`: `posting_pack`, file names, `due_state`, `due_publications`; `SOCIALHUB_MANUAL_POST_OVERDUE_MINUTES` in settings; `posting_pack` on the detail serializer; calls `media_url(…, download_name=…)` (E00-S06). Tests per format with a fixed clock; S3 backend mocked with `moto` to assert the content disposition | 0.5 d |
| E08-S05-BE2 | Permalink parser | `manual.parse_permalink(url, format, handle)` returning the normalised permalink and shortcode or a field code; table-driven tests for every accepted and rejected form | 0.25 d |
| E08-S05-BE3 | Mark-published endpoint | `manual.mark_published(publication, permalink, published_at, user)` and `POST /publications/{id}/mark-published/`: serializer, `allowed_actions` check under the row lock, uniqueness and partial unique index migration, `published_at` bounds, effects of rule 14 including the call to `start_metrics_pointer` (E09-S04), `ContentEvent`; `openapi.yaml`; API tests for every row of the error table | 0.5 d |
| E08-S05-BE4 | Hand-over tests | Integration test from an approved item to `scheduled`, `due`, `overdue` and `published` with the metric pointer set; a test that the E11-S01 builder receives `due_publications` with the right `overdue` values | 0.25 d |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E08-S05-FE1 | Post-by-hand card | `src/components/PostingPackCard`: alert by `due_state`, preview, details, downloads with re-read, caption and hashtag copy, checklist; placed in the Publishing tab and the calendar drawer; Vitest tests per format and due state | 0.75 d |
| E08-S05-FE2 | Mark-as-published dialog | `src/components/MarkPublishedModal`: fields, client check, field error mapping, conflict handling, success reload; `markPublished` in `src/services/publishing.ts`; tests for every error text | 0.5 d |
| E08-S05-FE3 | Published card and flags | Published card with link, "View on Instagram", "Copy link" and the metrics-due line; "Post by hand — due" and "Post by hand — overdue" in the `StatusTag` label map | 0.25 d |

### Test

None beyond the tests inside each subtask.

## Test notes

- Every due-state test uses a fixed clock; cover `scheduled_at − 1 min`, `+ 0`, `+ 119 min`, `+ 120 min` and an overridden setting.
- Permalink table: `/p/`, `/reel/`, `/reels/` and `/{username}/p/` forms; mobile share links with `?igsh=` and `?utm_source=`; upper-case handles; missing trailing slash; `http://`, `m.instagram.com`, `instagr.am`, profile links, `/explore/` links, `/stories/highlights/` links (rejected), and a feed post with a `/reel/` link (rejected).
- Fixtures: one account `greenhome.ir` in `Asia/Tehran`; one scheduled reel with a cover, one image story, one feed post; one publication already published with shortcode `DCx1AbCdEfG`.
- The end-to-end suite (E11-S03) uses this route for every post: it reads the posting pack, calls `mark-published` with a fixed link, and continues with metric entry.

## Later

- Phase 2: `mark-published` also accepts `failed` publications and `verifying` ones without an active lease, and takes an optional `verify` flag that looks the post up by shortcode on a connected account to fill `remote_media_id`; the response gains a `verification` object (E08-S04).
- Phase 2: publications get `delivery = manual` only when the account's connection cannot publish the format; the card then explains why (E08-S04).
- Editing the link of a published publication from the panel: a `PATCH` limited to `permalink` with the same parser.
- Sending the posting pack to a phone (a share link or QR code that opens the file on a signed URL), so the file does not have to be moved from the computer.
- Reminders outside the panel use `due_publications` as their source.
