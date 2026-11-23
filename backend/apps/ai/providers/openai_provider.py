"""OpenAI image adapter on the official `openai` SDK (E00-S05 rules 19-22).

Image generation endpoint only: `client.images.generate(model=, prompt=, size=, n=1)` (openai
2.x). GPT Image models return base64 data by default; DALL-E models are asked for
`response_format="b64_json"`. SDK retries are off; the gateway retries. A content-policy
rejection raises `ProviderRefused`.
"""

from __future__ import annotations

import base64
import threading

import openai

from ..errors import ProviderError, ProviderRefused
from .base import ImageRequest, ImageResponse

POLICY_CODES = frozenset({"content_policy_violation", "moderation_blocked",
                          "image_content_policy_violation"})
_MIME = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "webp": "image/webp"}

_clients: dict[tuple, openai.OpenAI] = {}
_clients_lock = threading.Lock()


def get_client(api_key: str, timeout: float) -> openai.OpenAI:
    key = (api_key, float(timeout))
    with _clients_lock:
        client = _clients.get(key)
        if client is None:
            client = openai.OpenAI(api_key=api_key, max_retries=0, timeout=float(timeout))
            _clients[key] = client
        return client


def _retry_after(exc) -> float | None:
    headers = getattr(getattr(exc, "response", None), "headers", None) or {}
    for name, scale in (("retry-after-ms", 0.001), ("retry-after", 1.0)):
        raw = headers.get(name)
        if raw:
            try:
                return float(raw) * scale
            except (TypeError, ValueError):
                continue
    return None


def _sniff_mime(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


class OpenAIImageProvider:
    name = "openai"

    def __init__(self, client: openai.OpenAI | None = None):
        self._client = client

    def client(self, request: ImageRequest) -> openai.OpenAI:
        if self._client is not None:
            return self._client
        from django.conf import settings

        return get_client(settings.OPENAI_API_KEY, request.timeout)

    def image(self, request: ImageRequest) -> ImageResponse:
        client = self.client(request)
        params = {"model": request.model, "prompt": request.prompt, "size": request.size, "n": 1}
        if request.model.startswith("dall-e"):
            params["response_format"] = "b64_json"
        try:
            result = client.images.generate(**params)
        except openai.RateLimitError as exc:
            raise ProviderError("rate_limited", retry_after=_retry_after(exc),
                                message=str(exc)) from exc
        except openai.APITimeoutError as exc:
            raise ProviderError("timeout", message=str(exc)) from exc
        except openai.APIConnectionError as exc:
            raise ProviderError("unavailable", message=str(exc)) from exc
        except openai.BadRequestError as exc:
            if getattr(exc, "code", None) in POLICY_CODES:
                raise ProviderRefused() from exc
            raise ProviderError("bad_request", retryable=False, message=str(exc)) from exc
        except (openai.AuthenticationError, openai.PermissionDeniedError, openai.NotFoundError,
                openai.UnprocessableEntityError, openai.ConflictError) as exc:
            raise ProviderError("bad_request", retryable=False, message=str(exc)) from exc
        except openai.APIStatusError as exc:
            if exc.status_code >= 500:
                raise ProviderError("unavailable", retry_after=_retry_after(exc),
                                    message=str(exc)) from exc
            raise ProviderError("bad_request", retryable=False, message=str(exc)) from exc
        except openai.APIError as exc:
            raise ProviderError("unavailable", message=str(exc)) from exc

        image = (result.data or [None])[0]
        b64 = getattr(image, "b64_json", None)
        if not b64:
            raise ProviderError("bad_request", retryable=False,
                                message="The image response carried no base64 data.")
        content = base64.b64decode(b64)
        mime = _MIME.get(getattr(result, "output_format", None) or "", None) or _sniff_mime(content)
        units = {}
        usage = getattr(result, "usage", None)
        if usage is not None:
            units["image_input_tokens"] = int(getattr(usage, "input_tokens", 0) or 0)
            units["image_output_tokens"] = int(getattr(usage, "output_tokens", 0) or 0)
        return ImageResponse(content=content, mime=mime, model=request.model,
                             request_id=getattr(result, "_request_id", None), units=units)
