# Social Hub documentation

This folder holds the MVP plan for the Instagram workflow in `Social_Hub_Instagram_Workflow (2).pdf`.

The MVP-*.md and MVP-*.csv files in the repository root describe an earlier, wider backlog written from the Phase 1 PRD. This folder is narrower: it covers only the ten-step workflow. Where the two disagree on scope, this folder is the plan to build from.

## Start here

| Document | Read it for |
| --- | --- |
| [ROADMAP.md](ROADMAP.md) | Scope, the story list with estimates, release plan, risks, open decisions |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, backend apps, the content pipeline and its states, background work, how it scales later |
| [DATA-MODEL.md](DATA-MODEL.md) | Every table, field and enum |
| [API.md](API.md) | API conventions and the full endpoint index |
| [AI-INTEGRATION.md](AI-INTEGRATION.md) | How Claude and OpenAI are called, the task list, prompts, cost logging |
| [INSTAGRAM-INTEGRATION.md](INSTAGRAM-INTEGRATION.md) | The official Instagram API (Instagram Login): Meta app setup, OAuth and tokens, publishing, verification, metrics, the manual fallback |
| [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) | Panel layout, tokens, components, page states, navigation map |
| [openapi.yaml](openapi.yaml) | The machine-readable contract for endpoints that already exist |

## Epics

Each epic is one directory. Its `README.md` gives the goal, scope, stories and dependencies. Each story is one file with the full specification and its backend, frontend and test subtasks. [epics/README.md](epics/README.md) explains the story format and ID scheme.

| Epic | Workflow step | Directory |
| --- | --- | --- |
| E00 Foundation | Prerequisite | [epics/E00-foundation](epics/E00-foundation/README.md) |
| E01 Weekly plan | 01 | [epics/E01-weekly-plan](epics/E01-weekly-plan/README.md) |
| E02 Trend research | 02 | [epics/E02-trend-research](epics/E02-trend-research/README.md) |
| E03 Content selection | 03 | [epics/E03-content-selection](epics/E03-content-selection/README.md) |
| E04 Formats and briefs | 04 | [epics/E04-formats-and-briefs](epics/E04-formats-and-briefs/README.md) |
| E05 Script and storyboard | 05 | [epics/E05-script-and-storyboard](epics/E05-script-and-storyboard/README.md) |
| E06 Assets and copy | 06 | [epics/E06-assets-and-copy](epics/E06-assets-and-copy/README.md) |
| E07 Quality check | 07 | [epics/E07-quality-check](epics/E07-quality-check/README.md) |
| E08 Schedule and publish | 08 | [epics/E08-schedule-and-publish](epics/E08-schedule-and-publish/README.md) |
| E09 Analytics refresh | 09 | [epics/E09-analytics-refresh](epics/E09-analytics-refresh/README.md) |
| E10 Evaluate and feed back | 10 and both feedback loops | [epics/E10-evaluate-and-feedback](epics/E10-evaluate-and-feedback/README.md) |
| E11 Release | Prerequisite for going live | [epics/E11-release](epics/E11-release/README.md) |
