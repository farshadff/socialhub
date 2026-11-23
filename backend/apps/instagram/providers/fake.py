"""The `fake` provider (E00-S04 rules 13-14): deterministic, scripted, never sleeps.

It keeps one remote account per Social Hub account: issued tokens, profile, containers,
published media, call counts and scripted scenarios. Time comes from `apps.core.clock`, so tests
freeze it. With `SOCIALHUB_TESTING_HOOKS=true` the state lives in the cache (Redis) under
`fake:ig:{account_id}` so the API process and every worker share it; otherwise it lives in
process memory.

Scripting (tests, or the E11-S03 hooks):

    FakeProvider.script(account, ["token_invalid"])
    FakeProvider.script(account, [{"name": "fail_n_times", "n": 2}])
    FakeProvider.script(account, [{"name": "container_slow", "delay_seconds": 30}])
    FakeProvider.script(account, [{"name": "values", "insights": {"reach": 10},
                                    "account_stats": {"followers": 5}}])
    FakeProvider.set_oauth_code(account, "fake-mismatch")
    FakeProvider.calls(account)  # {"verify": 1, ...}
    FakeProvider.reset()

OAuth codes: `fake-ok` (default), `fake-denied` (the authorize URL carries Instagram's decline
instead of a code), `fake-mismatch` (`verify` reports `someone.else`), `fake-personal` (`verify`
reports `PERSONAL`) and, beyond the spec, `fake-no-insights` (the insights permission is not
granted). Any other code is rejected like an expired one.
"""

from __future__ import annotations

import json
import re
import threading
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

from django.conf import settings
from django.core.cache import cache

from apps.core import clock

from .base import (
    ALL_SCOPES,
    SCOPE_BASIC,
    SCOPE_INSIGHTS,
    SCOPE_PUBLISH,
    AccountStats,
    AmbiguousResult,
    ContainerSpec,
    ContainerStatus,
    InsightsResult,
    MediaRejected,
    NotFound,
    PermissionMissing,
    Quota,
    QuotaExceeded,
    RateLimited,
    RemoteMedia,
    TokenGrant,
    TokenInvalid,
    TransientError,
    VerifyResult,
)

TOKEN_LIFETIME = timedelta(days=60)
REFRESH_MIN_AGE = timedelta(hours=24)
CONTAINER_LIFETIME = timedelta(hours=24)
STORY_LIFETIME = timedelta(hours=24)
QUOTA_TOTAL = 100
QUOTA_WINDOW = timedelta(hours=24)
CACHE_PREFIX = "fake:ig:"
CACHE_TTL = 60 * 60 * 24 * 90

OAUTH_CODES = ("fake-ok", "fake-denied", "fake-mismatch", "fake-personal", "fake-no-insights")
MISMATCH_USERNAME = "someone.else"
_TOKEN_RE = re.compile(r"^fake-token-(\d+)-(\d+)$")

# One-shot scenarios: consumed by the next call of any method.
_ONE_SHOT = ("token_invalid", "permission_missing", "rate_limited", "fail_n_times")
# One-shot scenarios consumed by the next `publish_container`.
_PUBLISH_ONE_SHOT = ("timeout_after_publish", "timeout_before_publish",
                     "story_timeout_after_publish")
_PERSISTENT = ("ok", "quota_exceeded", "media_rejected", "container_slow", "container_expired",
               "appears_late", "values")
SCENARIOS = _ONE_SHOT + _PUBLISH_ONE_SHOT + _PERSISTENT

_PRODUCT_TYPE = {"feed_image": "feed", "reel": "reels", "story_image": "story",
                 "story_video": "story"}
_MEDIA_KIND = {"feed_image": "image", "reel": "video", "story_image": "image",
               "story_video": "video"}
