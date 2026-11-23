"""Prompt registry loader: ``apps/ai/prompts/<task>/`` (E00-S05 rules 5–10)."""

from __future__ import annotations

import functools
import importlib.util
import json
import re
from dataclasses import dataclass
from pathlib import Path

import jinja2

PROMPTS_DIR = Path(__file__).parent / "prompts"
_extra_dirs: dict[str, Path] = {}


def register_prompt_dir(task: str, directory: Path) -> None:
    """Allow another app to ship its prompt directory outside ``apps/ai/prompts``."""
    _extra_dirs[task] = Path(directory)


def task_dir(task: str) -> Path:
    return _extra_dirs.get(task, PROMPTS_DIR / task)


def _tojson(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


_env = jinja2.Environment(
    undefined=jinja2.StrictUndefined,
    autoescape=False,
    keep_trailing_newline=False,
    trim_blocks=True,
    lstrip_blocks=True,
)
_env.filters["tojson"] = _tojson


@dataclass(frozen=True)
class PromptTask:
    key: str
    system: jinja2.Template
    user: jinja2.Template
    system_source: str
    version: str
    schema: type | None
    directory: Path

    def render(self, variables: dict) -> tuple[str, str]:
        system_vars = {"content_language": variables.get("content_language", "fa")}
        return self.system.render(**system_vars).strip(), self.user.render(**variables).strip()


def _load_schema(directory: Path, key: str):
    path = directory / "schema.py"
    if not path.exists():
        return None
    module_name = "apps.ai.registry._schema_" + re.sub(r"\W", "_", key)
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "Output"):
        raise ImportError(f"{path} does not export Output")
    return module.Output


@functools.cache
def load_task(key: str) -> PromptTask:
    directory = task_dir(key)
    system_source = (directory / "system.md").read_text(encoding="utf-8")
    user_source = (directory / "user.md").read_text(encoding="utf-8")
    return PromptTask(
        key=key,
        system=_env.from_string(system_source),
        user=_env.from_string(user_source),
        system_source=system_source,
        version=(directory / "VERSION").read_text(encoding="utf-8").strip(),
        schema=_load_schema(directory, key),
        directory=directory,
    )


def system_variables(task: PromptTask) -> set[str]:
    from jinja2 import meta

    return meta.find_undeclared_variables(_env.parse(task.system_source))
