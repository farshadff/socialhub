"""Fixtures for the AI gateway tests: a scripted provider double and temporary prompt tasks."""

from __future__ import annotations

import json
import textwrap
from pathlib import Path

import pytest

from apps.ai import gateway, registry
from apps.ai.providers.base import TextResponse
from apps.ai.providers.fake import fake_text
from apps.ai.tasks import TASKS, TaskSpec


class ScriptedProvider:
    """Returns (or raises) the scripted steps in order and records every request."""

    def __init__(self, *steps):
        self.steps = list(steps)
        self.requests = []

    def _next(self, request):
        self.requests.append(request)
        if not self.steps:
            raise AssertionError("ScriptedProvider ran out of steps")
        step = self.steps.pop(0)
        if isinstance(step, BaseException):
            raise step
        return step

    text = _next
    image = _next


def ok(text="done", **fields) -> TextResponse:
    return TextResponse(text=text, model=fields.pop("model", "claude-opus-5-5"),
                        stop_reason=fields.pop("stop_reason", "end_turn"), **fields)


@pytest.fixture
def scripted(monkeypatch):
    """`scripted(*steps)` installs a double for both provider kinds; sleeps are recorded."""
    sleeps: list[float] = []
    monkeypatch.setattr(gateway, "_sleep", sleeps.append)

    def install(*steps) -> ScriptedProvider:
        double = ScriptedProvider(*steps)
        double.sleeps = sleeps
        monkeypatch.setattr(gateway, "_text_adapter", lambda name: double)
        monkeypatch.setattr(gateway, "_image_adapter", lambda name: double)
        return double

    return install


@pytest.fixture
def anthropic_settings(settings):
    settings.SOCIALHUB_AI_TEXT_PROVIDER = "anthropic"
    settings.ANTHROPIC_API_KEY = "test-key-not-real"
    settings.SOCIALHUB_AI_TEXT_MODEL = "claude-opus-5-5"
    return settings


@pytest.fixture
def openai_settings(settings):
    settings.SOCIALHUB_AI_IMAGE_PROVIDER = "openai"
    settings.OPENAI_API_KEY = "test-key-not-real"
    settings.SOCIALHUB_AI_IMAGE_MODEL = "gpt-image-2"
    return settings


def _clear_caches():
    registry.load.cache_clear()
    registry.schema_for.cache_clear()
    registry.fake_builder.cache_clear()


@pytest.fixture(autouse=True)
def _reset_fakes():
    fake_text.clear()
    yield
    fake_text.clear()


@pytest.fixture
def prompt_task(tmp_path, monkeypatch):
    """`prompt_task(key, files={name: text}, spec=TaskSpec(...))` creates a registered task
    whose directory lives in a temporary folder."""
    root = tmp_path / "prompts"
    original = registry.task_dir

    def task_dir(task: str) -> Path:
        candidate = root / task
        return candidate if candidate.exists() else original(task)

    monkeypatch.setattr(registry, "task_dir", task_dir)
    _clear_caches()

    def make(key: str, files: dict[str, str | dict | list] | None = None,
             spec: TaskSpec | None = None, register: bool = True) -> Path:
        directory = root / key
        directory.mkdir(parents=True, exist_ok=True)
        defaults = {"system.md": "You are a test task.", "user.md": "Input: {{ value }}",
                    "VERSION": "3", "fixture.json": {"text": "fixture text", "citations": []}}
        for name, content in {**defaults, **(files or {})}.items():
            if content is None:
                continue
            if not isinstance(content, str):
                content = json.dumps(content)
            (directory / name).write_text(textwrap.dedent(content), encoding="utf-8")
        if register:
            monkeypatch.setitem(TASKS, key, spec or TaskSpec(provider="text", effort="medium"))
        _clear_caches()
        return directory

    yield make
    _clear_caches()


SCHEMA_PY = '''
from pydantic import BaseModel, Field


class Idea(BaseModel):
    title: str = Field(description="Short title", max_length=80)
    score: int = Field(description="0-100", ge=0, le=100)


class Output(BaseModel):
    ideas: list[Idea] = Field(description="Ideas", max_length=5)
'''
