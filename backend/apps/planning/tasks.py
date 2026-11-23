from celery import shared_task

from . import services


@shared_task(name="planning.close_finished_plans")
def close_finished_plans() -> dict:
    """Daily at 02:00 UTC: close active plans whose week ended two full days ago (E01-S03)."""
    return services.close_finished_plans()
