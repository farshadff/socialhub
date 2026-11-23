"""Single source of "now" for domain code, so tests can freeze it with one patch.

Call it as ``clock.now()`` (module attribute lookup), never ``from .clock import now``,
so that ``unittest.mock.patch("apps.core.clock.now")`` takes effect everywhere.
"""

from datetime import datetime

from django.utils import timezone


def now() -> datetime:
    return timezone.now()
