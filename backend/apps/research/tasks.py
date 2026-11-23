from . import jobs  # noqa: F401  (registers the research.run kind)
from .services import runs
from .services.platform import JobContext, job_task


@job_task("research.run")
def run_research(ctx: JobContext, **_payload):
    """Collect signals and synthesize topics for one research run (E02-S02, E02-S04).

    On the soft time limit, or any crash, the run is marked failed and the signals saved so far
    are kept; the job decorator records `timeout` or `server_error` on the job.
    """
    run_id = int(ctx.job.target_id)
    try:
        runs.execute_run(run_id, ctx)
    except Exception:
        runs.fail_on_timeout(run_id)
        raise
