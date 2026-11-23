"""The AI gateway: the only public surface for calling a model (AI-INTEGRATION.md section 2).

``run_text`` renders the task's prompts, adds the cached brand block, picks the provider and
model, retries transient failures, enforces the per-job call guard and writes exactly one
``AIRun`` row per call, whatever the outcome.
"""

from __future__ import annotations

import json
import logging
import time
from decimal import Decimal
from uuid import UUID

from django.conf import settings

from .errors import AIError, CallLimitExceeded, ProviderNotConfigured, ProviderRefused
from .models import AIRun
from .registry import load_task
from .results import TextRequest, TextResult, WebSearchOptions
from .tasks import TASKS

logger = logging.getLogger(__name__)

__all__ = [
    "TextResult",
    "WebSearchOptions",
    "ensure_text_provider",
    "run_text",
    "text_provider_configured",
]

RETRY_DELAYS = (2, 8, 30)
MAX_RETRY_AFTER = 60
PAYLOAD_LIMIT = 64 * 1024
_sleep = time.sleep


def _text_provider():
    name = settings.SOCIALHUB_AI_TEXT_PROVIDER
    if name == "anthropic":
        from .providers.anthropic_provider import AnthropicTextProvider

        return AnthropicTextProvider()
    from .providers.fake import FakeTextProvider

    return FakeTextProvider()


def text_provider_configured() -> bool:
    return _text_provider().configured()


def ensure_text_provider() -> None:
    """Raise ``ProviderNotConfigured`` when the text provider cannot be used (user actions → 503)."""
    if not text_provider_configured():
        raise ProviderNotConfigured("ANTHROPIC_API_KEY")


def _model_for(task: str) -> str:
    overrides = settings.SOCIALHUB_AI_TEXT_MODEL_OVERRIDES or {}
    return overrides.get(task) or settings.SOCIALHUB_AI_TEXT_MODEL


def _cost(model: str, input_tokens: int, output_tokens: int, units: dict) -> tuple[Decimal, bool]:
    prices = (settings.SOCIALHUB_AI_PRICES or {}).get(model)
    if not prices:
        return Decimal("0"), True
    million = Decimal(1_000_000)
    total = (
        Decimal(str(prices.get("input", 0))) * input_tokens
        + Decimal(str(prices.get("output", 0))) * output_tokens
        + Decimal(str(prices.get("cache_read", 0))) * int(units.get("cache_read_tokens", 0))
        + Decimal(str(prices.get("cache_write", 0))) * int(units.get("cache_write_tokens", 0))
    ) / million
    total += Decimal(str(prices.get("web_search", 0))) * int(units.get("web_searches", 0))
    return total.quantize(Decimal("0.000001")), False


def _payload(request: TextRequest, response_value) -> dict:
    if hasattr(response_value, "model_dump"):
        response_value = response_value.model_dump(mode="json")
    payload = {
        "request": {
            "system": request.system,
            "user": request.user,
            "options": {
                "model": request.model,
                "effort": request.effort,
                "max_tokens": request.max_tokens,
                "stream": request.stream,
                "web_search": bool(request.web_search),
                "schema": getattr(request.schema, "__name__", None),
            },
        },
        "response": response_value,
        "truncated": False,
    }
    encoded = json.dumps(payload, ensure_ascii=False, default=str)
    if len(encoded.encode()) > PAYLOAD_LIMIT:
        payload["request"]["user"] = request.user[: PAYLOAD_LIMIT // 4]
        if isinstance(response_value, str):
            payload["response"] = response_value[: PAYLOAD_LIMIT // 4]
        else:
            payload["response"] = json.dumps(response_value, ensure_ascii=False, default=str)[
                : PAYLOAD_LIMIT // 4
            ]
        payload["truncated"] = True
    return payload


def _record(**fields) -> AIRun:
    return AIRun.objects.create(**fields)


def run_text(
    task: str,
    *,
    variables: dict,
    schema: type | None = None,
    images=None,
    web_search: WebSearchOptions | None = None,
    account_id: int | None = None,
    job_id: UUID | str | None = None,
) -> TextResult:
    if images:
        raise NotImplementedError("Image input is not implemented yet (E00-S05 rule 16).")
    spec = TASKS[task]
    prompt = load_task(task)
    schema = schema or prompt.schema
    if schema is not None and web_search is not None:
        raise ValueError("Web search and a schema cannot be used in one call; use two calls.")

    system, user = prompt.render(variables)
    brand_block = None
    if account_id is not None and spec.cache_brand:
        from apps.accounts.models import InstagramAccount

        from .brand import render_brand_block

        account = InstagramAccount.objects.select_related("brand_profile").get(pk=account_id)
        brand_block = render_brand_block(account)

    provider = _text_provider()
    model = _model_for(task) if provider.name != "fake" else "fake"
    request = TextRequest(
        task=task,
        model=model,
        system=system,
        brand_block=brand_block,
        user=user,
        schema=schema,
        web_search=web_search,
        effort=spec.effort,
        max_tokens=spec.max_tokens,
        stream=spec.stream,
        timeout=float(settings.SOCIALHUB_AI_TIMEOUT_SECONDS),
        variables=variables,
    )
    base = {
        "task": task,
        "prompt_version": prompt.version,
        "provider": provider.name,
        "model": model,
        "job_id": job_id,
        "account_id": account_id,
    }

    if job_id is not None:
        calls = AIRun.objects.filter(job_id=job_id).count()
        if calls >= settings.SOCIALHUB_AI_MAX_CALLS_PER_JOB:
            exc = CallLimitExceeded()
            _record(**base, status=AIRun.Status.ERROR, error_code=exc.code, units={"attempts": 0})
            raise exc

    if not provider.configured():
        exc = ProviderNotConfigured("ANTHROPIC_API_KEY")
        _record(**base, status=AIRun.Status.ERROR, error_code=exc.code, units={"attempts": 0})
        raise exc

    started = time.monotonic()
    attempts = 0
    while True:
        attempts += 1
        try:
            response = provider.complete(request)
            break
        except AIError as exc:
            if exc.retryable and attempts <= len(RETRY_DELAYS):
                delay = RETRY_DELAYS[attempts - 1]
                if exc.retry_after:
                    delay = max(delay, min(exc.retry_after, MAX_RETRY_AFTER))
                logger.info("ai_retry task=%s attempt=%s detail=%s", task, attempts, exc.detail)
                _sleep(delay)
                continue
            latency = int((time.monotonic() - started) * 1000)
            _record(
                **base,
                status=AIRun.Status.REFUSED if isinstance(exc, ProviderRefused) else AIRun.Status.ERROR,
                error_code=exc.code if exc.code != "provider_error" else f"provider_error:{exc.detail}",
                latency_ms=latency,
                units={"attempts": attempts},
                payload=_payload(request, None),
            )
            raise

    latency = int((time.monotonic() - started) * 1000)
    units = {**response.units, "attempts": attempts}
    cost, price_missing = (
        (Decimal("0"), False)
        if provider.name == "fake"
        else _cost(response.model, response.input_tokens, response.output_tokens, units)
    )
    if price_missing:
        units["price_missing"] = True
    run = _record(
        **{**base, "model": response.model},
        status=AIRun.Status.OK,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
        units=units,
        cost_usd=cost,
        latency_ms=latency,
        provider_request_id=response.request_id,
        payload=_payload(request, response.data),
    )
    return TextResult(data=response.data, citations=response.citations, ai_run_id=run.pk)
