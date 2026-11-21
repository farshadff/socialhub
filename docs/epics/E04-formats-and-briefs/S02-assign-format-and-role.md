# E04-S02 — Assign format and role

| | |
| --- | --- |
| Epic | E04 Formats and briefs |
| Priority | Must |
| Estimate | BE 1 d · FE 1.5 d |
| Depends on | E04-S01, E03-S03, E03-S04, E01-S02 |
| Needed by | E04-S03, E05-S01 |

## User story

As an operator, I want to set or change each item's format, production mode, role and slot before production starts, so that every piece plays a clear part in the week and is made in the form that suits it.

## Context

Selection (E03-S03) creates each item with the slot's format, the registry's default media kind and production mode, and a role taken from the slot or the candidate. Most of the time that is right. This story covers the times it is not: an idea that works better as a reel than a story, a story that should be a short video rather than an image, a reel made from uploaded footage instead of animated frames, or a piece that should educate rather than attract.

The brief and the script are written for one format and one role. When a change makes them wrong, this story supersedes them and moves the item back so they are written again. Once production starts, the format is fixed: the item is cancelled and selected again instead.

## Scope

**In**

- `PATCH /content-items/{id}/` for `format`, `media_kind`, `production_mode`, `role` and `slot`.
- Role definitions with default success metrics, served as `roles` in `GET /formats/`.
- Superseding the brief and script, moving the item back, releasing and reserving slots.
- Panel: a "Format and role" modal opened from the workspace header, and a reusable `RolePicker`.

**Out (later)**

- Changes after production has started.
- Editing the item title (the title comes from the candidate; a later story can make it editable).
- Swapping slots between two items in one action.
- Bulk changes across items.

## Behaviour and rules

### Roles

1. The five roles are fixed in `apps/content/roles.py`. Each has a label, a one-line purpose, guidance used in prompts, examples and a default success metric:

   | Role | Label | Purpose shown to operators | Default metric | Default for stories |
   | --- | --- | --- | --- | --- |
   | `attract` | Attract | Reach people who do not follow the account yet | `reach` | `reach` |
   | `educate` | Educate | Teach something useful enough to save | `saves` | `saves` |
   | `build_trust` | Build trust | Show proof, results or the people behind the brand | `shares` | `shares` |
   | `convert` | Convert | Move people to a concrete action | `shares` | `shares` |
   | `engage` | Engage | Start a conversation with the audience | `comments` | `replies` |

   These defaults match DATA-MODEL.md section 1. The brief's `success_metric` starts from them (E04-S03).
2. `roles.default_metric(role, format)` returns the default metric, using the story column when `format` is `story`.

### When changes are allowed

3. Operators and admins may change items of the accounts they can see.
4. The item's status must be `selected`, `briefed` or `scripted`. Any other status returns `409 invalid_transition` with `details.status` and `details.reason = "production_started"` (or `"terminal"` for `published` and `cancelled`).
5. The item must have no active job (`pipeline.ensure_idle`). Otherwise `409 job_in_progress` with `details.job`.
6. Only `format`, `media_kind`, `production_mode`, `role`, `slot` and `confirm` are accepted. Any other key returns `400 validation_error` with code `read_only` on that field.
7. A request that changes nothing returns `200` with the item and no event.

### Format, media kind and production mode

8. The resulting combination must be allowed by the registry (`formats.is_allowed`). Missing values are filled in this order:
   - `format` changed and `media_kind` not sent → `media_kind` becomes the registry default for the new format if the current one is not allowed for it, otherwise it stays;
   - `media_kind` is now different and `production_mode` not sent → `production_mode` becomes the registry default for the new combination if the current one is not allowed, otherwise it stays.
9. An explicitly sent value that is not allowed returns `400 validation_error` with code `invalid_combination` on the field that broke it (`media_kind` or `production_mode`) and `details.allowed_values` listing the allowed values.

### Slot

