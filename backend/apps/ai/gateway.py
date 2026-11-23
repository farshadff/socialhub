"""The AI gateway: the only way the project calls an AI provider (E00-S05, AI-INTEGRATION.md 2).

Public surface:

    run_text(task, *, variables, schema=None, images=None, web_search=None,
             account_id=None, job_id=None) -> TextResult
    run_image(task, *, prompt, size, account_id=None, job_id=None) -> ImageResult
    is_configured("text" | "image") -> bool          # cheap, no provider call
    provider_status("text" | "image") -> dict        # the `ai.text` / `ai.image` status blocks
    ImageInput, WebSearchOptions, TextResult, ImageResult

Errors are `apps.ai.errors.AIError` subclasses. Programming errors (unknown task, a template
variable the caller did not pass, `schema` together with `web_search`, more than 8 images, an
unknown size) raise before any provider call and write no `AIRun`. Every other call writes
exactly one `AIRun`, whatever the outcome; retries inside a call share it.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import time
from dataclasses import asdict, replace
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist

from . import registry
from .errors import (
    AIError,
    CallLimitExceeded,
    OutputInvalid,
    ProviderError,
    ProviderNotConfigured,
    ProviderRefused,
)
from .images import MAX_IMAGES, prepare_image
from .models import AIRun
from .providers import base as provider_base
from .providers import image_provider, text_provider
from .tasks import NON_STREAMING_MAX_TOKENS, TASKS
from .types import ImageInput, ImageResult, TextResult, WebSearchOptions

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 4
RETRY_DELAYS = (2, 8, 30)
RETRY_AFTER_CAP_SECONDS = 60
MAX_PAYLOAD_BYTES = 64 * 1024
NO_TEXT_INSTRUCTION = ("Do not include any text, letters, numbers, logos or watermarks "
                       "anywhere in the image.")
FAKE_MODEL = "fake"
SIX_PLACES = Decimal("0.000001")

# Indirections the tests replace.
_sleep = time.sleep
_clock = time.monotonic
_adapters: dict[tuple[str, str], object] = {}


def _text_adapter(name: str):
    key = ("text", name)
    if key not in _adapters:
        _adapters[key] = text_provider(name)
    return _adapters[key]


def _image_adapter(name: str):
    key = ("image", name)
    if key not in _adapters:
        _adapters[key] = image_provider(name)
    return _adapters[key]


# --- configuration ---------------------------------------------------------------------------


def text_model(task: str | None = None) -> str:
    """Rule 11: the per-task override, else `SOCIALHUB_AI_TEXT_MODEL`, passed exactly."""
    overrides = settings.SOCIALHUB_AI_TEXT_MODEL_OVERRIDES or {}
    if task and overrides.get(task):
        return overrides[task]
    return settings.SOCIALHUB_AI_TEXT_MODEL


def provider_status(kind: str) -> dict:
    """Configuration of one provider kind, never secret values (rule 37)."""
    if kind == "text":
        provider = settings.SOCIALHUB_AI_TEXT_PROVIDER
        missing = []
        if provider != "fake":
            if not settings.ANTHROPIC_API_KEY:
                missing.append("ANTHROPIC_API_KEY")
            if not settings.SOCIALHUB_AI_TEXT_MODEL:
                missing.append("SOCIALHUB_AI_TEXT_MODEL")
        return {
            "provider": provider,
            "configured": not missing,
            "missing": missing,
            "model": FAKE_MODEL if provider == "fake" else settings.SOCIALHUB_AI_TEXT_MODEL,
            "overrides": dict(settings.SOCIALHUB_AI_TEXT_MODEL_OVERRIDES or {}),
        }
    if kind == "image":
        provider = settings.SOCIALHUB_AI_IMAGE_PROVIDER
        missing = []
        if provider != "fake":
            if not settings.OPENAI_API_KEY:
                missing.append("OPENAI_API_KEY")
            if not settings.SOCIALHUB_AI_IMAGE_MODEL:
                missing.append("SOCIALHUB_AI_IMAGE_MODEL")
        return {
            "provider": provider,
            "configured": not missing,
            "missing": missing,
            "model": FAKE_MODEL if provider == "fake" else settings.SOCIALHUB_AI_IMAGE_MODEL,
        }
    raise ValueError(f"Unknown provider kind {kind!r}; use 'text' or 'image'.")


def is_configured(kind: str) -> bool:
    """True when the provider can be called (`fake` always can). Makes no provider call."""
    return provider_status(kind)["configured"]


def models_without_price() -> list[str]:
    """Configured real models with no row in `SOCIALHUB_AI_PRICES`."""
    prices = settings.SOCIALHUB_AI_PRICES or {}
    models = set()
    if settings.SOCIALHUB_AI_TEXT_PROVIDER != "fake":
        models.add(settings.SOCIALHUB_AI_TEXT_MODEL)
        models.update((settings.SOCIALHUB_AI_TEXT_MODEL_OVERRIDES or {}).values())
    if settings.SOCIALHUB_AI_IMAGE_PROVIDER != "fake":
        models.add(settings.SOCIALHUB_AI_IMAGE_MODEL)
    return sorted(m for m in models if m and m not in prices)


# --- cost ------------------------------------------------------------------------------------


def _price(row: dict, name: str, fallback: str | None = None) -> Decimal:
    value = row.get(name)
    if value is None and fallback is not None:
        value = row.get(fallback)
    return Decimal(str(value or 0))


def text_cost(model: str, *, input_tokens: int = 0, output_tokens: int = 0,
              cache_read_tokens: int = 0, cache_write_tokens: int = 0,
              web_searches: int = 0) -> tuple[Decimal, bool]:
    """`(cost_usd, price_missing)` from `SOCIALHUB_AI_PRICES` (rule 25).

    Prices are per million tokens; `web_search` is per search. A missing cache price falls
    back to the input price, which over- rather than under-states the cost.
    """
    row = (settings.SOCIALHUB_AI_PRICES or {}).get(model)
    if row is None:
        return Decimal(0), True
    million = Decimal(1_000_000)
    cost = (Decimal(input_tokens) * _price(row, "input")
            + Decimal(output_tokens) * _price(row, "output")
            + Decimal(cache_read_tokens) * _price(row, "cache_read", "input")
            + Decimal(cache_write_tokens) * _price(row, "cache_write", "input")) / million
    cost += Decimal(web_searches) * _price(row, "web_search")
    return cost.quantize(SIX_PLACES, rounding=ROUND_HALF_UP), False


def image_cost(model: str, *, size: str, shape: str, images: int = 1) -> tuple[Decimal, bool]:
    """`per_image` is keyed by pixel size (for example "1024x1024"), or by shape."""
    row = (settings.SOCIALHUB_AI_PRICES or {}).get(model)
    per_image = (row or {}).get("per_image") or {}
    value = per_image.get(size, per_image.get(shape))
    if value is None:
        return Decimal(0), True
    return (Decimal(str(value)) * images).quantize(SIX_PLACES, rounding=ROUND_HALF_UP), False


# --- payload ---------------------------------------------------------------------------------


def _size(value) -> int:
    return len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8"))


def _string_slots(value, out: list) -> list:
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, str):
                out.append((value, key))
            else:
                _string_slots(item, out)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            if isinstance(item, str):
                out.append((value, index))
            else:
                _string_slots(item, out)
    return out


def fit_payload(payload: dict, limit: int = MAX_PAYLOAD_BYTES) -> dict:
    """Cut the longest strings until the JSON fits in `limit` bytes (rule 26)."""
    payload = json.loads(json.dumps(payload, ensure_ascii=False, default=str))
    payload["truncated"] = False
    if _size(payload) <= limit:
        return payload
    payload["truncated"] = True
    marker = " …[truncated]"
    for _ in range(200):
        excess = _size(payload) - limit
        if excess <= 0:
            return payload
        slots = _string_slots(payload, [])
        if not slots:
            break
        container, key = max(slots, key=lambda slot: len(slot[0][slot[1]].encode("utf-8")))
        raw = container[key].encode("utf-8")
        if len(raw) <= len(marker.encode("utf-8")) * 2:
            break
        keep = max(0, len(raw) - excess - len(marker.encode("utf-8")) - 8)
        container[key] = raw[:keep].decode("utf-8", "ignore") + marker
    return {"request": None, "response": None, "truncated": True}


def _image_ref(data: bytes, media_type: str) -> dict:
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            "media_type": media_type}


# --- one logical call ------------------------------------------------------------------------


class _Call:
    """Bookkeeping for one logical call: guard, configuration, retries and the `AIRun` row."""

    def __init__(self, *, kind: str, task: str, version: str, provider: str, model: str,
                 account_id, job_id, request_payload: dict):
        self.kind = kind
        self.task = task
        self.version = version
        self.provider = provider
        self.model = model
        self.account_id = account_id
        self.job_id = job_id
        self.request_payload = request_payload
        self.attempts = 0
        self.started = _clock()

    def latency_ms(self) -> int:
        return max(0, round((_clock() - self.started) * 1000))

    def record(self, *, status: str, model: str | None = None, error: AIError | None = None,
               input_tokens: int = 0, output_tokens: int = 0, units: dict | None = None,
               cost: Decimal = Decimal(0), request_id: str | None = None,
               response: dict | None = None, latency_ms: int | None = None) -> AIRun:
        units = {**(units or {})}
        if self.attempts:
            units["attempts"] = self.attempts
        payload = {"request": self.request_payload, "response": response}
        if error is not None:
            payload["error"] = {"code": error.code, "detail": error.detail}
        run = AIRun.objects.create(
            job_id=self.job_id, account_id=self.account_id, provider=self.provider,
            model=model if model is not None else self.model, task=self.task,
            prompt_version=self.version, input_tokens=input_tokens, output_tokens=output_tokens,
            units=units, cost_usd=cost,
            latency_ms=self.latency_ms() if latency_ms is None else latency_ms,
            status=status, error_code=error.code if error is not None else None,
            provider_request_id=request_id, payload=fit_payload(payload),
        )
        logger.info("ai_call task=%s provider=%s model=%s status=%s attempts=%s latency_ms=%s "
                    "ai_run_id=%s", self.task, self.provider, run.model, status, self.attempts,
                    run.latency_ms, run.pk)
        return run

    def fail(self, error: AIError, **fields):
        status = AIRun.Status.REFUSED if isinstance(error, ProviderRefused) else AIRun.Status.ERROR
        self.record(status=status, error=error, **fields)
        raise error

    def guard(self) -> None:
        """Rule 28: at the job's call limit, fail without calling the provider."""
        if self.job_id is None:
            return
        limit = int(settings.SOCIALHUB_AI_MAX_CALLS_PER_JOB)
        if AIRun.objects.filter(job_id=self.job_id).count() >= limit:
            self.fail(CallLimitExceeded(), latency_ms=0)

    def require_configured(self) -> None:
        """Rule 29: a missing key or model is logged and raised before any provider call."""
        status = provider_status(self.kind)
        if not status["configured"]:
            missing = status["missing"]
            self.fail(ProviderNotConfigured(f"{missing[0]} is not set."), latency_ms=0)

    def attempt(self, fn):
        """Run `fn` with the retry policy of rule 18; return its result or raise the error."""
        while True:
            self.attempts += 1
            try:
                return fn()
            except ProviderError as exc:
                if not exc.retryable or self.attempts >= MAX_ATTEMPTS:
                    raise
                delay = RETRY_DELAYS[min(self.attempts, len(RETRY_DELAYS)) - 1]
                if exc.retry_after:
                    delay = max(delay, min(float(exc.retry_after), RETRY_AFTER_CAP_SECONDS))
                logger.warning("ai_retry task=%s provider=%s attempt=%s detail=%s wait=%ss",
                               self.task, self.provider, self.attempts, exc.detail, delay)
                _sleep(delay)


