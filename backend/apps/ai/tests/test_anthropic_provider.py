"""Claude adapter against hand-built SDK response objects (E00-S05 BE3 test notes).

SDK types are reached through the adapter module, so this file has no `import anthropic`
(rule 2). The opt-in live test runs with `pytest -m live` and a real ANTHROPIC_API_KEY.
"""

from __future__ import annotations

import json
import os

import httpx2
import pytest
from pydantic import BaseModel, Field

from apps.ai.errors import ProviderError
from apps.ai.providers import anthropic_provider as ap
from apps.ai.providers.base import (
    OUTCOME_INVALID,
    OUTCOME_OK,
    OUTCOME_REFUSED,
    OUTCOME_TRUNCATED,
    OUTCOME_WEB_SEARCH_FAILED,
    PreparedImage,
    TextRequest,
)
from apps.ai.types import WebSearchOptions

SDK = ap.anthropic
BetaMessage = SDK.types.beta.BetaMessage
parse_beta_response = SDK.lib._parse._response.parse_beta_response


class Verdict(BaseModel):
    answer: str = Field(description="The answer")


def message(content, *, stop_reason="end_turn", model="claude-opus-5-5", **usage):
    body = {
        "id": "msg_test", "type": "message", "role": "assistant", "model": model,
        "stop_reason": stop_reason, "stop_sequence": None, "content": content,
        "usage": {"input_tokens": usage.pop("input_tokens", 10),
                  "output_tokens": usage.pop("output_tokens", 5), **usage},
    }
    return BetaMessage.model_validate(body)


def text_block(text):
    return {"type": "text", "text": text, "citations": None}


def search_result(*pairs):
    return {"type": "web_search_tool_result", "tool_use_id": "srvtoolu_1",
            "content": [{"type": "web_search_result", "url": url, "title": title,
                         "encrypted_content": "enc", "page_age": None} for url, title in pairs]}


def search_error():
    return {"type": "web_search_tool_result", "tool_use_id": "srvtoolu_2",
            "content": {"type": "web_search_tool_result_error", "error_code": "unavailable"}}


class FakeStream:
    def __init__(self, final):
        self.final = final

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self.final


class FakeMessages:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[tuple[str, dict]] = []

    def _next(self):
        item = self.responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    def create(self, **params):
        self.calls.append(("create", params))
        return self._next()

    def parse(self, **params):
        self.calls.append(("parse", params))
        item = self._next()
        return parse_beta_response(output_format=params["output_format"], response=item)

    def stream(self, **params):
        self.calls.append(("stream", params))
        item = self._next()
        if "output_format" in params:
            item = parse_beta_response(output_format=params["output_format"], response=item)
        return FakeStream(item)


class FakeClient:
    def __init__(self, *responses):
        self.beta = type("Beta", (), {})()
        self.beta.messages = FakeMessages(responses)


def request(**overrides) -> TextRequest:
    fields = {"task": "t", "model": "claude-opus-5-5",
              "system": ["You are a test.", "# Brand profile\n..."], "user": "Do it.",
              "effort": "medium", "max_tokens": 16000}
    fields.update(overrides)
    return TextRequest(**fields)


def run(client, **overrides):
    return ap.AnthropicTextProvider(client=client).text(request(**overrides))


def _http_error(cls, status, headers=None):
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx2.Response(status, headers=headers or {}, request=req)
    return cls("error", response=response, body=None)


# --- request shape ---------------------------------------------------------------------------


def test_request_shape_effort_cache_fallback_and_no_sampling():
    client = FakeClient(message([text_block("hi")]))
    result = run(client, images=[PreparedImage(b"\xff\xd8jpeg", "image/jpeg", "abc")])
    kind, params = client.beta.messages.calls[0]
    assert kind == "create"
    assert params["output_config"] == {"effort": "medium"}
    assert params["betas"] == ["server-side-fallback-2026-07-01"]
    assert params["fallbacks"] == "default"
    for forbidden in ("temperature", "top_p", "top_k", "tool_choice", "thinking"):
        assert forbidden not in params
    assert params["system"][0] == {"type": "text", "text": "You are a test."}
    assert params["system"][-1]["cache_control"] == {"type": "ephemeral"}
    content = params["messages"][0]["content"]
    assert [block["type"] for block in content] == ["image", "text"]
    assert content[0]["source"]["type"] == "base64"
    assert content[0]["source"]["media_type"] == "image/jpeg"
    assert len(params["messages"]) == 1 and params["messages"][0]["role"] == "user"
    assert result.outcome == OUTCOME_OK and result.text == "hi"
    assert (result.input_tokens, result.output_tokens) == (10, 5)


def test_structured_output_uses_sdk_parse():
    client = FakeClient(message([text_block(json.dumps({"answer": "yes"}))],
                                cache_read_input_tokens=7, cache_creation_input_tokens=3))
    result = run(client, schema=Verdict)
    kind, params = client.beta.messages.calls[0]
    assert kind == "parse" and params["output_format"] is Verdict
    assert isinstance(result.data, Verdict) and result.data.answer == "yes"
    assert (result.cache_read_tokens, result.cache_write_tokens) == (7, 3)


def test_streaming_uses_final_message_helper():
    client = FakeClient(message([text_block(json.dumps({"answer": "long"}))]))
    result = run(client, schema=Verdict, stream=True, max_tokens=64000)
    kind, params = client.beta.messages.calls[0]
    assert kind == "stream" and params["max_tokens"] == 64000
    assert params["output_format"] is Verdict and result.data.answer == "long"


