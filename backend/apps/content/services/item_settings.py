"""Assign format, media kind, production mode, role and slot (E04-S02)."""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ErrorDetail

from apps.core.errors import ApiError, DetailedValidationError, InvalidTransition

from .. import actions, formats, roles
from ..models import Brief, ContentEvent, ContentItem, DocumentStatus, ScriptVersion
from . import pipeline

S = ContentItem.Status
EDITABLE_STATUSES = (S.SELECTED, S.BRIEFED, S.SCRIPTED)
TERMINAL = (S.PUBLISHED, S.CANCELLED)
ACCEPTED_KEYS = {"format", "media_kind", "production_mode", "role", "slot", "confirm"}
SLOT_LEAD = timedelta(minutes=30)
_UNSET = object()


def _error(path: str, code: str, details: dict | None = None):
    return DetailedValidationError({path: [ErrorDetail(code, code=code)]}, details=details)


def ensure_editable(item: ContentItem) -> None:
    """Rules 4-5: status allows a change and no job is active."""
    if item.status not in EDITABLE_STATUSES:
        reason = "terminal" if item.status in TERMINAL else "production_started"
        raise InvalidTransition({"status": item.status, "reason": reason})
    pipeline.ensure_idle(item)


def _open_slots(item: ContentItem, format: str) -> list[dict]:
    from apps.planning.models import PlanSlot

    qs = PlanSlot.objects.filter(plan_id=item.plan_id, format=format, status="open",
                                 scheduled_at__gte=timezone.now() + SLOT_LEAD).order_by(
        "scheduled_at")
    return [{"id": s.pk, "scheduled_at": _iso(s.scheduled_at), "role": s.role} for s in qs]