# --- helpers ---------------------------------------------------------------------------------


def _spec(task: str, kind: str):
    spec = TASKS.get(task)
    if spec is None:
        raise LookupError(f"AI task {task!r} is not registered in apps/ai/tasks.py.")
    if spec.provider != kind:
        raise ValueError(f"AI task {task!r} is a {spec.provider} task; use run_{spec.provider}.")
    return spec


def _account(account_id):
    from apps.accounts.models import InstagramAccount

    return InstagramAccount.objects.get(pk=account_id)


def _brand_block(account) -> str | None:
    try:
        from apps.accounts.brand import render_brand_block
    except ImportError:
        # TODO(E00-S03): `render_brand_block` ships with the brand profile story; until it is
        # importable, calls run without the brand block.
        return None
    try:
        return render_brand_block(account) or None
    except ObjectDoesNotExist:  # the account has no brand profile yet
        return None


def _merge_web_search(options: WebSearchOptions | None) -> WebSearchOptions | None:
    if options is None:
        return None
    blocked = [*(options.blocked_domains or []),
               *getattr(settings, "SOCIALHUB_RESEARCH_BLOCKED_DOMAINS", [])]
    unique = list(dict.fromkeys(d.strip().lower() for d in blocked if d and d.strip()))
    return replace(options, blocked_domains=unique or None)


