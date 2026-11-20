import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class PublishingDisabledError(RuntimeError):
    """Raised when code attempts to publish from the local fixture environment."""


@dataclass(frozen=True)
class FixtureSourceProvider:
    name: str = "fixture"

    def fetch(self) -> list[dict[str, Any]]:
        fixture_path = Path(__file__).parent / "fixtures" / "demo_source_items.json"
        with fixture_path.open(encoding="utf-8") as fixture_file:
            return json.load(fixture_file)


@dataclass(frozen=True)
class FixtureModelProvider:
    name: str = "fixture"

    def generate(self, brief: str) -> dict[str, str]:
        return {
            "brief": brief,
            "caption": "This static sample confirms the UI-to-API integration path.",
            "provider": self.name,
            "is_synthetic": True,
        }


@dataclass(frozen=True)
class DisabledPublisher:
    name: str = "disabled"
    enabled: bool = False

    def publish(self, *_args: Any, **_kwargs: Any) -> None:
        raise PublishingDisabledError("Publishing is disabled in the local scaffold.")


def get_local_provider_summary() -> dict[str, Any]:
    source = FixtureSourceProvider()
    model = FixtureModelProvider()
    publisher = DisabledPublisher()
    return {
        "source_provider": source.name,
        "model_provider": model.name,
        "publisher_provider": publisher.name,
        "publishing_enabled": publisher.enabled,
        "source_items": source.fetch(),
        "model_preview": model.generate("Development fixture sample"),
    }
