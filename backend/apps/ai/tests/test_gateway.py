"""Gateway core with a scripted provider double (E00-S05 BE2 test notes)."""

from __future__ import annotations

import io
import json
from decimal import Decimal

import jinja2
import pytest
from PIL import Image

from apps.ai import gateway
from apps.ai.errors import (
    AIError,
    CallLimitExceeded,
    OutputInvalid,
    ProviderError,
    ProviderNotConfigured,
    ProviderRefused,
)
from apps.ai.gateway import ImageInput, WebSearchOptions, run_image, run_text
from apps.ai.models import AIRun
from apps.ai.providers.base import (
    OUTCOME_INVALID,
    OUTCOME_REFUSED,
    OUTCOME_TRUNCATED,
    OUTCOME_WEB_SEARCH_FAILED,
    ImageResponse,
)
from apps.ai.tasks import TaskSpec
from apps.core.models import JobRun

from .conftest import SCHEMA_PY, ok

pytestmark = pytest.mark.django_db


def _png(width: int, height: int, mode: str = "RGB") -> bytes:
    buffer = io.BytesIO()
    color = (10, 20, 30, 128) if mode == "RGBA" else (10, 20, 30)
    Image.new(mode, (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


# --- configuration ---------------------------------------------------------------------------


def test_fake_is_configured_without_keys(settings):
    assert settings.SOCIALHUB_AI_TEXT_PROVIDER == "fake"
    assert gateway.is_configured("text") and gateway.is_configured("image")


def test_missing_key_writes_airun_and_raises(settings, scripted):
    """AC2: anthropic without ANTHROPIC_API_KEY."""
    settings.SOCIALHUB_AI_TEXT_PROVIDER = "anthropic"
    settings.ANTHROPIC_API_KEY = ""
    double = scripted()
    assert gateway.is_configured("text") is False
    assert gateway.provider_status("text")["missing"] == ["ANTHROPIC_API_KEY"]
    with pytest.raises(ProviderNotConfigured) as caught:
        run_text("system.ping", variables={})
    assert caught.value.code == "provider_not_configured"
    assert caught.value.detail == "ANTHROPIC_API_KEY is not set."
    run = AIRun.objects.get()
    assert (run.status, run.error_code, run.provider) == ("error", "provider_not_configured",
                                                          "anthropic")
    assert double.requests == []


def test_model_override_per_task(anthropic_settings, scripted):
    anthropic_settings.SOCIALHUB_AI_TEXT_MODEL_OVERRIDES = {"system.ping": "claude-haiku-5-5"}
    double = scripted(ok("pong", model="claude-haiku-5-5"))
    run_text("system.ping", variables={})
    assert double.requests[0].model == "claude-haiku-5-5"
    assert gateway.text_model("other.task") == "claude-opus-5-5"


# --- programming errors: before any provider call, no AIRun ---------------------------------


def test_missing_template_variable_fails_before_provider(prompt_task, scripted):
    """AC7."""
    prompt_task("t.vars", {"user.md": "Hello {{ name }} and {{ missing }}"})
    double = scripted(ok())
    with pytest.raises(jinja2.UndefinedError):
        run_text("t.vars", variables={"name": "x"})
    assert double.requests == [] and AIRun.objects.count() == 0


def test_schema_with_web_search_is_a_programming_error(prompt_task, scripted):
    """AC10, second half."""
    prompt_task("t.schema", {"schema.py": SCHEMA_PY})
    double = scripted(ok())
    from apps.ai import registry

    with pytest.raises(ValueError):
        run_text("t.schema", variables={"value": 1}, schema=registry.schema_for("t.schema"),
                 web_search=WebSearchOptions())
    assert double.requests == [] and AIRun.objects.count() == 0


def test_unknown_task_and_wrong_kind(scripted):
    scripted()
    with pytest.raises(LookupError):
        run_text("no.such.task", variables={})
    with pytest.raises(ValueError):
        run_image("system.ping", prompt="x", size="square")
    with pytest.raises(ValueError):
        run_image("system.ping_image", prompt="x", size="huge")
    assert AIRun.objects.count() == 0


def test_more_than_eight_images_rejected(scripted):
    scripted()
    images = [ImageInput(_png(10, 10))] * 9
    with pytest.raises(ValueError):
        run_text("system.ping", variables={}, images=images)


# --- retries ---------------------------------------------------------------------------------


def test_rate_limited_twice_then_ok(anthropic_settings, scripted):
    """AC4: one AIRun, units.attempts == 3, waits 2 then 8 seconds."""
    double = scripted(ProviderError("rate_limited"), ProviderError("rate_limited"), ok("pong"))
    result = run_text("system.ping", variables={})
    assert result.data == "pong"
    run = AIRun.objects.get()
    assert run.units["attempts"] == 3 and run.status == "ok"
    assert double.sleeps == [2, 8]


def test_retry_after_longer_than_schedule_is_used_and_capped(anthropic_settings, scripted):
    double = scripted(ProviderError("rate_limited", retry_after=20),
                      ProviderError("unavailable", retry_after=500), ok())
    run_text("system.ping", variables={})
    assert double.sleeps == [20, 60]


def test_gives_up_after_four_attempts(anthropic_settings, scripted):
    double = scripted(*[ProviderError("timeout") for _ in range(4)])
    with pytest.raises(ProviderError) as caught:
        run_text("system.ping", variables={})
    assert caught.value.detail == "timeout"
    assert len(double.requests) == 4 and double.sleeps == [2, 8, 30]
    run = AIRun.objects.get()
    assert run.units["attempts"] == 4 and run.status == "error"
    assert run.payload["error"] == {"code": "provider_error", "detail": "timeout"}


def test_bad_request_is_not_retried(anthropic_settings, scripted):
    """AC5."""
    double = scripted(ProviderError("bad_request", retryable=False), ok())
    with pytest.raises(ProviderError) as caught:
        run_text("system.ping", variables={})
    assert caught.value.detail == "bad_request" and caught.value.retryable is False
    assert len(double.requests) == 1 and double.sleeps == []


# --- outcomes --------------------------------------------------------------------------------


def test_refusal_is_logged_as_refused(anthropic_settings, scripted):
    """AC6: the fallback did not resolve it."""
    scripted(ok("", stop_reason="refusal", outcome=OUTCOME_REFUSED, fallback_used=True,
                input_tokens=10, model="claude-opus-4-8"))
    with pytest.raises(ProviderRefused) as caught:
        run_text("system.ping", variables={})
    assert (caught.value.code, caught.value.detail) == ("provider_error", "refused")
    run = AIRun.objects.get()
    assert run.status == "refused" and run.units["fallback_used"] is True
    assert run.model == "claude-opus-4-8" and run.input_tokens == 10


def test_refusal_raised_by_provider_is_logged(scripted):
    scripted(ProviderRefused("refused"))
    with pytest.raises(ProviderRefused):
        run_text("system.ping", variables={})
    assert AIRun.objects.get().status == "refused"


@pytest.mark.parametrize("outcome", [OUTCOME_TRUNCATED, OUTCOME_INVALID])
def test_truncated_or_invalid_output(anthropic_settings, scripted, outcome):
    scripted(ok("{\"ideas\": [", outcome=outcome, stop_reason="max_tokens"))
    with pytest.raises(OutputInvalid) as caught:
        run_text("system.ping", variables={})
    assert caught.value.detail == "invalid_output"
    assert AIRun.objects.get().status == "error"


def test_schema_mismatch_is_output_invalid(prompt_task, anthropic_settings, scripted):
    prompt_task("t.schema", {"schema.py": SCHEMA_PY})
    from apps.ai import registry

    schema = registry.schema_for("t.schema")
    scripted(ok(data={"ideas": [{"title": "x", "score": 500}]}))
    with pytest.raises(OutputInvalid):
        run_text("t.schema", variables={"value": 1}, schema=schema)


def test_web_search_failed(anthropic_settings, scripted):
    scripted(ok("", outcome=OUTCOME_WEB_SEARCH_FAILED))
    with pytest.raises(ProviderError) as caught:
        run_text("system.ping", variables={}, web_search=WebSearchOptions())
    assert caught.value.detail == "web_search_failed"


def test_schema_result_cost_and_tokens(prompt_task, anthropic_settings, scripted):
    """AC3: data is an instance of the schema; cost from the price table."""
    prompt_task("t.schema", {"schema.py": SCHEMA_PY})
    from apps.ai import registry

    schema = registry.schema_for("t.schema")
    parsed = schema(ideas=[{"title": "A", "score": 50}])
    scripted(ok(data=parsed, input_tokens=4150, output_tokens=1260, cache_read_tokens=1900,
                cache_write_tokens=100, request_id="req_1"))
    result = run_text("t.schema", variables={"value": 1}, schema=schema)
    assert isinstance(result.data, schema) and result.data.ideas[0].title == "A"
    run = AIRun.objects.get(pk=result.ai_run_id)
    # 4150*4 + 1260*20 + 1900*0.20 + 100*5.00 per million
    expected = (Decimal(4150 * 4) + Decimal(1260 * 20) + Decimal("380") + Decimal("500")) \
        / Decimal(1_000_000)
    assert run.cost_usd == expected.quantize(Decimal("0.000001"))
    assert (run.input_tokens, run.output_tokens, run.status) == (4150, 1260, "ok")
    assert run.units["cache_read_tokens"] == 1900 and run.units["cache_write_tokens"] == 100
    assert run.prompt_version == "3" and run.provider_request_id == "req_1"
    assert run.payload["response"]["data"] == {"ideas": [{"title": "A", "score": 50}]}


def test_web_search_cost_and_citations_deduplicated(anthropic_settings, scripted):
    scripted(ok("found", web_searches=2, citations=[
        {"url": "https://a.example/1", "title": "A"},
        {"url": "https://a.example/1", "title": "A again"},
        {"url": "https://b.example/2", "title": "B"},
    ]))
    result = run_text("system.ping", variables={}, web_search=WebSearchOptions(max_uses=3))
    assert result.citations == [{"url": "https://a.example/1", "title": "A"},
                                {"url": "https://b.example/2", "title": "B"}]
    run = AIRun.objects.get()
    assert run.units["web_searches"] == 2
    assert run.cost_usd == Decimal("0.020000")


def test_model_without_price(anthropic_settings, scripted):
    scripted(ok(model="claude-new-model", input_tokens=1000, output_tokens=10))
    run_text("system.ping", variables={})
    run = AIRun.objects.get()
    assert run.cost_usd == 0 and run.units["price_missing"] is True
    anthropic_settings.SOCIALHUB_AI_TEXT_MODEL = "claude-new-model"
    assert gateway.models_without_price() == ["claude-new-model"]


def test_cost_helpers():
    cost, missing = gateway.text_cost("claude-haiku-5-5", input_tokens=1_000_000,
                                      output_tokens=1_000_000)
    assert (cost, missing) == (Decimal("0.600000"), False)
    assert gateway.image_cost("unknown", size="1024x1024", shape="square") == (Decimal(0), True)


def test_blocked_domains_are_merged(anthropic_settings, scripted):
    anthropic_settings.SOCIALHUB_RESEARCH_BLOCKED_DOMAINS = ["spam.example"]
    double = scripted(ok())
    run_text("system.ping", variables={},
             web_search=WebSearchOptions(max_uses=2, blocked_domains=["Bad.example"]))
    assert double.requests[0].web_search.blocked_domains == ["bad.example", "spam.example"]
    assert double.requests[0].web_search.max_uses == 2


# --- images, caching prefix, payload ---------------------------------------------------------


def test_large_image_is_downscaled(anthropic_settings, scripted):
    """AC9: a 3000x4000 image is sent at most 1568 px on its long side, JPEG."""
    double = scripted(ok())
    run_text("system.ping", variables={},
             images=[ImageInput(_png(3000, 4000), "image/png"), ImageInput(_png(50, 40, "RGBA"))])
    sent = double.requests[0].images
    with Image.open(io.BytesIO(sent[0].data)) as image:
        assert max(image.size) <= 1568 and image.size == (1176, 1568)
    assert sent[0].media_type == "image/jpeg" and sent[1].media_type == "image/png"
    options = AIRun.objects.get().payload["request"]["options"]
    assert options["images"][0]["sha256"] == sent[0].sha256
    assert set(options["images"][0]) == {"sha256", "bytes", "media_type"}


def test_brand_block_and_content_language_with_account(prompt_task, anthropic_settings,
                                                         scripted):
    factories = pytest.importorskip("apps.accounts.tests.factories")
    account = factories.make_account(content_language="en")
    prompt_task("t.brand", {"system.md": "Write in {{ content_language }}.",
                            "user.md": "Item {{ value }}"})
    double = scripted(ok(), ok())
    run_text("t.brand", variables={"value": 7}, account_id=account.pk)
    request = double.requests[0]
    assert request.system[0] == "Write in en."
    assert len(request.system) == 2 and "Brand profile" in request.system[1]
    assert request.user == "Item 7"
    assert AIRun.objects.get().account_id == account.pk


def test_no_brand_block_when_task_opts_out(prompt_task, anthropic_settings, scripted):
    factories = pytest.importorskip("apps.accounts.tests.factories")
    account = factories.make_account()
    prompt_task("t.nobrand", spec=TaskSpec(provider="text", effort="low", cache_brand=False))
    double = scripted(ok())
    run_text("t.nobrand", variables={"value": 1}, account_id=account.pk)
    assert len(double.requests[0].system) == 1


def test_structured_variables_render_as_sorted_json(prompt_task, scripted):
    prompt_task("t.json", {"user.md": "Data: {{ data }}"})
    double = scripted(ok())
    run_text("t.json", variables={"data": {"b": 1, "a": [2, "x"]}})
    assert double.requests[0].user == 'Data: {"a": [2, "x"], "b": 1}'


def test_non_streaming_max_tokens_capped(prompt_task, anthropic_settings, scripted):
    prompt_task("t.big", spec=TaskSpec(provider="text", effort="high", max_tokens=64000))
    prompt_task("t.stream", spec=TaskSpec(provider="text", effort="high", max_tokens=64000,
                                          stream=True))
    double = scripted(ok(), ok())
    run_text("t.big", variables={"value": 1})
    run_text("t.stream", variables={"value": 1})
    assert [r.max_tokens for r in double.requests] == [16000, 64000]
    assert [r.stream for r in double.requests] == [False, True]
    assert double.requests[0].effort == "high"


def test_payload_truncated_at_64_kb(anthropic_settings, scripted):
    scripted(ok("x" * 200_000))
    run_text("system.ping", variables={})
    run = AIRun.objects.get()
    assert run.payload["truncated"] is True
    assert len(json.dumps(run.payload, ensure_ascii=False).encode()) <= 64 * 1024
    assert run.payload["request"]["user"] == "Reply with the single word: pong"


def test_payload_never_contains_api_key(anthropic_settings, scripted):
    scripted(ok())
    run_text("system.ping", variables={})
    assert "test-key-not-real" not in json.dumps(AIRun.objects.get().payload)


# --- call guard ------------------------------------------------------------------------------


def _job():
    return JobRun.objects.create(kind="test.kind", target_type="system", target_id="x")


def test_call_guard_stops_at_limit(anthropic_settings, scripted):
    """AC8: 20 calls made; the 21st raises without calling the provider."""
    job = _job()
    AIRun.objects.bulk_create([AIRun(job=job, provider="anthropic", task="system.ping",
                                     status="ok") for _ in range(20)])
    double = scripted(ok())
    with pytest.raises(CallLimitExceeded) as caught:
        run_text("system.ping", variables={}, job_id=job.pk)
    assert caught.value.detail == "call_limit" and isinstance(caught.value, AIError)
    assert double.requests == []


def test_retries_share_one_airun_for_the_guard(anthropic_settings, scripted):
    anthropic_settings.SOCIALHUB_AI_MAX_CALLS_PER_JOB = 2
    job = _job()
    scripted(ProviderError("unavailable"), ok(), ok())
    run_text("system.ping", variables={}, job_id=job.pk)
    run_text("system.ping", variables={}, job_id=job.pk)
    assert AIRun.objects.filter(job=job).count() == 2
    with pytest.raises(CallLimitExceeded):
        run_text("system.ping", variables={}, job_id=job.pk)


# --- images ----------------------------------------------------------------------------------


def test_run_image_with_double_appends_no_text_rule(openai_settings, scripted):
    openai_settings.SOCIALHUB_AI_PRICES = {"gpt-image-2": {"per_image": {"1024x1024": 0.04}}}
    double = scripted(ImageResponse(content=_png(1024, 1024), mime="image/png",
                                    model="gpt-image-2", request_id="req_img"))
    result = run_image("system.ping_image", prompt="A calm sea", size="square")
    request = double.requests[0]
    assert request.size == "1024x1024" and request.prompt.startswith("A calm sea")
    assert gateway.NO_TEXT_INSTRUCTION in request.prompt
    assert (result.width, result.height, result.mime) == (1024, 1024, "image/png")
    run = AIRun.objects.get(pk=result.ai_run_id)
    assert run.cost_usd == Decimal("0.040000") and run.units["images"] == 1
    assert run.input_tokens == 0 and run.provider == "openai"


def test_run_image_refused(openai_settings, scripted):
    scripted(ProviderRefused())
    with pytest.raises(ProviderRefused):
        run_image("system.ping_image", prompt="x", size="landscape")
    assert AIRun.objects.get().status == "refused"


def test_run_image_missing_model(settings, scripted):
    settings.SOCIALHUB_AI_IMAGE_PROVIDER = "openai"
    settings.OPENAI_API_KEY = "k"
    settings.SOCIALHUB_AI_IMAGE_MODEL = ""
    scripted()
    with pytest.raises(ProviderNotConfigured) as caught:
        run_image("system.ping_image", prompt="x", size="square")
    assert "SOCIALHUB_AI_IMAGE_MODEL" in caught.value.detail
