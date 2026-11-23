"""Week and local-time arithmetic in the account's timezone."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from apps.core import clock

PLAN_WEEKS_AHEAD = 8
MIN_LEAD_TIME = timedelta(minutes=30)
# A plan closes itself once week_end + this many full days have passed (E01-S03 rule 10).
AUTO_CLOSE_AFTER_DAYS = 2

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def local_today(account, now: datetime | None = None) -> date:
    return (now or clock.now()).astimezone(account.tz).date()


def current_week_start(account, today: date) -> date:
    """The start of the account's week that contains ``today``."""
    return today - timedelta(days=(today.weekday() - account.week_start_day) % 7)


def week_has_ended(week_end: date, account, now: datetime | None = None) -> bool:
    """True once the last day of the week is over in the account's timezone."""
    return local_today(account, now) > week_end


def to_utc(local_date: date, local_time: time, tz: ZoneInfo) -> datetime:
    """Local wall time → UTC, using the tz database (handles daylight saving)."""
    return datetime.combine(local_date, local_time.replace(tzinfo=None), tzinfo=tz).astimezone(UTC)


def to_local(moment: datetime, tz: ZoneInfo) -> datetime:
    return moment.astimezone(tz)


def week_bounds(week_start: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """UTC [start, end) of a plan week: 00:00 on week_start to 00:00 the day after week_end."""
    return (
        to_utc(week_start, time(0, 0), tz),
        to_utc(week_start + timedelta(days=7), time(0, 0), tz),
    )


def date_in_week(week_start: date, weekday: int) -> date:
    """The date inside the week starting ``week_start`` that falls on ``weekday`` (0 = Monday)."""
    return week_start + timedelta(days=(weekday - week_start.weekday()) % 7)


def default_title(week_start: date) -> str:
    return f"Week of {week_start.day} {_MONTHS[week_start.month - 1]}"
