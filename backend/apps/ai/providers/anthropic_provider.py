"""Claude adapter on the official `anthropic` SDK (E00-S05 rules 12-18, AI-INTEGRATION.md 3).

Bindings checked against the pinned SDK (anthropic 1.17): `client.beta.messages.create`,
`.parse(output_format=Model)` and `.stream(...)` + `get_final_message()`, all taking `betas`,
`fallbacks`, `output_config` and `cache_control`; `anthropic.Anthropic(max_retries=0, timeout=)`.

- Structured output: `parse`/`stream` with `output_format=<Pydantic model>` (the SDK sets
  `output_config.format` and validates); no JSON is ever extracted from free text.
- Thinking stays at the model default; `output_config.effort` is always sent; no sampling
  parameters, prefill or forced tool choice.
- Refusals: `fallbacks="default"` with the `server-side-fallback-2026-07-01` beta; the final
  `stop_reason` is checked before content is read.
- Web search: the `web_search_20260209` server tool; `pause_turn` is continued by re-sending
  the user turn and the assistant content so far.
- Caching: the last system block (system.md, then the brand block) carries `cache_control`.
- Retries: the SDK's own retries are off (`max_retries=0`); the gateway retries.
"""

from __future__ import annotations

import base64
import threading

import anthropic
from pydantic import ValidationError

from ..errors import ProviderError
from .base import (
    OUTCOME_INVALID,
    OUTCOME_OK,
    OUTCOME_REFUSED,
    OUTCOME_TRUNCATED,
    OUTCOME_WEB_SEARCH_FAILED,
    TextRequest,
    TextResponse,
)

FALLBACK_BETA = "server-side-fallback-2026-07-01"
WEB_SEARCH_TOOL = "web_search_20260209"
MAX_CONTINUATIONS = 5

_clients: dict[tuple, anthropic.Anthropic] = {}
_clients_lock = threading.Lock()


def get_client(api_key: str, timeout: float) -> anthropic.Anthropic:
    """One SDK client per key and timeout per process; SDK retries off."""
    key = (api_key, float(timeout))
    with _clients_lock:
        client = _clients.get(key)
        if client is None:
            client = anthropic.Anthropic(api_key=api_key, max_retries=0, timeout=float(timeout))
            _clients[key] = client
        return client


def web_search_tool(options) -> dict:
    tool = {"type": WEB_SEARCH_TOOL, "name": "web_search", "max_uses": int(options.max_uses)}
    # The API takes allowed *or* blocked domains; an allow-list makes the block-list moot.
    if options.allowed_domains:
        tool["allowed_domains"] = list(options.allowed_domains)
    elif options.blocked_domains:
        tool["blocked_domains"] = list(options.blocked_domains)
    return tool


def build_params(request: TextRequest) -> dict:
    """The request body, without `output_format` (added per call)."""
    system = [{"type": "text", "text": text} for text in request.system if text]
    if system:
        # End of the stable prefix (system prompt + brand block): cacheable (rule 9).
        system[-1]["cache_control"] = {"type": "ephemeral"}
    content: list[dict] = [
        {"type": "image",
         "source": {"type": "base64", "media_type": image.media_type,
                    "data": base64.standard_b64encode(image.data).decode("ascii")}}
        for image in request.images
    ]
    content.append({"type": "text", "text": request.user})
    params = {
        "model": request.model,
        "max_tokens": request.max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": content}],
        "output_config": {"effort": request.effort},
        "betas": [FALLBACK_BETA],
        "fallbacks": "default",
    }
    if request.web_search is not None:
        params["tools"] = [web_search_tool(request.web_search)]
    return params


def _retry_after(exc) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) or {}
    for name, scale in (("retry-after-ms", 0.001), ("retry-after", 1.0)):
        raw = headers.get(name)
        if raw:
            try:
                return float(raw) * scale
            except (TypeError, ValueError):
                continue
    return None


def _block_type(block) -> str | None:
    return getattr(block, "type", None)


def _served_content(message) -> list:
    """Content produced by the model that served the turn (after the last fallback block)."""
    content = list(getattr(message, "content", None) or [])
    last_fallback = max((i for i, b in enumerate(content) if _block_type(b) == "fallback"),
                        default=-1)
    return content[last_fallback + 1:]


def _fallback_used(message) -> bool:
    usage = getattr(message, "usage", None)
    iterations = getattr(usage, "iterations", None) or []
    if any(getattr(entry, "type", None) == "fallback_message" for entry in iterations):
        return True
    return any(_block_type(b) == "fallback" for b in getattr(message, "content", None) or [])


def _usage(message, name: str) -> int:
    return int(getattr(getattr(message, "usage", None), name, None) or 0)


def _web_searches(message) -> int:
    server = getattr(getattr(message, "usage", None), "server_tool_use", None)
    return int(getattr(server, "web_search_requests", None) or 0)


