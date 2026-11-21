# E02-S03 — Collect public Instagram signals

| | |
| --- | --- |
| Epic | E02 Trend research |
| Priority | Should |
| Estimate | BE 2 d · FE 0 d · QA 0 d |
| Depends on | E02-S02, E00-S04 |
| Needed by | E02-S04 (optional input) |

## User story

As an operator, I want research runs to also look at top posts under my watched hashtags and recent posts from sector accounts, so that topic ideas reflect what is working on Instagram itself, with real engagement numbers.

## Context

Web search and RSS show what people write about. Instagram shows what people actually watch and save. This story adds an Instagram collector to the research run from E02-S02. It uses the `InstagramResearchProvider` interface from E00-S04 and a separate research account, never a brand account, so a block on research cannot stop publishing ([INSTAGRAM-INTEGRATION.md](../../INSTAGRAM-INTEGRATION.md), "Research account").

The story is a Should. Without it, Instagram sources stay in the watchlist marked "Not available", runs skip them, and the operator can still add Instagram posts as manual signals.

## Scope

**In:**

- A stored, encrypted session for the research account and a management command to sign it in.
- The `instagrapi` implementation of `InstagramResearchProvider`, and the `fake` one.
- An Instagram collector for `instagram_hashtag` and `instagram_account` sources.
- Pacing, per-run and per-day call budgets.
- Clean degradation: not configured, session lost, rate limited, not found.
- Availability of Instagram sources reported to the panel.

**Out (later):**

- A panel screen to sign the research account in or enter a challenge code.
- Downloading media, thumbnails or comments.
- Reading follower counts or profiles of other accounts.
- Hashtag "recent" feeds, audio trends, Explore.
- More than one research account or rotation between accounts.

## Behaviour and rules

### Research connection

1. The research account is global, not per brand account. Its state lives in one `ResearchConnection` row (Data section).
2. Settings:

   | Setting | Purpose | Default |
   | --- | --- | --- |
   | `SOCIALHUB_IG_RESEARCH_PROVIDER` | `instagrapi`, `fake` or empty | empty locally means disabled; tests use `fake` |
   | `SOCIALHUB_IG_RESEARCH_USERNAME` | Optional default username offered by `ig_research_login`; the signed-in username is stored on `ResearchConnection` | none |
   | `SOCIALHUB_IG_RESEARCH_PROXY_URL` | Fixed proxy for the research account | none |
   | `SOCIALHUB_IG_RESEARCH_MAX_CALLS_PER_RUN` | Provider calls allowed in one run | 12 |
   | `SOCIALHUB_IG_RESEARCH_MAX_CALLS_PER_DAY` | Provider calls allowed per UTC day | 60 |

3. Sign-in is done by an admin on the server with `python manage.py ig_research_login`. The command reads the username and proxy from settings, prompts for the password without echo, calls the provider's login, prompts for a verification code if Instagram asks for one, and on success stores the encrypted session with status `connected`. The password is never stored or logged.
4. `python manage.py ig_research_login --verify` checks the stored session and prints the status. `--logout` deletes the stored session and sets `disconnected`.
5. Session data is encrypted with Fernet using `SOCIALHUB_ENCRYPTION_KEY`, the same way as `AccountConnection.session_encrypted`. After every successful provider call the refreshed session is saved back.

### Availability

6. `research.services.sources.availability(kind)` for the two Instagram kinds returns:
   - `not_supported` when `SOCIALHUB_IG_RESEARCH_PROVIDER` is empty or there is no `ResearchConnection` row with status `connected`;
   - available otherwise.
7. A run does not call the provider for an unavailable source. The source is recorded as `error:not_supported`.

### Collecting

8. Instagram sources are visited after web search and RSS sources, hashtags first, then accounts, each by `id`.
9. One provider call per source:

   | Kind | Call | Limit | Kept |
   | --- | --- | --- | --- |
   | `instagram_hashtag` | `hashtag_top_media(tag, limit=9)` | 9 media | Media taken within the last 14 days or `lookback_days`, whichever is longer |
   | `instagram_account` | `user_recent_media(username, limit=6)` | 6 media | Media taken within `lookback_days` |

10. Mapping from `PublicMedia` to a `SignalDraft`:

    | Signal field | Value |
    | --- | --- |
    | `kind` | The source's kind |
    | `url` | `https://www.instagram.com/p/{code}/` (normalized by the fingerprint rules to `https://instagram.com/p/{code}`) |
    | `title` | First line of the caption, cut to 120 characters; when there is no caption, "@{username} {media_type}" |
    | `excerpt` | The caption, cut to 1,000 characters |
    | `author` | `@{username}` |
    | `published_at` | `taken_at` in UTC |
    | `metrics` | `{"likes": like_count, "comments": comment_count, "views": view_count}`; a key is left out when the provider returns null |
    | `raw` | `{"pk", "code", "media_type", "hashtags", "source_value"}`; `hashtags` are the first 30 found in the caption |

