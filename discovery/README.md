# Discovery work: US-001 to US-003

Prepared 2026-11-19. These artifacts start the first three backlog stories.

| Story | Current status | Evidence in this checkout | Remaining gate |
| --- | --- | --- | --- |
| US-001 | In progress | [Decision sheet](US-001-pilot-decision-sheet.md), [Persian operator prototype](prototype/index.html) | Identify account and named owners; choose calendar display; provide source/brand inputs; record operator review |
| US-002 | Blocked | [Instagram capability matrix](US-002-instagram-capability-matrix.md) | Accept US-001; identify the pilot account and provide authorized Meta developer-app/test-account access |
| US-003 | Blocked | [Source access matrix](US-003-source-access-matrix.md), [normalized source-item schema](source-item.schema.json) | Accept US-001; name the company feed and approved sources and provide permitted access |

No live account/feed calls were made. The requester selected `combined` source mode, `Asia/Tehran`, and the roadmap's recommended operating defaults. Public Meta documentation is recorded as a planning input only; it does not satisfy account-specific acceptance. No access tokens, private source records, or fabricated probe results belong in these files.

## Suggested evidence handling

- Keep test account handles and provider object IDs redacted in shared evidence; retain exact values only in an approved restricted store if operationally necessary.
- Record each authorized probe with UTC timestamp, selected API version/login flow, capability, sanitized request shape, outcome, provider error code, and evidence location.
- Keep genuine feed samples in an access-controlled store. In this repository, retain only redacted schema mappings and hashes/links that the source owner permits.
- A public documentation check, a mock, and an authorized real-account probe are separate evidence classes.