def _dedupe_citations(citations) -> list[dict]:
    seen: dict[str, dict] = {}
    for item in citations or []:
        url = (item.get("url") if isinstance(item, dict) else getattr(item, "url", None)) or ""
        if not url or url in seen:
            continue
        title = item.get("title") if isinstance(item, dict) else getattr(item, "title", "")
        seen[url] = {"url": url, "title": title or ""}
    return list(seen.values())


def _validate(schema, data):
    from pydantic import BaseModel, ValidationError

    if isinstance(data, schema):
        return data
    try:
        if isinstance(data, BaseModel):
            return schema.model_validate(data.model_dump())
        if isinstance(data, (str, bytes)):
            return schema.model_validate_json(data)
        return schema.model_validate(data)
    except ValidationError as exc:
        raise OutputInvalid(reason=f"{exc.error_count()} validation errors") from exc


def _dump(data):
    from pydantic import BaseModel

    return data.model_dump(mode="json") if isinstance(data, BaseModel) else data


# --- public functions ------------------------------------------------------------------------


def run_text(task: str, *, variables: dict, schema=None, images: list[ImageInput] | None = None,
             web_search: WebSearchOptions | None = None, account_id: int | None = None,
             job_id=None) -> TextResult:
    """Run a text task through the configured text provider (Claude or fake)."""
    spec = _spec(task, "text")
    if schema is not None and web_search is not None:
        raise ValueError("Pass either `schema` or `web_search`, not both: run a search call, "
                         "then a structured call (AI-INTEGRATION.md section 3).")
    images = list(images or [])
    if len(images) > MAX_IMAGES:
        raise ValueError(f"At most {MAX_IMAGES} images per call.")

    variables = dict(variables or {})
    account = _account(account_id) if account_id is not None else None
    if account is not None:
        variables.setdefault("content_language", account.content_language)
    system_text, user_text = registry.render(task, variables)  # StrictUndefined: may raise
    version = registry.load(task).version
    system = [system_text]
    if account is not None and spec.cache_brand:
        brand = _brand_block(account)
        if brand:
            system.append(brand)
    prepared = [prepare_image(image.content) for image in images]
    search = _merge_web_search(web_search)

    provider = settings.SOCIALHUB_AI_TEXT_PROVIDER
    model = FAKE_MODEL if provider == "fake" else text_model(task)
    max_tokens = spec.max_tokens if spec.stream else min(spec.max_tokens,
                                                         NON_STREAMING_MAX_TOKENS)
    request = provider_base.TextRequest(
        task=task, model=model, system=system, user=user_text, effort=spec.effort,
        max_tokens=max_tokens, stream=spec.stream, schema=schema, images=prepared,
        web_search=search, timeout=float(settings.SOCIALHUB_AI_TIMEOUT_SECONDS),
        variables=variables,
    )
    call = _Call(kind="text", task=task, version=version, provider=provider, model=model,
                 account_id=account_id, job_id=job_id, request_payload={
                     "system": system,
                     "user": user_text,
                     "options": {
                         "model": model, "effort": spec.effort, "max_tokens": max_tokens,
                         "stream": spec.stream,
                         "schema": getattr(schema, "__name__", None),
                         "web_search": asdict(search) if search is not None else None,
                         "images": [_image_ref(i.data, i.media_type) for i in prepared],
                     },
                 })
    call.guard()
    call.require_configured()

    adapter = _text_adapter(provider)
    try:
        response = call.attempt(lambda: adapter.text(request))
    except AIError as exc:
        call.fail(exc)

    usage = {
        "input_tokens": response.input_tokens,
        "output_tokens": response.output_tokens,
    }
    units = {"fallback_used": bool(response.fallback_used)}
    if response.cache_read_tokens:
        units["cache_read_tokens"] = response.cache_read_tokens
    if response.cache_write_tokens:
        units["cache_write_tokens"] = response.cache_write_tokens
    if response.web_searches:
        units["web_searches"] = response.web_searches
    if provider == "fake":
        cost, price_missing = Decimal(0), False
    else:
        cost, price_missing = text_cost(
            response.model or model, cache_read_tokens=response.cache_read_tokens,
            cache_write_tokens=response.cache_write_tokens,
            web_searches=response.web_searches, **usage)
    if price_missing:
        units["price_missing"] = True
    citations = _dedupe_citations(response.citations)
    logged = {"model": response.model or model, "units": units, "cost": cost,
              "request_id": response.request_id, **usage}

    def response_payload(data=None):
        body = {"stop_reason": response.stop_reason}
        if data is not None:
            body["data"] = _dump(data)
        else:
            body["text"] = response.text
        if citations:
            body["citations"] = citations
        if response.reason:
            body["reason"] = response.reason
        return body

    outcome = response.outcome
    if outcome == provider_base.OUTCOME_REFUSED:
        call.fail(ProviderRefused(), response=response_payload(), **logged)
    if outcome in (provider_base.OUTCOME_TRUNCATED, provider_base.OUTCOME_INVALID):
        call.fail(OutputInvalid(reason=response.reason), response=response_payload(), **logged)
    if outcome == provider_base.OUTCOME_WEB_SEARCH_FAILED:
        call.fail(ProviderError("web_search_failed", retryable=False),
                  response=response_payload(), **logged)

    if schema is not None:
        try:
            data = _validate(schema, response.data if response.data is not None
                             else response.text)
        except OutputInvalid as exc:
            call.fail(exc, response=response_payload(), **logged)
    else:
        data = response.text
    run = call.record(status=AIRun.Status.OK,
                      response=response_payload(data if schema is not None else None), **logged)
    return TextResult(data=data, citations=citations, ai_run_id=run.pk)


