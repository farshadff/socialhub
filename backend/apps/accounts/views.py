"""Account, brand profile, logo and font endpoints (E00-S03)."""

from __future__ import annotations

from collections.abc import Mapping

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.templatetags.static import static
from rest_framework import serializers, status
from rest_framework.exceptions import ErrorDetail, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from apps.core.errors import InstagramNotConnected, InvalidTransition
from apps.core.fonts import registry as font_registry
from apps.core.params import csv_values
from apps.core.permissions import IsAdmin, is_admin

from . import logos
from .models import AccountConnection, BrandProfile, InstagramAccount
from .serializers import (
    ADMIN_ONLY_FIELDS,
    AccountSerializer,
    AccountWriteSerializer,
    BrandSerializer,
    BrandWriteSerializer,
)
from .services import create_account


def _unique_handle_error() -> ValidationError:
    return ValidationError({"handle": [ErrorDetail("This is already in use.", code="unique")]})


def _body(request) -> Mapping:
    if not isinstance(request.data, Mapping):
        raise ValidationError({"non_field_errors": [ErrorDetail("Expected an object.",
                                                                code="invalid")]})
    return request.data


class AccountViewSet(GenericViewSet):
    """List, create, retrieve and partially update accounts. Accounts are never deleted."""

    serializer_class = AccountSerializer

    def get_permissions(self):
        if self.action == "create":
            return [IsAdmin()]
        return super().get_permissions()

    def get_queryset(self):
        return InstagramAccount.objects.select_related("connection", "brand").order_by("handle")

    def list(self, request):
        qs = self.get_queryset()
        statuses = csv_values(request, "status")
        valid = set(InstagramAccount.Status.values) | {"all"}
        if any(value not in valid for value in statuses):
            raise ValidationError({"status": [ErrorDetail("Unknown status.",
                                                          code="invalid_choice")]})
        if statuses and "all" not in statuses:
            qs = qs.filter(status__in=statuses)
        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(Q(handle__icontains=search.lstrip("@"))
                           | Q(display_name__icontains=search))
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    def retrieve(self, request, pk=None):
        return Response(self.get_serializer(get_object_or_404(self.get_queryset(), pk=pk)).data)

    def create(self, request):
        serializer = AccountWriteSerializer(data=_body(request))
        serializer.is_valid(raise_exception=True)
        try:
            account = create_account(**serializer.validated_data)
        except IntegrityError:  # a concurrent create took the handle
            raise _unique_handle_error() from None
        account = self.get_queryset().get(pk=account.pk)
        return Response(self.get_serializer(account).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        data = _body(request)
        try:
            with transaction.atomic():
                account = get_object_or_404(InstagramAccount.objects.select_for_update(), pk=pk)
                if not is_admin(request.user) and ADMIN_ONLY_FIELDS & set(data):
                    raise PermissionDenied()  # rule 10: nothing is saved
                serializer = AccountWriteSerializer(account, data=data, partial=True)
                serializer.is_valid(raise_exception=True)
                self._apply(account, serializer.validated_data)
        except IntegrityError:
            raise _unique_handle_error() from None
        return Response(self.get_serializer(self.get_queryset().get(pk=account.pk)).data)

    @staticmethod
    def _apply(account: InstagramAccount, changes: dict) -> None:
        connection, _ = AccountConnection.objects.select_for_update().get_or_create(
            account=account)
        new_handle = changes.get("handle", account.handle)
        if new_handle != account.handle and (
                connection.status != AccountConnection.Status.DISCONNECTED):
            raise InvalidTransition(details={"status": connection.status,
                                             "reason": "connection_not_disconnected"})

        new_status = changes.get("status", account.status)
        if changes.get("publishing_enabled") is True and not account.publishing_enabled:
            if new_status == InstagramAccount.Status.ARCHIVED:
                raise InvalidTransition(details={"status": account.status,
                                                 "reason": "account_archived"})
            if not connection.can_publish:
                raise InstagramNotConnected(details={"status": connection.status})

        for name, value in changes.items():
            setattr(account, name, value)
        account.save()  # archiving forces publishing_enabled off (rule 12)


class _AccountBrandMixin:
    def _brand(self, pk, *, lock=False) -> BrandProfile:
        account = get_object_or_404(InstagramAccount, pk=pk)
        qs = BrandProfile.objects.select_related("account")
        if lock:
            qs = qs.select_for_update()
        brand, _ = qs.get_or_create(account=account)
        return brand


class BrandView(_AccountBrandMixin, APIView):
    """`GET`/`PUT /accounts/{id}/brand/` for admins and operators (rule 15)."""

    def get(self, request, pk):
        return Response(BrandSerializer(self._brand(pk)).data)

    def put(self, request, pk):
        data = _body(request)
        with transaction.atomic():
            brand = self._brand(pk, lock=True)
            serializer = BrandWriteSerializer(data=data)
            serializer.is_valid(raise_exception=True)
            for name, value in serializer.validated_data.items():
                setattr(brand, name, value)
            for variant in logos.VARIANTS:  # rule 16: null removes a logo, anything else ignored
                if f"logo_{variant}" in data and data[f"logo_{variant}"] is None:
                    logos.remove_logo(brand, variant)
            brand.save()
        return Response(BrandSerializer(brand).data)


class LogoUploadSerializer(serializers.Serializer):
    variant = serializers.ChoiceField(choices=logos.VARIANTS)
    file = serializers.FileField(allow_empty_file=True)


class BrandLogoView(_AccountBrandMixin, APIView):
    """`POST /accounts/{id}/brand/logo/` (multipart `file`, `variant`)."""

    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk):
        get_object_or_404(InstagramAccount, pk=pk)
        serializer = LogoUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uploaded = serializer.validated_data["file"]
        variant = serializer.validated_data["variant"]
        ext = logos.validate_logo(uploaded)
        with transaction.atomic():
            brand = self._brand(pk, lock=True)
            logos.store_logo(brand, variant, uploaded, ext)
        return Response(BrandSerializer(brand).data)


class FontListView(APIView):
    """`GET /fonts/`: the bundled fonts, not paginated."""

    def get(self, request):
        results = []
        for font in font_registry.list_fonts():
            results.append({
                "key": font["key"],
                "name": font["name"],
                "scripts": font["scripts"],
                "weights": font["weights"],
                "files": {
                    str(weight): request.build_absolute_uri(
                        static(font_registry.static_path(font["key"], weight)))
                    for weight in font["weights"]
                },
            })
        return Response({"results": results})
