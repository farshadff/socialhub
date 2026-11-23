"""Startup check: render template files are complete and valid (E06-S02 BE6)."""

from django.core import checks

from .rendering.templates import validate_registry


@checks.register()
def check_render_templates(app_configs, **kwargs):
    return [checks.Error(problem, id="production.E001") for problem in validate_registry()]
