# E08 — Schedule and publish

## Goal

Workflow step 08: "Sequence posts across slots. Verify live posts before retrying." An item that passes the quality check is given a time automatically, sent to Instagram by a worker when that time comes, and confirmed live. If a send is uncertain, the worker looks at the account on Instagram before it ever sends again, so a timeout cannot produce a duplicate post.

## Scope

**In the MVP**

- A publication is created in the same transaction that approves an item, at the item's slot time, or at the next suitable time when the slot can no longer be used.
- Sequencing rules from the account's `posting_rules`: minimum gap between feed posts and reels, daily limits for feed/reel and for stories, counted in the account timezone.
- A dispatcher that runs every minute, claims due publications with a lease, and sends at most one publication per account at a time.
- Send-time gates: stop switch, connection health, the version is still the one that passed, daily limit, minimum gap, lateness.
- Publishing each format through the account's Instagram provider: single-image feed post, reel with cover, image story, video story.
- Verify-before-retry: every retry is preceded by a live check; at most three sends; a final live check before a publication is declared failed.
- Manual fallback: "post by hand" with downloadable asset and copyable caption, then "Mark as published" with the link.
- A week calendar, a publication list, the Publishing tab of the item workspace, and the controls reschedule, cancel, publish now, retry.

**Left for later**

- Drag-and-drop on the calendar, month view, bulk actions.
- First-comment hashtags, location tags, collaborators, story stickers and links.
- Per-account posting windows edited in the panel (the MVP uses one setting).
- Cross-posting, carousels, feed videos.
- The official Graph API adapter (the provider interface already allows it).
- Deleting or editing a live post from the panel.

## Stories

| ID | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E08-S01](S01-auto-schedule.md) | Automatic scheduling and sequencing | Must | 2.5 | 0 | |
| [E08-S02](S02-calendar-and-controls.md) | Calendar and manual controls | Must | 1.5 | 4 | |
| [E08-S03](S03-publish-worker.md) | Publish worker for each format | Must | 3.5 | 0.5 | |
| [E08-S04](S04-verify-retry-and-fallback.md) | Verify before retry, failures and manual fallback | Must | 3 | 1.5 | |
| | **Total** | | **10.5** | **6** | |

## Flow

1. The quality check (E07) ends in Pass, or a reviewer approves. The pipeline sets the item to `approved` and, in the same transaction, calls `publishing.services.schedule_item` (S01).
2. `schedule_item` creates the `Publication` at the slot time, or finds another time, and moves the item and slot to `scheduled`. If no time exists it opens a review task with reason `no_slot`.
3. The operator sees the week on `/calendar` and can reschedule, cancel or publish now (S02).
4. Every minute the dispatcher claims due publications that pass the gates and enqueues one send per account (S03).
5. The send task downloads the final asset, calls the provider method for the format, and on success marks publication, slot and item `published` and sets the first metric checkpoint for E09 (S03).
6. If the result is uncertain or the send fails, the worker checks Instagram for the post, retries with backoff only when the post is not there, and after the last attempt fails the publication and opens a review task (S04).
7. When the provider cannot publish a format, or the account uses the `manual` provider, the publication waits as "post by hand" until the operator marks it as published (S04).

```text
approved ──schedule_item──► scheduled ──dispatcher──► publishing ──success──────────────► published
                               ▲  ▲                       │
                               │  └── retry wait ◄────────┤ uncertain / transient ─► verifying ─ found ─► published
                               │      (2, 10 min)         │                              │
                reschedule / publish now                  │                              └ not found after last attempt
                                                          └── fatal ───────────────────────────► failed + review task
```

## Owns

| Kind | Items |
| --- | --- |
| Tables | `Publication`, `PublishAttempt` ([DATA-MODEL.md](../../DATA-MODEL.md) section 9) |
| Endpoints | `GET /publications/`, `GET /publications/{id}/`, `GET /calendar/`, `POST /publications/{id}/reschedule/`, `POST /publications/{id}/cancel/`, `POST /publications/{id}/publish-now/`, `POST /publications/{id}/retry/`, `POST /publications/{id}/mark-published/` |
| Panel | `/calendar`; the Publishing tab of `/content/:id` |
| Background tasks | `publishing.dispatch_due` (every minute), `publishing.send`, `publishing.verify` (queue `publish`) |
| Services | `publishing.services.scheduling` (`schedule_item`, `withdraw`, `find_time`), `publishing.services.sending`, `publishing.services.verification`, `publishing.services.recovery` (`after_attempt`, `on_review_decision`), `publishing.services.captions` (`full_caption`, the single caption builder, and `caption_fingerprint`) |
| AI tasks | None |
| Job kinds | `publish.send`, `publish.verify` |

## Depends on / needed by

| Depends on | Why |
| --- | --- |
| E00-S04 | Provider interface, connection status and capabilities, per-account Instagram lock, fake provider with failure scenarios |
| E00-S06 | `JobRun`, media storage, `JobButton` |
| E01-S02 | `PlanSlot` and slot statuses |
| E03-S04 | `ContentItem`, the pipeline service that owns status changes, the item workspace shell |
| E04-S01 | Format registry (caption limit, media rules) |
| E06-S07 | `ContentVersion` with `final_asset`, `cover_asset`, caption and hashtags |
| E07-S01, E07-S06 | The `approved` transition; `ReviewTask` and its resolution page |

| Needed by | Why |
| --- | --- |
| E09-S01 | `remote_media_pk`, `published_at`, `next_metrics_checkpoint`, `next_metrics_at` |
| E10 | Published posts to evaluate |
| E11-S01 | Next publications, blocked publications and "post by hand" items on the overview |

## Done when

On a test Instagram account, with the `instagrapi` provider:

1. Approving a feed post, a reel and a story creates three publications at their slot times without anyone touching the calendar.
2. Each one is published within two minutes of its time and shows its permalink in the panel.
3. With the fake provider set to time out after upload, the publication ends `published` with outcome `verified_live` and Instagram shows exactly one post.
4. With the fake provider set to fail three times without posting, the publication ends `failed` and a review task with reason `publish_failed` exists.
5. With publishing switched off, nothing is sent, and due publications show "Publishing off".
6. With the `manual` provider, the operator can download the asset, copy the caption, paste the link and see the item as published.

## Later

- The posting window and lead time become account settings.
- The `graph_api` provider plugs into `publishing.services.sending` without changes to scheduling or verification.
- A second worker pool for the `publish` queue when the number of accounts grows; the lease and the per-account lock already make that safe.
- Smarter sequencing (for example a story teaser before a reel) can replace `find_time` without touching the dispatcher.
