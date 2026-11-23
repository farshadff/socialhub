# E08 — Schedule and post

## Goal

Workflow step 08: "Sequence posts across slots. Verify live posts before retrying." An item that passes the quality check is given a time automatically and shown on the calendar. In Phase 1 nothing is sent to Instagram: from the moment an item is scheduled, the operator has a posting pack (the final file and the full caption), posts it in the Instagram app when it is due, and pastes the post link into the panel. The system flags posts that are due or overdue, and a link marks the post published and starts metric entry (E09).

## Scope

**In Phase 1**

- A publication is created in the same transaction that approves an item, at the item's slot time, or at the next suitable time when the slot can no longer be used. Every publication has `delivery = manual`.
- Sequencing rules from the account's `posting_rules`: minimum gap between feed posts and reels, daily limits for feed/reel and for stories, counted in the account timezone, plus the posting window for times the system chooses.
- Publication statuses `scheduled`, `published`, `cancelled`.
- A week calendar, a publication list, the Publishing tab of the item workspace, and the controls reschedule, cancel and mark as published.
- The posting pack: download the final asset (and the reel cover), copy the full caption, see the scheduled time and the format.
- "Post by hand — due" when the time has passed and "Post by hand — overdue" two hours later, on the calendar, the item and the overview attention list.
- "Mark as published" with the post link: the publication, slot and item become `published`, and the first metric-entry checkpoint is set.

**Moved to Phase 2 (Instagram API)**

- The publish worker and Meta's container flow (E08-S03).
- Verify before retry, publish failures, retries and the failed state (E08-S04).
- "Publish now" and "Retry" controls, the publishing stop switch, connection and capability gates.

**Left for later (both phases)**

- Drag-and-drop on the calendar, month view, bulk actions.
- First-comment hashtags, location tags, collaborators, story stickers and links.
- Per-account posting windows edited in the panel (one setting covers all accounts).
- Cross-posting, carousels, feed videos.
- Deleting or editing a live post from the panel.

## Stories

| ID | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E08-S01](S01-auto-schedule.md) | Automatic scheduling and sequencing | Must | 2 | 0 | |
| [E08-S02](S02-calendar-and-controls.md) | Calendar and manual controls | Must | 1.5 | 3.5 | |
| [E08-S03](S03-publish-worker.md) | Publish worker for each format | Phase 2 | (3.5) | (0.5) | |
| [E08-S04](S04-verify-retry-and-fallback.md) | Verify before retry and publish failures | Phase 2 | (3) | (1.5) | |
| [E08-S05](S05-post-by-hand.md) | Post by hand: posting pack and mark as published | Must | 1.5 | 1.5 | |
| | **Phase 1 total** | | **5** | **5** | |

Figures in brackets are Phase 2 estimates and are not in the total.

## Flow

1. The quality check (E07) ends in Pass, or a reviewer approves. The pipeline sets the item to `approved` and, in the same transaction, calls `publishing.services.scheduling.schedule_item` (S01).
2. `schedule_item` creates the `Publication` with `delivery = manual` and `status = scheduled` at the slot time, or finds another time, and moves the item and slot to `scheduled`. If no time exists it opens a review task with reason `no_slot`.
3. The operator sees the week on `/calendar` and can reschedule or cancel (S02). The posting pack is on the item's Publishing tab and in the calendar drawer from this moment (S05).
4. When `scheduled_at` passes, the publication is "Post by hand — due"; `SOCIALHUB_MANUAL_POST_OVERDUE_MINUTES` (120) later it is "Post by hand — overdue". Both appear on the calendar and on the overview attention list as `publication_due_by_hand` (S05, E11-S01). Nothing moves automatically.
5. The operator downloads the asset, copies the caption, posts it in the Instagram app, copies the post link and uses "Mark as published" (S05). The publication, slot and item become `published`, and the publication's metric pointer is set to the first evaluation checkpoint, so E09-S04 asks for the numbers when they are due.

```text
approved ──schedule_item──► scheduled ──scheduled_at passes──► scheduled, "due" ──+120 min──► scheduled, "overdue"
                              │   ▲                                 │                               │
                              │   └──────── reschedule ─────────────┴───────────────────────────────┤
                              │                                                                     │
                              ├──────────────── mark as published (any time) ───────────────────────┴──► published
                              └──────────────── cancel ─────────────────────────────────────────────────► cancelled
```

### Phase 2

