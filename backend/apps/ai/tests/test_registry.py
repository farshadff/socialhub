"""Task registry, system check and import boundary (E00-S05 rules 2, 5-10, 33)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from django.core import checks

from apps.ai import registry
from apps.ai.checks import check_ai_task_registry
from apps.ai.tasks import TASKS, TaskSpec

from .conftest import SCHEMA_PY

BACKEND = Path(__file__).resolve().parents[3]
TEXT_TASKS = sorted(key for key, spec in TASKS.items() if spec.provider == "text")


# --- registry tests over every registered task (rule 33) -------------------------------------


@pytest.mark.parametrize("task", sorted(TASKS))
def test_registered_task_has_its_files(task):
    assert registry.problems(task, TASKS[task]) == [], task


@pytest.mark.parametrize("task", TEXT_TASKS)
def test_registered_text_task_fixtures_validate(task):
    assert registry.fixture_problems(task) == [], task


@pytest.mark.parametrize("task", TEXT_TASKS)
def test_registered_schema_has_descriptions_and_bounded_lists(task):
    schema = registry.schema_for(task)
    if schema is None:
        pytest.skip("text task without a schema")
    assert registry.schema_problems(schema) == [], task


def test_bad_fixture_is_reported_with_the_task_name(prompt_task):
    """AC15."""
    prompt_task("t.badfixture", {"schema.py": SCHEMA_PY,
                                 "fixture.json": {"ideas": [{"title": "x"}]}})
    found = registry.fixture_problems("t.badfixture")
    assert found and found[0].startswith("t.badfixture: fixture.json does not match")


def test_schema_problems_detects_missing_descriptions_and_unbounded_lists():
    from pydantic import BaseModel, Field

    class Loose(BaseModel):
        items: list[str]
        name: str = Field(description="ok")

    assert registry.schema_problems(Loose) == ["Loose.items: no description",
                                               "Loose.items: list without a maximum length"]


# --- system check (rule 10) ------------------------------------------------------------------


def _messages():
    return [e.msg for e in check_ai_task_registry() if e.level >= checks.ERROR]


def test_check_passes_for_the_real_registry():
    assert _messages() == []


def test_check_reports_missing_files(prompt_task, monkeypatch):
    prompt_task("t.missing", {"user.md": None, "fixture.json": None})
    (registry.task_dir("t.missing") / "user.md").unlink(missing_ok=True)
    (registry.task_dir("t.missing") / "fixture.json").unlink(missing_ok=True)
    messages = _messages()
    assert "AI task 't.missing': user.md is missing." in messages
    assert "AI task 't.missing': fixture.json is missing." in messages


def test_check_reports_unknown_directory(monkeypatch):
    monkeypatch.setitem(TASKS, "t.nowhere", TaskSpec(provider="text", effort="low"))
    assert "AI task 't.nowhere': directory apps/ai/prompts/t.nowhere/ does not exist." \
        in _messages()


def test_check_reports_system_variables_and_schema_without_output(prompt_task):
    prompt_task("t.sysvars", {"system.md": "Today is {{ today }} in {{ content_language }}."})
    prompt_task("t.nooutput", {"schema.py": "from pydantic import BaseModel\n"})
    messages = _messages()
    assert ("AI task 't.sysvars': system.md may reference only content_language, not today."
            in messages)
    assert any(m.startswith("AI task 't.nooutput': schema.py cannot be loaded") for m in messages)


def test_check_reports_bad_effort_and_template_syntax(prompt_task):
    prompt_task("t.effort", spec=TaskSpec(provider="text", effort="extreme"))
    prompt_task("t.syntax", {"user.md": "{% if %}"})
    messages = _messages()
    assert any("effort 'extreme'" in m for m in messages)
    assert any(m.startswith("AI task 't.syntax': user.md line 1") for m in messages)


def test_unregistered_prompt_dirs_are_ignored(prompt_task):
    prompt_task("t.unregistered", {"user.md": None}, register=False)
    assert not any("t.unregistered" in m for m in _messages())


def test_image_task_needs_only_version(prompt_task):
    directory = prompt_task("t.image", {"system.md": None, "user.md": None, "fixture.json": None},
                            spec=TaskSpec(provider="image"))
    for name in ("system.md", "user.md", "fixture.json"):
        (directory / name).unlink(missing_ok=True)
    assert not any("t.image" in m for m in _messages())


def test_schema_alias_and_registry_loader(prompt_task):
    prompt_task("t.alias", {"schema.py": "from pydantic import BaseModel, Field\n\n"
                                         "class Pkg(BaseModel):\n"
                                         "    a: int = Field(description='a')\n\n"
                                         "Output = Pkg\n"})
    assert registry.schema_for("t.alias").__name__ == "Pkg"
    assert registry.output_schema is registry.schema_for


# --- import boundary (rule 2, AC12) ----------------------------------------------------------


def test_provider_sdks_are_imported_only_under_providers():
    pattern = re.compile(r"^\s*(?:import|from)\s+(anthropic|openai)\b", re.MULTILINE)
    allowed = BACKEND / "apps" / "ai" / "providers"
    offenders = []
    for path in [*BACKEND.joinpath("apps").rglob("*.py"), *BACKEND.joinpath("config").rglob(
            "*.py")]:
        if allowed in path.parents:
            continue
        if pattern.search(path.read_text(encoding="utf-8", errors="ignore")):
            offenders.append(str(path.relative_to(BACKEND)))
    assert offenders == []
    providers_text = "".join(p.read_text() for p in allowed.glob("*.py"))
    assert "import anthropic" in providers_text and "import openai" in providers_text