class AnthropicTextProvider:
    name = "anthropic"

    def __init__(self, client: anthropic.Anthropic | None = None):
        self._client = client

    def client(self, request: TextRequest) -> anthropic.Anthropic:
        if self._client is not None:
            return self._client
        from django.conf import settings

        return get_client(settings.ANTHROPIC_API_KEY, request.timeout)

    def text(self, request: TextRequest) -> TextResponse:
        client = self.client(request)
        params = build_params(request)
        try:
            messages = self._run(client, request, params)
        except ValidationError as exc:
            # The SDK's structured-output parse failed (for example partial JSON).
            return TextResponse(outcome=OUTCOME_INVALID, model=request.model,
                                reason=f"schema validation failed: {exc.error_count()} errors")
        # Most specific SDK error first (AI-INTEGRATION.md section 3).
        except anthropic.RateLimitError as exc:
            raise ProviderError("rate_limited", retry_after=_retry_after(exc),
                                message=str(exc)) from exc
        except anthropic.APITimeoutError as exc:
            raise ProviderError("timeout", message=str(exc)) from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError("unavailable", message=str(exc)) from exc
        except (anthropic.BadRequestError, anthropic.AuthenticationError,
                anthropic.PermissionDeniedError, anthropic.NotFoundError,
                anthropic.UnprocessableEntityError, anthropic.RequestTooLargeError) as exc:
            raise ProviderError("bad_request", retryable=False, message=str(exc)) from exc
        except anthropic.APIStatusError as exc:
            if exc.status_code >= 500:
                raise ProviderError("unavailable", retry_after=_retry_after(exc),
                                    message=str(exc)) from exc
            raise ProviderError("bad_request", retryable=False, message=str(exc)) from exc
        except anthropic.APIError as exc:  # for example an error event inside a stream
            raise ProviderError("unavailable", message=str(exc)) from exc
        return self._response(request, messages)

    def _call(self, client, request: TextRequest, params: dict):
        if request.stream:
            extra = {"output_format": request.schema} if request.schema is not None else {}
            with client.beta.messages.stream(**params, **extra) as stream:
                return stream.get_final_message()
        if request.schema is not None:
            return client.beta.messages.parse(**params, output_format=request.schema)
        return client.beta.messages.create(**params)

    def _run(self, client, request: TextRequest, params: dict) -> list:
        """One request, continued after `pause_turn` (server tool loop limit)."""
        user_turn = params["messages"][0]
        assistant_content: list = []
        messages = []
        for _ in range(MAX_CONTINUATIONS + 1):
            call_params = dict(params)
            if assistant_content:
                call_params["messages"] = [user_turn,
                                           {"role": "assistant", "content": assistant_content}]
            message = self._call(client, request, call_params)
            messages.append(message)
            if message.stop_reason != "pause_turn":
                break
            assistant_content = [*assistant_content, *message.content]
        return messages

    def _response(self, request: TextRequest, messages: list) -> TextResponse:
        final = messages[-1]
        response = TextResponse(
            model=getattr(final, "model", None) or request.model,
            stop_reason=final.stop_reason,
            input_tokens=sum(_usage(m, "input_tokens") for m in messages),
            output_tokens=sum(_usage(m, "output_tokens") for m in messages),
            cache_read_tokens=sum(_usage(m, "cache_read_input_tokens") for m in messages),
            cache_write_tokens=sum(_usage(m, "cache_creation_input_tokens") for m in messages),
            web_searches=sum(_web_searches(m) for m in messages),
            fallback_used=any(_fallback_used(m) for m in messages),
            request_id=getattr(final, "_request_id", None),
        )
        # Check the stop reason before reading content (rule 14).
        if final.stop_reason == "refusal":
            response.outcome = OUTCOME_REFUSED
            return response

        texts: list[str] = []
        parsed = None
        searches = errors = 0
        citations: list[dict] = []
        for message in messages:
            for block in _served_content(message):
                kind = _block_type(block)
                if kind == "text":
                    texts.append(block.text)
                    if getattr(block, "parsed_output", None) is not None:
                        parsed = block.parsed_output
                elif kind == "web_search_tool_result":
                    searches += 1
                    content = block.content
                    if isinstance(content, list):
                        citations.extend({"url": r.url, "title": r.title or ""}
                                         for r in content if getattr(r, "url", None))
                    else:  # an error object, not an exception (rule 15)
                        errors += 1
        response.text = "".join(texts)
        response.citations = citations
        response.data = parsed

        if final.stop_reason in ("max_tokens", "pause_turn"):
            response.outcome = OUTCOME_TRUNCATED
            response.reason = f"stop_reason {final.stop_reason}"
        elif request.web_search is not None and searches and errors == searches:
            response.outcome = OUTCOME_WEB_SEARCH_FAILED
        elif request.schema is not None and parsed is None:
            response.outcome = OUTCOME_INVALID
            response.reason = "no parsed output"
        else:
            response.outcome = OUTCOME_OK
        return response