def _iso(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _live_briefs(item):
    return list(Brief.objects.filter(content_item=item, status__in=[
        DocumentStatus.DRAFT, DocumentStatus.APPROVED]).order_by("version"))


def _live_scripts(item):
    return list(ScriptVersion.objects.filter(content_item=item, status__in=[
        DocumentStatus.DRAFT, DocumentStatus.APPROVED]).order_by("version"))


def update_item_settings(item: ContentItem, data: dict, *, actor=None) -> tuple[ContentItem, dict]:
    unknown = [key for key in data if key not in ACCEPTED_KEYS]
    if unknown:
        raise DetailedValidationError(
            {key: [ErrorDetail("read_only", code="read_only")] for key in unknown})

    from apps.planning.models import PlanSlot

    with transaction.atomic():
        item = pipeline.lock(item)
        ensure_editable(item)

        old = {"format": item.format, "media_kind": item.media_kind,
               "production_mode": item.production_mode, "role": item.role, "slot": item.slot_id}
        new_format = data.get("format", item.format)
        if new_format not in formats.Format.values:
            raise _error("format", "invalid_choice")

        # Rule 8: fill media kind, then production mode.
        if "media_kind" in data:
            new_media = data["media_kind"]
            allowed_media = list(formats.media_kinds_for(new_format))
            if new_media not in allowed_media:
                raise _error("media_kind", "invalid_combination",
                             {"allowed_values": allowed_media})
        elif item.media_kind in formats.media_kinds_for(new_format):
            new_media = item.media_kind
        else:
            new_media = formats.defaults_for(new_format)[0]

        allowed_modes = list(formats.get_spec(new_format, new_media).production_modes)
        if "production_mode" in data:
            new_mode = data["production_mode"]
            if new_mode not in allowed_modes:
                raise _error("production_mode", "invalid_combination",
                             {"allowed_values": allowed_modes})
        elif item.production_mode in allowed_modes:
            new_mode = item.production_mode
        else:
            new_mode = formats.default_mode(new_format, new_media)

        # Slot (rules 10-14).
        new_slot = item.slot
        slot_sent = "slot" in data
        if slot_sent:
            slot_id = data["slot"]
            if slot_id is None:
                new_slot = None
            else:
                try:
                    new_slot = PlanSlot.objects.select_for_update().get(pk=int(slot_id))
                except (PlanSlot.DoesNotExist, TypeError, ValueError):
                    raise _error("slot", "does_not_exist") from None
                if new_slot.pk != item.slot_id:
                    if new_slot.plan_id != item.plan_id:
                        raise _error("slot", "slot_wrong_plan")
                    if new_slot.status != "open":
                        raise _error("slot", "slot_not_open")
                    if new_slot.scheduled_at < timezone.now() + SLOT_LEAD:
                        raise _error("slot", "slot_in_past")
                if new_slot.format != new_format:
                    raise _error("slot", "slot_format_mismatch",
                                 {"open_slots": _open_slots(item, new_format)})
        elif item.slot is not None and item.slot.format != new_format:
            raise _error("slot", "slot_format_mismatch",
                         {"open_slots": _open_slots(item, new_format)})

        # Role (rules 14-15).
        if "role" in data:
            new_role = data["role"]
            if new_role is not None and new_role not in roles.ROLE_KEYS:
                raise _error("role", "invalid_choice")
            if new_role is None and _live_briefs(item):
                raise _error("role", "role_required")
        else:
            new_role = item.role
            if new_role is None and new_slot is not None and new_slot.pk != item.slot_id and (
                    new_slot.role):
                new_role = new_slot.role

        changes = {}
        for key, value in (("format", new_format), ("media_kind", new_media),
                           ("production_mode", new_mode), ("role", new_role),
                           ("slot", new_slot.pk if new_slot else None)):
            if old[key] != value:
                changes[key] = [old[key], value]
        if not changes:
            return item, _effects(item.status, item.status, [], [], None, None)

        # Superseding (rules 16-18).
        strong = any(k in changes for k in ("format", "media_kind")) or (
            "role" in changes and old["role"] is not None)
        mode_only = "production_mode" in changes and not strong
        live_briefs = _live_briefs(item) if strong else []
        live_scripts = _live_scripts(item) if (strong or mode_only) else []
        if strong:
            status_to = S.SELECTED if item.status in (S.BRIEFED, S.SCRIPTED) else item.status
        elif mode_only and item.status == S.SCRIPTED:
            status_to = S.BRIEFED
        else:
            status_to = item.status
        if (live_briefs or live_scripts) and data.get("confirm") is not True:
            raise _error("confirm", "confirmation_required", {"would_supersede": {
                "briefs": [b.version for b in live_briefs],
                "scripts": [s.version for s in live_scripts], "status_to": status_to}})

        Brief.objects.filter(pk__in=[b.pk for b in live_briefs]).update(
            status=DocumentStatus.SUPERSEDED)
        ScriptVersion.objects.filter(pk__in=[s.pk for s in live_scripts]).update(
            status=DocumentStatus.SUPERSEDED)

        released = reserved = None
        if "slot" in changes:
            old_slot = item.slot
            if old_slot is not None:
                status = pipeline.release_slot(
                    PlanSlot.objects.select_for_update().get(pk=old_slot.pk))
                released = {"id": old_slot.pk, "status": status}
            item.slot = None
            item.save(update_fields=["slot", "updated_at"])
            if new_slot is not None:
                _reserve(new_slot)
                reserved = {"id": new_slot.pk}

        item.format, item.media_kind, item.production_mode = new_format, new_media, new_mode
        item.role = new_role
        item.slot = new_slot
        item.save(update_fields=["format", "media_kind", "production_mode", "role", "slot",
                                 "updated_at"])

        status_from = item.status
        if status_to != status_from:
            pipeline.transition(item, status_to, actor=actor, message=_message(old, item),
                                data={"changes": changes})
        pipeline.log_event(item, ContentEvent.Type.EDITED, actor=actor, message=_message(old, item),
                           data={"changes": changes,
                                 "superseded": {"briefs": [b.version for b in live_briefs],
                                                "scripts": [s.version for s in live_scripts]},
                                 "released_slot": released["id"] if released else None})
        if status_to == status_from:
            # The pipeline still needs to look at the item (for example a new role).
            item_id = item.pk
            transaction.on_commit(lambda: pipeline.advance(item_id))
        effects = _effects(status_from, status_to, [b.version for b in live_briefs],
                           [s.version for s in live_scripts], released, reserved)
    item.refresh_from_db()
    return item, effects


def _reserve(slot) -> None:
    from django.db import IntegrityError

    try:
        from apps.planning import services as planning_services
    except ImportError:  # pragma: no cover
        planning_services = None
    if slot.status != "open":
        raise ApiError("state_conflict", 409, details={"conflicts": ["slot"]})
    try:
        if planning_services is not None and hasattr(planning_services, "reserve_slot"):
            planning_services.reserve_slot(slot)
        else:
            slot.status = "reserved"
            slot.save(update_fields=["status", "updated_at"])
    except (IntegrityError, InvalidTransition):
        raise ApiError("state_conflict", 409, details={"conflicts": ["slot"]}) from None


def _effects(status_from, status_to, briefs, scripts, released, reserved) -> dict:
    return {"status_from": status_from, "status_to": status_to,
            "superseded": {"briefs": briefs, "scripts": scripts},
            "released_slot": released, "reserved_slot": reserved}


def _message(old: dict, item: ContentItem) -> str:
    """"Format changed from Reel to Video story" and the like (rule 19)."""
    if (old["format"], old["media_kind"]) != (item.format, item.media_kind):
        return (f"Format changed from {formats.format_label(old['format'], old['media_kind'])} "
                f"to {formats.format_label(item.format, item.media_kind)}")
    if old["role"] != item.role:
        return f"Role changed from {roles.label(old['role'])} to {roles.label(item.role)}"
    if old["production_mode"] != item.production_mode:
        return (f"Production mode changed from {formats.mode_label(old['production_mode'])} "
                f"to {formats.mode_label(item.production_mode)}")
    return "Slot changed"


@actions.register
def _edit_format_action(item, user, ctx):
    return ["edit_format"] if item.status in EDITABLE_STATUSES and ctx["idle"] else []
