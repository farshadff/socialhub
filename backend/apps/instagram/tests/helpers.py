"""Shared helpers for the E00-S04 tests."""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from rest_framework.test import APIClient

from apps.accounts.models import AccountConnection


def connection_url(account, suffix: str = "") -> str:
    return f"/api/v1/accounts/{account.pk}/connection/{suffix}"


def start_connect(client, account) -> dict:
    response = client.post(connection_url(account, "connect/"))
    assert response.status_code == 200, response.content
    return response.json()


def follow_authorize(authorize_url: str):
    """Open the fake authorize URL (it points straight at the callback) as Instagram's
    redirect would: an anonymous browser request."""
    parsed = urlparse(authorize_url)
    return APIClient().get(f"{parsed.path}?{parsed.query}")


def callback(params: dict):
    return APIClient().get("/api/v1/instagram/oauth/callback/", params)


def redirect_query(response) -> tuple[str, dict]:
    assert response.status_code == 302
    location = urlparse(response["Location"])
    return location.path, {key: values[0] for key, values in parse_qs(location.query).items()}


def connection_of(account) -> AccountConnection:
    return AccountConnection.objects.get(account=account)
