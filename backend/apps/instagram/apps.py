from django.apps import AppConfig


class InstagramConfig(AppConfig):
    """Instagram provider layer and connection lifecycle (E00-S04). Owns no tables: the
    connection row is `accounts.AccountConnection`."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.instagram"
    label = "instagram"
    verbose_name = "Instagram connection"
