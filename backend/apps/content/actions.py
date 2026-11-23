"""`allowed_actions` registry (E03-S04 rule 11). Each epic registers a function that returns the
action names it allows for an item; the panel shows a button only when its action is listed."""

from __future__ import annotations

from collections.abc import Callable

_providers: list[Callable] = []


def register(fn: Callable) -> Callable:
    """`fn(item, user, ctx) -> list[str]`; `ctx` is a dict with `idle` (no active job)."""
    if fn not in _providers:
        _providers.append(fn)
    return fn


def allowed_actions(item, user) -> list[str]:
    from .services import pipeline

    ctx = {"idle": pipeline.active_job(item) is None}
    actions: list[str] = []
    for provider in _providers:
        for name in provider(item, user, ctx):
            if name not in actions:
                actions.append(name)
    return actions


@register
def _cancel(item, user, ctx):
    from .services.pipeline import NOT_CANCELLABLE

    return [] if item.status in NOT_CANCELLABLE else ["cancel"]
