"""Signals other apps subscribe to (E01-S03)."""

from django.dispatch import Signal

# Sent after the activation transaction commits. Arguments: plan.
plan_activated = Signal()

# Sent after the close transaction commits. Arguments: plan, forced (bool), automatic (bool).
# E10-S02 listens to it and starts the weekly report job.
plan_closed = Signal()
