"""Provider adapters. Only this package imports the `anthropic` and `openai` SDKs (rule 2)."""

from __future__ import annotations

TEXT_PROVIDERS = ("anthropic", "fake")
IMAGE_PROVIDERS = ("openai", "fake")


def text_provider(name: str):
    if name == "anthropic":
        from .anthropic_provider import AnthropicTextProvider

        return AnthropicTextProvider()
    if name == "fake":
        from .fake import FakeTextProvider

        return FakeTextProvider()
    raise LookupError(f"Unknown text provider {name!r}.")


def image_provider(name: str):
    if name == "openai":
        from .openai_provider import OpenAIImageProvider

        return OpenAIImageProvider()
    if name == "fake":
        from .fake import FakeImageProvider

        return FakeImageProvider()
    raise LookupError(f"Unknown image provider {name!r}.")
