from celery.exceptions import SoftTimeLimitExceeded

from apps.core.jobs import JobContext, JobError, job_step, job_task

CALLS: list[str] = []
STEP_CALLS: list[tuple] = []


@job_task("test.echo", max_retries=3)
def echo(ctx: JobContext, mode: str = "succeed", **payload):
    CALLS.append(mode)
    if mode == "succeed":
        ctx.progress(40, "Checking copy")
        ctx.succeed({"qc_run_id": 7})
    elif mode == "job_error":
        ctx.progress(30, "Rendering frame 3 of 5")
        raise JobError("render_failed", "Frame 3 overflowed")
    elif mode == "key_error":
        raise KeyError("secret-looking-key")
    elif mode == "soft_timeout":
        raise SoftTimeLimitExceeded()
    elif mode == "retry":
        if ctx.task.request.retries < 1:
            ctx.retry(countdown=0)
        ctx.succeed({"retries": ctx.task.request.retries})
    elif mode == "noop":
        ctx.progress(10, "Working")


@job_task("test.verify")
def verify(ctx: JobContext, **payload):
    ctx.succeed()


@job_task("test.refresh")
def refresh(ctx: JobContext, **payload):
    ctx.succeed()


@job_task("test.render")
def render(ctx: JobContext, **payload):
    ctx.succeed()


@job_task("test.prunable")
def prunable(ctx: JobContext, **payload):
    ctx.succeed()


@job_step("core_testapp.step_progress")
def step_progress(ctx: JobContext, percent: int = 50, **payload):
    STEP_CALLS.append(("progress", percent))
    ctx.progress(percent, f"Step at {percent}")
    return {"step": percent}


@job_step("core_testapp.step_finish")
def step_finish(ctx: JobContext, **payload):
    STEP_CALLS.append(("finish", None))
    ctx.succeed({"done": True})


@job_step("core_testapp.step_boom")
def step_boom(ctx: JobContext, **payload):
    STEP_CALLS.append(("boom", None))
    raise JobError("render_failed", "Step failed")
