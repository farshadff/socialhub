"""Deterministic fake providers (E00-S05 rules 30-32, AI-INTEGRATION.md section 7).

Text output is chosen in this order:

1. with `SOCIALHUB_TESTING_HOOKS=true`, a shared override for the task stored in the cache
   (Redis outside tests) by the E11-S03 test hooks: `{"variant": "<name>"}`, `{"data": ...}` or
   `{"error": "refused" | "<ProviderError detail>"}` (see `set_shared_override`);
2. an in-process override from `fake_text.set(task, data_or_exception)` (unit tests);
3. a variant named by the `_fixture` variable, else by a `[fixture:<name>]` marker inside any
   string variable;
4. the default.

For 3 and 4, a task's `fake.py` with `build(variables, variant) -> dict` wins; otherwise
`fixture.<variant>.json` (or `fixture.json`) is returned. Text tasks return
`{"text", "citations"}` (or a plain string); schema tasks return a dict that the gateway
validates against the schema. A `fake.py` may raise `ProviderRefused("refused")`.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import threading

from django.conf import settings
from django.core.cache import cache

from .. import registry
from ..errors import AIError, ProviderError, ProviderRefused
from .base import ImageRequest, ImageResponse, TextRequest, TextResponse

FAKE_MODEL = "fake"
SHARED_KEY = "socialhub:ai:fake:{task}"
MARKER = re.compile(r"\[fixture:([A-Za-z0-9_.-]+)\]")
WEB_SEARCH_CITATIONS = (
    {"url": "https://example.com/fake-search/1", "title": "Example search result one"},
    {"url": "https://example.com/fake-search/2", "title": "Example search result two"},
)


class FakeOverrides:
    """In-process fake output per task, for unit tests: `fake_text.set(task, value)`.

    `value` is the output itself (a dict valid against the task's schema, or text), or an
    exception instance (for example `ProviderRefused()`) to raise. Use `clear()` in teardown.
    """

    def __init__(self):
        self._values: dict[str, object] = {}
        self._lock = threading.Lock()

    def set(self, task: str, value) -> None:
        with self._lock:
            self._values[task] = value

    def clear(self, task: str | None = None) -> None:
        with self._lock:
            if task is None:
                self._values.clear()
            else:
                self._values.pop(task, None)

    def get(self, task: str) -> tuple[bool, object]:
        with self._lock:
            if task in self._values:
                return True, self._values[task]
        return False, None


fake_text = FakeOverrides()


def set_shared_override(task: str, value: dict | None, timeout: int | None = None) -> None:
    """Store (or with None, remove) the shared override read when testing hooks are on."""
    key = SHARED_KEY.format(task=task)
    if value is None:
        cache.delete(key)
    else:
        cache.set(key, json.dumps(value), timeout)


def _shared_override(task: str) -> dict | None:
    if not getattr(settings, "SOCIALHUB_TESTING_HOOKS", False):
        return None
    raw = cache.get(SHARED_KEY.format(task=task))
    if not raw:
        return None
    return json.loads(raw) if isinstance(raw, str) else raw


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _strings(item)


def variant_from(variables: dict) -> str | None:
    """`_fixture` when given, else the first `[fixture:<name>]` marker in a string variable."""
    explicit = variables.get("_fixture")
    if explicit:
        return str(explicit)
    for text in _strings({k: v for k, v in variables.items() if k != "_fixture"}):
        match = MARKER.search(text)
        if match:
            return match.group(1)
    return None


def _error(detail: str) -> AIError:
    return ProviderRefused() if detail == "refused" else ProviderError(detail)


def _default_output(task: str, variables: dict, variant: str | None):
    build = registry.fake_builder(task)
    if build is not None:
        return build(variables, variant)
    return registry.fixture(task, variant)


def select_output(task: str, variables: dict):
    """The fake output for one call, or an exception instance to raise."""
    shared = _shared_override(task)
    if shared is not None:
        if "data" in shared:
            return shared["data"]
        if "error" in shared:
            return _error(str(shared["error"]))
        if "variant" in shared:
            return _default_output(task, variables, shared["variant"] or None)
    found, value = fake_text.get(task)
    if found:
        return value
    return _default_output(task, variables, variant_from(variables))


class FakeTextProvider:
    name = "fake"

    def text(self, request: TextRequest) -> TextResponse:
        output = select_output(request.task, request.variables)
        if isinstance(output, BaseException):
            raise output
        if isinstance(output, type) and issubclass(output, BaseException):
            raise output()
        response = TextResponse(model=FAKE_MODEL, stop_reason="end_turn")
        citations = None
        if request.schema is not None:
            response.data = output
            response.text = json.dumps(output, ensure_ascii=False, sort_keys=True, default=str) \
                if not isinstance(output, str) else output
        elif isinstance(output, dict) and "text" in output:
            response.text = str(output["text"])
            citations = output.get("citations")
        elif isinstance(output, str):
            response.text = output
        else:
            response.text = json.dumps(output, ensure_ascii=False, sort_keys=True, default=str)
        if citations is None and request.web_search is not None:
            citations = [dict(c) for c in WEB_SEARCH_CITATIONS]
        response.citations = list(citations or [])
        return response


def solid_png(size: str, seed: str) -> bytes:
    """A PNG of `size` ("WxH") filled with a colour derived from `seed`'s SHA-256."""
    from PIL import Image

    width, height = (int(part) for part in size.lower().split("x"))
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    image = Image.new("RGB", (width, height), tuple(digest[:3]))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class FakeImageProvider:
    name = "fake"

    def image(self, request: ImageRequest) -> ImageResponse:
        found, value = fake_text.get(request.task)
        if found and isinstance(value, BaseException):
            raise value
        return ImageResponse(content=solid_png(request.size, request.prompt), mime="image/png",
                             model=FAKE_MODEL)