_DEFAULT_METRICS = {
    "feed_post": {"reach": 1200, "views": 1500, "likes": 90, "comments": 12, "saves": 30,
                  "shares": 8},
    "reel": {"reach": 4000, "views": 6500, "likes": 210, "comments": 25, "saves": 60,
             "shares": 40},
    "story": {"reach": 800, "views": 950, "shares": 4, "replies": 6},
}

_memory: dict[str, dict] = {}
_memory_lock = threading.RLock()


def _account_id(account) -> int:
    return int(getattr(account, "pk", account))


def _iso(value: datetime) -> str:
    return value.isoformat()


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _new_state() -> dict:
    return {
        "oauth_code": "fake-ok",
        "profile": None,  # {"username", "account_type", "scopes"} set by exchange_code
        "insights_revoked": False,
        "token_seq": 0,
        "tokens": {},  # token -> {"issued_at", "expires_at"}
        "container_seq": 0,
        "containers": {},
        "media_seq": 0,
        "media": [],
        "scenarios": [],
        "calls": {},
    }


def _hooks() -> bool:
    return bool(getattr(settings, "SOCIALHUB_TESTING_HOOKS", False))


def _load(account_id: int) -> dict:
    key = f"{CACHE_PREFIX}{account_id}"
    if _hooks():
        raw = cache.get(key)
        return json.loads(raw) if raw else _new_state()
    with _memory_lock:
        return deepcopy(_memory.get(key) or _new_state())


def _save(account_id: int, state: dict) -> None:
    key = f"{CACHE_PREFIX}{account_id}"
    if _hooks():
        cache.set(key, json.dumps(state), CACHE_TTL)
        return
    with _memory_lock:
        _memory[key] = deepcopy(state)


def _normalise_scenario(item) -> dict:
    scenario = {"name": item} if isinstance(item, str) else dict(item)
    if scenario.get("name") not in SCENARIOS:
        raise ValueError(f"Unknown fake Instagram scenario {scenario.get('name')!r}.")
    if scenario["name"] == "fail_n_times":
        scenario["n"] = int(scenario.get("n", 1))
    if scenario["name"] in ("container_slow", "appears_late"):
        scenario["delay_seconds"] = int(scenario.get("delay_seconds", 60))
    return scenario


