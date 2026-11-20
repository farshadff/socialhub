from celery import shared_task


@shared_task(name="core.ping")
def ping() -> str:
    """Small, deterministic broker smoke task; performs no external work."""
    return "pong"