10. `slot` takes a slot ID or `null`.
11. A slot ID must refer to a slot that belongs to the item's plan (`slot_wrong_plan`), has status `open` (`slot_not_open`), is at least 30 minutes in the future (`slot_in_past`) and has the item's resulting format (`slot_format_mismatch`). All four are `400 validation_error` on `slot`.
12. When the format changes and the item keeps a slot of the old format, the request must also send `slot` (a matching open slot or `null`). Otherwise `400 validation_error`, code `slot_format_mismatch`, with `details.open_slots` listing the open future slots of the new format in the plan (`id`, `scheduled_at`, `role`).
13. The old slot is released the same way as on cancel (E03-S04 rule 15): status `open` when its time is still in the future, otherwise `skipped`. The new slot becomes `reserved`. `slot: null` only releases.
14. When the item has no role and the new slot has one, the item takes the slot's role, unless `role` is also sent.

### Role

15. `role` takes a `Role` value or `null`. `null` is accepted only when the item has no brief in `draft` or `approved` status; otherwise `400 validation_error`, code `role_required`.

### Superseding

16. What a change invalidates:

    | Change | Briefs (`draft`, `approved`) | Scripts (`draft`, `approved`) | Item moves |
    | --- | --- | --- | --- |
    | `format` or `media_kind` | superseded | superseded | `briefed` → `selected`, `scripted` → `selected` |
    | `role` (to a different value) | superseded | superseded | `briefed` → `selected`, `scripted` → `selected` |
    | `production_mode` only | kept | superseded | `scripted` → `briefed` |
    | `slot` only | kept | kept | none |

    When several fields change, the strongest row applies. An item in `selected` stays `selected`.
17. Superseding sets `status = superseded` on the affected `Brief` and `ScriptVersion` rows. Pointers `current_brief` and `current_script` are not changed; they still show the latest version, now superseded, so the history stays visible.
18. When a change would supersede at least one brief or script in `draft` or `approved` status, the request must carry `"confirm": true`. Otherwise it returns `400 validation_error` with code `confirmation_required` on `confirm`, and `details.would_supersede` = `{"briefs": [versions], "scripts": [versions], "status_to": "selected"}`. Nothing is changed.
19. All effects of one request happen in one transaction, with row locks on the item and the slots involved. Status moves go through `pipeline.transition` with the message "Format changed from Reel to Video story" (or "Role changed from Attract to Educate", "Production mode changed from Motion to Video").
20. A `ContentEvent` of type `edited` is written with `data = {"changes": {"format": ["reel", "story"], "media_kind": ["video", "video"], "slot": [101, 205]}, "superseded": {"briefs": [1, 2], "scripts": [1]}, "released_slot": 101}` and the actor.
21. After the transaction commits, the pipeline's `advance` runs (as for every transition). For an item now in `selected` with no usable brief, E04-S03's handler writes a new brief. For an item now in `briefed`, E05-S01's handler writes a new script when `autopilot.script` is on.

### Allowed actions

22. The item detail's `allowed_actions` contains `edit_format` when rules 3–5 allow a change.

## Data

Writes `ContentItem.format`, `media_kind`, `production_mode`, `role`, `slot`, and `status` through the pipeline; `Brief.status`, `ScriptVersion.status`; `PlanSlot.status`. No new fields.

`apps/content/roles.py` is code, not a table.

## API

### `GET /api/v1/formats/` (addition)

This story adds `roles`:

```json
{
  "roles": [
    {
      "key": "attract",
      "label": "Attract",
      "purpose": "Reach people who do not follow the account yet",
      "guidance": "Lead with a broad, curiosity-driven hook. Easy to understand without context. Built to be shared or recommended.",
      "examples": ["A surprising fact about the topic", "A trend applied to the brand's field"],
      "default_metric": "reach",
      "default_metric_story": "reach"
    },
    {
      "key": "educate",
      "label": "Educate",
      "purpose": "Teach something useful enough to save",
      "guidance": "One clear lesson, steps or a checklist. Concrete and practical. Ends with something worth coming back to.",
      "examples": ["Three steps to …", "A mistake to avoid when …"],
      "default_metric": "saves",
      "default_metric_story": "saves"
    },
    {
      "key": "build_trust",
      "label": "Build trust",
      "purpose": "Show proof, results or the people behind the brand",
      "guidance": "Use real numbers, customer results or behind-the-scenes moments. Honest tone, no hard sell.",
      "examples": ["How we reduced delivery time", "A day with the support team"],
      "default_metric": "shares",
      "default_metric_story": "shares"
    },
    {
      "key": "convert",
      "label": "Convert",
      "purpose": "Move people to a concrete action",
      "guidance": "One offer or action, the reason to act now, and a clear call to action.",
      "examples": ["The winter collection is live", "Book a free consultation this week"],
      "default_metric": "shares",
      "default_metric_story": "shares"
    },
    {
      "key": "engage",
      "label": "Engage",
      "purpose": "Start a conversation with the audience",
      "guidance": "Ask a question or invite an opinion the audience can answer in a few words.",
      "examples": ["Which one would you choose?", "Tell us your best tip for …"],
      "default_metric": "comments",
      "default_metric_story": "replies"
    }
  ]
}
```

