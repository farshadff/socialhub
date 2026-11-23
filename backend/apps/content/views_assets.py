"""Asset library endpoints (E06-S01)."""

from __future__ import annotations

from datetime import date

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import ErrorDetail, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.jobs import user_ref
from apps.core.pagination import BoundedPageNumberPagination
from apps.core.params import bool_param, csv_values, required_account

from .models import Asset, ContentItem
from .serializers import iso, media_url
from .services import assets as asset_service

ORDERINGS = {"-created_at", "created_at", "bytes", "-bytes"}


def asset_payload(asset: Asset, *, used=None, duplicate=None) -> dict:
    uses = asset_service.used_by(asset) if used is None else used
    data = {
        "id": asset.pk, "account": asset.account_id, "content_item": asset.content_item_id,
        "kind": asset.kind, "role": asset.role, "url": media_url(asset.file),
        "thumbnail_url": media_url(asset.thumbnail) if asset.thumbnail else None,
        "original_filename": asset.original_filename, "mime": asset.mime, "bytes": asset.bytes,
        "width": asset.width, "height": asset.height, "duration_ms": asset.duration_ms,
        "checksum": asset.checksum, "origin": asset.origin,
        "rights_status": asset_service.effective_rights(asset),
        "license_note": asset.license_note, "source_url": asset.source_url,
        "rights_expires_at": asset.rights_expires_at.isoformat() if asset.rights_expires_at
        else None,
        "meta": asset.meta, "in_use": bool(uses), "created_by": user_ref(asset.created_by),
        "created_at": iso(asset.created_at), "updated_at": iso(asset.updated_at),
    }
    if duplicate is not None:
        data["duplicate"] = duplicate
    return data


def _date(value, name):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({name: [ErrorDetail("invalid", code="invalid")]}) from None


class AssetListView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        account = required_account(request)
        qs = Asset.objects.filter(account=account).select_related("account", "created_by")
        item = request.query_params.get("content_item")
        if item == "null":
            qs = qs.filter(content_item__isnull=True)
        elif item:
            qs = qs.filter(content_item_id=item)
        for name in ("kind", "role", "origin"):
            values = csv_values(request, name)
            if values:
                qs = qs.filter(**{f"{name}__in": values})
        if q := request.query_params.get("q"):
            qs = qs.filter(Q(original_filename__icontains=q) | Q(license_note__icontains=q))
        ordering = request.query_params.get("ordering") or "-created_at"
        if ordering not in ORDERINGS:
            raise ValidationError({"ordering": [ErrorDetail("invalid", code="invalid")]})
        qs = qs.order_by(ordering, "-pk")
        rights = csv_values(request, "rights_status")
        wanted_in_use = bool_param(request, "in_use")
        usage = asset_service.usage_index(account.pk)
        if rights or wanted_in_use is not None:
            # Effective rights and usage are computed values; filter in Python (bounded lists).
            rows = []
            for asset in qs[:2000]:
                if rights and asset_service.effective_rights(asset) not in rights:
                    continue
                if wanted_in_use is not None and bool(usage.get(asset.pk)) != wanted_in_use:
                    continue
                rows.append(asset)
            qs = rows
        paginator = BoundedPageNumberPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(
            [asset_payload(a, used=usage.get(a.pk, [])) for a in page])

    def post(self, request):
        from apps.accounts.models import InstagramAccount

        errors = {}
        uploaded = request.FILES.get("file")
        if uploaded is None:
            errors["file"] = [ErrorDetail("required", code="required")]
        account_id = request.data.get("account")
        account = InstagramAccount.objects.filter(pk=account_id).first() if (
            str(account_id or "").isdigit()) else None
        if account is None:
            errors["account"] = [ErrorDetail("required" if not account_id else "does_not_exist",
                                             code="required" if not account_id else
                                             "does_not_exist")]
        if errors:
            raise ValidationError(errors)
        item = None
        if request.data.get("content_item"):
            item = ContentItem.objects.filter(pk=request.data["content_item"]).first()
            if item is None or item.account_id != account.pk:
                raise ValidationError({"content_item": [ErrorDetail("invalid", code="invalid")]})
        asset, duplicate = asset_service.upload(
            account=account, uploaded=uploaded, user=request.user, content_item=item,
            role=request.data.get("role") or "source",
            origin=request.data.get("origin") or "uploaded",
            rights_status=request.data.get("rights_status") or None,
            license_note=request.data.get("license_note") or "",
            source_url=request.data.get("source_url") or "",
            rights_expires_at=_date(request.data.get("rights_expires_at"), "rights_expires_at"))
        return Response(asset_payload(asset, duplicate=duplicate),
                        status=status.HTTP_200_OK if duplicate else status.HTTP_201_CREATED)


class AssetDetailView(APIView):
    def get(self, request, pk):
        asset = get_object_or_404(Asset.objects.select_related("account", "created_by"), pk=pk)
        uses = asset_service.used_by(asset)
        data = asset_payload(asset, used=uses)
        data["used_by"] = uses
        return Response(data)

    def patch(self, request, pk):
        asset = get_object_or_404(Asset.objects.select_related("account"), pk=pk)
        asset_service.update(asset, dict(request.data))
        return Response(asset_payload(asset))

    def delete(self, request, pk):
        asset = get_object_or_404(Asset.objects.select_related("account"), pk=pk)
        asset_service.delete(asset)
        return Response(status=status.HTTP_204_NO_CONTENT)