Phase 2 adds `delivery = provider` and a publish worker (E08-S03) that claims due publications every minute, checks the send-time gates (stop switch, connection, capability, lateness, daily limit, minimum gap), runs Meta's container flow through the account's Instagram provider and reads the post back. E08-S04 adds the rule that nothing is sent twice without first reading the container and, if needed, the account's media; retries with backoff; and the `failed` state with a `publish_failed` review task. The manual route of E08-S05 stays as the fallback: a publication switches to it when Instagram has not granted publishing for a format, and an operator can mark a failed publication as published. Phase 2 flow:

```text
approved ──schedule_item──► scheduled ──dispatcher──► publishing ──container, publish, read back──► published
                               ▲  ▲                       │
                               │  └── retry wait ◄────────┤ uncertain / transient ─► verifying ─ found ─► published
                               │      (2, 10 min)         │ slow container ─────────►    │
                reschedule / publish now                  │                              └ not found after last attempt
                                                          └── fatal / container ERROR ─────────► failed + review task
```

## Owns

| Kind | Items |
| --- | --- |
| Tables | `Publication` ([DATA-MODEL.md](../../DATA-MODEL.md) section 9). `PublishAttempt` is Phase 2 |
| Endpoints | `GET /publications/`, `GET /publications/{id}/`, `GET /calendar/`, `POST /publications/{id}/reschedule/`, `POST /publications/{id}/cancel/`, `POST /publications/{id}/mark-published/`. Phase 2: `POST /publications/{id}/publish-now/`, `POST /publications/{id}/retry/` |
| Panel | `/calendar`; the Publishing tab of `/content/:id` |
| Background tasks | None in Phase 1. Phase 2: `publishing.dispatch_due`, `publishing.send`, `publishing.verify` (queue `publish`) |
| Services | `publishing.services.scheduling` (`schedule_item`, `withdraw`, `find_time`), `publishing.services.captions.full_caption` (the single caption builder), `publishing.services.manual` (`due_state`, `due_publications`, `posting_pack`, `parse_permalink`, `mark_published`) (S05) |
| Settings | `SOCIALHUB_PUBLISH_MIN_LEAD_MINUTES`, `SOCIALHUB_PUBLISH_WINDOW`, `SOCIALHUB_PUBLISH_GRID_MINUTES` (S01), `SOCIALHUB_MANUAL_POST_OVERDUE_MINUTES` (S05) |
| AI tasks | None |
| Job kinds | None in Phase 1. Phase 2: `publish.send`, `publish.verify` |

## Depends on / needed by

| Depends on | Why |
| --- | --- |
| E00-S03 | `InstagramAccount` with `handle`, `timezone` and `posting_rules` |
| E00-S06 | Media storage and signed URLs for the posting pack |
| E01-S02 | `PlanSlot` and slot statuses |
| E03-S04 | `ContentItem`, the pipeline service that owns status changes, the item workspace shell |
| E04-S01 | Format registry (caption limit, media rules) |
| E06-S07 | `ContentVersion` with `final_asset`, `cover_asset`, caption and hashtags |
| E07-S01, E07-S06 | The `approved` transition; `ReviewTask` (reason `no_slot`) and its resolution page |

| Needed by | Why |
| --- | --- |
| E09-S03, E09-S04 | Published publications with `published_at`, `permalink`, `next_metrics_checkpoint` and `next_metrics_at` |
| E10 | Published posts to evaluate |
| E11-S01 | Next publications and `publication_due_by_hand` entries on the overview |

## Done when

On a test Instagram account, posting by hand from the panel:

1. Approving a feed post, a reel and a story creates three publications at their slot times without anyone touching the calendar; each has `delivery = manual`.
2. Each one's Publishing tab offers the final file (and the reel's cover) for download under a readable file name, and the full caption to copy (none for the story), as soon as it is scheduled.
3. When a publication's time passes it shows "Post by hand — due" on the calendar and the overview; two hours later "Post by hand — overdue". Nothing changes on its own.
4. After posting in the Instagram app, pasting the link with "Mark as published" makes the publication, slot and item `published`, shows the permalink in the panel, and sets the first metric-entry checkpoint (24 h for the post and the reel, 23 h for the story).
5. Rescheduling a publication to an open slot or a free time obeys the minimum gap and daily limits; cancelling frees the slot.

## Later

- Phase 2: the publish worker (E08-S03) and verify before retry (E08-S04) claim publications with `delivery = provider`; scheduling, the calendar and the manual route keep working unchanged.
- The posting window and lead time become account settings.
- Carousels: a new format in the registry; the posting pack then lists several files.
- Smarter sequencing (for example a story teaser before a reel) can replace `find_time` without touching anything else.
- A reminder outside the panel (email or chat) when a post becomes due.
