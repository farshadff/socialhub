# E02-S03 — Collect public Instagram signals

| | |
| --- | --- |
| Epic | E02 Trend research |
| Priority | Later |
| Estimate | Not scheduled (estimated BE 2 d when scheduled) |
| Depends on | E02-S02, E00-S04; the `graph_api_fb` adapter with Facebook Login (not in the MVP) |
| Needed by | None in the MVP. E02-S04 would use its signals as extra input |

## User story

As an operator, I want research runs to also look at top posts under my watched hashtags and recent posts from sector accounts, so that topic ideas reflect what is working on Instagram itself, with real engagement numbers.

## Context

**Later — not in the MVP.** The MVP connects accounts with the Instagram API with Instagram Login ([INSTAGRAM-INTEGRATION.md](../../INSTAGRAM-INTEGRATION.md), sections 1 and 2). That API has no hashtag search and no business discovery. Both exist only in the Facebook Login for Business variant on `graph.facebook.com`, which needs each account linked to a Facebook Page in a Meta Business portfolio.

Until this story is built, research uses web search, RSS and manual signals. An operator who finds a relevant Instagram post adds it as a manual signal with its URL and numbers (E02-S02, rules 36–40). The source kinds `instagram_hashtag` and `instagram_account` are reserved for this story and cannot be created in the MVP (E02-S01, rule 2).