### `PATCH /api/v1/content-items/{id}/`

Permission: operator or admin.

**Example 1 — change a briefed reel to a video story in another slot.**

```json
{
  "format": "story",
  "media_kind": "video",
  "slot": 205,
  "confirm": true
}
```

Response `200`: the item detail as defined in E03-S04, plus an `effects` object that only PATCH responses carry.

```json
{
  "id": 42,
  "account": 3,
  "title": "Five-minute desk setup",
  "format": "story",
  "media_kind": "video",
  "production_mode": "motion",
  "role": "educate",
  "status": "selected",
  "hold_reason": "",
  "needs_attention": false,
  "revision_count": 0,
  "cancelled_reason": "",
  "plan": {"id": 12, "title": "Week of 28 Nov", "week_start": "2026-11-28", "week_end": "2026-12-04", "status": "active"},
  "slot": {"id": 205, "scheduled_at": "2026-11-29T06:30:00Z", "format": "story", "role": "engage", "status": "reserved"},
  "candidate": {"id": 540, "kind": "trend", "title": "Five-minute desk setup", "total_score": "77.80", "rank": 1},
  "active_job": {"id": "c1f0a2b3-4d5e-4f60-8a71-92b3c4d5e6f7", "kind": "brief.generate", "status": "queued", "progress": 0, "message": ""},
  "current_brief": {"id": 88, "version": 1, "status": "superseded", "origin": "ai", "role": "educate", "key_message": "A tidy desk takes five minutes if you follow the same four moves.", "success_metric": "saves", "created_at": "2026-11-22T09:21:40Z"},
  "current_script": null,
  "current_version": null,
  "latest_check": null,
  "open_review_task": null,
  "publication": null,
  "thumbnail_url": null,
  "allowed_actions": ["cancel"],
  "created_by": {"id": 5, "name": "Sara"},
  "created_at": "2026-11-22T09:20:11Z",
  "updated_at": "2026-11-22T10:02:15Z",
  "effects": {
    "status_from": "briefed",
    "status_to": "selected",
    "superseded": {"briefs": [1], "scripts": []},
    "released_slot": {"id": 101, "status": "open"},
    "reserved_slot": {"id": 205}
  }
}
```

The response is serialized after the transaction commits, so `advance` has already queued the new brief job: `active_job` shows it and the brief actions are absent until it finishes.

**Example 2 — change only the production mode of a scripted reel.**

```json
{"production_mode": "video", "confirm": true}
```

`effects`: `{"status_from": "scripted", "status_to": "briefed", "superseded": {"briefs": [], "scripts": [1, 2]}, "released_slot": null, "reserved_slot": null}`.

**Example 3 — set the role of a new item that has no brief yet.** No confirmation is needed.

```json
{"role": "engage"}
```

**Errors**

Confirmation missing:

```json
{
  "error": {
    "code": "validation_error",
    "message": "…",
    "fields": [{"path": "confirm", "code": "confirmation_required", "message": "…"}],
    "details": {"would_supersede": {"briefs": [1], "scripts": [], "status_to": "selected"}},
    "request_id": "3a1d0b7e-5c2f-4f0e-9a51-7f0c1e2d3b44",
    "retryable": false
  }
}
```

Format changed but the old slot was kept:

```json
{
  "error": {
    "code": "validation_error",
    "message": "…",
    "fields": [{"path": "slot", "code": "slot_format_mismatch", "message": "…"}],
    "details": {
      "open_slots": [
        {"id": 205, "scheduled_at": "2026-11-29T06:30:00Z", "role": "engage"},
        {"id": 209, "scheduled_at": "2026-12-01T06:30:00Z", "role": null}
      ]
    },
    "request_id": "8e7c4d2a-1b3f-4a6e-8d9c-0f1e2a3b4c5d",
    "retryable": false
  }
}
```

| Case | Response |
| --- | --- |
| Status is `in_production` or later | `409 invalid_transition`, `details.reason = "production_started"` |
| Status is `published` or `cancelled` | `409 invalid_transition`, `details.reason = "terminal"` |
| A job is running on the item | `409 job_in_progress`, `details.job` |
| Combination not allowed | `400 validation_error`, `invalid_combination` on `media_kind` or `production_mode`, `details.allowed_values` |
| Slot from another plan, not open, too soon, or wrong format | `400 validation_error` on `slot`: `slot_wrong_plan`, `slot_not_open`, `slot_in_past`, `slot_format_mismatch` |
| `role: null` while a brief exists | `400 validation_error`, `role_required` on `role` |
| Change would supersede without `confirm` | `400 validation_error`, `confirmation_required` on `confirm` |
| Unknown field such as `title` or `status` | `400 validation_error`, `read_only` |
| Another request reserved the slot first | `409 state_conflict`, `details.conflicts = ["slot"]` |

## Background work

None. The brief or script jobs that follow a change are started by `advance` and belong to E04-S03 and E05-S01.

## AI

None.

## Panel

### Header control

In the workspace header (E03-S04), the format tag, production mode and role tag are grouped with a small "Edit" button (pencil icon, accessible name "Edit format and role"). It is shown when `edit_format` is in `allowed_actions`; otherwise the tags show alone, with a tooltip "Format is fixed once production starts" for items past `scripted`.

### "Format and role" modal

`ModalForm`, width 640, title "Format and role".

| Field | Control | Behaviour |
| --- | --- | --- |
| Format | `Radio.Group` buttons with icons: Reel, Story, Feed post | Changing it resets media kind and production mode to the registry defaults unless still allowed |
| Media | `Segmented`: Image, Video | Shown only for Story |
| Production mode | `Radio.Group` with a description under each option, options from `modesFor(format, mediaKind)` | Hidden when only one mode is allowed (feed post, image story), with the text "Made as a design" |
| Role | `RolePicker` | |
| Slot | `Select` of the plan's open future slots of the chosen format, each labelled with `DateTime` and role, plus "No slot" | When the format changes and the current slot no longer matches, the field is marked required and pre-selects the first open slot whose role matches the item's role, else the earliest. With no open slot of that format, it shows "No open story slot this week" and defaults to "No slot", with a link "Add a slot" to the plan's Slots tab |

Under the fields, an `Alert` explains the consequence, computed in the browser from the item and the selected values (the server checks again):

| Situation | Alert |
| --- | --- |
| Format, media or role changes, item has a brief | Warning: "The brief (v{n}) and any script will be replaced. A new brief is written automatically." |
| Only production mode changes, item has a script | Warning: "The script (v{n}) will be replaced. The brief stays." |
| Only the slot changes | Info: "The item moves to {slot time}. The brief and script stay." |

Footer buttons: "Cancel" and "Save". When the alert is a warning, "Save" opens `Modal.confirm` ("Replace the brief and script?", confirm label "Replace and save") and then sends `confirm: true`. Otherwise it sends without `confirm`.

After success: message "Saved", the modal closes, the workspace reloads, and if `effects.status_to` is `selected` a second message says "Writing a new brief…". API field errors appear under the matching field. `slot_format_mismatch` replaces the slot options with `details.open_slots`. `job_in_progress` closes the modal with "Wait for the running step to finish." `409` responses reload the item.

### `RolePicker`

`src/components/RolePicker` — a vertical `Radio.Group` of five cards. Each card shows the label, the purpose, and a small line "Measured by: Saves" (story default when the format is story). The examples appear in a tooltip on an info icon. The picker accepts `allowClear` for items without a brief, which adds the option "No role yet". It reads roles from `useFormats`. E01-S02's slot form may reuse it later; in this story it is used only here.

