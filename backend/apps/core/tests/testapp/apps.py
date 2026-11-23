from django.apps import AppConfig


class CoreTestAppConfig(AppConfig):
    """Installed only by config/settings_test.py."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core.tests.testapp"
    label = "core_testapp"