This file keeps a compact design so the story can be scheduled without new research. The estimate covers the research calls, the collector and the run integration. Connecting accounts through Facebook Login (the `graph_api_fb` adapter's connect flow, INSTAGRAM-INTEGRATION.md section 8) is separate work and is not estimated here.

## Scope

**In (when scheduled):**

- Research methods on the `graph_api_fb` adapter: hashtag search with `top_media` and `recent_media`, and business discovery. Matching `fake` provider behaviour.
- An Instagram collector for `instagram_hashtag` and `instagram_account` sources, run with the account's own connection.
- A per-account guard for the limit of 30 unique hashtags per rolling 7 days.
- Re-enabling the two source kinds in the watchlist (E02-S01) and the signal list (E02-S05).

**Out (later):**

- Downloading media, thumbnails or comments.
- One shared account that researches for every brand account.
- Audio trends, Explore, mentions and tags.

## Behaviour and rules

### Connection and availability

1. Research calls use the run's own account. `research.services.sources.availability(kind)` returns `not_supported` for both Instagram kinds unless the account's `AccountConnection.provider` is `graph_api_fb`, its status is `connected` or `expiring`, and a new `research` capability is true.
2. `research` is true when the permissions hashtag search and business discovery need were granted: `instagram_basic` plus the Instagram Public Content Access feature for hashtags, and `pages_read_engagement` for business discovery **(confirm when scheduled)**. Both usually need Advanced Access through App Review.
3. Every call goes through `account_session(account, wait_seconds=30)`, so research never interleaves with publishing or metric collection for that account.

### Sources when re-enabled

4. Normalization and validation, added back to E02-S01 rule 4:

   | Kind | Normalization | Validation |
   | --- | --- | --- |
   | `instagram_hashtag` | Trim; remove leading `#`; lowercase | 1–100 characters; letters (any script), digits and `_` only |
   | `instagram_account` | Trim; remove leading `@`; take the first path segment of a pasted profile URL; lowercase | 1–30 characters matching `^[a-z0-9._]+$`; must not start or end with `.` |

5. Active limits per account: 5 hashtags and 5 accounts. Run order: `web_search`, `rss`, `instagram_hashtag`, `instagram_account`, each by `id`.

### Hashtag sources

6. `GET /ig_hashtag_search?user_id={ig_user_id}&q={tag}` returns the hashtag ID. IDs are stable and are cached in Redis (`ig:hashtag_id:{tag}`, 30 days).
7. `GET /{hashtag_id}/top_media?user_id={ig_user_id}&fields=id,caption,media_type,permalink,timestamp,like_count,comments_count` returns the most popular recent posts; keep at most 9 taken within `lookback_days`. When `top_media` yields fewer than 3 kept posts, `recent_media` (last 24 hours) with the same fields tops the list up to 9.
8. **30 unique hashtags per account per rolling 7 days.** Meta counts each distinct hashtag searched; repeat searches of the same hashtag inside the window do not count again. The collector keeps a Redis sorted set `ig:hashtags:{account_id}` (tag → time first searched, entries older than 7 days dropped). A tag not in the set when the set already holds 30 is not searched and the source gets `error:hashtag_limit`. Changing a hashtag source's value therefore uses up a new slot.
9. The hashtag endpoints do not return the author's username **(confirm when scheduled)**, so hashtag signals have no `author`. E02-S04 would use `#tag` as their origin for source diversity.

### Account sources

10. Business discovery: `GET /{ig_user_id}?fields=business_discovery.username({username}){username,followers_count,media.limit(6){id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count}}`. Keep media taken within `lookback_days`, at most 6. Only professional accounts can be looked up; a personal, private or unknown username raises `NotFound`.

### From result to `TrendSignal`

11. Each kept post becomes a `SignalDraft`; E02-S02 normalizes, deduplicates and saves it:

    | Signal field | Value |
    | --- | --- |
    | `kind` | The source's kind |
    | `url` | `permalink` (normalized by E02-S02 rule 16 to `https://instagram.com/p/{code}`) |
    | `title` | First caption line, cut to 120 characters; without a caption, "#{tag} {media type}" or "@{username} {media type}" |
    | `excerpt` | The caption, cut to 1,000 characters |
    | `author` | Null for hashtag posts; `@{username}` for account posts |
    | `published_at` | `timestamp` in UTC |
    | `metrics` | `{"likes": like_count, "comments": comments_count}`; a key is left out when the API omits it (owners can hide likes) |
    | `raw` | `{"media_id", "media_type", "media_product_type", "edge"}`, where `edge` is `top_media`, `recent_media` or `business_discovery` |

12. A post already stored keeps its row; its `metrics` are replaced with the newer values (E02-S02 rule 18). Posts by the run's own account are dropped; own posts are measured in E09.

### Errors

13. Errors from INSTAGRAM-INTEGRATION.md section 7, translated once in the collector:

    | Error | Source status | Rest of the run |
    | --- | --- | --- |
    | `TokenInvalid`, `PermissionMissing` | `error:token_invalid`, `error:permission_missing`; `report_connection_error(account, error)` | Remaining Instagram sources get the same status without a call |
    | `RateLimited`, `AccountBusy` | `error:rate_limited` | Remaining Instagram sources get the same status without a call |
    | `TransientError` | `error:transient` after one retry 30 seconds later | Next source is tried |
    | `NotFound` | `error:not_found` | Next source is tried |
    | Hashtag limit (rule 8) | `error:hashtag_limit` | Next source is tried |

14. Instagram failures never fail the run by themselves; the all-sources-failed rule of E02-S02 applies across all kinds.

## Data

No new tables. Uses `ResearchSource`, `ResearchRun`, `TrendSignal` and `AccountConnection` from [DATA-MODEL.md](../../DATA-MODEL.md). When scheduled: add `instagram_hashtag` and `instagram_account` to `ResearchSource.kind` and `TrendSignal.kind`, add `graph_api_fb` to `AccountConnection.provider`, and add `research` to `AccountConnection.capabilities`.

## API

No new endpoints. When scheduled, `POST /research/sources/` accepts the two kinds again, `available` and `unavailable_reason` reflect rule 1, and run results gain the statuses `error:not_supported`, `error:token_invalid`, `error:permission_missing`, `error:rate_limited`, `error:transient`, `error:not_found` and `error:hashtag_limit`.

## Background work

Runs inside `research.tasks.run_research` (E02-S02); no new task. One retry for `TransientError`, none for anything else. About 2–4 seconds per source; ten sources add well under a minute to a run.

## AI

None.

## Panel

No new screens. When scheduled, E02-S01's Sources tab gets back the kinds "Hashtag" and "Instagram account" (tags, form fields and placeholders "#coffee" and "@username", tooltip texts for the statuses in the API section), and E02-S05's Signals tab gets the two kind tags and filter options.

## Acceptance criteria

1. Given an account on `graph_api`, when a run includes an Instagram source, then no call is made and the source shows `error:not_supported`.
2. Given an account on `graph_api_fb` with `research` true and a hashtag source, when the run visits it, then up to nine signals are stored with `kind = instagram_hashtag`, a canonical post URL, no author and like and comment counts.
3. Given an account source naming a professional account, when the run visits it, then at most six signals from the last `lookback_days` days are stored with `@username` as author.
4. Given 30 different hashtags searched for the account in the last 7 days, when a run reaches a 31st hashtag, then no search is made and the source shows `error:hashtag_limit`; a hashtag already in the set is still searched.
5. Given a post stored last week, when it appears again with more likes, then no new signal is created and the stored `metrics` show the new counts.
6. Given `TokenInvalid` on the first of three Instagram sources, when the run ends, then all three show `error:token_invalid`, one call was made, and the connection is `needs_attention`.

## Subtasks

### Backend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E02-S03-BE1 | Research calls on `graph_api_fb` | `hashtag_search`, `hashtag_media(hashtag_id, edge)` and `business_discovery(username)` in the adapter; error translation; hashtag ID cache; `fake` behaviour for each, including `NotFound` and the hashtag limit. | — |
| E02-S03-BE2 | Hashtag limit guard | `ig:hashtags:{account_id}` sorted set with 7-day pruning and the 30-tag check; unit tests at the boundary. | — |
| E02-S03-BE3 | Instagram collector | `apps/research/collectors/instagram.py`: per-kind calls, age filter, `top_media` top-up from `recent_media`, mapping of rule 11, own-account filter, `account_session`. | — |
| E02-S03-BE4 | Run and source integration | Kinds and limits back in `services/sources.py`; availability and the `research` capability; run order; stop rules of rule 13; `openapi.yaml`. Run-level tests for acceptance criteria 1–6 with the fake provider. | — |

### Frontend

| ID | Task | Detail | Est. |
| --- | --- | --- | --- |
| E02-S03-FE1 | Re-enable Instagram kinds in the panel | Kind options, value placeholders and client validation in `SourceFormModal.tsx`; kind tags and status tooltips in `SourcesTab.tsx` and `SignalsTab.tsx`. | — |

The 2 backend days are not counted in the MVP total in [ROADMAP.md](../../ROADMAP.md). FE1 is small and is estimated together with the backend when the story is scheduled.

### Test

None. Tests are part of each subtask.

## Test notes

- Unit: caption title and empty-caption title; missing like counts leave the key out; own-account posts dropped; age windows for both kinds; hashtag limit boundary and pruning.
- Recorded Graph API responses for hashtag search, `top_media`, `recent_media` and business discovery, including the error bodies for an unknown hashtag and a personal account.
- No test calls Instagram. A manual check on a real account connected through Facebook Login is part of the setup for the `graph_api_fb` adapter.

## Later

- One shared account connected through Facebook Login that researches for every brand account, so brand accounts can stay on Instagram Login. The 30-hashtag limit would then be shared by every brand account's watchlist.
- Mentions and tagged posts as further source kinds behind the same collector.