class FakeProvider:
    name = "fake"

    # --- scripting (class level, shared by every instance) ----------------------------------

    @classmethod
    def script(cls, account, scenarios: list) -> None:
        """Replace the account's scenarios. `["ok"]` or `[]` clears them."""
        account_id = _account_id(account)
        state = _load(account_id)
        normalised = [_normalise_scenario(item) for item in scenarios]
        state["scenarios"] = [item for item in normalised if item["name"] != "ok"]
        _save(account_id, state)

    @classmethod
    def set_oauth_code(cls, account, code: str) -> None:
        account_id = _account_id(account)
        state = _load(account_id)
        state["oauth_code"] = code
        _save(account_id, state)

    @classmethod
    def calls(cls, account) -> dict[str, int]:
        return dict(_load(_account_id(account))["calls"])

    @classmethod
    def state(cls, account) -> dict:
        """A copy of the remote account (tests)."""
        return _load(_account_id(account))

    @classmethod
    def reset(cls, account=None) -> None:
        """Forget one remote account, or every one kept in process memory."""
        if account is not None:
            account_id = _account_id(account)
            if _hooks():
                cache.delete(f"{CACHE_PREFIX}{account_id}")
            with _memory_lock:
                _memory.pop(f"{CACHE_PREFIX}{account_id}", None)
            return
        with _memory_lock:
            _memory.clear()

    @staticmethod
    def ig_user_id(account_id: int) -> str:
        return f"9{int(account_id):016d}"

    @staticmethod
    def token_for(account_id: int, n: int = 0) -> str:
        return f"fake-token-{int(account_id)}-{n}"

    # --- internals ---------------------------------------------------------------------

    def _enter(self, account_id: int, method: str) -> dict:
        """Count the call and raise a pending one-shot scenario. Returns the saved state."""
        state = _load(account_id)
        state["calls"][method] = state["calls"].get(method, 0) + 1
        error = None
        for scenario in list(state["scenarios"]):
            name = scenario["name"]
            if name not in _ONE_SHOT:
                continue
            if name == "fail_n_times":
                scenario["n"] -= 1
                if scenario["n"] <= 0:
                    state["scenarios"].remove(scenario)
                error = TransientError("Instagram returned a temporary error (fake).")
            else:
                state["scenarios"].remove(scenario)
                if name == "token_invalid":
                    error = TokenInvalid()
                elif name == "permission_missing":
                    state["insights_revoked"] = True
                    error = PermissionMissing()
                else:
                    error = RateLimited(retry_after_seconds=60)
            break
        _save(account_id, state)
        if error is not None:
            raise error
        return state

    @staticmethod
    def _scenario(state: dict, name: str) -> dict | None:
        return next((s for s in state["scenarios"] if s["name"] == name), None)

    @staticmethod
    def _parse_token(token: str) -> int:
        match = _TOKEN_RE.match(token or "")
        if not match:
            raise TokenInvalid()
        return int(match.group(1))

    def _check_token(self, state: dict, token: str) -> None:
        issued = state["tokens"].get(token)
        # A well-formed token the fake did not issue (test factories) is treated as valid.
        if issued is not None and _dt(issued["expires_at"]) <= clock.now():
            raise TokenInvalid()

    def _issue(self, account_id: int, state: dict) -> TokenGrant:
        now = clock.now()
        state["token_seq"] += 1
        token = self.token_for(account_id, state["token_seq"])
        expires_at = now + TOKEN_LIFETIME
        state["tokens"][token] = {"issued_at": _iso(now), "expires_at": _iso(expires_at)}
        return TokenGrant(access_token=token, expires_at=expires_at,
                          user_id=self.ig_user_id(account_id), scopes=self._scopes(state))

    @staticmethod
    def _scopes(state: dict) -> list[str]:
        profile = state.get("profile") or {}
        scopes = list(profile.get("scopes") or ALL_SCOPES)
        if state.get("insights_revoked"):
            scopes = [scope for scope in scopes if scope != SCOPE_INSIGHTS]
        return scopes

    def _call(self, token: str, method: str) -> tuple[int, dict]:
        account_id = self._parse_token(token)
        state = self._enter(account_id, method)
        self._check_token(state, token)
        return account_id, state

    @staticmethod
    def _remote_media(item: dict) -> RemoteMedia:
        return RemoteMedia(id=item["id"], shortcode=item["shortcode"],
                           permalink=item["permalink"], media_kind=item["media_kind"],
                           product_type=item["product_type"], caption=item["caption"],
                           timestamp=_dt(item["timestamp"]))

    # --- connection ---------------------------------------------------------------------

    def authorize_url(self, *, state: str, redirect_uri: str,
                      account_id: int | None = None) -> str:
        code = _load(account_id)["oauth_code"] if account_id is not None else "fake-ok"
        if code == "fake-denied":
            query = {"error": "access_denied", "error_reason": "user_denied",
                     "error_description": "The user denied your request.", "state": state}
        else:
            query = {"code": code, "state": state}
        return f"{redirect_uri}?{urlencode(query)}"

    def exchange_code(self, *, code: str, redirect_uri: str,
                      account_id: int | None = None) -> TokenGrant:
        if account_id is None:
            raise TokenInvalid("The fake provider needs the account to exchange a code.")
        state = self._enter(account_id, "exchange_code")
        if code not in OAUTH_CODES or code == "fake-denied":
            raise TokenInvalid("The authorization code was rejected.")
        scopes = list(ALL_SCOPES)
        if code == "fake-no-insights":
            scopes = [SCOPE_BASIC, SCOPE_PUBLISH]
        state["profile"] = {
            "username": MISMATCH_USERNAME if code == "fake-mismatch" else None,
            "account_type": "PERSONAL" if code == "fake-personal" else "BUSINESS",
            "scopes": scopes,
        }
        state["insights_revoked"] = False
        grant = self._issue(account_id, state)
        _save(account_id, state)
        return grant

    def refresh_token(self, token: str) -> TokenGrant:
        account_id, state = self._call(token, "refresh_token")
        issued = state["tokens"].get(token)
        if issued is not None and clock.now() - _dt(issued["issued_at"]) < REFRESH_MIN_AGE:
            raise TransientError("The token is less than 24 hours old (fake).")
        grant = self._issue(account_id, state)
        _save(account_id, state)
        return grant

    def verify(self, token: str) -> VerifyResult:
        account_id, state = self._call(token, "verify")
        profile = state.get("profile") or {}
        username = profile.get("username")
        if not username:
            from apps.accounts.models import InstagramAccount

            username = (InstagramAccount.objects.filter(pk=account_id)
                        .values_list("handle", flat=True).first() or f"account{account_id}")
        return VerifyResult(ig_user_id=self.ig_user_id(account_id), username=username,
                            account_type=profile.get("account_type") or "BUSINESS",
                            scopes=self._scopes(state))

    # --- publishing ---------------------------------------------------------------------

    def _published_in_window(self, state: dict) -> int:
        since = clock.now() - QUOTA_WINDOW
        return sum(1 for item in state["media"] if _dt(item["timestamp"]) >= since)

    def publishing_quota(self, token: str) -> Quota:
        _, state = self._call(token, "publishing_quota")
        usage = (QUOTA_TOTAL if self._scenario(state, "quota_exceeded")
                 else self._published_in_window(state))
        return Quota(usage=usage, total=QUOTA_TOTAL,
                     duration_seconds=int(QUOTA_WINDOW.total_seconds()))

    def create_container(self, token: str, spec: ContainerSpec) -> str:
        account_id, state = self._call(token, "create_container")
        if spec.kind not in _PRODUCT_TYPE:
            raise MediaRejected(f"Unknown container kind {spec.kind!r}.")
        now = clock.now()
        state["container_seq"] += 1
        container_id = f"fake-container-{account_id}-{state['container_seq']}"
        slow = self._scenario(state, "container_slow")
        state["containers"][container_id] = {
            "kind": spec.kind,
            "caption": None if spec.kind.startswith("story") else spec.caption,
            "created_at": _iso(now),
            "ready_at": _iso(now + timedelta(seconds=slow["delay_seconds"] if slow else 0)),
            "error": bool(self._scenario(state, "media_rejected")),
            "expired": bool(self._scenario(state, "container_expired")),
            "media_id": None,
        }
        _save(account_id, state)
        return container_id

    def _container(self, state: dict, container_id: str) -> dict:
        container = state["containers"].get(container_id)
        if container is None:
            raise NotFound()
        return container

    def _container_status(self, container: dict) -> ContainerStatus:
        now = clock.now()
        if container["media_id"]:
            return ContainerStatus("PUBLISHED")
        if container["error"]:
            return ContainerStatus("ERROR", "The media could not be processed (fake).")
        if container["expired"] or now - _dt(container["created_at"]) >= CONTAINER_LIFETIME:
            return ContainerStatus("EXPIRED")
        if now < _dt(container["ready_at"]):
            return ContainerStatus("IN_PROGRESS")
        return ContainerStatus("FINISHED")

    def container_status(self, token: str, container_id: str) -> ContainerStatus:
        _, state = self._call(token, "container_status")
        return self._container_status(self._container(state, container_id))

    def publish_container(self, token: str, container_id: str) -> str:
        account_id, state = self._call(token, "publish_container")
        container = self._container(state, container_id)
        if self._scenario(state, "quota_exceeded"):
            raise QuotaExceeded()
        status = self._container_status(container).status_code
        if status == "ERROR":
            raise MediaRejected("The container failed processing.")
        if status == "EXPIRED":
            raise MediaRejected("The container expired before it was published.")
        if status == "PUBLISHED":
            raise MediaRejected("The container was already published.")
        if status == "IN_PROGRESS":
            raise TransientError("The container is not ready yet (fake).")
        is_story = container["kind"].startswith("story")
        timeout = None
        for name in _PUBLISH_ONE_SHOT:
            scenario = self._scenario(state, name)
            if scenario is None or (name == "story_timeout_after_publish" and not is_story):
                continue
            state["scenarios"].remove(scenario)
            timeout = name
            break
        if timeout == "timeout_before_publish":
            _save(account_id, state)
            raise AmbiguousResult()
        now = clock.now()
        state["media_seq"] += 1
        n = state["media_seq"]
        media_id = f"fake-media-{account_id}-{n}"
        shortcode = f"FAKE{account_id}x{n}"
        late = self._scenario(state, "appears_late")
        path = "reel" if container["kind"] == "reel" else "p"
        state["media"].append({
            "id": media_id,
            "shortcode": None if is_story else shortcode,
            "permalink": None if is_story else f"https://www.instagram.com/{path}/{shortcode}/",
            "media_kind": _MEDIA_KIND[container["kind"]],
            "product_type": _PRODUCT_TYPE[container["kind"]],
            "caption": container["caption"],
            "timestamp": _iso(now),
            "visible_at": _iso(now + timedelta(seconds=late["delay_seconds"] if late else 0)),
        })
        container["media_id"] = media_id
        _save(account_id, state)
        if timeout is not None:
            raise AmbiguousResult()
        return media_id

    def _media(self, state: dict, media_id: str) -> dict:
        item = next((m for m in state["media"] if m["id"] == media_id), None)
        if item is None:
            raise NotFound()
        return item

    def get_media(self, token: str, media_id: str) -> RemoteMedia:
        _, state = self._call(token, "get_media")
        return self._remote_media(self._media(state, media_id))

    # --- verification ---------------------------------------------------------------------

    @staticmethod
    def _visible(item: dict, now: datetime) -> bool:
        return _dt(item["visible_at"]) <= now

    def list_recent_media(self, token: str, *, since: datetime,
                          limit: int = 25) -> list[RemoteMedia]:
        _, state = self._call(token, "list_recent_media")
        now = clock.now()
        items = [m for m in state["media"]
                 if m["product_type"] != "story" and self._visible(m, now)
                 and _dt(m["timestamp"]) >= since]
        items.sort(key=lambda m: m["timestamp"], reverse=True)
        return [self._remote_media(m) for m in items[:limit]]

    def list_active_stories(self, token: str) -> list[RemoteMedia]:
        _, state = self._call(token, "list_active_stories")
        now = clock.now()
        items = [m for m in state["media"]
                 if m["product_type"] == "story" and self._visible(m, now)
                 and now - _dt(m["timestamp"]) < STORY_LIFETIME]
        items.sort(key=lambda m: m["timestamp"], reverse=True)
        return [self._remote_media(m) for m in items]

    # --- analytics ---------------------------------------------------------------------

    def media_insights(self, token: str, media_id: str, fmt: str) -> InsightsResult:
        _, state = self._call(token, "media_insights")
        self._media(state, media_id)
        values = self._scenario(state, "values") or {}
        metrics = dict(_DEFAULT_METRICS.get(fmt, _DEFAULT_METRICS["feed_post"]))
        metrics.update(values.get("insights") or {})
        raw: dict[str, Any] = {"data": [{"name": name, "values": [{"value": value}]}
                                        for name, value in metrics.items()]}
        return InsightsResult(metrics=metrics, raw=raw)

    def account_stats(self, token: str) -> AccountStats:
        _, state = self._call(token, "account_stats")
        values = (self._scenario(state, "values") or {}).get("account_stats") or {}
        return AccountStats(followers=int(values.get("followers", 1000)),
                            following=int(values.get("following", 150)),
                            media_count=int(values.get("media_count", len(state["media"]))))
