"""Prompt loader for `apps/ai/prompts/<task key>/` (E00-S05 rules 5-10).

Task directories are named with dotted keys, so they are not importable packages: `schema.py`
and `fake.py` are loaded by path, once per process. Templates are Jinja2 with
`StrictUndefined`; structured values printed with `{{ ... }}` are rendered as JSON with sorted
keys so identical inputs give identical prompts (rule 7).

Public names: `PROMPTS_DIR`, `load`, `render`, `schema_for` (alias `output_schema`),
`fake_builder`, `fixture`, `fixture_variants`, `prompt_dirs`, `problems`.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import ModuleType

import jinja2
from jinja2 import meta as jinja_meta
from pydantic import BaseModel

from .tasks import EFFORTS, PROVIDERS, TASKS, TaskSpec

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
SYSTEM_ALLOWED_VARIABLES = frozenset({"content_language"})
TEXT_FILES = ("system.md", "user.md", "VERSION", "fixture.json")
IMAGE_FILES = ("VERSION",)


def _finalize(value):
    """Print dicts and lists as canonical JSON; everything else as Jinja normally would."""
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
    if isinstance(value, BaseModel):
        return json.dumps(value.model_dump(mode="json"), sort_keys=True, ensure_ascii=False)
    return value


_ENV = jinja2.Environment(
    undefined=jinja2.StrictUndefined,
    autoescape=False,
    keep_trailing_newline=False,
    trim_blocks=False,
    finalize=_finalize,
)


@dataclass(frozen=True)
class TaskPrompt:
    key: str
    directory: Path
    version: str
    system: jinja2.Template | None
    user: jinja2.Template | None


def task_dir(task: str) -> Path:
    return PROMPTS_DIR / task


def prompt_dirs() -> list[str]:
    """Every prompt directory on disk, registered or not."""
    if not PROMPTS_DIR.is_dir():
        return []
    return sorted(p.name for p in PROMPTS_DIR.iterdir()
                  if p.is_dir() and not p.name.startswith(("_", ".")))


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


@lru_cache(maxsize=None)
def load(task: str) -> TaskPrompt:
    """Read and compile a task's templates (cached per process)."""
    directory = task_dir(task)
    system = directory / "system.md"
    user = directory / "user.md"
    return TaskPrompt(
        key=task,
        directory=directory,
        version=_read(directory / "VERSION").strip(),
        system=_ENV.from_string(_read(system)) if system.is_file() else None,
        user=_ENV.from_string(_read(user)) if user.is_file() else None,
    )


def render(task: str, variables: dict) -> tuple[str, str]:
    """Render `(system, user)`. A missing variable raises `jinja2.UndefinedError` (rule 7)."""
    prompt = load(task)
    if prompt.system is None or prompt.user is None:
        raise LookupError(f"AI task {task!r} has no system.md/user.md.")
    return prompt.system.render(**variables).strip(), prompt.user.render(**variables).strip()


def _load_module(task: str, filename: str) -> ModuleType | None:
    path = task_dir(task) / filename
    if not path.is_file():
        return None
    digest = hashlib.sha256(str(path).encode()).hexdigest()[:8]
    name = f"apps_ai_prompt__{task.replace('.', '_')}__{path.stem}__{digest}"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


@lru_cache(maxsize=None)
def schema_for(task: str) -> type[BaseModel] | None:
    """The task's `Output` model from `schema.py`, or None when the task has no schema."""
    module = _load_module(task, "schema.py")
    if module is None:
        return None
    output = getattr(module, "Output", None)
    if output is None:
        raise LookupError(f"apps/ai/prompts/{task}/schema.py does not export `Output`.")
    return output


output_schema = schema_for


@lru_cache(maxsize=None)
def fake_builder(task: str):
    """`build(variables, variant) -> dict` from the task's `fake.py`, or None."""
    module = _load_module(task, "fake.py")
    return getattr(module, "build", None) if module is not None else None


def fixture_variants(task: str) -> list[str]:
    return sorted(p.name[len("fixture."):-len(".json")]
                  for p in task_dir(task).glob("fixture.*.json"))


def fixture(task: str, variant: str | None = None):
    """Parsed `fixture.<variant>.json`, or `fixture.json` when `variant` is None."""
    name = f"fixture.{variant}.json" if variant else "fixture.json"
    path = task_dir(task) / name
    if not path.is_file():
        raise FileNotFoundError(f"apps/ai/prompts/{task}/{name} does not exist.")
    return json.loads(_read(path))


