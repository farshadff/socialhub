from django.apps import AppConfig


class ResearchConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.research"
    label = "research"

    def ready(self):
        from . import checks, jobs  # noqa: F401  (system check and job kind registration)
