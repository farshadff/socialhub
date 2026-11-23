# Epics and stories

One directory per epic. Each directory has a `README.md` for the epic and one file per story. A story file contains the complete specification and its subtasks, so a developer can build from that one file plus the shared references.

The story details preserve upstream product requirements, but the implemented panel uses Umi Max 4, Ant Design 6 and Pro Components as documented in [ARCHITECTURE.md](../ARCHITECTURE.md) and [frontend/AGENTS.md](../../frontend/AGENTS.md). If a story names Refine or Vite-specific paths, keep its product behavior and follow the current stack for implementation.

## IDs

| Kind | Pattern | Example |
| --- | --- | --- |
| Epic | `E` + two digits | `E06` |
| Story | epic + `-S` + two digits | `E06-S02` |
| Subtask | story + `-BE`, `-FE` or `-QA` + number | `E06-S02-BE3` |

Story files are named `S02-short-name.md`. IDs never change once work has started; a dropped story keeps its number.

## Shared references

Stories do not repeat these; they link to them.

- Tables, fields and enums: [DATA-MODEL.md](../DATA-MODEL.md)
- API rules, error codes and the endpoint index: [API.md](../API.md)
- Pipeline statuses, apps, background work: [ARCHITECTURE.md](../ARCHITECTURE.md)
- AI gateway and task registry: [AI-INTEGRATION.md](../AI-INTEGRATION.md)
- Instagram provider interface: [INSTAGRAM-INTEGRATION.md](../INSTAGRAM-INTEGRATION.md)
- Panel layout, components, status colours, page states: [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md)

## Epic README format

1. **Goal** — the workflow step and the outcome in two or three sentences.
2. **Scope** — in the MVP, and left for later.
3. **Stories** — table with ID, title, priority, BE/FE/QA days (matching [ROADMAP.md](../ROADMAP.md)).
4. **Flow** — how the stories fit together, as a short numbered walk-through or diagram.
5. **Owns** — tables, endpoints, panel pages, background tasks, AI tasks.
6. **Depends on / needed by** — other stories.
7. **Done when** — the epic-level acceptance check.
8. **Later** — extension points.

## Story file format

```markdown
# E00-S00 — Title

| | |
| --- | --- |
| Epic | E00 Name |
| Priority | Must, Should or Phase 2 |
| Estimate | BE n d · FE n d · QA n d |
| Depends on | story IDs |
| Needed by | story IDs |

## User story
As a <role>, I want <capability>, so that <outcome>.

## Context
Why this exists, where it sits in the workflow, what the user already has when they arrive.

## Scope
**In:** bullet list. **Out (later):** bullet list.

## Behaviour and rules
Numbered business rules. Each is testable. Include defaults, limits, validation and status transitions.

## Data
Tables and fields used, by reference to DATA-MODEL.md. New fields are listed here and added there.

## API
For each endpoint: method and path, permission, request example, response example,
validation, error cases with codes. JSON examples are complete and realistic.

## Background work
Tasks, queues, schedules, idempotency, retries. "None" if there is none.

## AI
Task key, inputs, output schema, effort, failure handling. "None" if there is none.

## Panel
Route, layout, components, fields, actions, every state (loading, empty, error, job running), copy for
buttons and messages.

## Acceptance criteria
Numbered Given/When/Then statements a tester can run.

## Subtasks
### Backend
| ID | Task | Detail | Est. |
### Frontend
| ID | Task | Detail | Est. |
### Test
| ID | Task | Detail | Est. |

## Test notes
Unit, API and panel tests that must exist; fixtures; the fake-provider scenarios used.

## Later
What this story leaves out and where the seam is.
```

Rules for writing stories:

- Subtask estimates add up to the story estimate in ROADMAP.md.
- A Phase 2 story (Instagram API work, see ROADMAP.md section 0) has Priority `Phase 2` and a one-line quote directly under its title saying it is not built in Phase 1 and what Phase 1 does instead. Phase 1 stories never depend on Phase 2 stories; where they would, they list the Phase 2 addition under "Later".
- Each subtask is small enough to finish in a day or less and names the files or modules it touches.
- Tests are part of each subtask. Separate test subtasks exist only for cross-story or end-to-end checks.
- Sections that do not apply say "None" in one line; they are not removed.
