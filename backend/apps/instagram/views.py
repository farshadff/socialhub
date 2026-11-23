"""Connection endpoints and the public OAuth callback (E00-S04 "API").

Admin only: `PATCH` and `DELETE …/connection/`, `connect/`, `refresh-token/`. Any signed-in user:
`GET …/connection/` and `verify/`. The callback is public and protected by the single-use state.
"""

from __future__ import annotations

from collections.abc import Mapping

from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET
from rest_framework import status
from rest_framework.exceptions import ErrorDetail, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AccountConnection, InstagramAccount
from apps.core.errors import InstagramNotConnected, InvalidTransition
from apps.core.jobs import job_payload
from apps.core.permissions import IsAdmin

from . import services
from .providers.registry import allowed_providers, ensure_configured
from .serializers import connection_payload

Status = AccountConnection.Status
Provider = AccountConnection.Provider


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _account(pk) -> InstagramAccount:
    return get_object_or_404(InstagramAccount.objects.select_related("connection"), pk=pk)


def _connection(account: InstagramAccount) -> AccountConnection:
    connection, _ = AccountConnection.objects.get_or_create(account=account)
    return connection


def _field_error(field: str, code: str, message: str) -> ValidationError:
    return ValidationError({field: [ErrorDetail(message, code=code)]})


def _job_guards(account: InstagramAccount, connection: AccountConnection) -> None:
    if account.is_archived:
        raise InvalidTransition(details={"status": connection.status,
                                         "reason": "account_archived"})
    if connection.provider == Provider.MANUAL:
        raise InvalidTransition(details={"status": connection.status,
                                         "reason": "manual_provider"})


def _request_id(request):
    return getattr(request, "request_id", None)


class ConnectionView(APIView):
    """`GET` (any signed-in user), `PATCH` and `DELETE` (admin) `/accounts/{id}/connection/`."""

    def get_permissions(self):
        if self.request.method in ("PATCH", "DELETE"):
            return [IsAdmin()]
        return [IsAuthenticated()]

    def get(self, request, pk):
        return Response(connection_payload(_connection(_account(pk))))

    def patch(self, request, pk):
        account = _account(pk)
        data = request.data if isinstance(request.data, Mapping) else {}
        provider = data.get("provider")
        if provider in (None, ""):
            raise _field_error("provider", "required", "This field is required.")
        if not isinstance(provider, str) or provider not in allowed_providers():
            raise _field_error("provider", "invalid", "This connection type is not allowed.")
        connection = services.choose_provider(account, provider)
        connection.refresh_from_db()
        return Response(connection_payload(connection))

    def delete(self, request, pk):
        services.disconnect(_account(pk))
        return Response(status=status.HTTP_204_NO_CONTENT)


class ConnectView(APIView):
    """`POST /accounts/{id}/connection/connect/` (admin): start "Connect with Instagram"."""

    permission_classes = [IsAdmin]

    def post(self, request, pk):
        result = services.start_connect(_account(pk), request.user)
        return Response({"authorize_url": result["authorize_url"],
                         "expires_at": _ts(result["expires_at"])})


class VerifyView(APIView):
    """`POST /accounts/{id}/connection/verify/` (any signed-in user) → `instagram.verify`."""

    def post(self, request, pk):
        account = _account(pk)
        connection = _connection(account)
        _job_guards(account, connection)
        if not connection.has_token:
            raise InstagramNotConnected(details={"status": connection.status})
        ensure_configured(connection.provider)
        job = services.start_connection_job(services.VERIFY_KIND, account, user=request.user,
                                            request_id=_request_id(request))
        return Response({"job": job_payload(job)}, status=status.HTTP_202_ACCEPTED)


class RefreshTokenView(APIView):
    """`POST /accounts/{id}/connection/refresh-token/` (admin) → `instagram.refresh_token`."""

    permission_classes = [IsAdmin]

    def post(self, request, pk):
        account = _account(pk)
        connection = _connection(account)
        _job_guards(account, connection)
        if (connection.status not in (Status.CONNECTED, Status.EXPIRING)
                or not connection.has_token):
            raise InstagramNotConnected(details={"status": connection.status})
        retry_after = services.refresh_blocked_until(connection)
        if retry_after is not None:
            error = InvalidTransition(details={"status": connection.status,
                                               "reason": "token_refreshed_recently",
                                               "retry_after": _ts(retry_after)})
            raise error
        ensure_configured(connection.provider)
        job = services.start_connection_job(services.REFRESH_KIND, account, user=request.user,
                                            request_id=_request_id(request))
        return Response({"job": job_payload(job)}, status=status.HTTP_202_ACCEPTED)


@require_GET
def oauth_callback(request):
    """`GET /instagram/oauth/callback/`: public; always a `302` to the panel, never JSON."""
    outcome = services.complete_oauth(request.GET)
    response = HttpResponseRedirect(outcome.redirect_url)
    response["Cache-Control"] = "no-store"
    response["Referrer-Policy"] = "no-referrer"
    return response