def test_invalid_structured_output_is_reported_not_raised():
    client = FakeClient(message([text_block('{"answer": ')], stop_reason="end_turn"))
    result = run(client, schema=Verdict)
    assert result.outcome == OUTCOME_INVALID


def test_max_tokens_is_truncated():
    client = FakeClient(message([text_block("partial")], stop_reason="max_tokens"))
    assert run(client).outcome == OUTCOME_TRUNCATED


def test_refusal_checked_before_content_and_fallback_detected():
    client = FakeClient(message(
        [text_block("partial"),
         {"type": "fallback", "from": {"model": "claude-opus-5-5"},
          "to": {"model": "claude-opus-4-8"}, "trigger": {"type": "refusal"}}],
        stop_reason="refusal", model="claude-opus-4-8",
        iterations=[{"type": "fallback_message", "model": "claude-opus-4-8", "input_tokens": 1,
                     "output_tokens": 0, "cache_read_input_tokens": 0,
                     "cache_creation_input_tokens": 0}]))
    result = run(client)
    assert result.outcome == OUTCOME_REFUSED and result.text == ""
    assert result.fallback_used is True and result.model == "claude-opus-4-8"


def test_fallback_served_text_is_taken_after_the_fallback_block():
    client = FakeClient(message(
        [text_block("declined part"),
         {"type": "fallback", "from": {"model": "claude-opus-5-5"},
          "to": {"model": "claude-opus-4-8"}, "trigger": {"type": "refusal"}},
         text_block("served answer")], model="claude-opus-4-8"))
    result = run(client)
    assert result.text == "served answer" and result.fallback_used
    assert result.model == "claude-opus-4-8"


# --- web search ------------------------------------------------------------------------------


def test_web_search_tool_citations_and_pause_turn_continuation():
    first = message([{"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search",
                      "input": {"query": "q"}},
                     search_result(("https://a.example", "A"), ("https://b.example", "B"))],
                    stop_reason="pause_turn",
                    server_tool_use={"web_search_requests": 1, "web_fetch_requests": 0})
    second = message([search_error(), text_block("Summary.")],
                     server_tool_use={"web_search_requests": 1, "web_fetch_requests": 0})
    client = FakeClient(first, second)
    result = run(client, web_search=WebSearchOptions(max_uses=4, blocked_domains=["x.example"]))
    calls = client.beta.messages.calls
    assert calls[0][1]["tools"] == [{"type": "web_search_20260209", "name": "web_search",
                                     "max_uses": 4, "blocked_domains": ["x.example"]}]
    assert len(calls) == 2
    continued = calls[1][1]["messages"]
    assert continued[0] == calls[0][1]["messages"][0]
    assert continued[1]["role"] == "assistant" and len(continued) == 2
    assert result.outcome == OUTCOME_OK and result.text == "Summary."
    assert result.citations == [{"url": "https://a.example", "title": "A"},
                                {"url": "https://b.example", "title": "B"}]
    assert result.web_searches == 2 and result.input_tokens == 20


def test_every_search_errored_is_web_search_failed():
    client = FakeClient(message([search_error(), text_block("Nothing found.")]))
    assert run(client, web_search=WebSearchOptions()).outcome == OUTCOME_WEB_SEARCH_FAILED


def test_allowed_domains_take_precedence():
    tool = ap.web_search_tool(WebSearchOptions(max_uses=2, allowed_domains=["a.example"],
                                               blocked_domains=["b.example"]))
    assert tool == {"type": "web_search_20260209", "name": "web_search", "max_uses": 2,
                    "allowed_domains": ["a.example"]}


# --- error mapping ---------------------------------------------------------------------------


@pytest.mark.parametrize("error, detail, retryable, retry_after", [
    (_http_error(SDK.RateLimitError, 429, {"retry-after": "12"}), "rate_limited", True, 12.0),
    (_http_error(SDK.InternalServerError, 500), "unavailable", True, None),
    (_http_error(SDK.OverloadedError, 529), "unavailable", True, None),
    (_http_error(SDK.BadRequestError, 400), "bad_request", False, None),
    (_http_error(SDK.AuthenticationError, 401), "bad_request", False, None),
    (_http_error(SDK.ConflictError, 409), "bad_request", False, None),
    (SDK.APITimeoutError(request=httpx2.Request("POST", "https://api.anthropic.com")),
     "timeout", True, None),
    (SDK.APIConnectionError(request=httpx2.Request("POST", "https://api.anthropic.com")),
     "unavailable", True, None),
])
def test_sdk_errors_are_mapped(error, detail, retryable, retry_after):
    with pytest.raises(ProviderError) as caught:
        run(FakeClient(error))
    assert (caught.value.detail, caught.value.retryable, caught.value.retry_after) == (
        detail, retryable, retry_after)


def test_client_has_sdk_retries_off():
    client = ap.get_client("test-key-not-real", 180)
    assert client.max_retries == 0
    assert ap.get_client("test-key-not-real", 180) is client


# --- live (opt-in) ---------------------------------------------------------------------------


@pytest.mark.live
@pytest.mark.skipif(not os.environ.get("ANTHROPIC_API_KEY"), reason="needs ANTHROPIC_API_KEY")
def test_live_ping(settings):
    settings.ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
    result = ap.AnthropicTextProvider().text(request(
        system=["You are a connectivity check for Social Hub."],
        user="Reply with the single word: pong", effort="low", max_tokens=64))
    assert result.outcome == OUTCOME_OK and "pong" in result.text.lower()
