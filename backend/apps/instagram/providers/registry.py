"""Provider registry (E00-S04 rule 8).

`get_provider(name)` returns the adapter for a stored `AccountConnection.provider`. `graph_api`
is a reserved name: its adapter is not built yet, so asking for it raises
`ProviderNotConfigured` (`503 provider_not_configured` from the API).
TODO(E00-S04-BE2): add `providers/graph_api.py` and return it here once the Meta app exists
(docs/INSTAGRAM-INTEGRATION.md sections 3, 7 and 8; spec rules 9-12).
"""

from __future__ import annotations

from django.conf import settings

from .base import InstagramProvider, ProviderNotConfigured
from .fake import FakeProvider
from .manual import ManualProvider

PROVIDER_NAMES = ("graph_api", "manual", "fake")
META_SETTINGS = ("SOCIALHUB_META_APP_ID", "SOCIALHUB_META_APP_SECRET",
                 "SOCIALHUB_META_REDIRECT_URI", "SOCIALHUB_IG_API_VERSION")
GRAPH_API_NOT_BUILT = "adapter_not_built"

_INSTANCES: dict[str, InstagramProvider] = {}


def allowed_providers() -> list[str]:
    return list(settings.SOCIALHUB_IG_ALLOWED_PROVIDERS)


def missing_settings(name: str) -> list[str]:
    """Settings the provider still needs on this server (only `graph_api` needs any)."""
    if name != "graph_api":
        return []
    return [setting for setting in META_SETTINGS if not getattr(settings, setting, "")]


def provider_configured(name: str) -> bool:
    """Rule 42: `manual` and `fake` always are; `graph_api` is not until its adapter exists."""
    if name == "graph_api":
        return False  # TODO(E00-S04-BE2): `not missing_settings(name)` once the adapter exists.
    return name in PROVIDER_NAMES


def ensure_configured(name: str) -> None:
    if name == "graph_api":
        raise ProviderNotConfigured("graph_api", missing_settings("graph_api"),
                                    reason=GRAPH_API_NOT_BUILT)
    if name not in PROVIDER_NAMES:
        raise ProviderNotConfigured(name, [], reason="unknown_provider")


def get_provider(name: str) -> InstagramProvider:
    ensure_configured(name)
    if name not in _INSTANCES:
        _INSTANCES[name] = FakeProvider() if name == "fake" else ManualProvider()
    return _INSTANCES[name]
