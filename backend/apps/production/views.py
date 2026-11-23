"""Production workspace endpoints (E06-S02 to S07)."""

from __future__ import annotations

from datetime import date

from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.content import formats
from apps.content.models import Asset, ContentVersion
from apps.content.serializers import asset_ref, iso, media_url
from apps.content.services import assets as asset_service
from apps.content.views import get_item
from apps.core.jobs import job_payload, job_summary, user_ref

from .rendering.templates import all_templates
from .services import assembly, orchestration, rights
from .services import copy as copy_service


def _static_base() -> str:
    return getattr(settings, "SOCIALHUB_STATIC_BASE_URL", "") or "http://localhost:8000/static/"


class RenderTemplatesView(APIView):
    def get(self, request):
        fmt = request.query_params.get("format")
        layouts = None
        if fmt:
            if fmt not in formats.Format.values:
                raise ValidationError({"format": [ErrorDetail("invalid_choice",
                                                              code="invalid_choice")]})
            layouts = {s.layout for s in formats.all_specs() if s.format == fmt}
        results = []
        for t in all_templates():
            if layouts and not layouts & set(t.layouts):
                continue
            base = _static_base().rstrip("/")
            results.append({
                "key": t.key, "name": t.name, "description": t.description,
                "version": t.version, "layouts": list(t.layouts), "image_slot": t.image_slot,
                "fields": t.field_limits(),
                "preview_urls": {lay: f"{base}/render-templates/{t.key}/preview-{lay}.png"
                                 for lay in t.layouts},
            })
        return Response({"count": len(results), "next": None, "previous": None,
                         "results": results})


# --- The production resource ---------------------------------------------------------------

def _frame_payload(version: ContentVersion, frame: dict, assets: dict) -> dict:
    data = dict(frame)
    asset = assets.get(frame.get("asset_id"))
    background = assets.get(frame.get("background_asset_id"))
    data["asset"] = ({"id": asset.pk, "url": media_url(asset.file),
                      "thumbnail_url": media_url(asset.thumbnail) if asset.thumbnail else None,
                      "width": asset.width, "height": asset.height} if asset else None)
    data["background_asset"] = ({"id": background.pk,
                                 "thumbnail_url": media_url(background.thumbnail or
                                                            background.file),
                                 "origin": background.origin,
                                 "rights_status": asset_service.effective_rights(background)}
                                if background else None)
    original = orchestration.script_frame(version, frame["index"])
    data["script_frame"] = ({k: original.get(k) for k in ("template", "headline", "body",
                                                         "duration_seconds", "transition")}
                            if original and frame.get("overridden") else None)
    return data


def _final_payload(asset):
    if asset is None:
        return None
    return {"id": asset.pk, "kind": asset.kind, "mime": asset.mime, "url": media_url(asset.file),
            "thumbnail_url": media_url(asset.thumbnail) if asset.thumbnail else None,
            "width": asset.width, "height": asset.height, "duration_ms": asset.duration_ms,
            "bytes": asset.bytes, "rights_status": asset_service.effective_rights(asset)}


def _shots_payload(version: ContentVersion) -> list[dict]:
    if version.content_item.production_mode != formats.VIDEO_MODE:
        return []
    out = []
    for shot in assembly.shots_of(version):
        out.append({"index": shot["index"], "type": shot["type"],
                    "duration_seconds": shot["duration_seconds"],
                    "description": shot.get("description", ""),
                    "asset_hint": shot.get("asset_hint", ""),
                    "frame_indexes": [f["index"] for f in version.frames
                                      if f.get("shot_index") == shot["index"]]})
    return out


def _clips_payload(version: ContentVersion) -> list[dict]:
    shots = {s["index"]: s for s in assembly.shots_of(version)}
    out = []
    for clip in version.clips or []:
        asset = Asset.objects.filter(pk=clip["asset_id"]).select_related("account").first()
        shot = shots.get(clip["shot_index"])
        if asset is None or shot is None:
            continue
        shot_ms = int(shot["duration_seconds"] * 1000)
        state, usable = assembly.clip_state(asset, clip.get("start_ms", 0), shot_ms)
        out.append({"shot_index": clip["shot_index"],
                    "asset": {"id": asset.pk, "original_filename": asset.original_filename,
                              "duration_ms": asset.duration_ms, "width": asset.width,
                              "height": asset.height,
                              "thumbnail_url": media_url(asset.thumbnail) if asset.thumbnail
                              else None,
                              "rights_status": asset_service.effective_rights(asset)},
                    "start_ms": clip.get("start_ms", 0), "shot_duration_ms": shot_ms,
                    "usable_ms": usable, "state": state})
    return out


