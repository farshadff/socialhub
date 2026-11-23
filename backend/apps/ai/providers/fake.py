"""Deterministic fake text provider (E00-S05 rules 30–33, AI-INTEGRATION.md section 7).

What it returns, in order:
1. an in-process override from ``fake_text.set(task, value)`` (unit tests). ``value`` is the
   data to return, an exception instance to raise, or a callable ``f(variables)`` returning
   data (for computed fakes such as ``selection.score_goal_fit``);
2. a variant chosen by the ``_fixture`` variable, or by a marker ``[fixture:<name>]`` found in
   any string variable, loading ``fixture.<name>.json``;
3. ``fixture.json``.

A fixture ``{"_raise": "refused" | "<provider error detail>"}`` raises instead of answering.
A string value ``"@a.0.b"`` in a fixture is replaced by that path in the call's variables
(``"@signals.0.id"`` → the first input signal's id), so fixtures can point at real rows. When
the path does not exist the value after ``|`` is used (``"@existing_topics.0.title|Coffee"``),
or ``-1`` when there is none.
For tasks without a schema a fixture is either a string or ``{"text": ..., "citations": [...]}``.
With web search and no citations in the fixture, two fixed ``example.com`` citations are returned.
"""

from __future__ import annotations

import json
import re
from typing import Any

from ..errors import OutputInvalid, ProviderError, ProviderRefused
from ..registry import task_dir
from ..results import ProviderResponse, TextRequest

_MARKER = re.compile(r"\[fixture:([a-z0-9_.-]+)\]")
DEFAULT_CITATIONS = [
    {"url": "https://example.com/fake-result-1", "title": "Fake search result one"},
    {"url": "https://example.com/fake-result-2", "title": "Fake search result two"},
]


class _FakeOverrides:
    def __init__(self):
        self._overrides: dict[str, Any] = {}
        self._defaults: dict[str, Any] = {}

    def set(self, task: str, value: Any) -> None:
        self._overrides[task] = value

    def set_default(self, task: str, value: Any) -> None:
        """A computed fake registered by an app (for example in ``AppConfig.ready``).

        Used when no ``set`` override exists; ``clear()`` does not remove it.
        """
        self._defaults[task] = value

    def clear(self, task: str | None = None) -> None:
        if task is None:
            self._overrides.clear()
        else:
            self._overrides.pop(task, None)

    def get(self, task: str):
        if task in self._overrides:
            return self._overrides[task]
        return self._defaults.get(task, _MISSING)


_MISSING = object()
fake_text = _FakeOverrides()


def _find_variant(value) -> str | None:
    if isinstance(value, str):
        match = _MARKER.search(value)
        return match.group(1) if match else None
    if isinstance(value, dict):
        for item in value.values():
            found = _find_variant(item)
            if found:
                return found
    if isinstance(value, (list, tuple)):
        for item in value:
            found = _find_variant(item)
            if found:
                return found
    return None


def select_variant(variables: dict) -> str | None:
    explicit = variables.get("_fixture")
    if explicit:
        return str(explicit)
    return _find_variant(variables)


def _lookup(variables, path: str):
    current = variables
    for part in path.split("."):
        if isinstance(current, (list, tuple)) and part.isdigit():
            current = current[int(part)]
        elif isinstance(current, dict):
            current = current[part]
        else:
            raise KeyError(path)
    return current


def resolve_references(value, variables: dict):
    if isinstance(value, str) and value.startswith("@") and len(value) > 1:
        path, _, fallback = value[1:].partition("|")
        try:
            return _lookup(variables, path)
        except (KeyError, IndexError, TypeError):
            return fallback if fallback else -1
    if isinstance(value, dict):
        return {key: resolve_references(item, variables) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_references(item, variables) for item in value]
    return value


def load_fixture(task: str, variant: str | None = None):
    directory = task_dir(task)
    path = directory / (f"fixture.{variant}.json" if variant else "fixture.json")
    if variant and not path.exists():
        path = directory / "fixture.json"
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


class FakeTextProvider:
    name = "fake"

    def configured(self) -> bool:
        return True

    def complete(self, request: TextRequest) -> ProviderResponse:
        override = fake_text.get(request.task)
        if override is not _MISSING:
            if isinstance(override, BaseException):
                raise override
            raw = override(request.variables) if callable(override) else override
        else:
            raw = load_fixture(request.task, select_variant(request.variables))
            raw = resolve_references(raw, request.variables)

        if isinstance(raw, dict) and "_raise" in raw:
            if raw["_raise"] == "refused":
                raise ProviderRefused()
            raise ProviderError(str(raw["_raise"]))

        citations: list[dict[str, str]] = []
        if request.schema is not None:
            try:
                data = request.schema.model_validate(raw)
            except Exception as exc:  # pydantic.ValidationError
                raise OutputInvalid() from exc
            text = json.dumps(raw, ensure_ascii=False)
        else:
            if isinstance(raw, dict):
                text = str(raw.get("text", ""))
                citations = list(raw.get("citations", DEFAULT_CITATIONS if request.web_search else []))
            else:
                text = str(raw)
                citations = list(DEFAULT_CITATIONS) if request.web_search else []
            data = text
        units = {"attempts": 1}
        if request.web_search is not None:
            units["web_searches"] = 1 if citations else 0
        return ProviderResponse(
            data=data,
            model="fake",
            citations=citations,
            units=units,
            raw_text=text,
        )
