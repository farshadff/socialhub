"""OpenAI image adapter with a mocked client (E00-S05 rules 19-22). No `import openai` here."""

from __future__ import annotations

import base64
import io
import os

import httpx
import pytest
from PIL import Image

from apps.ai.errors import ProviderError, ProviderRefused
from apps.ai.providers import openai_provider as op
from apps.ai.providers.base import ImageRequest

SDK = op.openai


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (1, 2, 3)).save(buffer, format="PNG")
    return buffer.getvalue()


class FakeImages:
    def __init__(self, outcome):
        self.outcome = outcome
        self.calls = []

    def generate(self, **params):
        self.calls.append(params)
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        return self.outcome


class FakeClient:
    def __init__(self, outcome):
        self.images = FakeImages(outcome)


def response(data: bytes, output_format="png"):
    return SDK.types.ImagesResponse.model_validate({
        "created": 1, "output_format": output_format,
        "data": [{"b64_json": base64.b64encode(data).decode()}],
        "usage": {"input_tokens": 12, "output_tokens": 300, "total_tokens": 312,
                  "input_tokens_details": {"image_tokens": 0, "text_tokens": 12}},
    })


def _request(model="gpt-image-2"):
    return ImageRequest(task="t", model=model, prompt="A sea. No text.", size="1024x1536")


def _error(cls, status, body=None):
    req = httpx.Request("POST", "https://api.openai.com/v1/images/generations")
    return cls("error", response=httpx.Response(status, request=req), body=body)


def test_generate_returns_bytes_and_mime():
    client = FakeClient(response(_png()))
    result = op.OpenAIImageProvider(client=client).image(_request())
    assert client.images.calls == [{"model": "gpt-image-2", "prompt": "A sea. No text.",
                                    "size": "1024x1536", "n": 1}]
    assert result.content == _png() and result.mime == "image/png"
    assert result.units == {"image_input_tokens": 12, "image_output_tokens": 300}


def test_dall_e_asks_for_base64():
    client = FakeClient(response(_png()))
    op.OpenAIImageProvider(client=client).image(_request("dall-e-3"))
    assert client.images.calls[0]["response_format"] == "b64_json"


def test_content_policy_rejection_is_refused():
    error = _error(SDK.BadRequestError, 400,
                   {"code": "content_policy_violation", "message": "blocked"})
    with pytest.raises(ProviderRefused):
        op.OpenAIImageProvider(client=FakeClient(error)).image(_request())


@pytest.mark.parametrize("error, detail, retryable", [
    (_error(SDK.RateLimitError, 429), "rate_limited", True),
    (_error(SDK.InternalServerError, 500), "unavailable", True),
    (_error(SDK.BadRequestError, 400, {"code": "invalid_size"}), "bad_request", False),
    (SDK.APITimeoutError(request=httpx.Request("POST", "https://api.openai.com")), "timeout",
     True),
])
def test_errors_are_mapped(error, detail, retryable):
    with pytest.raises(ProviderError) as caught:
        op.OpenAIImageProvider(client=FakeClient(error)).image(_request())
    assert (caught.value.detail, caught.value.retryable) == (detail, retryable)


def test_client_has_sdk_retries_off():
    assert op.get_client("test-key-not-real", 180).max_retries == 0


@pytest.mark.live
@pytest.mark.skipif(not (os.environ.get("OPENAI_API_KEY")
                         and os.environ.get("SOCIALHUB_AI_IMAGE_MODEL")),
                    reason="needs OPENAI_API_KEY and SOCIALHUB_AI_IMAGE_MODEL")
def test_live_image(settings):
    settings.OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
    result = op.OpenAIImageProvider().image(ImageRequest(
        task="system.ping_image", model=os.environ["SOCIALHUB_AI_IMAGE_MODEL"],
        prompt="A plain light grey surface. No text.", size="1024x1024"))
    with Image.open(io.BytesIO(result.content)) as image:
        assert image.size == (1024, 1024)