def production_resource(item, version: ContentVersion | None, user, *, read_only=False) -> dict:
    spec = formats.get_spec(item.format, item.media_kind)
    active = orchestration.pipeline.active_job(item)
    versions = list(ContentVersion.objects.filter(content_item=item).order_by("-version"))
    latest = versions[0].version if versions else 0
    base = {
        "content_item": item.pk, "latest_version": latest, "format": item.format,
        "media_kind": item.media_kind, "production_mode": item.production_mode,
        "copy_limits": copy_service.copy_limits(spec),
        "active_job": job_summary(active) if active else None,
        "versions": [{"version": v.version, "status": v.status, "origin": v.origin,
                      "is_current": v.pk == item.current_version_id,
                      "change_note": v.change_note, "created_at": iso(v.created_at),
                      "submitted_at": iso(v.submitted_at)} for v in versions],
    }
    if version is None:
        actions = orchestration.production_actions(item, None, user)
        return {**base, "version": None, "is_current": False, "status": None, "origin": None,
                "render_status": "pending", "script": None, "change_note": "", "frames": [],
                "final_asset": None, "cover_asset": None, "cover_frame_index": None,
                "music_asset": None, "shots": [], "clips": [], "missing_shots": [],
                "caption": "", "hashtags": [], "alt_text": "", "caption_preview": "",
                "caption_length": 0, "hashtag_count": 0, "disclosure_required": False,
                "uses_ai_generated": False, "render_warnings": [], "production_steps": {},
                "submitted_at": None, "submitted_by": None, "submit_trigger": None,
                "actions": actions}
    ids = {f.get("asset_id") for f in version.frames} | {f.get("background_asset_id")
                                                         for f in version.frames}
    assets = {a.pk: a for a in Asset.objects.filter(pk__in=[i for i in ids if i]).select_related(
        "account")}
    script = version.script
    from apps.content.services.scripts import approved_script

    approved = approved_script(item)
    music = version.music_asset
    is_current = version.pk == item.current_version_id
    actions = orchestration.production_actions(item, version, user)
    if read_only or not is_current:
        actions = {k: (False if isinstance(v, bool) else v) for k, v in actions.items()}
    preview = copy_service.full_caption(version)
    return {
        **base,
        "version": version.version, "is_current": is_current, "status": version.status,
        "origin": version.origin, "render_status": version.render_status,
        "script": ({"id": script.pk, "version": script.version, "status": script.status,
                    "is_current": approved is not None and approved.pk == script.pk}
                   if script else None),
        "change_note": version.change_note,
        "frames": [_frame_payload(version, f, assets) for f in version.frames]
        if version.origin == ContentVersion.VersionOrigin.PIPELINE else
        [_frame_payload(version, f, assets) | {"ignored": True} for f in version.frames],
        "final_asset": _final_payload(version.final_asset),
        "cover_asset": asset_ref(version.cover_asset),
        "cover_frame_index": version.cover_frame_index,
        "music_asset": ({"id": music.pk, "kind": music.kind,
                         "original_filename": music.original_filename,
                         "duration_ms": music.duration_ms,
                         "rights_status": asset_service.effective_rights(music),
                         "url": media_url(music.file)} if music else None),
        "shots": _shots_payload(version),
        "clips": _clips_payload(version),
        "missing_shots": assembly.missing_shots(version)
        if item.production_mode == formats.VIDEO_MODE else [],
        "caption": version.caption, "hashtags": version.hashtags, "alt_text": version.alt_text,
        "caption_preview": preview, "caption_length": len(preview),
        "hashtag_count": copy_service.hashtag_count(version.caption, version.hashtags),
        "disclosure_required": copy_service.disclosure_required(version)
        if spec.caption_allowed else False,
        "uses_ai_generated": rights.uses_ai_generated(version),
        "render_warnings": version.render_warnings or [],
        "production_steps": version.production_steps or {},
        "submitted_at": iso(version.submitted_at),
        "submitted_by": user_ref(version.submitted_by),
        "submit_trigger": version.submit_trigger,
        "actions": actions,
    }


def _current(item, request):
    raw = request.query_params.get("version")
    if raw in (None, ""):
        return item.current_version, False
    try:
        number = int(raw)
    except ValueError:
        raise NotFound() from None
    version = ContentVersion.objects.filter(content_item=item, version=number).first()
    if version is None:
        raise NotFound()
    return version, True


def _respond(request, pk, *, status_code=200, extra=None):
    item = get_item(pk)
    data = production_resource(item, item.current_version, request.user)
    if extra:
        data.update(extra)
    return Response(data, status=status_code)


class ProductionView(APIView):
    def get(self, request, pk):
        item = get_item(pk)
        version, read_only = _current(item, request)
        return Response(production_resource(item, version, request.user, read_only=read_only))

    def patch(self, request, pk):
        orchestration.update_settings(get_item(pk), dict(request.data), user=request.user)
        return _respond(request, pk)


