# Panel design system

The panel is built on the Ant Design Pro scaffold in `frontend/`. This page fixes the small set of rules that keep every screen consistent. It is deliberately short: use Ant Design and Pro Components as they come, and add nothing custom unless this page says so.

Two separate things carry a visual identity:

- **The panel** uses Social Hub's own identity, described here.
- **Published content** uses each Instagram account's brand profile (logo, colours, fonts), applied by the render templates in E06-S02. The panel's tokens never leak into rendered assets.

## 1. Identity

| Item | Rule |
| --- | --- |
| Product name | "Social Hub", two words, both capitalised |
| Logo | `frontend/public/socialhub.svg`. Used in the sidebar header, the login page and the browser tab. Do not recolour, stretch or redraw it. Minimum size 24 px; keep clear space of a quarter of its width around it. |
| Browser tab title | "{Page title} · Social Hub" |
| Footer | "Social Hub {release}" for admins, "Social Hub" for operators |
| Language and direction | English, left-to-right. Content previews (captions, scripts, rendered frames) follow the account's `content_language` and are wrapped with `dir="auto"` so Persian text displays right-to-left inside the English panel. |

## 2. Tokens

All colours, spacing and type come from Ant Design theme tokens, set once in `frontend/config/theme.ts` and passed to the Ant Design `ConfigProvider` and Pro layout. Components never contain a literal colour, font or pixel radius.

| Token | Value | Use |
| --- | --- | --- |
| `colorPrimary` | `#1677ff` | Primary buttons, links, active navigation. Matches the logo. |
| `colorSuccess` | Ant Design default | Pass, published, connected |
| `colorWarning` | Ant Design default | Revise, needs attention, waiting for a person |
| `colorError` | Ant Design default | Escalate, failed, blocked |
| `colorInfo` | Ant Design default | In progress, scheduled |
| `borderRadius` | 8 | All surfaces |
| `fontFamily` | Ant Design default system stack, with `Vazirmatn` appended for Persian glyphs | Everything |
| Base font size | 14 | Body; headings use Ant Design's type scale |
| Spacing | Ant Design 8 px grid (`marginXS` 8, `marginSM` 12, `margin` 16, `marginLG` 24) | All gaps and padding |

Light theme is the default. The scaffold's dark theme switch keeps working because everything uses tokens.

`Vazirmatn` is bundled in `frontend/public/fonts/` (it is open source under the SIL Open Font License). No font is loaded from a CDN.

## 3. Status colours

One mapping for the whole panel, implemented once in `src/components/StatusTag` as `<StatusTag kind="item" value="in_review" />`. A status is always shown as a tag with text; colour alone never carries meaning. New kinds and values are added here first, then to the component.

Kinds: `item`, `plan`, `slot`, `candidate`, `topic`, `job`, `qc`, `review`, `publication`, `attempt`, `connection`, `verdict`, `goal`, `account`, `publishing`, `research_run`, `research_source`, `feed_item`, `feed_source`, `brief`, `script`, `rights`, `clip`, `report`, `finding`, `carried_finding`, `repurpose`, `ai_run`, `system`, `metrics`, `checkpoint`.

| Meaning | Tag colour | Statuses |
| --- | --- | --- |
| Not started / neutral | default (grey) | item `selected`, `cancelled`; plan `draft`, `closed`; slot `open`, `skipped`; candidate `candidate`, `rejected`; topic `new`, `dismissed`; feed item `new`, `ignored`; feed source and research source `empty`; account `archived`; connection `disconnected`; brief and script `superseded`; publication `cancelled`; review task `resolved`; verdict `on_par`, `insufficient_data` ("Not enough data"); goal `no_goal`, `not_measured`; report `draft`; carried finding `ignored`; repurpose task `dismissed`; metrics Incomplete; checkpoint Skipped, Upcoming; system `unknown` |
| In progress | processing (blue) | item `briefed`, `scripted`, `in_production`, `in_check`, `publishing`; job `queued`, `running`; research run `running`; publication `publishing`, `verifying` ("Verifying"); attempt running; repurpose task `in_selection`; metrics Collecting; checkpoint Due |
| Waiting for a person | warning (orange) | item `needs_revision`, `in_review`; review task `open`; brief and script `draft` ("Waiting for approval"); connection `expiring`, `needs_attention`; QC `revise`; attempt `retryable_error`, `ambiguous`; publication flag "Retry n of 3", "Post by hand — due"; rights `unknown`; clip "Needs clip", `padded`; goal `missed` at a non-final checkpoint ("Goal not met yet"); carried finding `pending`; ai_run `refused`; metrics Overdue, Needs manual entry; checkpoint Overdue |
| Ready / scheduled | cyan | item `approved`, `scheduled`; slot `reserved`, `scheduled`; publication `scheduled`; candidate `proposed`; topic `shortlisted`; feed item `eligible`; repurpose task `open` |
| Done / good | success (green) | item `published`; plan `active`; slot `published`; candidate `selected`; topic `used`; feed item `used`; feed source and research source `ok`; research run `completed`; account `active`; publishing `on` ("Publishing on"); connection `connected`; brief and script `approved`; QC `pass`; publication `published`; attempt `success`, `verified_live`; rights `cleared`; clip `ok` ("Ready"); verdict `outperforming`; goal `met`; report `accepted`; carried finding `applied`; repurpose task `used`; ai_run `ok`; system `ok`; metrics Complete; checkpoint Captured |
| Problem | error (red) | item `failed`; job `failed`; research run `failed`; feed source and research source `error:*`; publishing `off` ("Publishing off", everywhere, including the Accounts table); QC `escalate`; publication `failed`; publication flags "Publishing off", "Connection problem", "Daily limit"; attempt `fatal_error`; rights `restricted`, `expired`; clip "Too short"; verdict `underperforming`; goal `missed` at the final checkpoint; ai_run `error`; system `unavailable` |

