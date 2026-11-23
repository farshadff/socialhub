"""System check for the AI task registry (E00-S05 rule 10).

Only tasks registered in `apps.ai.tasks.TASKS` are checked; prompt directories that no row
names yet (another story's work in progress) are left alone.
"""

from django.core import checks


@checks.register()
def check_ai_task_registry(app_configs=None, **kwargs):
    from . import registry

    errors = []
    for task, found in sorted(registry.registered_problems().items()):
        for message in found:
            errors.append(checks.Error(
                f"AI task {task!r}: {message}.",
                hint=f"See apps/ai/prompts/{task}/ and apps/ai/tasks.py (E00-S05 rules 5-10).",
                id="ai.E001",
            ))
    return errors