def run_image(task: str, *, prompt: str, size: str, account_id: int | None = None,
              job_id=None) -> ImageResult:
    """Generate one image without text through the configured image provider."""
    _spec(task, "image")
    sizes = settings.SOCIALHUB_AI_IMAGE_SIZES or {}
    if size not in sizes:
        raise ValueError(f"Unknown image size {size!r}; use one of {', '.join(sizes)}.")
    if not (prompt or "").strip():
        raise ValueError("An image prompt is required.")
    version = registry.load(task).version
    provider = settings.SOCIALHUB_AI_IMAGE_PROVIDER
    model = FAKE_MODEL if provider == "fake" else settings.SOCIALHUB_AI_IMAGE_MODEL
    pixel_size = sizes[size]
    full_prompt = f"{prompt.strip()}\n\n{NO_TEXT_INSTRUCTION}"
    request = provider_base.ImageRequest(task=task, model=model, prompt=full_prompt,
                                         size=pixel_size,
                                         timeout=float(settings.SOCIALHUB_AI_TIMEOUT_SECONDS))
    call = _Call(kind="image", task=task, version=version, provider=provider, model=model,
                 account_id=account_id, job_id=job_id, request_payload={
                     "prompt": full_prompt,
                     "options": {"model": model, "size": size, "pixel_size": pixel_size},
                 })
    call.guard()
    call.require_configured()

    adapter = _image_adapter(provider)
    try:
        response = call.attempt(lambda: adapter.image(request))
    except AIError as exc:
        call.fail(exc, units={"images": 0})

    from PIL import Image

    with Image.open(io.BytesIO(response.content)) as image:
        width, height = image.size
    units = {"images": 1, **(response.units or {})}
    if provider == "fake":
        cost, price_missing = Decimal(0), False
    else:
        cost, price_missing = image_cost(response.model or model, size=pixel_size, shape=size)
    if price_missing:
        units["price_missing"] = True
    run = call.record(status=AIRun.Status.OK, model=response.model or model, units=units,
                      cost=cost, request_id=response.request_id, response={
                          "image": _image_ref(response.content, response.mime),
                          "width": width, "height": height,
                      })
    return ImageResult(content=response.content, mime=response.mime, width=width,
                       height=height, ai_run_id=run.pk)


__all__ = ["ImageInput", "ImageResult", "TextResult", "WebSearchOptions", "image_cost",
           "is_configured", "models_without_price", "provider_status", "run_image", "run_text",
           "text_cost", "text_model"]