class ProductionStartView(APIView):
    def post(self, request, pk):
        item = get_item(pk)
        job = orchestration.start_production(
            item, actor=request.user, reason="manual",
            restart_from_script=bool(request.data.get("restart_from_script")),
            request_id=getattr(request, "request_id", None))
        if job is None:
            item = get_item(pk)
            return Response({"job": None, "content_version": item.current_version.version,
                             "unchanged": True})
        return Response({"job": job_payload(job)}, status=status.HTTP_202_ACCEPTED)


class ProductionRenderView(APIView):
    def post(self, request, pk):
        job = orchestration.start_render_job(
            get_item(pk), base_version=request.data.get("base_version"),
            frames=request.data.get("frames"), reassemble=request.data.get("reassemble", True),
            user=request.user, request_id=getattr(request, "request_id", None))
        return Response({"job": job_payload(job)}, status=status.HTTP_202_ACCEPTED)


class ProductionFrameView(APIView):
    def put(self, request, pk, index):
        orchestration.update_frame(get_item(pk), index, dict(request.data), user=request.user)
        return _respond(request, pk)


class ProductionClipsView(APIView):
    def put(self, request, pk):
        orchestration.set_clips(get_item(pk), dict(request.data), user=request.user)
        return _respond(request, pk)


class ProductionGenerateImageView(APIView):
    def post(self, request, pk):
        frame_index = request.data.get("frame_index")
        if not isinstance(frame_index, int) or isinstance(frame_index, bool):
            raise ValidationError({"frame_index": [ErrorDetail("required", code="required")]})
        job = orchestration.start_image_job(
            get_item(pk), base_version=request.data.get("base_version"),
            frame_index=frame_index, prompt=request.data.get("prompt"),
            attach=request.data.get("attach", True), rerender=request.data.get("rerender", True),
            user=request.user, request_id=getattr(request, "request_id", None))
        return Response({"job": job_payload(job)}, status=status.HTTP_202_ACCEPTED)


def _date(value):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({"rights_expires_at": [ErrorDetail("invalid", code="invalid")]}
                              ) from None


def _int_or_none(value, name):
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValidationError({name: [ErrorDetail("invalid", code="invalid")]}) from None


class ProductionFinalAssetView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request, pk):
        item = get_item(pk)
        rights_data = {"origin": request.data.get("origin"),
                       "rights_status": request.data.get("rights_status"),
                       "license_note": request.data.get("license_note"),
                       "source_url": request.data.get("source_url"),
                       "rights_expires_at": _date(request.data.get("rights_expires_at"))}
        version, copy_job = orchestration.use_final_asset(
            item, user=request.user, uploaded=request.FILES.get("file"),
            asset_id=_int_or_none(request.data.get("asset_id"), "asset_id"),
            base_version=_int_or_none(request.data.get("base_version"), "base_version"),
            cover_uploaded=request.FILES.get("cover"),
            cover_asset_id=_int_or_none(request.data.get("cover_asset_id"), "cover_asset_id"),
            rights=rights_data, request_id=getattr(request, "request_id", None))
        return _respond(request, pk)


class ProductionSubmitView(APIView):
    def post(self, request, pk):
        item = get_item(pk)
        version = orchestration.check_base_version(item, request.data.get("base_version"))
        orchestration.pipeline.ensure_idle(item)
        orchestration.submit_version(item, version, actor=request.user, trigger="submission",
                                     acknowledge_warnings=bool(
                                         request.data.get("acknowledge_warnings")))
        item = get_item(pk)
        version.refresh_from_db()
        active = orchestration.pipeline.active_job(item)
        return Response({
            "content_item": {"id": item.pk, "status": item.status,
                             "active_job": job_summary(active) if active else None},
            "version": version.version, "status": version.status,
            "submitted_at": iso(version.submitted_at),
            "submitted_by": user_ref(version.submitted_by),
            "submit_trigger": version.submit_trigger,
        })


class CopyGenerateView(APIView):
    def post(self, request, pk):
        job = orchestration.start_copy_job(
            get_item(pk), base_version=request.data.get("base_version"),
            feedback=(request.data.get("feedback") or "").strip(),
            keep_hashtags=bool(request.data.get("keep_hashtags")), user=request.user,
            request_id=getattr(request, "request_id", None))
        return Response({"job": job_payload(job)}, status=status.HTTP_202_ACCEPTED)


class CopyView(APIView):
    def put(self, request, pk):
        item = get_item(pk)
        orchestration.pipeline.ensure_idle(item)
        if item.status != "in_production" or item.current_version is None or (
                item.current_version.status != ContentVersion.Status.DRAFT):
            from apps.core.errors import InvalidTransition

            raise InvalidTransition({"status": item.status, "allowed_statuses":
                                     ["in_production"]})
        version = orchestration.check_base_version(item, request.data.get("base_version"))
        copy_service.save_copy(version, dict(request.data), user=request.user)
        return _respond(request, pk)
