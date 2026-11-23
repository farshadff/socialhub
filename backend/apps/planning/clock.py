"""One place to read the current time, so tests can freeze it."""

from django.utils import timezone


def now():
    return timezone.now()
