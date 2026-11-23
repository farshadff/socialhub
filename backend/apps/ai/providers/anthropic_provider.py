"""Claude adapter (E00-S05 rules 12–18, AI-INTEGRATION.md section 3).

The only module in the project that imports ``anthropic``. It performs one attempt; the
gateway owns retries, so the SDK's own retries are off (``max_retries=0``).
"""

from __future__ import annotations

import anthropic
from django.conf import settings

from ..errors import OutputInvalid, ProviderError, ProviderRefused
from ..results import ProviderResponse, TextRequest

FALLBACK_BETA = "server-side-fallback-2026-07-01"
WEB_SEARCH_TOOL = "web_search_20260209"
MAX_PAUSE_CONTINUATIONS = 5
NON_STREAM_MAX_TOKENS = 16000


def _retry_after(exc: anthropic.APIStatusError) -> float | None:
    try:
        value = exc.response.headers.get("retry-after")
        return float(value) if value is not None else None
    except (AttributeError, ValueError):
        return None


def _system_blocks(request: TextRequest) -> list[dict]:
    blocks = [{"type": "text", "text": request.system}]
    if request.brand_block:
        blocks.append({"type": "text", "text": request.brand_block})
    # End of the stable prefix: system prompt (+ brand block) is cached; per-item content follows.
    blocks[-1]["cache_control"] = {"type": "ephemeral"}
    return blocks


def _web_search_tool(request: TextRequest) -> dict:
    options = request.web_search
    tool = {"type": WEB_SEARCH_TOOL, "name": "web_search", "max_uses": options.max_uses}
    blocked = set(options.blocked_domains or ())
    blocked |= {
        domain.strip()
        for domain in (settings.SOCIALHUB_RESEARCH_BLOCKED_DOMAINS or "").split(",")
        if domain.strip()
    }
    # The API accepts one of allowed_domains or blocked_domains, never both.
    if options.allowed_domains:
        tool["allowed_domains"] = list(options.allowed_domains)
    elif blocked:
        tool["blocked_domains"] = sorted(blocked)
    return tool


class AnthropicTextProvider:
    name = "anthropic"

    def configured(self) -> bool:
        return bool(settings.ANTHROPIC_API_KEY and settings.SOCIALHUB_AI_TEXT_MODEL)

    def _client(self, timeout: float) -> anthropic.Anthropic:
        return anthropic.Anthropic(
            api_key=settings.ANTHROPIC_API_KEY, max_retries=0, timeout=timeout
        )

    def _call(self, client, request: TextRequest, messages: list[dict]):
        params = {
            "model": request.model,
            "max_tokens": request.max_tokens if request.stream else min(
                request.max_tokens, NON_STREAM_MAX_TOKENS
            ),
            "system": _system_blocks(request),
            "messages": messages,
            "output_config": {"effort": request.effort},
            "betas": [FALLBACK_BETA],
            "fallbacks": "default",
        }
        if request.web_search is not None:
            params["tools"] = [_web_search_tool(request)]
        if request.schema is not None:
            params["output_format"] = request.schema
            if request.stream:
                with client.beta.messages.stream(**params) as stream:
                    return stream.get_final_message()
            return client.beta.messages.parse(**params)
        if request.stream:
            with client.beta.messages.stream(**params) as stream:
                return stream.get_final_message()
        return client.beta.messages.create(**params)

    def complete(self, request: TextRequest) -> ProviderResponse:
        client = self._client(request.timeout)
        messages: list[dict] = [{"role": "user", "content": request.user}]
        totals = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "web_searches": 0}
        fallback_used = False
        try:
            for _ in range(MAX_PAUSE_CONTINUATIONS + 1):
                response = self._call(client, request, messages)
                usage = response.usage
                totals["input"] += usage.input_tokens or 0
                totals["output"] += usage.output_tokens or 0
                totals["cache_read"] += usage.cache_read_input_tokens or 0
                totals["cache_write"] += usage.cache_creation_input_tokens or 0
                if usage.server_tool_use is not None:
                    totals["web_searches"] += usage.server_tool_use.web_search_requests or 0
                fallback_used = fallback_used or any(
                    getattr(block, "type", None) == "fallback" for block in response.content
                ) or any(
                    getattr(entry, "type", None) == "fallback_message"
                    for entry in (usage.iterations or [])
                )
                if response.stop_reason == "pause_turn":
                    # A long server-tool turn paused; send it back so the server resumes it.
                    messages = [*messages, {"role": "assistant", "content": response.content}]
                    continue
                break
        except anthropic.APITimeoutError as exc:
            raise ProviderError("timeout", retryable=True) from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError("unavailable", retryable=True) from exc
        except anthropic.RateLimitError as exc:
            raise ProviderError("rate_limited", retryable=True, retry_after=_retry_after(exc)) from exc
        except anthropic.APIStatusError as exc:
            if exc.status_code >= 500:
                raise ProviderError(
                    "unavailable", retryable=True, retry_after=_retry_after(exc)
                ) from exc
            raise ProviderError("bad_request") from exc

        units = {
            "cache_read_tokens": totals["cache_read"],
            "cache_write_tokens": totals["cache_write"],
            "web_searches": totals["web_searches"],
            "fallback_used": fallback_used,
        }
        request_id = getattr(response, "_request_id", None)

        if response.stop_reason == "refusal":
            raise ProviderRefused(retryable=False)

        citations, searches, failed_searches = self._citations(response.content)
        if request.web_search is not None and searches and searches == failed_searches:
            raise ProviderError("web_search_failed")

        text = "".join(
            block.text for block in response.content if getattr(block, "type", None) == "text"
        )
        if request.schema is not None:
            if response.stop_reason == "max_tokens":
                raise OutputInvalid()
            data = getattr(response, "parsed_output", None)
            if data is None:
                raise OutputInvalid()
        else:
            data = text

        return ProviderResponse(
            data=data,
            model=response.model,
            citations=citations,
            input_tokens=totals["input"],
            output_tokens=totals["output"],
            units=units,
            request_id=request_id,
            raw_text=text,
        )

    @staticmethod
    def _citations(content) -> tuple[list[dict[str, str]], int, int]:
        seen: dict[str, dict[str, str]] = {}
        searches = failed = 0
        for block in content:
            if getattr(block, "type", None) != "web_search_tool_result":
                continue
            searches += 1
            results = block.content
            # A failed search carries an error object instead of a list of results.
            if not isinstance(results, list):
                failed += 1
                continue
            for result in results:
                if getattr(result, "type", None) == "web_search_result" and result.url:
                    seen.setdefault(result.url, {"url": result.url, "title": result.title or ""})
        return list(seen.values()), searches, failed
