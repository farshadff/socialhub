"""Settings for the automated test suite on a machine without PostgreSQL or Redis.

SQLite in memory, a local-memory cache and eager Celery. Production settings stay PostgreSQL
and Redis (config/settings.py). Used by pytest (pyproject.toml) and by
`python manage.py test --settings=config.settings_test`.
"""

import os
import secrets
import tempfile

from cryptography.fernet import Fernet

os.environ.setdefault("DJANGO_SECRET_KEY", secrets.token_urlsafe(50))  # random per run
os.environ["SOCIALHUB_DB_ENGINE"] = "sqlite"
os.environ["SOCIALHUB_CACHE"] = "locmem"
os.environ.setdefault("SOCIALHUB_MEDIA_BACKEND", "local")
# A real Fernet key per run (E00-S04 rule 17); the local fallback key is not used in tests.
os.environ.setdefault("SOCIALHUB_ENCRYPTION_KEY", Fernet.generate_key().decode())

from .settings import *  # noqa: E402,F403

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

CELERY_BROKER_URL = "memory://"
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

MEDIA_ROOT = tempfile.mkdtemp(prefix="socialhub-test-media-")
STORAGES = {
    **STORAGES,  # noqa: F405
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage",
                "OPTIONS": {"location": MEDIA_ROOT}},
}
SOCIALHUB_WORK_DIR = tempfile.gettempdir()

# A test-only app with a model that carries `active_job` (core job target tests).
INSTALLED_APPS = [*INSTALLED_APPS, "apps.core.tests.testapp"]  # noqa: F405
