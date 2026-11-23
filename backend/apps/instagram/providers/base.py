"""The Instagram provider interface, result types and errors (INSTAGRAM-INTEGRATION.md section 7).

Every adapter (`fake`, `manual`; `graph_api` later) implements `InstagramProvider` and raises only
the errors below. Error messages are safe: they never contain a token, the app secret or an
OAuth code.

Deviation from section 7: `authorize_url` and `exchange_code` take an optional keyword
`account_id`. Real Instagram ignores it; the fake needs it to issue the account's token
(`fake-token-{account_id}-{n}`) and to read the account's scripted OAuth code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, ClassVar, Protocol, runtime_checkable

SCOPE_BASIC = "instagram_business_basic"
SCOPE_PUBLISH = "instagram_business_content_publish"
SCOPE_INSIGHTS = "instagram_business_manage_insights"
ALL_SCOPES = (SCOPE_BASIC, SCOPE_PUBLISH, SCOPE_INSIGHTS)
PROFESSIONAL_ACCOUNT_TYPES = ("BUSINESS", "MEDIA_CREATOR")
CAPABILITY_KEYS = ("publish_feed", "publish_reel", "publish_story", "insights")

CONTAINER_KINDS = ("feed_image", "reel", "story_image", "story_video")
CONTAINER_STATUSES = ("IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED")
FORMATS = ("feed_post", "reel", "story")


# --- result types ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TokenGrant:
    access_token: str = field(repr=False)
    expires_at: datetime
    user_id: str
    scopes: list[str] | None


@dataclass(frozen=True)
class VerifyResult:
    ig_user_id: str
    username: str
    account_type: str
    scopes: list[str] | None  # None: the API cannot report granted permissions
    status: str = "ok"
    capabilities: dict[str, bool] | None = None  # filled by the connection service


@dataclass(frozen=True)
class Quota:
    usage: int
    total: int
    duration_seconds: int


@dataclass(frozen=True)
class ContainerSpec:
    kind: str  # CONTAINER_KINDS
    media_url: str
    caption: str | None = None  # None for stories
    cover_url: str | None = None
    share_to_feed: bool = True
    ai_generated: bool = False


@dataclass(frozen=True)
class ContainerStatus:
    status_code: str  # CONTAINER_STATUSES
    message: str = ""


@dataclass(frozen=True)
class RemoteMedia:
    id: str
    shortcode: str | None
    permalink: str | None
    media_kind: str  # image, video
    product_type: str  # feed, reels, story
    caption: str | None
    timestamp: datetime


@dataclass(frozen=True)
class InsightsResult:
    metrics: dict[str, int]
    unavailable: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AccountStats:
    followers: int
    following: int
    media_count: int


# --- errors ---------------------------------------------------------------------------------


class InstagramError(Exception):
    """Base of every provider error. `code` is the connection/job error code (section 7)."""

    code: ClassVar[str] = "provider_error"
    default_message: ClassVar[str] = "Instagram didn't respond as expected."

    def __init__(self, message: str | None = None, *, graph_code: int | None = None,
                 error_subcode: int | None = None, fbtrace_id: str | None = None):
        self.message = message or self.default_message
        self.graph_code = graph_code
        self.error_subcode = error_subcode
        self.fbtrace_id = fbtrace_id
        super().__init__(self.message)

    def as_api_error(self):
        """The API error a view returns when this escapes (`apps.core.errors` hook)."""
        from apps.core.errors import ProviderError

        return ProviderError(details={"reason": self.code})


class TokenInvalid(InstagramError):
    code = "token_invalid"
    default_message = "Instagram no longer accepts this account's access token."

    def as_api_error(self):
        from apps.core.errors import InstagramNotConnected

        return InstagramNotConnected(details={"reason": self.code})


class PermissionMissing(InstagramError):
    code = "permission_missing"
    default_message = "A permission Social Hub needs is missing on Instagram."

    def as_api_error(self):
        from apps.core.errors import InstagramPermissionMissing

        return InstagramPermissionMissing()


class RateLimited(InstagramError):
    code = "rate_limited"
    default_message = "Instagram asked us to slow down."

    def __init__(self, message: str | None = None, *, retry_after_seconds: int | None = None,
                 **kwargs):
        super().__init__(message, **kwargs)
        self.retry_after_seconds = retry_after_seconds

    def as_api_error(self):
        from apps.core.errors import RateLimited as ApiRateLimited

        return ApiRateLimited(self.retry_after_seconds)


class QuotaExceeded(InstagramError):
    code = "quota_exceeded"
    default_message = "The account reached Instagram's publishing limit."


class MediaRejected(InstagramError):
    code = "media_rejected"
    default_message = "Instagram rejected the media."


class TransientError(InstagramError):
    code = "provider_error"


class AmbiguousResult(InstagramError):
    code = "provider_error"
    default_message = "Instagram didn't confirm whether the post was published."


class NotFound(InstagramError):
    code = "not_found"
    default_message = "The object does not exist on Instagram."


class NotSupported(InstagramError):
    code = "not_supported"
    default_message = "This connection type does not support the action."


class AccountBusy(InstagramError):
    code = "rate_limited"
    default_message = "Another task is using this Instagram account. Try again shortly."


class ProviderNotConfigured(InstagramError):
    """The provider cannot be used on this server (missing Meta settings, or no adapter)."""

    code = "provider_not_configured"
    default_message = "The Instagram provider is not configured on the server."

    def __init__(self, provider: str, missing: list[str], *, reason: str | None = None):
        super().__init__()
        self.provider = provider
        self.missing = list(missing)
        self.reason = reason

    def as_api_error(self):
        from apps.core.errors import ProviderNotConfiguredError

        details: dict[str, Any] = {"provider": self.provider, "missing": self.missing}
        if self.reason:
            details["reason"] = self.reason
        return ProviderNotConfiguredError(details=details)


# --- interface ------------------------------------------------------------------------------


@runtime_checkable
class InstagramProvider(Protocol):
    name: str

    # connection
    def authorize_url(self, *, state: str, redirect_uri: str,
                      account_id: int | None = None) -> str: ...
    def exchange_code(self, *, code: str, redirect_uri: str,
                      account_id: int | None = None) -> TokenGrant: ...
    def refresh_token(self, token: str) -> TokenGrant: ...
    def verify(self, token: str) -> VerifyResult: ...

    # publishing
    def publishing_quota(self, token: str) -> Quota: ...
    def create_container(self, token: str, spec: ContainerSpec) -> str: ...
    def container_status(self, token: str, container_id: str) -> ContainerStatus: ...
    def publish_container(self, token: str, container_id: str) -> str: ...
    def get_media(self, token: str, media_id: str) -> RemoteMedia: ...

    # verification
    def list_recent_media(self, token: str, *, since: datetime,
                          limit: int = 25) -> list[RemoteMedia]: ...
    def list_active_stories(self, token: str) -> list[RemoteMedia]: ...

    # analytics
    def media_insights(self, token: str, media_id: str, fmt: str) -> InsightsResult: ...
    def account_stats(self, token: str) -> AccountStats: ...
