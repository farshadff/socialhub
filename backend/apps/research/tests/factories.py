"""Small builders for research tests."""

from datetime import UTC, date, datetime, timedelta
from itertools import count
from unittest import mock

from django.contrib.auth import get_user_model

from apps.accounts.models import InstagramAccount
from apps.planning.models import WeeklyPlan
from apps.research.models import ResearchSource, TrendSignal, TrendTopic
from apps.research.services.fingerprints import fingerprint

NOW = datetime(2026, 11, 22, 9, 0, tzinfo=UTC)
_seq = count(1)


def freeze(moment=NOW):
    """Patch the domain clock (``apps.core.clock.now``)."""
    return mock.patch("apps.core.clock.now", return_value=moment)


def user(*, admin=False, username=None):
    User = get_user_model()
    name = username or f"user{next(_seq)}"
    if admin:
        return User.objects.create_superuser(name, f"{name}@example.com", "pw")
    return User.objects.create_user(name, f"{name}@example.com", "pw", first_name="Sara")


def account(**fields):
    defaults = {"handle": f"acct{next(_seq)}", "display_name": "Test account"}
    defaults.update(fields)
    return InstagramAccount.objects.create(**defaults)


def plan(acct, *, week_start=date(2026, 11, 28), status=WeeklyPlan.Status.DRAFT, created_by=None):
    return WeeklyPlan.objects.create(
        account=acct,
        week_start=week_start,
        week_end=week_start + timedelta(days=6),
        status=status,
        title=f"Week of {week_start}",
        created_by=created_by or user(),
    )


def source(acct, kind="rss", value=None, **fields):
    value = value or (
        f"https://feed{next(_seq)}.example.com/feed/" if kind == "rss" else f"coffee trends {next(_seq)}"
    )
    fields.setdefault("label", value[:80])
    return ResearchSource.objects.create(account=acct, kind=kind, value=value, **fields)


def signal(acct, *, kind="rss", url=None, title="A signal", author="Publisher", excerpt="",
           published_at=None, captured_at=NOW, metrics=None, run=None, source=None):
    url = url if url is not None else f"https://news.example.com/item-{next(_seq)}"
    return TrendSignal.objects.create(
        account=acct,
        run=run,
        source=source,
        kind=kind,
        url=url,
        title=title,
        excerpt=excerpt,
        author=author,
        published_at=published_at,
        captured_at=captured_at,
        metrics=metrics or {},
        fingerprint=fingerprint(kind, url, author, excerpt),
    )


def topic(acct, *, title=None, plan=None, status=TrendTopic.Status.NEW,
          origin=TrendTopic.Origin.AI, signals=()):
    item = TrendTopic.objects.create(
        account=acct,
        plan=plan,
        title=title or f"Topic {next(_seq)}",
        hooks=["Hook one", "Hook two"],
        suggested_formats=["reel"],
        keywords=["a", "b", "c"],
        status=status,
        origin=origin,
    )
    item.signals.set(signals)
    return item
