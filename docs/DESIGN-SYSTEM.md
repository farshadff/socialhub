# Panel design system

The panel in `frontend/` is built on [Refine](https://refine.dev) with its Ant Design package (`@refinedev/antd`, Ant Design 5). Refine provides the data layer, routing, layout and CRUD page views; Ant Design provides the components. This page fixes the small set of rules that keep every screen consistent. It is deliberately short: use Refine and Ant Design as they come, and add nothing custom unless this page says so. Ant Design Pro and Pro Components are not used.

Two separate things carry a visual identity:

- **The panel** uses Social Hub's own identity, described here.
- **Published content** uses each Instagram account's brand profile (logo, colours, fonts), applied by the render templates in E06-S02. The panel's tokens never leak into rendered assets.

The page describes the **Phase 1** panel ([ROADMAP.md](ROADMAP.md) section 0): no Instagram connection, posting by hand, metrics typed in. Statuses, tabs and components marked **(Phase 2)** belong to the Instagram API phase and are not built in Phase 1.

## 1. Identity

| Item | Rule |
| --- | --- |
| Product name | "Social Hub", two words, both capitalised |
| Logo | `frontend/public/socialhub.svg`. Used in the sidebar header, the login page and the browser tab. Do not recolour, stretch or redraw it. Minimum size 24 px; keep clear space of a quarter of its width around it. |
| Browser tab title | "{Page title} · Social Hub" |
| Footer | "Social Hub {release}" for admins, "Social Hub" for operators |
| Language and direction | English, left-to-right. Content previews (captions, scripts, rendered frames) follow the account's `content_language` and are wrapped with `dir="auto"` so Persian text displays right-to-left inside the English panel. |

## 2. Tokens

All colours, spacing and type come from Ant Design theme tokens, set once in `frontend/src/theme.ts` and passed to the Ant Design `ConfigProvider` that wraps `<Refine>` (`src/contexts/color-mode.tsx`). Refine's `ThemedLayout` reads the same tokens. Components never contain a literal colour, font or pixel radius; when they need one they read it with `theme.useToken()`.

| Token | Value | Use |
| --- | --- | --- |
| `colorPrimary` | `#1677ff` | Primary buttons, links, active navigation. Matches the logo. |
| `colorSuccess` | Ant Design default | Pass, published; (Phase 2) connected |
| `colorWarning` | Ant Design default | Revise, needs attention, waiting for a person |
| `colorError` | Ant Design default | Escalate, failed, overdue; (Phase 2) blocked |
| `colorInfo` | Ant Design default | In progress, scheduled |
| `borderRadius` | 8 | All surfaces |
| `fontFamily` | Ant Design default system stack, with `Vazirmatn` appended for Persian glyphs | Everything |
| Base font size | 14 | Body; headings use Ant Design's type scale |
| Spacing | Ant Design 8 px grid (`marginXS` 8, `marginSM` 12, `margin` 16, `marginLG` 24) | All gaps and padding |

Light theme is the default. The top bar's dark theme switch swaps the Ant Design algorithm (`darkAlgorithm`) and keeps working because everything uses tokens. The choice is stored in local storage under `socialhub.colorMode`.

`Vazirmatn` is bundled in `frontend/public/fonts/` (it is open source under the SIL Open Font License). No font is loaded from a CDN.

## 3. Status colours

One mapping for the whole panel, implemented once in `src/components/StatusTag` as `<StatusTag kind="item" value="in_review" />`. A status is always shown as a tag with text; colour alone never carries meaning. New kinds and values are added here first, then to the component.

Kinds: `item`, `plan`, `slot`, `candidate`, `topic`, `job`, `qc`, `review`, `publication`, `verdict`, `goal`, `account`, `research_run`, `research_source`, `feed_item`, `feed_source`, `brief`, `script`, `rights`, `clip`, `report`, `finding`, `carried_finding`, `repurpose`, `ai_run`, `system`, `metrics`, `checkpoint`. (Phase 2: `attempt`, `connection`, `publishing`.)

Phase 1 values:

| Meaning | Tag colour | Statuses |
| --- | --- | --- |
| Not started / neutral | default (grey) | item `selected`, `cancelled`; plan `draft`, `closed`; slot `open`, `skipped`; candidate `candidate`, `rejected`; topic `new`, `dismissed`; feed item `new`, `ignored`; feed source and research source `empty`; account `archived`; brief and script `superseded`; publication `cancelled`; review task `resolved`; verdict `on_par`, `insufficient_data` ("Not enough data"); goal `no_goal`, `not_measured`; report `draft`; carried finding `ignored`; repurpose task `dismissed`; metrics Incomplete; checkpoint Skipped, Upcoming; system `unknown` |
| In progress | processing (blue) | item `briefed`, `scripted`, `in_production`, `in_check`; job `queued`, `running`; research run `running`; repurpose task `in_selection` |
| Waiting for a person | warning (orange) | item `needs_revision`, `in_review`; review task `open`; brief and script `draft` ("Waiting for approval"); QC `revise`; publication flag "Post by hand — due"; rights `unknown`; clip "Needs clip", `padded`; goal `missed` at a non-final checkpoint ("Goal not met yet"); carried finding `pending`; ai_run `refused`; metrics "Metrics to enter"; checkpoint "Due for entry" |
| Ready / scheduled | cyan | item `approved`, `scheduled`; slot `reserved`, `scheduled`; publication `scheduled` ("Scheduled"); candidate `proposed`; topic `shortlisted`; feed item `eligible`; repurpose task `open` |
| Done / good | success (green) | item `published`; plan `active`; slot `published`; candidate `selected`; topic `used`; feed item `used`; feed source and research source `ok`; research run `completed`; account `active`; brief and script `approved`; QC `pass`; publication `published`; rights `cleared`; clip `ok` ("Ready"); verdict `outperforming`; goal `met`; report `accepted`; carried finding `applied`; repurpose task `used`; ai_run `ok`; system `ok`; metrics Complete; checkpoint Captured |
| Problem | error (red) | job `failed`; research run `failed`; feed source and research source `error:*`; QC `escalate`; publication flag "Post by hand — overdue"; rights `restricted`, `expired`; clip "Too short"; verdict `underperforming`; goal `missed` at the final checkpoint; ai_run `error`; system `unavailable` |

The publication flags come from the publication's `due_state` (E08-S05): "Post by hand — due" for `due` (`scheduled_at` has passed and it is not published), "Post by hand — overdue" for `overdue` (`SOCIALHUB_MANUAL_POST_OVERDUE_MINUTES` more have passed); no flag while `upcoming`. A flag is not a status: the publication stays `scheduled` until it is marked published, rescheduled or cancelled. "Metrics to enter" and "Due for entry" come from E09-S04.

Phase 2 values, added to the same rows when the Instagram API arrives:

| Meaning | Tag colour | Statuses |
| --- | --- | --- |
| Not started / neutral | default (grey) | connection `disconnected` |
| In progress | processing (blue) | item `publishing`; publication `publishing`, `verifying` ("Verifying"); attempt running; metrics Collecting; checkpoint Due |
| Waiting for a person | warning (orange) | connection `expiring`, `needs_attention`; attempt `retryable_error`, `ambiguous`; publication flag "Retry n of 3"; metrics Overdue, Needs manual entry; checkpoint Overdue |
| Done / good | success (green) | publishing `on` ("Publishing on"); connection `connected`; attempt `success`, `verified_live` |
| Problem | error (red) | item `failed`; publishing `off` ("Publishing off", everywhere, including the Accounts table); publication `failed`; publication flags "Publishing off", "Connection problem", "Daily limit"; attempt `fatal_error` |

Tags that are not statuses:

| Tag group | Colours |
| --- | --- |
| Check finding severity | `blocker` red, `major` orange, `minor` blue, `info` grey |
| Attention severity (overview) | `high` red, `medium` orange, `low` grey |
| Weekly report finding type | Worked green, Did not work red, Insight blue |
| Render warnings (`FrameWarning`) | Orange |
| "Provisional" | Default |
| "Post by hand" (not yet due) (Phase 2; in Phase 1 every publication is posted by hand, so "Scheduled" is enough) | Default |
| Category tags: candidate kind, format, role | Default tag with an icon; no colour presets |

Display labels are sentence case with spaces ("In production", "Needs revision"). The label map lives next to `StatusTag` and also covers review task reasons ("Check escalated", "Revision limit reached", "No slot available", "Raised by hand"; Phase 2: "Publishing failed") and decisions ("Approve", "Request changes", "Reject").

Other colour uses go through tokens: an attention border on a board card uses `colorWarning`; a counter over its limit uses `colorError`.

## 4. Layout

- Refine's `ThemedLayout` from `@refinedev/antd`: fixed left sidebar (`ThemedSider`, collapsible) with the logo and name at its top (`Title`), a sticky top bar (`Header`), and the page in the content area. The sidebar items are Refine `resources`.
- **Top bar, left to right:** account switcher, spacer, attention count, user menu (the logo and name sit at the top of the sidebar, directly left of the top bar). (Phase 2: a publishing switch indicator for the current account sits before the attention count: green "Publishing on" or red "Publishing off", linking to `/settings/accounts/{id}?tab=automation`.)
- **Account switcher:** a select listing active accounts by handle. The choice is stored in local storage under `socialhub.currentAccountId` and sent as the `account` query parameter of every API call. Pages that are not account-scoped (Settings → System) ignore it.
- **Page frame:** every page is a `PageFrame` (`src/components/page-frame.tsx`) with a title, an optional one-line description and its primary action on the right. It renders the same header as Refine's CRUD views. A page that is only a full-page create or edit form uses Refine's `Create` or `Edit` instead, which adds the save button and the unsaved-changes warning. Content sits in Ant Design `Card`s.
- **Width:** fluid. Tables scroll horizontally below 1200 px. The panel is a desktop tool; it must remain usable at 1280 × 720 and need not be designed for phones.

## 5. Navigation map

| Sidebar item | Icon | Route | Page | Story |
| --- | --- | --- | --- | --- |
| Overview | `dashboard` | `/overview` | This week at a glance, attention list | E11-S01 |
| Weekly plan | `schedule` | `/plans`, `/plans/:planId` | Plan list; plan editor with tabs Plan, Slots | E01 |
| Research | `radarChart` | `/research` | Tabs: Topics, Signals, Sources, Runs | E02 |
| Selection | `filter` | `/selection` | Tabs: Candidates (with a Repurpose tasks section, E10-S04), Proposal, Feed items, Feed sources | E03 |
| Content | `appstore` | `/content`, `/content/:id` | Pipeline list and board; item workspace with tabs Brief, Script, Production, Checks, Publishing, Performance, History | E03-S04 and the tab's own epic |
| Review | `audit` | `/review`, `/review/:taskId` | Human review queue and task page; the sidebar item shows the open-task count | E07-S06 |
| Calendar | `calendar` | `/calendar` | Week calendar of slots and publications | E08-S02 |
| Analytics (group) | `lineChart` | `/analytics/posts`, `/analytics/posts/:publicationId`, `/analytics/account` | Post metrics, post detail, followers | E09-S03 |
| Reports | `fileText` | `/reports`, `/reports/:id` | Weekly reports | E10-S02 |
| Library | `picture` | `/library` | Asset library | E06-S01 |
| Settings (group) | `setting` | `/settings/accounts`, `/settings/accounts/:id`, `/settings/system` | Accounts (tabs: Profile, Brand, Automation; Phase 2 adds Connection between Brand and Automation), system (admin; tabs: Status, AI calls, Jobs) | E00 |
| — | — | `/user/login` | Sign in | E00-S01 |

The sidebar order follows the workflow, top to bottom. `/` redirects to `/overview`, the default page after sign-in. Detail routes are hidden from the menu, and the 403, 404 and 500 pages stay off it. Each sidebar item is a Refine resource in `src/App.tsx` (`meta.label`, `meta.icon`, `meta.parent` for groups, `meta.hide` for detail routes); its routes are React Router routes inside `ThemedLayout`.

Query parameters that link into a page:

| Page | Parameters |
| --- | --- |
| Item workspace | `/content/:id?tab=brief\|script\|production\|checks\|publishing\|performance\|history` |
| Content list | `/content?plan=&status=` and the other list filters, mirrored to the query string; a List / Board toggle |
| Account settings | `/settings/accounts/:id?tab=profile\|brand\|automation`. (Phase 2: `tab=connection`; after Instagram sign-in, `?tab=connection&connect=success` or `&connect=error&code=`) |
| Plans | `/plans?create=1`; `/plans/:planId?tab=plan\|slots`; `/plans/:planId?findings=1` |
| Research | `/research?plan=&tab=topics\|signals\|sources\|runs` |
| Selection | `/selection?plan=&tab=candidates\|proposal\|feed-items\|feed-sources` |
| Calendar | `/calendar?focus={publicationId}` |

(Phase 2) The Connection tab has no password or verification-code form. An admin connects an account with the button "Connect with Instagram", which opens Instagram's own sign-in and approval page; the OAuth callback then returns the browser to the tab with the `connect` parameters above. The tab confirms success with `message` and shows a failure as a `notification` with the error text for `code`.

## 6. Components to use

| Need | Component | Rule |
| --- | --- | --- |
| Data access | Refine data hooks through the Social Hub data provider (`src/providers/data-provider.ts`) | `useTable`, `useList`, `useOne`, `useForm`, `useCustom`, `useCustomMutation`, `useInvalidate`. Pages never call `fetch` |
| Lists | Ant Design `Table` driven by Refine `useTable` (`tableProps`) | Server-side paging, sorting and filters; the filter form above the table uses `searchFormProps`, and filters are mirrored to the query string (`syncWithLocation`) |
| Inline-edited rows (goals, slot template, shots) | Ant Design `Table` with `Form` rows driven by Refine `useEditableTable` | |
| Forms | Ant Design `Form` driven by Refine `useForm` (page), `useModalForm` (`Modal`) or `useDrawerForm` (`Drawer`) | Short creates in a modal; long edits on a page; visible labels; the data provider turns the API's `fields` into Refine validation errors, so they appear under the field |
| Detail pages | `PageFrame` + Ant Design `Card` + `Descriptions` | |
| Buttons for records | Refine `CreateButton`, `EditButton`, `ShowButton`, `DeleteButton`, `RefreshButton` | They respect `accessControlProvider` and hide for operators when an action is admin-only |
| Status | `StatusTag` (section 3) | |
| Long actions | `JobButton` and `JobProgress` (built in E00-S06) | A button that starts a job, shows progress, and refreshes data when the job ends |
| Confirmation | `Popconfirm` for reversible actions, `Modal.confirm` naming the object for destructive or outward-facing ones (cancel; Phase 2: publish now, disconnect) | |
| Feedback | `message` for success, `notification` for failures that need reading | Refine mutations notify through `useNotificationProvider` from `@refinedev/antd`; pass `successNotification` / `errorNotification` to set the text |
| Charts | `@ant-design/plots` (added with the first chart, E09-S03) | Line for series over time, column for comparisons; always with axis titles and a table view toggle |
| Media preview | `MediaPreview` (built in E06-S07) | Shows image or video in the format's aspect ratio with a safe-area overlay toggle |
| Content text | `ContentText` (built in E00-S02) | Wraps captions and script text with `dir="auto"` and the content font |
| Dates | `DateTime` (built in E00-S02) | Shows account-timezone time with the UTC value in a tooltip |

Shared components built by stories. Use them instead of building a second version:

| Component | Built in | Rule |
| --- | --- | --- |
| `AccountSwitcher`, `AccountGate`, `AttentionBadge` | E00-S02 | Top bar and the "no account selected" state |
| `PageError`, `OfflineBanner`, `PlaceholderPage`, `TabPlaceholder` | E00-S02 | Backs the Error state in section 7 |
| `errorText`, `applyFieldErrors` | E00-S02 | English text for an error `code`; API field errors onto a form |
| `useJob` hook | E00-S06 | Used by `JobButton` and `JobProgress` |
| `AssetUploader` | E06-S01 | Multi-file dropzone with one shared rights form |
| `AssetPicker` | E06-S01 | Tabs "This item" and "Library"; confirms before picking a restricted or expired asset |
| `RightsTag` | E06-S01 | Built on `StatusTag`; tooltip shows the licence note and expiry |
| `TemplateSelect`, `FrameWarning` | E06-S02 | `FrameWarning` maps warning codes to orange tags |
| Publication actions | E08-S02 | Buttons driven by `allowed_actions` |
| `PostingPackCard`, `MarkPublishedModal` | E08-S05 | The posting pack (download the asset and cover, copy the caption) and "Mark as published" with the post link |
| `AttemptsTimeline` (Phase 2) | E08-S03 | |
| `EvaluationCard` | E10-S01 | |

## 7. States every page handles

| State | What the user sees |
| --- | --- |
| Loading | Skeleton in the card or table, not a full-page spinner |
| Empty | `Empty` with one sentence saying what belongs here and one action that creates it |
| Error | Inline `Result` with the error text for the `code` and a Retry button; `request_id` shown small for support |
| No account selected | A prompt to pick or create an account |
| Not allowed | The action is hidden for operators when it is admin-only; direct navigation shows the 403 page |
| Job running | Affected actions are disabled with a tooltip saying what is running |
| Stale after conflict | On `409`, a message says the data changed and the page reloads the resource |
| API restarting | A non-JSON `502` or `503`: "Social Hub is restarting. Try again in a moment." `GET` requests are retried once after 2 seconds |

## 8. Writing in the panel

- Sentence case for titles, buttons and labels. Buttons start with a verb and say what happens: "Run research", "Approve brief", "Mark as published".
- Name things the way this documentation does: plan, slot, signal, topic, candidate, item, brief, script, version, check, review task, publication.
- Error text says what happened and what to do next. No codes in the main text.
- Numbers use thousands separators. Metrics show their age: "Reach 4,210 at 24 h".

## 9. Accessibility

- Every control is reachable and usable by keyboard; focus is visible.
- Form fields have labels; icons that act as buttons have an accessible name.
- Text contrast meets WCAG AA (4.5:1) in both themes. Ant Design's default tokens do; check any token that is changed.
- Media previews have a text alternative: the caption or the frame's text.
