import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set; copy .env.example for local development.")

DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = [host.strip() for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost").split(",") if host.strip()]
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "apps.core",
]

MIDDLEWARE = [
    "apps.core.middleware.RequestIDMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "socialhub"),
        "USER": os.environ.get("POSTGRES_USER", "socialhub"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "socialhub-local-only"),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }
}

LANGUAGE_CODE = "fa-ir"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
FILE_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024

SOCIALHUB_SOURCE_PROVIDER = os.environ.get("SOCIALHUB_SOURCE_PROVIDER", "fixture")
SOCIALHUB_MODEL_PROVIDER = os.environ.get("SOCIALHUB_MODEL_PROVIDER", "fixture")
SOCIALHUB_PUBLISHER_PROVIDER = os.environ.get("SOCIALHUB_PUBLISHER_PROVIDER", "disabled")
SOCIALHUB_PUBLISHING_ENABLED = os.environ.get("SOCIALHUB_PUBLISHING_ENABLED", "false").lower() == "true"
SOCIALHUB_DEFAULT_SOURCE_MODE = os.environ.get("SOCIALHUB_DEFAULT_SOURCE_MODE", "combined")
SOCIALHUB_DEFAULT_ACCOUNT_TIME_ZONE = os.environ.get(
    "SOCIALHUB_DEFAULT_ACCOUNT_TIME_ZONE", "Asia/Tehran"
)

if SOCIALHUB_PUBLISHING_ENABLED or SOCIALHUB_PUBLISHER_PROVIDER != "disabled":
    raise ImproperlyConfigured(
        "External publishing is unavailable in this scaffold. Keep the publisher disabled."
    )
if SOCIALHUB_SOURCE_PROVIDER != "fixture" or SOCIALHUB_MODEL_PROVIDER != "fixture":
    raise ImproperlyConfigured("Only deterministic fixture providers are available in the local scaffold.")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/1")
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "UTC"
CELERY_ENABLE_UTC = True
CELERY_TASK_TRACK_STARTED = True
CELERY_BEAT_SCHEDULE = {}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.BoundedPageNumberPagination",
    "PAGE_SIZE": 50,
    "EXCEPTION_HANDLER": "apps.core.errors.api_exception_handler",
}

CSRF_FAILURE_VIEW = "apps.core.errors.csrf_failure"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "local": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        },
    },
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "local"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}
