# E04 — Formats and briefs

Workflow step 04: **Choose formats — assign a role and brief to each Reel, Story, or feed post.**

## Goal

Every content item created by selection (E03) gets three things before anyone writes a script: a confirmed format and production mode, a role in the week, and a written brief that says what the piece must achieve. The brief is the contract for the rest of the pipeline. The script (E05), the caption (E06-S06), the copy and facts checks (E07-S03) and the evaluation (E10-S01) all read it.

This epic also owns the format registry: one code module that states, for each format, the canvas size, media limits, caption and hashtag limits, safe areas, allowed production modes and metric checkpoints. Rendering, checking, publishing and analytics read their limits from it instead of hard-coding them.

## Scope

**In the MVP**

- Format registry for `feed_post` (image), `story` (image and video) and `reel` (video), served by `GET /formats/`.
- Role definitions with their default success metric.
- Changing an item's format, media kind, production mode, role and slot before production starts, with the brief and script superseded when they no longer fit.
- AI-written briefs for one item or for every waiting item in a plan, human edits as new versions, version history, approval, and `autopilot.brief`.
- Panel: the format-and-role editor in the item workspace header, a role picker, the Brief tab of `/content/:id`, and a "Write missing briefs" action on `/content`.

**Left for later**

- Carousels, feed videos and story stickers. Each is a new registry entry plus render and publish support.
- Per-account overrides of registry values (for example a stricter hashtag limit for one brand).
- Brief templates per role or per account.
- Side-by-side diff between brief versions.
- Changing format after production has started. The item is cancelled and selected again instead.

## Stories

| ID | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E04-S01](S01-format-registry.md) | Format specification registry | Must | 1 | 0.5 | |
| [E04-S02](S02-assign-format-and-role.md) | Assign format and role | Must | 1 | 1.5 | |
| [E04-S03](S03-brief.md) | Generate, edit and approve the brief | Must | 2 | 2 | |
| | **Total** | | **4** | **4** | |

## Flow

1. Selection confirms an assignment (E03-S03). The new item has status `selected`, its format from the slot, and media kind and production mode from the registry defaults (S01). Its role comes from the slot, else from the candidate's `suggested_role`.
2. The pipeline calls `advance`. The handler for `selected`, registered by S03, starts a `brief.generate` job because the item has no usable brief.
3. The job writes brief version 1 from the candidate, its sources, the plan, the slot, the brand profile and the format rules. With `autopilot.brief` on, the brief is approved at once and the item becomes `briefed`. Otherwise the item waits with the hold reason "Brief waiting for approval".
4. The operator opens the Brief tab, reads the brief, edits it (version 2, origin `human`) or regenerates it with feedback, and approves it. The item becomes `briefed`, and `advance` hands it to script generation (E05-S01).
5. At any point before production starts, the operator can change format, media kind, production mode, role or slot from the workspace header (S02). A change that makes the brief or script wrong supersedes them and moves the item back, and step 2 runs again.

```text
          confirm (E03-S03)
                │
                ▼
  selected ──► brief.generate ──► brief v1 (draft) ──► approve ──► briefed ──► script (E05)
     ▲              ▲                    │  ▲                         │
     │              └── regenerate ──────┘  └── edit = new version    │
     │                                                                │
     └──────── format, media kind or role changed (S02) ◄─────────────┘
               production mode changed: scripted ─► briefed
```

## Owns

| Kind | Items |
| --- | --- |
| Code | `apps/content/formats.py` (registry), `apps/content/roles.py` (role definitions), `apps/content/services/briefs.py`, `apps/content/services/item_settings.py` |
| Tables | `Brief` (app `content`) — model created here; `ContentItem` fields `format`, `media_kind`, `production_mode`, `role`, `slot`, `current_brief` written here |
| Endpoints | `GET /formats/`, `PATCH /content-items/{id}/`, `POST /content-items/{id}/brief/generate/`, `POST /plans/{id}/briefs/generate/`, `GET`/`PUT /content-items/{id}/brief/`, `GET /content-items/{id}/brief/versions/`, `POST /content-items/{id}/brief/approve/` |
| Pipeline | Handler for status `selected`; transitions `selected → briefed`, `briefed → selected`, `scripted → selected`, `scripted → briefed` |
| Panel | Format-and-role modal and `RolePicker` (workspace header), Brief tab, "Write missing briefs" on `/content`, `useFormats` hook |
| Background tasks | `content.tasks.generate_brief` (Celery name `brief.generate`); `job_finished` receiver `content.receivers.update_batch_parent` |
| Job kinds | `brief.generate`, `brief.generate_batch` |
| AI tasks | `brief.generate` |
| Settings | `SOCIALHUB_MAX_HASHTAGS` |

## Depends on / needed by

| Depends on | For |
| --- | --- |
| E00-S03 | `BrandProfile`, `InstagramAccount.autopilot`, `content_language` |
| E00-S05 | AI gateway for `brief.generate` |
| E00-S06 | `JobRun`, `JobButton`, `JobProgress` |
| E01-S01, E01-S02 | Plan objective, audience, goals, success metrics; slots |
| E03-S02 | `Candidate` with `sources`, `rationale`, `suggested_role` |
| E03-S03 | Items created with registry defaults |
| E03-S04 | `ContentItem`, `ContentEvent`, the pipeline service, `allowed_actions`, the workspace shell |

| Needed by | For |
| --- | --- |
| E03-S03 | Registry defaults for media kind and production mode |
| E05-S01, E05-S02 | Approved brief; registry module where `script_rules` and `frame_templates` are added |
| E06-S02, E06-S03, E06-S06, E06-S07 | Canvas sizes, layouts, safe areas, media and copy limits; the brief for copy |
| E07-S02, E07-S03, E07-S04 | Format limits; brief references for the facts check |
| E08-S01, E08-S05 | Daily-limit group per format; caption limit |
| E09-S03, E09-S04 | Metric and evaluation checkpoints per format |
| E10-S01 | Evaluation checkpoints; brief `success_metric` and role defaults |

## Done when

1. `GET /formats/` returns the four format specifications, and E06, E07 and E08 code reads every limit from `content.formats` (a test fails if a size or limit literal appears outside the registry).
2. A newly selected item gets brief version 1 without anyone pressing a button; with `autopilot.brief` on it reaches `briefed` on its own.
3. An operator can edit the brief, regenerate it with feedback, see every version, and approve the latest; stale edits are refused with `409 version_conflict`.
4. "Write missing briefs" writes briefs for every waiting item of a plan in one job and reports per item.
5. Changing a briefed item from a reel to a story supersedes its brief and script, frees the old slot, reserves a story slot and writes a new brief.

## Later

- New formats: one `FormatSpec` entry, plus a render layout (E06), publish method (E08) and checkpoints. Nothing in E04's services changes.
- Account-level overrides: wrap `get_spec` so it merges account settings over the defaults; callers already go through it.
- Brief quality checks before approval (for example "no references") can become blocking rules in `validate_brief`.
- A `brief.generate` variant per role, once there is evidence that one prompt does not fit all roles.
