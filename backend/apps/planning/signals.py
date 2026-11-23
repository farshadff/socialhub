"""Signals other apps subscribe to (E01-S03).

Both are sent with ``send_robust`` after the transaction commits, so a failing receiver
can neither roll back the status change nor break the response.
"""

from django.dispatch import Signal

# Arguments: plan
plan_activated = Signal()

# Arguments: plan, forced (bool), automatic (bool). E10-S02 starts the weekly report from it.
plan_closed = Signal()
