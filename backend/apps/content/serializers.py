"""Response shapes for content items, briefs and scripts (E03-S04, E04-S03, E05-S01)."""

from __future__ import annotations

from apps.core.jobs import job_summary, user_ref

from . import actions
from .models import Brief, ContentEvent, ContentItem, ContentVersion, ScriptVersion

NEEDS_ATTENTION_STATUSES = ("needs_revision", "in_review", "failed")


def iso(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _active_job(item: ContentItem):
    from .services import pipeline

    job = pipeline.active_job(item)
    return job_summary(job) if job else None


def needs_attention(item: ContentItem, active) -> bool:
    if item.status in NEEDS_ATTENTION_STATUSES:
        return True
    return bool(item.hold_reason) and active is None


def media_url(file):
    if not file:
        return None
    try:
        from apps.core.storage import media_url as core_media_url

        return core_media_url(file)
    except ImportError:
        return file.url


def asset_ref(asset):
    if asset is None:
        return None
    return {"id": asset.pk, "url": media_url(asset.file), "kind": asset.kind,
            "width": asset.width, "height": asset.height, "duration_ms": asset.duration_ms,
            "thumbnail_url": media_url(asset.thumbnail) if asset.thumbnail else None}


def thumbnail_url(item: ContentItem):
    """Rule 10: cover asset, final image, first frame asset."""
    version = item.current_version
    if version is None:
        return None
    if version.cover_asset_id:
        asset = version.cover_asset
        return media_url(asset.thumbnail or asset.file)
    if version.final_asset_id and version.final_asset.kind == "image":
        asset = version.final_asset
        return media_url(asset.thumbnail or asset.file)
    for frame in version.frames or []:
        if frame.get("asset_id"):
            from .models import Asset

            asset = Asset.objects.filter(pk=frame["asset_id"]).first()
            if asset is not None:
                return media_url(asset.thumbnail or asset.file)
    return None


def slot_summary(slot):
    if slot is None:
        return None
    return {"id": slot.pk, "scheduled_at": iso(slot.scheduled_at), "format": slot.format,
            "role": slot.role, "status": slot.status}


def brief_summary(brief: Brief | None):
    if brief is None:
        return None
    return {"id": brief.pk, "version": brief.version, "status": brief.status,
            "origin": brief.origin, "role": brief.role, "key_message": brief.key_message,
            "success_metric": brief.success_metric, "created_at": iso(brief.created_at)}


def script_summary(script: ScriptVersion | None):
    if script is None:
        return None
    payload = script.payload or {}
    return {"id": script.pk, "version": script.version, "status": script.status,
            "origin": script.origin, "hook": payload.get("hook", ""),
            "duration_seconds": payload.get("duration_seconds", 0),
            "frame_count": len(payload.get("frames") or []),
            "shot_count": len(payload.get("shots") or []), "created_at": iso(script.created_at)}


def version_summary(version: ContentVersion | None):
    if version is None:
        return None
    return {"id": version.pk, "version": version.version, "status": version.status,
            "render_status": version.render_status, "origin": version.origin,
            "caption": version.caption, "hashtags": version.hashtags,
            "final_asset": asset_ref(version.final_asset),
            "cover_asset": asset_ref(version.cover_asset)}


def item_summary(item: ContentItem) -> dict:
    active = _active_job(item)
    plan = item.plan
    candidate = item.candidate
    return {
        "id": item.pk,
        "account": item.account_id,
        "title": item.title,
        "format": item.format,
        "media_kind": item.media_kind,
        "production_mode": item.production_mode,
        "role": item.role,
        "status": item.status,
        "hold_reason": item.hold_reason,
        "needs_attention": needs_attention(item, active),
        "revision_count": item.revision_count,
        "plan": {"id": plan.pk, "title": plan.title, "week_start": plan.week_start.isoformat()},
        "slot": slot_summary(item.slot),
        "candidate": {"id": candidate.pk, "kind": candidate.kind,
                      "total_score": f"{candidate.total_score:.2f}"},
        "active_job": active,
        "thumbnail_url": thumbnail_url(item),
        "publication": None,
        "created_at": iso(item.created_at),
        "updated_at": iso(item.updated_at),
    }


def item_detail(item: ContentItem, user) -> dict:
    data = item_summary(item)
    plan = item.plan
    candidate = item.candidate
    data.update({
        "cancelled_reason": item.cancelled_reason,
        "plan": {"id": plan.pk, "title": plan.title, "week_start": plan.week_start.isoformat(),
                 "week_end": plan.week_end.isoformat(), "status": plan.status},
        "candidate": {
            "id": candidate.pk, "kind": candidate.kind, "title": candidate.title,
            "summary": candidate.summary, "rationale": candidate.rationale,
            "sources": candidate.sources or [], "evidence_score": candidate.evidence_score,
            "goal_fit_score": candidate.goal_fit_score,
            "freshness_score": candidate.freshness_score,
            "total_score": f"{candidate.total_score:.2f}", "rank": candidate.rank,
        },
        "current_brief": brief_summary(item.current_brief),
        "current_script": script_summary(item.current_script),
        "current_version": version_summary(item.current_version),
        "latest_check": None,
        "open_review_task": None,
        "publication": None,
        "allowed_actions": actions.allowed_actions(item, user),
        "created_by": user_ref(item.created_by),
    })
    return data


def event_payload(event: ContentEvent) -> dict:
    return {"id": event.pk, "type": event.type, "from_status": event.from_status,
            "to_status": event.to_status, "actor": user_ref(event.actor),
            "message": event.message, "data": event.data, "created_at": iso(event.created_at)}


# --- Briefs -------------------------------------------------------------------------------

def brief_payload(brief: Brief) -> dict:
    return {
        "id": brief.pk, "version": brief.version, "role": brief.role,
        "objective": brief.objective, "key_message": brief.key_message,
        "hook_direction": brief.hook_direction, "audience_note": brief.audience_note,
        "cta": brief.cta, "must_include": brief.must_include, "must_avoid": brief.must_avoid,
        "references": brief.references, "format_notes": brief.format_notes,
        "success_metric": brief.success_metric, "status": brief.status, "origin": brief.origin,
        "feedback": brief.feedback, "ai_run": brief.ai_run_id,
        "created_by": user_ref(brief.created_by), "created_at": iso(brief.created_at),
    }


def brief_document(item: ContentItem, brief: Brief | None) -> dict:
    from .services import briefs

    latest = briefs.latest_brief(item)
    approved = briefs.approved_brief(item)
    shown = brief if brief is not None else latest
    if shown is not None:
        issues = briefs.validate_brief(briefs.brief_fields(shown), item, shown.role)
        validation = {"valid": not issues, "issues": issues}
        warnings = briefs.brief_warnings(shown, item)
    else:
        validation = {"valid": False, "issues": []}
        warnings = []
    return {
        "content_item": item.pk,
        "brief": brief_payload(shown) if shown is not None else None,
        "latest_version": latest.version if latest else 0,
        "approved_version": approved.version if approved else None,
        "validation": validation,
        "warnings": warnings,
        "actions": briefs.brief_actions(item),
    }


# --- Scripts ------------------------------------------------------------------------------

def script_document(item: ContentItem, script: ScriptVersion) -> dict:
    from .services import scripts

    latest = scripts.latest_script(item)
    approved = scripts.approved_script(item)
    brief = script.brief
    issues = scripts.validate_for_item(script.payload, item, brief)
    return {
        "content_item": item.pk,
        "version": script.version,
        "latest_version": latest.version if latest else 0,
        "approved_version": approved.version if approved else None,
        "status": script.status,
        "origin": script.origin,
        "feedback": script.feedback,
        "brief_version": brief.version,
        "brief_is_current": item.current_brief_id == script.brief_id,
        "ai_run": script.ai_run_id,
        "created_by": user_ref(script.created_by),
        "created_at": iso(script.created_at),
        "payload": script.payload,
        "validation": {"valid": not issues, "issues": issues},
        "actions": scripts.script_actions(item, script),
    }


def script_version_row(item: ContentItem, script: ScriptVersion, latest_pk) -> dict:
    from .services import scripts

    issues = scripts.validate_for_item(script.payload, item, script.brief)
    return {
        "version": script.version, "status": script.status, "origin": script.origin,
        "source": scripts.version_source(script), "feedback": script.feedback,
        "brief_version": script.brief.version, "is_latest": script.pk == latest_pk,
        "valid": not issues, "summary": scripts.script_summary(script),
        "created_by": user_ref(script.created_by), "created_at": iso(script.created_at),
    }