### States

| State | Behaviour |
| --- | --- |
| Registry loading | Modal fields show a skeleton; Save disabled |
| Slots loading | Slot select shows a spinner; Save disabled until loaded |
| Plan closed | Slot select disabled with the hint "The plan is closed"; other fields still work if the status allows |

## Acceptance criteria

1. Given a `selected` reel without a brief, when I set its role to `engage`, then the role is saved, no event other than `edited` is written, and the status stays `selected`.
2. Given a `briefed` reel with an approved brief v1 in slot 101, when I change it to a video story with slot 205 and `confirm: true`, then the brief is `superseded`, the item is `selected`, slot 101 is `open`, slot 205 is `reserved`, and a brief job starts.
3. Given the same reel, when I send the change without `confirm`, then I get `confirmation_required` with `would_supersede.briefs = [1]` and nothing changes.
4. Given a `scripted` reel, when I change only the production mode to `video` with `confirm: true`, then the scripts are superseded, the brief stays approved and the item is `briefed`.
5. Given a briefed reel in a reel slot, when I change the format to `story` without sending `slot`, then I get `slot_format_mismatch` with the open story slots in `details.open_slots`.
6. Given a feed post, when I send `production_mode: "motion"`, then I get `invalid_combination` on `production_mode` with `details.allowed_values = ["design"]`.
7. Given a story changed from image to video without a production mode, then the item's production mode becomes `motion`.
8. Given an item in `in_production`, when I send any change, then I get `409 invalid_transition` with reason `production_started`.
9. Given an item with a running brief job, when I send a change, then I get `409 job_in_progress`.
10. Given a slot that another operator reserved a moment earlier, when I move my item into it, then I get `409 state_conflict` or `slot_not_open`, and my item keeps its old slot.
11. Given `GET /formats/`, then `roles` lists five roles, and `engage` has `default_metric_story` `replies`.
12. In the panel, given I switch a briefed reel to Story, then the slot field becomes required, a matching story slot is pre-selected, and the warning about replacing the brief is shown before saving.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E04-S02-BE1 | Roles module and endpoint addition | `apps/content/roles.py` with the table from rule 1, `default_metric(role, format)`; `roles` key in the `GET /formats/` serializer; unit tests | 0.25 |
| E04-S02-BE2 | PATCH serializer and validation | Field whitelist, combination filling and checks (rules 8–9), slot rules (10–14), role rule, confirmation check with `would_supersede`, status and active-job guards | 0.25 |
| E04-S02-BE3 | Change service | `content.services.item_settings.apply_changes(item, data, actor)`: locks, slot release and reserve, supersede table (rule 16), transitions through the pipeline, `edited` event, `effects`; `edit_format` in `allowed_actions` | 0.25 |
| E04-S02-BE4 | Contract and tests | `openapi.yaml` for PATCH and `roles`; API tests for every row of the error table and for criteria 2, 4 and 7; concurrency test for the slot race | 0.25 |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E04-S02-FE1 | `RolePicker` | Card radio group from `useFormats().data.roles`, metric line per format, examples tooltip, `allowClear`; component tests | 0.5 |
| E04-S02-FE2 | "Format and role" modal | Dependent fields from the registry, slot select loading the plan's open slots with pre-selection, consequence alert, confirm step, error mapping including `details.open_slots` | 0.75 |
| E04-S02-FE3 | Header integration | Edit button gated by `allowed_actions`, tooltip for locked items, reload and messages after save | 0.25 |

### Test

None beyond the tests inside each subtask.

## Test notes

- Use the fake AI provider so the brief job started by `advance` completes in tests; assert only that it was enqueued.
- Fixtures: a plan with one open reel slot, two open story slots (one with role `engage`), one open feed-post slot, and one past slot.
- A test that a closed plan still allows role changes but rejects slot changes with `slot_not_open` or `slot_in_past` as appropriate.

## Later

- Allow format changes during production by cancelling the current version and returning to `selected` in one action.
- A "swap with item" action for two reserved slots.
- Weighting the role more strongly in selection once performance data shows which roles work per slot.
