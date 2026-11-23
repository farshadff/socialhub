"""System checks for the job registry (E00-S06 rule 3)."""

from django.core import checks


@checks.register()
def check_job_registry(app_configs=None, **kwargs):
    from celery import current_app

    from . import jobs

    errors = []
    task_names = set(current_app.tasks.keys())
    for kind in sorted(set(jobs._DUPLICATE_KINDS)):
        errors.append(checks.Error(f"Job kind {kind!r} is registered more than once.",
                                   id="core.E001"))
    for spec in jobs.registered_kinds().values():
        if spec.task is not None and spec.task not in task_names:
            errors.append(checks.Error(
                f"Job kind {spec.kind!r} names an unknown Celery task {spec.task!r}.",
                id="core.E002"))
        if spec.queue not in jobs.QUEUES:
            errors.append(checks.Error(
                f"Job kind {spec.kind!r} names an unknown queue {spec.queue!r}.",
                hint=f"Use one of {', '.join(jobs.QUEUES)}.", id="core.E003"))
    registered = jobs.registered_kinds()
    for kind, task_name in sorted(jobs._DECORATED.items()):
        spec = registered.get(kind)
        if spec is None:
            errors.append(checks.Error(
                f"Task {task_name!r} is decorated with @job_task({kind!r}) but the kind is "
                "not registered.", hint="Call register_job_kind in the app's jobs.py.",
                id="core.E004"))
        elif spec.task != task_name:
            errors.append(checks.Error(
                f"Job kind {kind!r} is registered with task {spec.task!r} but decorated as "
                f"{task_name!r}.", id="core.E005"))
    return errors