Tags that are not statuses:

| Tag group | Colours |
| --- | --- |
| Check finding severity | `blocker` red, `major` orange, `minor` blue, `info` grey |
| Attention severity (overview) | `high` red, `medium` orange, `low` grey |
| Weekly report finding type | Worked green, Did not work red, Insight blue |
| Render warnings (`FrameWarning`) | Orange |
| "Post by hand" (not yet due) and "Provisional" | Default |
| Category tags: candidate kind, format, role | Default tag with an icon; no colour presets |

Display labels are sentence case with spaces ("In production", "Needs revision"). The label map lives next to `StatusTag` and also covers review task reasons ("Check escalated", "Revision limit reached", "Publishing failed", "No slot available", "Raised by hand") and decisions ("Approve", "Request changes", "Reject").

Other colour uses go through tokens: an attention border on a board card uses `colorWarning`; a counter over its limit uses `colorError`.

## 4. Layout

- Pro layout in `mix` mode: top bar plus left sidebar, as the scaffold has it.
- **Top bar, left to right:** logo and name, account switcher, spacer, publishing switch indicator for the current account (green "Publishing on" or red "Publishing off", linking to `/settings/accounts/{id}?tab=automation`), attention count, user menu.
- **Account switcher:** a select listing active accounts by handle. The choice is stored in local storage under `socialhub.currentAccountId` and sent as the `account` query parameter of every API call. Pages that are not account-scoped (Settings → System) ignore it.
- **Page frame:** every page is a `PageContainer` with a title, an optional one-line description and its primary action on the right. Content sits in `ProCard`s.
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
| Settings (group) | `setting` | `/settings/accounts`, `/settings/accounts/:id`, `/settings/system` | Accounts (tabs: Profile, Brand, Connection, Automation), system (admin; tabs: Status, AI calls, Jobs) | E00 |
| — | — | `/user/login` | Sign in | E00-S01 |

The sidebar order follows the workflow, top to bottom. `/` redirects to `/overview`, the default page after sign-in. Detail routes are hidden from the menu, and the 403, 404 and 500 pages stay off it. The scaffold's demo pages and routes are removed in E00-S02.

Query parameters that link into a page:

| Page | Parameters |
| --- | --- |
| Item workspace | `/content/:id?tab=brief\|script\|production\|checks\|publishing\|performance\|history` |
| Content list | `/content?plan=&status=` and the other list filters, mirrored to the query string; a List / Board toggle |
| Account settings | `/settings/accounts/:id?tab=profile\|brand\|connection\|automation`; after Instagram sign-in, `?tab=connection&connect=success` or `&connect=error&code=` |
| Plans | `/plans?create=1`; `/plans/:planId?tab=plan\|slots`; `/plans/:planId?findings=1` |
| Research | `/research?plan=&tab=topics\|signals\|sources\|runs` |
| Selection | `/selection?plan=&tab=candidates\|proposal\|feed-items\|feed-sources` |
| Calendar | `/calendar?focus={publicationId}` |

The Connection tab has no password or verification-code form. An admin connects an account with the button "Connect with Instagram", which opens Instagram's own sign-in and approval page; the OAuth callback then returns the browser to the tab with the `connect` parameters above. The tab confirms success with `message` and shows a failure as a `notification` with the error text for `code`.

## 6. Components to use

| Need | Component | Rule |
| --- | --- | --- |
| Lists | `ProTable` | Server-side paging, filters in the table's search form, column settings off |
| Inline-edited rows (goals, slot template, shots) | `EditableProTable` | |
| Forms | `ProForm`, `ModalForm`, `DrawerForm` | Short creates in a modal; long edits on a page; visible labels; field errors under the field from the API's `fields` |
| Detail pages | `PageContainer` + `ProCard` + `ProDescriptions` | |
| Status | `StatusTag` (section 3) | |
| Long actions | `JobButton` and `JobProgress` (built in E00-S06) | A button that starts a job, shows progress, and refreshes data when the job ends |
| Confirmation | `Popconfirm` for reversible actions, `Modal.confirm` naming the object for destructive or outward-facing ones (publish now, cancel, disconnect) | |
| Feedback | `message` for success, `notification` for failures that need reading | |
| Charts | `@ant-design/plots` (already installed) | Line for series over time, column for comparisons; always with axis titles and a table view toggle |
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
| `AttemptsTimeline` | E08-S03 | |
| Publication actions | E08-S02 | Buttons driven by `allowed_actions` |
| `PostByHandCard`, `MarkPublishedModal` | E08-S04 | |
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

- Sentence case for titles, buttons and labels. Buttons start with a verb and say what happens: "Run research", "Approve brief", "Publish now".
- Name things the way this documentation does: plan, slot, signal, topic, candidate, item, brief, script, version, check, review task, publication.
- Error text says what happened and what to do next. No codes in the main text.
- Numbers use thousands separators. Metrics show their age: "Reach 4,210 at 24 h".

## 9. Accessibility

- Every control is reachable and usable by keyboard; focus is visible.
- Form fields have labels; icons that act as buttons have an accessible name.
- Text contrast meets WCAG AA (4.5:1) in both themes. Ant Design's default tokens do; check any token that is changed.
- Media previews have a text alternative: the caption or the frame's text.
