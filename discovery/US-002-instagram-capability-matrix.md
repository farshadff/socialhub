# US-002 — Instagram capability and access matrix

**Status:** Blocked for authorized account probes  
**Prepared:** 2026-11-19  
**Dependency:** US-001 is not accepted; the pilot account and Meta developer app are not identified, and authorized probe results were not supplied.

Public documentation below is a feasibility baseline. It does not prove the chosen account, app, permissions, quotas, or metrics work. Do not place access tokens in this repository. Record only redacted provider IDs and sanitized outcomes.

The account is needed to close this specific account-level spike, not to continue the decision sheet or prepare the source schema. A real eligible account connected to an authorized app lets the operator verify the account type, granted permissions, format results, metrics, token lifecycle, and live quota. The account handle and credentials do not need to be shared in chat; a restricted account reference and redacted probe evidence are sufficient. These checks should be completed before building the account-specific publishing connector.

## Current documented baseline

Meta's current Content Publishing guide describes publishing single images, videos, Reels, Stories, and mixed image/video carousels to Instagram professional accounts. It lists three login paths (Unified Login, Instagram Login, and Facebook Login), with different tokens, hosts, and permissions. The guide currently identifies API `v27.0` in examples/version references. None is selected for this pilot yet.

The same guide says source media must be reachable by Meta when fetched from a URL, and an account/page may require Page Publishing Authorization. It documents a publishing-limit endpoint. The guide has different published-post limit statements in its general and carousel sections (100 vs. 50 in 24 hours); query the selected account's live limit and resolve this discrepancy before relying on a quota value.

Meta documents an `is_ai_generated` container parameter as a self-disclosure option. That is a technical capability; whether/when it satisfies applicable disclosure requirements and how it behaves for the selected account still needs a policy decision and authorized probe.

Meta's Insights documentation lists media and account Insights endpoints and includes post, video/Reel, and Story insights among supported content types. Exact metrics, permission requirements, retention windows, and availability for this account must be tested and stored with observation windows. Do not treat a metric's presence in a general reference as account-level evidence.

## Capability matrix

| Capability | PRD priority | Public documentation baseline | Account result | Evidence / owner |
| --- | --- | --- | --- | --- |
| Eligible account type | Required | Publishing docs target Instagram professional accounts; IG User docs describe Business/Creator professional accounts | **Not tested** | Identify pilot account and confirm Business/Creator status; INT + account owner |
| Login flow and API version | Required | Unified, Instagram, and Facebook Login paths are documented; current guide references v27.0 | **Not selected / not tested** | Select based on account ownership, permission needs, and approved app; INT + OPS |
| Single-image feed post | Core | Documented single-image publishing | **Not tested** | Authorized test account and app access; INT |
| Reel | Core | `REELS` media container path documented | **Not tested** | Probe create/status/publish/returned ID; INT |
| Image Story | Core | `STORIES` media container path documented | **Not tested** | Probe create/status/publish/returned ID; INT |
| Video Story | Core | `STORIES` supports video media in documented publishing flow | **Not tested** | Probe create/status/publish/returned ID; INT |
| Image carousel | Later core extension; check early | Carousel container documented | **Not tested** | Probe format and crop behavior; INT |
| Video/mixed carousel | Later core extension; check early | Up to 20 images/videos or a mix documented | **Not tested** | Probe format constraints and container status; INT |
| AI-content disclosure | Required when applicable | `is_ai_generated` parameter documented for media/carousel container | **Policy and behavior unverified** | Decide applicable cases; verify output/metadata for each format; PO + INT |
| Post/Reel metrics | Required where available | Insights endpoints exist for media and Reels/video | **Not tested** | Probe exact metric names/permissions/windows; INT |
| Story metrics and observation window | Required where available | Meta Insights overview includes Stories | **Not tested** | Probe metrics and age/window behavior; INT |
| Publishing quota | Required | Limit endpoint documented; guide text has 100/24h and carousel section says 50/24h | **Not queried** | Query live account, capture limit fields and resolve documentation mismatch; INT |
| Media reachability | Required for hosted media URL flow | Publishing service fetches URL; publicly reachable media is required for that path | **Not tested** | Test only an approved, non-sensitive media asset from the planned host; OPS + INT |
| Permissions/app review | Required | Permission sets and Standard/Advanced access are flow-specific; review may be needed for Advanced Access | **Not checked** | Record app mode, granted scopes, approval state and exact blocker; INT + OPS |
| Token lifecycle | Required | Access-token path depends on login type | **Not checked** | Verify refresh/expiry/revocation/reconnect safely; OPS + INT |
| Publishing disclosure/partnership labels | Must be checked | `is_ai_generated` documented; paid-partnership label has flow-specific availability | **Not tested** | Confirm required labels and supported path for selected content; PO + INT |

## Authorized probe record template

Create one record per capability. Replace all bracketed values; redact secrets and public-facing account handles before sharing.

```yaml
probe_id: US-002-[sequence]
class: authorized_real_account
performed_at_utc: null
account_ref_redacted: null
app_ref_redacted: null
login_flow: null
api_version: null
permission_names: []
capability: null
request_shape_redacted: null
provider_object_ids_redacted: []
http_status: null
provider_error_code: null
outcome: not_run # pass | fail | unavailable | not_run
observed_limits_or_metrics: null
evidence_location: null
operator: null
notes: null
```

Never record a bearer token, app secret, raw authorization header, or unrestricted media URL here.

## Blockers and close conditions

- **B-002-1:** US-001 decision sheet is pending PO acceptance. Owner: PO.
- **B-002-2:** Pilot professional account and authorized test-account operator are unidentified. Owner: PO + OPS.
- **B-002-3:** Approved Meta developer app, login flow, app access level and granted permissions are not supplied. Owner: INT + OPS.
- **B-002-4:** No authorized live probes or redacted results exist. Owner: INT.

Close US-002 only after the selected flow/version/account and app permissions are recorded, all required core-format probes and available metric probes have authorized evidence, carousel/disclosure checks are recorded, and every unavailable feature has a named blocker and resolution owner. Documentation or mock results alone cannot close it.

## Public references checked 2026-11-19

- [Meta Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) — formats, login paths, permissions, media URL requirements, quota endpoint, carousel and AI self-disclosure parameter.
- [Meta Insights APIs overview](https://developers.facebook.com/docs/insights/overview) — account/permission access levels and supported Insights surfaces.
- [Meta Insights API references](https://developers.facebook.com/docs/insights/references) — media, account, video and Reel endpoint families.
- [Meta Instagram API changelog](https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/) — Instagram Login product and permissions context.
