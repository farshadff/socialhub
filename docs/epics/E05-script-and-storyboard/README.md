# E05 — Script and storyboard

## Goal

Workflow step 05: "Script & storyboard — write the scenario, shot list, frame sequence, and design notes." For every item with an approved brief, the system writes one script package that production (E06) can render without further interpretation. The operator can read it, change it in a storyboard editor, ask for a rewrite with feedback, and approve it. Approval moves the item to `scripted` and production starts.

## Scope

**In the MVP**

- One AI task, `script.generate`, that returns the whole package in one call: scenario, hook, shots, frames, design notes, call to action, music hint.
- Server-side rules that guarantee a package fits the item's format and the render templates: frame counts, durations, text lengths, index integrity.
- One automatic repair call when the AI output breaks a rule.
- A storyboard editor on the Script tab of the item workspace.
- Immutable versions: every edit or regeneration is a new `ScriptVersion`.
- Approval by a person, or automatically when `autopilot.script` is on.
- Regeneration with feedback, a version list, a read-only view of old versions, and restoring an old version as a new one.
- A service entry point the revise loop (E07-S05) calls to rewrite a script from check findings.

**Left for later**

- Rendered previews inside the editor (the Production tab shows real renders).
- Side-by-side comparison of two versions.
- Comments and multi-person editing at the same time.
- Voiceover production. The `voiceover` field is kept as a note only.
- Multi-frame stories and carousels.

## Stories

| Story | Title | Priority | BE | FE | QA |
| --- | --- | --- | --- | --- | --- |
| [E05-S01](S01-generate-script.md) | Generate the script package | Must | 2.5 | 0.5 | |
| [E05-S02](S02-storyboard-editor.md) | Storyboard editor and approval | Must | 1 | 3.5 | |
| [E05-S03](S03-regenerate-and-history.md) | Regenerate with feedback and version history | Must | 1 | 1 | |
| | **Total** | | **4.5** | **5** | |

## Flow

1. The brief is approved (E04-S03) and the item is `briefed`. `advance(item)` enqueues `script.generate` when `autopilot.script` is on; otherwise the Script tab shows a "Generate script" button.
2. The job calls the AI, validates the package against the script rules, repairs once if needed, and stores `ScriptVersion` version 1 as `draft`.
3. If `autopilot.script` is on and the package is valid, it is approved at once. Otherwise the operator opens the Script tab, edits (each save is a new version), or asks for a rewrite with feedback.
4. The operator approves. The item becomes `scripted`, and `advance(item)` starts production (E06-S07), which moves it to `in_production`.
5. Later, if a check returns Revise with script-level findings, the revise loop (E07-S05) calls the same generation service with the findings as feedback. That version is approved automatically when valid, and production runs again.

```text
briefed ──generate──► ScriptVersion v1 (draft) ──edit──► v2 (draft) ──approve──► scripted ──advance──► in_production
                             ▲                                  │
                             └────── regenerate with feedback ──┘        E07-S05 revise loop ──► v3 (approved) ──► in_production
```

## Owns

| Kind | Items |
| --- | --- |
| Tables | `ScriptVersion` (in the `content` app) |
| Endpoints | `POST /content-items/{id}/script/generate/`, `GET` and `PUT /content-items/{id}/script/`, `GET /content-items/{id}/script/versions/`, `GET /content-items/{id}/script/versions/{version}/`, `POST /content-items/{id}/script/approve/` |
| Registry data | `script_rules` and `frame_templates` in the format registry, returned by `GET /formats/` |
| Panel | The Script tab of `/content/:id` |
| Background tasks | `content.tasks.generate_script`, registered as Celery task `script.generate`, on the `default` queue (job kind `script.generate`); the synchronous service `write_script_version` used inside E07-S05's `qc.revise` job |
| AI tasks | `script.generate` |
| Services | `content.services.scripts`: `generate_script`, `save_script_edit`, `approve_script`, `validate_script_package` |

## Depends on / needed by

- **Depends on:** E00-S05 (AI gateway), E00-S06 (jobs), E00-S03 (brand profile), E03-S04 (item workspace shell and `ContentEvent`), E04-S01 (format registry), E04-S03 (approved brief).
- **Needed by:** E06-S02, E06-S03, E06-S04 (renderers read frames and shots), E06-S06 (copy is written from the script), E06-S07 (production starts on approval), E07-S03 and E07-S04 (checks read on-screen text and design notes), E07-S05 (revise loop calls regeneration).

## Done when

1. An item with an approved brief gets a script package that passes every script rule for its format, in the account's content language.
2. An operator can change any part of the package, save it as a new version, and approve it; the item becomes `scripted` and production starts without another click.
3. With `autopilot.script` on, steps 1 and 2 happen with no person involved.
4. A rewrite with feedback produces a new version that reflects the feedback, and every earlier version can still be opened and restored.
5. Two people saving from the same version cannot overwrite each other: the second save gets `version_conflict`.

## Later

- Rendered frame thumbnails in the editor: the frame card already has a fixed preview area and the render endpoint exists in E06.
- Version comparison: versions are immutable JSON documents, so a diff view needs no backend change.
- More frame templates: add an entry to `frame_templates` with its limits and a render template in E06-S02.
- Per-task model choice: `script.generate` can be pointed at another model through `SOCIALHUB_AI_TEXT_MODEL_OVERRIDES`.
