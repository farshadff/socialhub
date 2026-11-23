"""Startup check: every registered task has its prompt files (E00-S05 rule 10)."""

from django.core import checks

from .registry import load_task, system_variables, task_dir
from .tasks import TASKS


@checks.register()
def check_task_registry(app_configs=None, **kwargs):
    errors = []
    for key in sorted(TASKS):
        directory = task_dir(key)
        for name in ("system.md", "user.md", "VERSION"):
            if not (directory / name).exists():
                errors.append(checks.Error(f"AI task {key!r} is missing {name}", id="ai.E001"))
        if errors:
            continue
        try:
            prompt = load_task(key)
        except Exception as exc:
            errors.append(checks.Error(f"AI task {key!r} failed to load: {exc}", id="ai.E002"))
            continue
        extra = system_variables(prompt) - {"content_language"}
        if extra:
            errors.append(
                checks.Error(
                    f"AI task {key!r}: system.md may only use content_language, uses {sorted(extra)}",
                    id="ai.E003",
                )
            )
        if not (directory / "fixture.json").exists():
            errors.append(checks.Error(f"AI task {key!r} has no fixture.json", id="ai.E004"))
    return errors
