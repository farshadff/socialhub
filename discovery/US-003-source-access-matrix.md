# US-003 — Company feed and approved trend inputs

**Status:** Blocked for source selection and live access  
**Prepared:** 2026-11-19  
**Dependency:** US-001 is not accepted; no company feed, approved-source list, endpoint, credentials, or sample records were supplied.

This spike will use permitted APIs, feeds, exports, or licensed sources only. It will not infer access to private social accounts or rely on arbitrary Instagram scraping. The JSON Schema in this folder defines the normalized record to apply once genuine source samples are available.

US-001 now selects `combined` as the pilot source mode, which means company-feed plus approved trend inputs under the roadmap proposal. This selects the mode only; the feed, approved sources, permissions, and editorial rules remain unprovided.

## Source matrix

| Input category | First source selected | Permitted retrieval path | Minimum evidence to retain | Current status / owner |
| --- | --- | --- | --- | --- |
| Company feed | None supplied | Company-approved authenticated API/feed/export | Redacted external ID, source URL/locator, publication/update time, status, feed eligibility fields, collection time, pagination/freshness/limits | **Blocked**; PO + INT to name feed and access owner |
| Industry sources | None approved | Explicitly approved public or licensed endpoint/feed | Publisher, original URL, timestamp, excerpt/snapshot only where permitted, rights/terms and collection time | **Blocked**; PO to approve sources; INT to verify route |
| Search signals | Provider/query scope not selected | Approved search API or licensed service; no undocumented scraping | Provider/query metadata, original source link, observation time, limits and terms | **Blocked**; PO + INT |
| Social signals | Provider and signals not selected | Approved API/service with applicable account/permission rights | Signal type, source identity/link, observed time/window, retrieval scope and limitation | **Blocked**; PO + INT |
| Sector accounts | No account list supplied | Approved public/authorized interface or licensed provider | Account reference, post ID/link, timestamp, observable fields and access basis | **Blocked**; PO + INT |

## Normalized source item contract

The schema at [source-item.schema.json](source-item.schema.json) captures:

- stable connector/source identity and input category;
- original link, publisher, external ID, published/source-updated times, and observed collection time;
- source/feed status and the eligibility result/reasons as observed under a versioned policy;
- provenance and rights basis, permitted use, and expiry where applicable;
- a content hash and evidence locators, without requiring unrestricted raw-source copies.

Schema is prepared, but no authentic samples can be mapped yet. The first accepted sample set should include at least one eligible and one excluded company item when available, plus one item from each approved trend-input category. Keep raw payloads and restricted text in an approved controlled store; commit only owner-approved redacted mappings and evidence references.

## Retrieval and eligibility questions to answer per source

1. Who owns the source and approves Social Hub access?
2. What authentication method and secret reference are permitted? Where are credentials stored and rotated?
3. What stable ID, canonical link, timestamps, status, pagination cursor, freshness semantics, rate limit, and deletion/update behavior does it expose?
4. What are the legal/contractual uses: read, summarize, quote, retain evidence, create derivative content, or publish? What retention/attribution rules apply?
5. Which account/source mode can use it, and what freshness/status/exclusion rules determine eligibility?
6. How are unavailable, stale, conflicting, private, or revoked records represented? They remain unavailable/uncertain rather than guessed eligible.

Do not define a universal freshness window or topic cooldown. The roadmap assigns these to the editorial owner per feed.

## Blockers and close conditions

- **B-003-1:** US-001 source-mode and pilot-account decisions are pending. Owner: PO.
- **B-003-2:** The first company feed and an authorized technical owner are not identified. Owner: PO + INT.
- **B-003-3:** Approved industry/search/social/sector sources and permitted retrieval paths are not identified. Owner: PO + INT.
- **B-003-4:** No authorized feed access or original source samples exist in this checkout. Owner: INT.
- **B-003-5:** Editorial freshness/status/exclusion and rights rules are not confirmed. Owner: PO/editorial owner.

Close US-003 only after genuine redacted samples retain allowed original locators and collection times, the common schema maps the samples, retrieval/auth/pagination/freshness/limits are recorded, and every unsupported category has an explicit blocker and owner.
