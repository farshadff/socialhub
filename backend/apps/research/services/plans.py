"""Which plan research serves (E02-S02 rule 5, E02-S04 rule 25)."""

from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.planning.models import WeeklyPlan


def account_today(account, now=None):
    now = now or timezone.now()
    return now.astimezone(ZoneInfo(account.timezone)).date()


def default_plan(account, now=None):
    """The earliest draft or active plan whose week ends today or later (account timezone)."""
    return (
        WeeklyPlan.objects.filter(
            account=account,
            status__in=[WeeklyPlan.Status.DRAFT, WeeklyPlan.Status.ACTIVE],
            week_end__gte=account_today(account, now),
        )
        .order_by("week_start")
        .first()
    )


def usable_plan(account, plan_id):
    """Return the plan if it belongs to the account and is not closed, else None."""
    return (
        WeeklyPlan.objects.filter(account=account, pk=plan_id)
        .exclude(status=WeeklyPlan.Status.CLOSED)
        .first()
    )