def system_variables(task: str) -> set[str]:
    path = task_dir(task) / "system.md"
    return set(jinja_meta.find_undeclared_variables(_ENV.parse(_read(path))))


def problems(task: str, spec: TaskSpec) -> list[str]:
    """Registry consistency problems of one registered task (rules 5-10), as messages."""
    found: list[str] = []
    directory = task_dir(task)
    if spec.provider not in PROVIDERS:
        found.append(f"provider {spec.provider!r} is not one of {', '.join(PROVIDERS)}")
    if spec.provider == "text" and spec.effort not in EFFORTS:
        found.append(f"effort {spec.effort!r} is not one of {', '.join(EFFORTS)}")
    if spec.max_tokens < 1:
        found.append("max_tokens must be positive")
    if not directory.is_dir():
        return [*found, f"directory apps/ai/prompts/{task}/ does not exist"]
    required = TEXT_FILES if spec.provider == "text" else IMAGE_FILES
    for name in required:
        if not (directory / name).is_file():
            found.append(f"{name} is missing")
    if (directory / "VERSION").is_file() and not _read(directory / "VERSION").strip():
        found.append("VERSION is empty")
    for name in ("system.md", "user.md"):
        path = directory / name
        if path.is_file():
            try:
                _ENV.parse(_read(path))
            except jinja2.TemplateSyntaxError as exc:
                found.append(f"{name} line {exc.lineno}: {exc.message}")
    if (directory / "system.md").is_file():
        try:
            extra = system_variables(task) - SYSTEM_ALLOWED_VARIABLES
        except jinja2.TemplateSyntaxError:
            extra = set()
        if extra:
            found.append("system.md may reference only content_language, not "
                         + ", ".join(sorted(extra)))
    if (directory / "schema.py").is_file():
        try:
            output = schema_for(task)
        except Exception as exc:  # noqa: BLE001 - reported by the check, not raised
            found.append(f"schema.py cannot be loaded: {exc}")
        else:
            if not (isinstance(output, type) and issubclass(output, BaseModel)):
                found.append("schema.py `Output` is not a Pydantic model")
    return found


def schema_problems(schema: type[BaseModel]) -> list[str]:
    """Prompt rule 5: every field has a description and every list has a maximum length."""
    found: list[str] = []
    document = schema.model_json_schema()

    def walk(node, path: str) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "array" and "maxItems" not in node:
            found.append(f"{path}: list without a maximum length")
        for name, prop in (node.get("properties") or {}).items():
            if isinstance(prop, dict) and not prop.get("description"):
                found.append(f"{path}.{name}: no description")
            walk(prop, f"{path}.{name}")
        for key in ("items", "additionalProperties"):
            walk(node.get(key), f"{path}[]")
        for key in ("anyOf", "oneOf", "allOf"):
            for option in node.get(key) or []:
                walk(option, path)

    walk(document, schema.__name__)
    for name, definition in (document.get("$defs") or {}).items():
        walk(definition, name)
    return found


def fixture_problems(task: str) -> list[str]:
    """Rule 33: every fixture of a registered text task validates (against `Output` if any)."""
    from pydantic import ValidationError

    spec = TASKS.get(task)
    if spec is None or spec.provider != "text":
        return []
    found: list[str] = []
    schema = schema_for(task)
    for variant in [None, *fixture_variants(task)]:
        name = f"fixture.{variant}.json" if variant else "fixture.json"
        try:
            value = fixture(task, variant)
        except (FileNotFoundError, json.JSONDecodeError) as exc:
            found.append(f"{task}: {name}: {exc}")
            continue
        if schema is not None:
            try:
                schema.model_validate(value)
            except ValidationError as exc:
                found.append(f"{task}: {name} does not match its schema: "
                             f"{exc.error_count()} errors")
        elif not (isinstance(value, str)
                  or (isinstance(value, dict) and isinstance(value.get("text"), str))):
            found.append(f"{task}: {name} must be text or {{\"text\", \"citations\"}}")
    return found


def registered_problems() -> dict[str, list[str]]:
    return {task: p for task, spec in TASKS.items() if (p := problems(task, spec))}
