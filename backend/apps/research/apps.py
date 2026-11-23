from django.apps import AppConfig


class ResearchConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.research"
    label = "research"
    verbose_name = "Trend research"

    def ready(self):
        from . import (
            jobs,  # noqa: F401  (registers research.run)
            tasks,  # noqa: F401  (registers its Celery task)
        )
        from .services import evidence

        evidence.check_weights()
