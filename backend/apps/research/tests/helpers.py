"""Shared fixtures for research tests."""

from dataclasses import dataclass, field
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.accounts.models import InstagramAccount
from apps.planning.models import WeeklyPlan

from ..models import ResearchSource, TrendSignal
from ..services.fingerprints import fingerprint


def make_user(username="operator", superuser=False):
    model = get_user_model()
    if superuser:
        return model.objects.create_superuser(username, f"{username}@example.com", "pw-1234567")
    return model.objects.create_user(username, f"{username}@example.com", "pw-1234567")


def make_account(handle="coffeelab", **kwargs):
    defaults = {"display_name": "Coffee Lab", "timezone": "Asia/Tehran",
                "content_language": "fa"}
    defaults.update(kwargs)
    return InstagramAccount.objects.create(handle=handle, **defaults)


def make_plan(account, *, days_ahead=2, status="draft"):
    today = timezone.now().date()
    start = today + timedelta(days=days_ahead)
    return WeeklyPlan.objects.create(account=account, week_start=start,
                                     week_end=start + timedelta(days=6), status=status,
                                     objective="Grow reach", audience_summary="Home brewers")


def make_source(account, kind="rss", value="https://sprudge.com/feed/", **kwargs):
    return ResearchSource.objects.create(account=account, kind=kind, value=value,
                                         label=kwargs.pop("label", value[:80]), **kwargs)


_counter = {"n": 0}


def make_signal(account, *, kind="rss", url=None, title="Signal", author="Publisher",
                excerpt="Excerpt", published_at=None, captured_at=None, metrics=None, **kwargs):
    _counter["n"] += 1
    if url is None and kind != "manual":
        url = f"https://example.com/post/{_counter['n']}"
    return TrendSignal.objects.create(
        account=account, kind=kind, url=url or "", title=title, author=author, excerpt=excerpt,
        published_at=published_at, captured_at=captured_at or timezone.now(),
        metrics=metrics or {}, fingerprint=fingerprint(kind, url, author, excerpt), **kwargs)


@dataclass
class FakeResult:
    data: object
    citations: list = field(default_factory=list)
    ai_run_id: int | None = None


def provider_configured(value=True):
    return mock.patch("apps.research.services.platform.text_provider_configured",
                      return_value=value)


class FakeCtx:
    """Stand-in for JobContext in service tests."""

    def __init__(self):
        self.progress_calls = []
        self.outcome = None

    def progress(self, percent, message=None):
        self.progress_calls.append((percent, message))

    def succeed(self, result=None, message="Done"):
        self.outcome = ("succeeded", result, message)

    def fail(self, code, detail=""):
        self.outcome = ("failed", code, detail)
