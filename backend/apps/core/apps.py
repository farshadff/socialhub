from django.apps import AppConfig
from django.utils.module_loading import autodiscover_modules


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    label = "core"

    def ready(self):
        from . import checks  # noqa: F401  (registers the job registry check)

        # Every app registers its job kinds in jobs.py; tasks are imported too so the web
        # process can enqueue them by name and the system check can see them.
        autodiscover_modules("jobs")
        autodiscover_modules("tasks")
