"""Test factories (E03-S04 test notes): `make_item(status=…)` builds everything an item needs."""

from __future__ import annotations

import itertools
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.accounts.models import InstagramAccount
from apps.planning.models import PlanSlot, WeeklyPlan
from apps.selection.models import Candidate

from .. import formats
from ..models import ContentItem
from ..services import pipeline

_seq = itertools.count(1)


def make_user(*, admin=False, username=None):
    username = username or f"user{next(_seq)}"
    model = get_user_model()
    if admin:
        return model.objects.create_superuser(username=username, password="pw-123456")
    return model.objects.create_user(username=username, password="pw-123456")


def make_account(**overrides) -> InstagramAccount:
    n = next(_seq)
    data = {"handle": f"acct{n}", "display_name": f"Account {n}", "content_language": "fa"}
    data.update(overrides)
    return InstagramAccount.objects.create(**data)


def _week_start(account) -> date:
    today = timezone.now().date()
    delta = (account.week_start_day - today.weekday()) % 7
    return today + timedelta(days=delta)


def make_plan(account=None, **overrides) -> WeeklyPlan:
    account = account or make_account()
    start = overrides.pop("week_start", None) or _week_start(account)
    data = {"account": account, "week_start": start, "week_end": start + timedelta(days=6),
            "status": "active", "title": f"Week of {start:%d %b}",
            "objective": "Grow saves among home-office workers this week.",
            "audience_summary": "Home-office workers in big cities.",
            "success_metrics": ["reach", "saves", "shares"]}
    if "created_by" in {f.name for f in WeeklyPlan._meta.fields}:
        data["created_by"] = overrides.pop("created_by", None) or make_user()
    data.update(overrides)
    return WeeklyPlan.objects.create(**data)


def make_slot(plan, *, format="reel", days=2, role=None, status="open") -> PlanSlot:
    when = timezone.now() + timedelta(days=days, hours=next(_seq))
    return PlanSlot.objects.create(plan=plan, scheduled_at=when, format=format, role=role,
                                   status=status)


def make_candidate(plan, **overrides) -> Candidate:
    data = {"account": plan.account, "plan": plan, "kind": "trend",
            "title": "Five-minute desk setup", "summary": "Desk reset routines are spreading.",
            "suggested_formats": ["reel"], "suggested_role": "educate",
            "sources": [{"title": "Why tidy desks are trending",
                         "url": "https://example.org/articles/tidy-desks"}],
            "evidence_score": 72, "goal_fit_score": 85, "freshness_score": 76,
            "total_score": "77.80", "rationale": "Fits the saves goal.", "rank": 1,
            "status": "selected"}
    data.update(overrides)
    return Candidate.objects.create(**data)


def make_item(*, status="selected", format="reel", media_kind=None, production_mode=None,
              role="educate", account=None, plan=None, with_slot=True, actor=None
              ) -> ContentItem:
    plan = plan or make_plan(account)
    default_media, default_mode = formats.defaults_for(format)
    media_kind = media_kind or default_media
    production_mode = production_mode or formats.default_mode(format, media_kind)
    slot = make_slot(plan, format=format, status="reserved") if with_slot else None
    item = pipeline.create_item(account=plan.account, plan=plan, slot=slot,
                                candidate=make_candidate(plan), title="Five-minute desk setup",
                                format=format, media_kind=media_kind,
                                production_mode=production_mode, role=role, actor=actor)
    if status != "selected":
        ContentItem.objects.filter(pk=item.pk).update(status=status)
        item.refresh_from_db()
    return item
