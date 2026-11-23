from django.apps import AppConfig


class ContentConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.content"
    label = "content"

    def ready(self):
        from . import checks  # noqa: F401 - registers system checks
        from . import handlers  # noqa: F401 - registers pipeline handlers and actions
        from . import receivers  # noqa: F401 - job_finished receivers

        try:
            from apps.core.jobs import register_job_target
        except ImportError:  # E00-S06 job targets not available yet
            return
        from . import jobs  # noqa: F401 - job kinds
        from .models import ContentItem

        register_job_target("content_item", ContentItem)
