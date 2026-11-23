from django.apps import AppConfig


class AiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.ai"
    label = "ai"
    verbose_name = "AI gateway"

    def ready(self):
        from . import checks  # noqa: F401  (registers the task registry check)
