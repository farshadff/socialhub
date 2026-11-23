from django.apps import AppConfig


class ProductionConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.production"
    label = "production"

    def ready(self):
        from . import checks  # noqa: F401 - render template system check
        from .services import orchestration  # noqa: F401 - registers the `scripted` handler

        try:
            from . import jobs  # noqa: F401 - job kinds (needs E00-S06 core.jobs)
        except ImportError:
            pass
