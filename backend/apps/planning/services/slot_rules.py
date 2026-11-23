"""Posting rules (E01-S02 rule 4 and 12), shared by the slot template and plan slots.

Per day: reels + feed posts ≤ ``max_feed_per_day``; stories ≤ ``max_stories_per_day``;
any two reels/feed posts at least ``min_gap_minutes`` apart. Stories are exempt from the gap.
"""

from collections import defaultdict
from collections.abc import Hashable, Iterable
from dataclasses import dataclass

from apps.core.enums import Format

EXCEEDS_DAILY_LIMIT = "exceeds_daily_limit"
GAP_TOO_SMALL = "gap_too_small"


@dataclass(frozen=True)
class RuleEntry:
    key: Hashable  # what an error is reported against (row index, slot id, …)
    day: Hashable  # weekday for the template, local date for plan slots
    minute: int  # minutes on a common clock, used for the gap check
    format: str


def check_entry(entry: RuleEntry, others: Iterable[RuleEntry], rules: dict) -> str | None:
    """The rule ``entry`` breaks when added to ``others``, or None."""
    same_day = [o for o in others if o.day == entry.day and o.key != entry.key]
    if entry.format == Format.STORY:
        stories = sum(1 for o in same_day if o.format == Format.STORY)
        return EXCEEDS_DAILY_LIMIT if stories >= rules["max_stories_per_day"] else None

    feed = [o for o in same_day if o.format != Format.STORY]
    if len(feed) >= rules["max_feed_per_day"]:
        return EXCEEDS_DAILY_LIMIT
    if any(abs(o.minute - entry.minute) < rules["min_gap_minutes"] for o in feed):
        return GAP_TOO_SMALL
    return None


def find_violations(entries: Iterable[RuleEntry], rules: dict) -> dict[Hashable, str]:
    """Check entries in the given order; each one that breaks a rule is reported and left out.

    Processing in submission order means the row the operator added last is the one flagged.
    """
    accepted: dict[Hashable, list[RuleEntry]] = defaultdict(list)
    errors: dict[Hashable, str] = {}
    for entry in entries:
        code = check_entry(entry, accepted[entry.day], rules)
        if code:
            errors[entry.key] = code
        else:
            accepted[entry.day].append(entry)
    return errors
