"""The one place business code reads the current time (ARCHITECTURE.md section 4, "Time")."""

from datetime import datetime

from django.utils import timezone


def now() -> datetime:
    return timezone.now()