11. Nothing else is stored: no media files, no thumbnail URLs (they expire), no comment text, no data about people other than the public username of the author.
12. Deduplication is the E02-S02 rule. Because top posts reappear on later runs with higher counts, an existing signal's `metrics` are replaced with the newer values.
13. A media item from the brand account itself (author equals the run's account handle) is dropped; own posts are measured in E09, not researched.

### Pacing and budgets

14. One provider call at a time across the whole system, enforced by the Redis lock `ig:research:lock` (lease 120 seconds). The collector waits up to 60 seconds for the lock, then records `error:rate_limited` for the source.
15. A random pause of 4 to 9 seconds follows every provider call.
16. Per-run budget: at most `SOCIALHUB_IG_RESEARCH_MAX_CALLS_PER_RUN` calls. Sources beyond the budget are recorded as `error:run_budget` without a call.
17. Per-day budget: a Redis counter `ig:research:calls:{YYYYMMDD}` (UTC, expires after 48 hours). When it reaches `SOCIALHUB_IG_RESEARCH_MAX_CALLS_PER_DAY`, remaining Instagram sources are recorded as `error:daily_budget` without a call.

### Errors

18. Provider errors are translated once, in the collector:

    | Provider error | Source status | Effect on the rest of the run |
    | --- | --- | --- |
    | `SessionRequired` | `error:session_required` | Connection becomes `needs_attention`; every remaining Instagram source gets the same status without a call |
    | `ChallengeRequired` | `error:session_required` | Connection becomes `challenge_required`; same as above |
    | `RateLimited` | `error:rate_limited` | Every remaining Instagram source gets the same status without a call |
    | `TransientError` | `error:transient` after one retry 30 seconds later | The next source is still tried |
    | `NotFound` | `error:not_found` | The next source is still tried |
    | `NotSupported` | `error:not_supported` | Every remaining Instagram source of that kind gets the same status |
    | Empty list | `empty` | — |

19. `connection.last_error_code` and `last_error_at` are set on session and challenge errors.
20. Instagram failures never fail the run by themselves. The all-sources-failed rule of E02-S02 still applies across all kinds.
21. Nothing sensitive is logged: no session data, no proxy URL, no captions. Logs carry the source ID, the call name, the outcome and the duration.

## Data

Uses `ResearchSource`, `ResearchRun`, `TrendSignal` from [DATA-MODEL.md](../../DATA-MODEL.md). One new table in `apps/instagram`:

### ResearchConnection

At most one row (enforced by a fixed primary key of 1).

| Field | Type | Notes |
| --- | --- | --- |
| `provider` | enum | `instagrapi`, `fake` |
| `status` | enum | `disconnected`, `connected`, `challenge_required`, `needs_attention` |
| `username` | text | |
| `session_encrypted` | text, null | Fernet-encrypted; never serialized |
| `last_verified_at` | datetime, null | |
| `last_error_code` / `last_error_at` | text / datetime, null | |

The proxy URL stays in the environment and is not stored.

Fields this story needs on the `PublicMedia` dataclass defined in `apps/instagram/providers/base.py` (E00-S04): `pk: str`, `code: str`, `media_type: Literal["image", "video", "reel", "carousel"]`, `caption: str`, `username: str`, `taken_at: datetime`, `like_count: int | None`, `comment_count: int | None`, `view_count: int | None`.

One provider error is added to the shared list: `NotFound` — the hashtag or user does not exist, or the account is private.

## API

No new endpoints. Two existing responses change:

- `GET /research/sources/` — `available` and `unavailable_reason` for Instagram kinds now reflect the research connection (rule 6).
- `GET /system/status/` (E00-S05, admin) should include the research connection so an admin can see it without shell access:

```json
{
  "instagram_research": {
    "provider": "instagrapi",
    "status": "connected",
    "username": "research.account",
    "last_verified_at": "2026-11-22T03:10:00Z",
    "last_error_code": null,
    "calls_today": 14,
    "calls_per_day_limit": 60
  }
}
```

When the provider setting is empty the object is `{"provider": null, "status": "disconnected"}`.

Run results gain these per-source statuses: `error:session_required`, `error:rate_limited`, `error:transient`, `error:not_found`, `error:run_budget`, `error:daily_budget`.

## Background work

| Item | Value |
| --- | --- |
| Task | Runs inside `research.tasks.run_research` (E02-S02); no new task |
| Queue | `default` |
| Daily verification | The daily "Verify Instagram sessions" Beat task from E00-S04 also calls `verify` on the research connection and updates its status |
| Idempotency | Same as the run: fingerprints make re-collection safe; metrics are overwritten with newer values |
| Retries | One retry for `TransientError`; none for anything else |
| Time cost | About 5 to 12 seconds per source including the pause; ten sources add roughly two minutes to a run |
| Locks | `ig:research:lock` (rule 14) |

Module layout:

```text
apps/instagram/models.py                         ResearchConnection
apps/instagram/providers/instagrapi_research.py  InstagrapiResearchProvider
apps/instagram/providers/fake.py                 FakeResearchProvider (scenarios)
apps/instagram/services/research_session.py      load_provider(), save_session(), budgets
apps/instagram/management/commands/ig_research_login.py
apps/research/collectors/instagram.py            InstagramCollector
```

`instagrapi` method names to confirm against the pinned version during the E00-S04 spike: top media for a hashtag (`hashtag_medias_top`), user ID from a username (`user_id_from_username`) and recent media for a user (`user_medias`). The account lookup and the media listing count as one logical call for the budgets; the adapter caches username-to-ID lookups in Redis (`ig:research:uid:{username}`) for 30 days to avoid repeating them.

## AI

None.

## Panel

No new screens (FE 0 d). Existing screens change through data only:

- **Research → Sources:** Instagram sources lose the "Not available" tag once the research connection is `connected`. The `last_status` tooltips for the new statuses are already defined in E02-S01.
- **Research → Signals:** Instagram signals show likes, comments and views in the Metrics column (E02-S05).
- **Settings → System** (E00-S05): shows the `instagram_research` block.

## Acceptance criteria

1. Given the research provider setting is empty, when a run includes Instagram sources, then no provider call is made, each Instagram source shows `error:not_supported`, and the run completes from the other sources.
2. Given a connected research session and a hashtag source, when the run visits it, then up to nine signals are stored with `kind = instagram_hashtag`, a canonical post URL, `@username` as author and like, comment and view counts in `metrics`.
3. Given an account source, when the run visits it, then only media from the last `lookback_days` days are stored, at most six.
4. Given a post already stored last week, when it appears again with more likes, then no new signal is created and the stored signal's `metrics` show the new counts.
5. Given the provider raises `SessionRequired` on the second of five Instagram sources, when the run ends, then the first source is `ok`, the other four are `error:session_required`, only two provider calls were made, the connection is `needs_attention`, and the run is still `completed` if another source succeeded.
6. Given the provider raises `RateLimited`, when the run continues, then no further Instagram calls are made in that run.
7. Given a username that does not exist, when the run visits it, then the source shows `error:not_found` and the next source is still tried.
8. Given the daily counter has reached the limit, when a run starts, then Instagram sources are recorded as `error:daily_budget` without calls.
9. Given two research runs for different accounts at the same time, when both reach their Instagram sources, then provider calls never overlap.
10. Given `ig_research_login` is run with a correct password and a verification code, when it finishes, then a `ResearchConnection` row exists with status `connected` and an encrypted session, and the password appears in no log or table.
11. Given the `fake` research provider, when the test suite runs, then every scenario above passes without network access.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E02-S03-BE1 | Research connection and login command | `ResearchConnection` model and migration; `services/research_session.py` (encrypt, decrypt, save back, load provider from settings); `ig_research_login` command with password prompt, challenge prompt, `--verify`, `--logout`; hook into the daily verification task. Tests with the fake provider. | 0.5 d |
| E02-S03-BE2 | Provider adapters | `InstagrapiResearchProvider` implementing `hashtag_top_media` and `user_recent_media`, mapping library objects to `PublicMedia`, translating library exceptions to the shared errors including `NotFound`; proxy support; username-to-ID cache. `FakeResearchProvider` with scenarios `ok`, `empty`, `session_required`, `challenge`, `rate_limited`, `transient_then_ok`, `not_found`. | 0.5 d |
| E02-S03-BE3 | Instagram collector | `collectors/instagram.py`: per-kind call, age filters, `PublicMedia` to `SignalDraft` mapping, own-account filter, Redis lock, random pause (injectable for tests), per-run and per-day budgets. Unit tests for mapping and limits. | 0.5 d |
| E02-S03-BE4 | Run integration | Register the collector in `services/runs.py`; availability for Instagram kinds; stop rules for session, challenge, rate-limit and not-supported errors; metrics overwrite on duplicate; `instagram_research` block for `GET /system/status/`. | 0.25 d |
| E02-S03-BE5 | Tests and runbook note | Run-level tests for acceptance criteria 1 and 4 to 9 with the fake provider; a short "Research account" section in the operations runbook (E11-S02) covering login, verification and what the statuses mean; `openapi.yaml` update for the status block. | 0.25 d |

### Frontend

None.

### Test

None. Tests are part of each subtask.

## Test notes

- Unit: caption first-line title, empty caption title, hashtag extraction cap, missing counts leave keys out, own-account media dropped, age windows for both kinds.
- Budgets: counter increments per logical call, resets by date key, per-run cap stops calls; the pause function is injected so tests do not sleep.
- Lock: a held lock makes the second collector wait and then record `error:rate_limited` after the wait limit.
- Session: refreshed session is saved after a successful call; nothing is saved after a failed one; decrypt failure sets `needs_attention`.
- Command: tested through Django's `call_command` with patched prompts.
- No test calls Instagram. A manual check on the real research account is part of the E00-S04 spike checklist.

## Later

- A panel form under Settings → System to sign the research account in and answer challenges, reusing the connection components from E00-S04.
- More than one research account with round-robin use and per-account budgets; `ResearchConnection` loses its single-row rule.
- A third-party scraping API as another `InstagramResearchProvider` implementation, chosen by `SOCIALHUB_IG_RESEARCH_PROVIDER`.
- Audio and Explore trends as new source kinds.
