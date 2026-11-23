"""The connection resource (`GET …/connection/`). Never serializes the token (rule 19)."""

from __future__ import annotations

from apps.accounts.models import AccountConnection, default_capabilities
from apps.core.jobs import job_summary

from .providers.base import CAPABILITY_KEYS
from .providers.registry import allowed_providers, provider_configured
from .services import active_connection_job


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def connection_payload(connection: AccountConnection) -> dict:
    capabilities = {**default_capabilities(), **(connection.capabilities or {})}
    return {
        "account": connection.account_id,
        "provider": connection.provider,
        "provider_configured": provider_configured(connection.provider),
        "allowed_providers": allowed_providers(),
        "status": connection.status,
        "ig_user_id": connection.ig_user_id or None,
        "username": connection.username or None,
        "account_type": connection.account_type or None,
        "has_token": connection.has_token,
        "token_expires_at": _ts(connection.token_expires_at),
        "token_refreshed_at": _ts(connection.token_refreshed_at),
        "scopes": list(connection.scopes or []),
        "capabilities": {key: bool(capabilities.get(key)) for key in CAPABILITY_KEYS},
        "last_verified_at": _ts(connection.last_verified_at),
        "last_error_code": connection.last_error_code or None,
        "last_error_at": _ts(connection.last_error_at),
        "active_job": job_summary(active_connection_job(connection.account_id)),
        "updated_at": _ts(connection.updated_at),
    }
