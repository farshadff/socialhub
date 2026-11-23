import json
import os
from pathlib import Path

from celery.schedules import crontab
from django.core.exceptions import ImproperlyConfigured
from kombu import Queue

from .media import build_media_settings

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
    "apps.accounts",
    "apps.ai",
    "apps.planning",
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

# PostgreSQL everywhere the app runs. SOCIALHUB_DB_ENGINE=sqlite exists only so the test suite
# can run on a machine without PostgreSQL (config/settings_test.py sets it).
SOCIALHUB_TEST_DATABASE = os.environ.get("SOCIALHUB_DB_ENGINE", "postgresql") == "sqlite"
if SOCIALHUB_TEST_DATABASE:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }
else:
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "socialhub"),
        "USER": os.environ.get("POSTGRES_USER", "socialhub"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "socialhub-local-only"),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }}

LANGUAGE_CODE = "fa-ir"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# Media storage (E00-S06): SOCIALHUB_MEDIA_BACKEND=local|s3 plus SOCIALHUB_S3_*,
# SOCIALHUB_MEDIA_URL_TTL_SECONDS, SOCIALHUB_MEDIA_BASE_URL and SOCIALHUB_WORK_DIR. Sets STORAGES.
globals().update(
    build_media_settings(os.environ, debug=DEBUG, media_root=MEDIA_ROOT,
                         allow_local_without_debug=SOCIALHUB_TEST_DATABASE)
)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
FILE_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024

SOCIALHUB_DEFAULT_SOURCE_MODE = os.environ.get("SOCIALHUB_DEFAULT_SOURCE_MODE", "combined")
SOCIALHUB_DEFAULT_ACCOUNT_TIME_ZONE = os.environ.get(
    "SOCIALHUB_DEFAULT_ACCOUNT_TIME_ZONE", "Asia/Tehran"
)

# AI gateway (E00-S05, docs/AI-INTEGRATION.md section 1). Keys come only from the environment.
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
SOCIALHUB_AI_TEXT_PROVIDER = os.environ.get("SOCIALHUB_AI_TEXT_PROVIDER", "fake")
SOCIALHUB_AI_IMAGE_PROVIDER = os.environ.get("SOCIALHUB_AI_IMAGE_PROVIDER", "fake")
SOCIALHUB_AI_TEXT_MODEL = os.environ.get("SOCIALHUB_AI_TEXT_MODEL", "claude-opus-5-5")
SOCIALHUB_AI_TEXT_MODEL_OVERRIDES = json.loads(
    os.environ.get("SOCIALHUB_AI_TEXT_MODEL_OVERRIDES", "") or "{}"
)
# Set at deployment to OpenAI's current image model (confirm the ID in OpenAI's documentation).
SOCIALHUB_AI_IMAGE_MODEL = os.environ.get("SOCIALHUB_AI_IMAGE_MODEL", "")
SOCIALHUB_AI_IMAGE_SIZES = json.loads(
    os.environ.get("SOCIALHUB_AI_IMAGE_SIZES", "")
    or '{"square": "1024x1024", "portrait": "1024x1536", "landscape": "1536x1024"}'
)
# Per million tokens (text) or `per_image` by pixel size (image); `web_search` per search.
# Seed from Anthropic's published prices; SOCIALHUB_AI_PRICES entries replace a model's row.
SOCIALHUB_AI_PRICES = {
    "claude-opus-5-5": {"input": 4.00, "output": 20.00, "cache_read": 0.20, "cache_write": 5.00,
                        "web_search": 0.01},
    "claude-haiku-5-5": {"input": 0.10, "output": 0.50, "cache_read": 0.01, "cache_write": 0.125,
                         "web_search": 0.01},
    **json.loads(os.environ.get("SOCIALHUB_AI_PRICES", "") or "{}"),
}
SOCIALHUB_AI_TIMEOUT_SECONDS = int(os.environ.get("SOCIALHUB_AI_TIMEOUT_SECONDS", "180"))
SOCIALHUB_AI_MAX_CALLS_PER_JOB = int(os.environ.get("SOCIALHUB_AI_MAX_CALLS_PER_JOB", "20"))
SOCIALHUB_AI_MAX_IMAGES_PER_ITEM = int(os.environ.get("SOCIALHUB_AI_MAX_IMAGES_PER_ITEM", "12"))
SOCIALHUB_PRODUCTION_AUTO_IMAGES = (
    os.environ.get("SOCIALHUB_PRODUCTION_AUTO_IMAGES", "false").lower() == "true"
)
SOCIALHUB_REPORT_LANGUAGE = os.environ.get("SOCIALHUB_REPORT_LANGUAGE", "en")
# E11-S03 test hooks; the fake AI provider reads its Redis overrides only when this is on.
SOCIALHUB_TESTING_HOOKS = os.environ.get("SOCIALHUB_TESTING_HOOKS", "false").lower() == "true"
SOCIALHUB_APP_VERSION = os.environ.get("SOCIALHUB_APP_VERSION", "0.1.0")
SOCIALHUB_ENVIRONMENT = os.environ.get("SOCIALHUB_ENVIRONMENT",
                                       "development" if DEBUG else "production")

if SOCIALHUB_AI_TEXT_PROVIDER not in ("anthropic", "fake"):
    raise ImproperlyConfigured("SOCIALHUB_AI_TEXT_PROVIDER must be `anthropic` or `fake`.")
if SOCIALHUB_AI_IMAGE_PROVIDER not in ("openai", "fake"):
    raise ImproperlyConfigured("SOCIALHUB_AI_IMAGE_PROVIDER must be `openai` or `fake`.")
# Production startup rule (E11-S02 rule 9): no fake AI provider without DJANGO_DEBUG=true.
# The SQLite test database (SOCIALHUB_DB_ENGINE=sqlite) is exempt so the suite runs anywhere.
if not DEBUG and not SOCIALHUB_TEST_DATABASE and "fake" in (SOCIALHUB_AI_TEXT_PROVIDER,
                                                            SOCIALHUB_AI_IMAGE_PROVIDER):
    raise ImproperlyConfigured(
        "The fake AI provider is for local development only; set SOCIALHUB_AI_TEXT_PROVIDER="
        "anthropic and SOCIALHUB_AI_IMAGE_PROVIDER=openai when DJANGO_DEBUG=false."
    )

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/1")
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "UTC"
CELERY_ENABLE_UTC = True
CELERY_TASK_TRACK_STARTED = True
# Queues and routing (E00-S06 rule 24). Job tasks are also routed explicitly by start_job.
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_TASK_QUEUES = [Queue("default"), Queue("render"), Queue("publish")]
CELERY_TASK_ROUTES = {
    "production.render_*": {"queue": "render"},
    "production.export_*": {"queue": "render"},
    "production.assemble_*": {"queue": "render"},
    "production.normalise_*": {"queue": "render"},
    "production.tasks.render_*": {"queue": "render"},
    "production.tasks.export_*": {"queue": "render"},
    "production.tasks.assemble_*": {"queue": "render"},
    "production.tasks.normalise_*": {"queue": "render"},
    "publishing.*": {"queue": "publish"},
}
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BROKER_TRANSPORT_OPTIONS = {"visibility_timeout": 7200}
CELERY_TASK_IGNORE_RESULT = True
CELERY_TASK_ALWAYS_EAGER = os.environ.get("CELERY_TASK_ALWAYS_EAGER", "false").lower() == "true"

SOCIALHUB_JOB_TIMEOUT_OVERRIDES = json.loads(
    os.environ.get("SOCIALHUB_JOB_TIMEOUT_OVERRIDES", "") or "{}"
)

CELERY_BEAT_SCHEDULE = {
    "core.sweep_stale_jobs": {"task": "core.sweep_stale_jobs", "schedule": 300.0},
    "core.prune_jobs": {"task": "core.prune_jobs", "schedule": crontab(hour=3, minute=15)},
    "ai.prune_payloads": {"task": "ai.prune_payloads", "schedule": crontab(hour=2, minute=30)},
    "planning.close_finished_plans": {
        "task": "planning.close_finished_plans",
        "schedule": crontab(hour=2, minute=0),
    },
}

# Redis backs the cache: sign-in throttle counters, OAuth state, per-account locks (E00-S01).
# SOCIALHUB_CACHE=locmem exists only for the test suite.
if os.environ.get("SOCIALHUB_CACHE", "redis") == "locmem":
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}

SESSION_COOKIE_AGE = 1209600
SESSION_SAVE_EVERY_REQUEST = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_HTTPONLY = False

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.core.authentication.CsrfSessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.BoundedPageNumberPagination",
    "PAGE_SIZE": 50,
    "EXCEPTION_HANDLER": "apps.core.errors.api_exception_handler",
    # Several list endpoints filter by `?format=reel`; DRF must not read it as a renderer.
    "URL_FORMAT_OVERRIDE": None,
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

# E00-S03: accounts, brand profiles and bundled fonts.
# Bundled fonts (apps/core/fonts/files) are served as static files under static/fonts/.
STATICFILES_DIRS = [("fonts", BASE_DIR / "apps" / "core" / "fonts" / "files")]

# E00-S04: Instagram connection (docs/INSTAGRAM-INTEGRATION.md section 9).
INSTALLED_APPS += ["apps.instagram"]
_IG_PROVIDERS = ("graph_api", "manual", "fake")
# Providers with an adapter. TODO(E00-S04-BE2): add `graph_api` once its adapter exists
# (docs/INSTAGRAM-INTEGRATION.md sections 7-8); until then it is a reserved value only.
SOCIALHUB_IG_IMPLEMENTED_PROVIDERS = ("manual", "fake")
_IG_LOCAL = DEBUG or SOCIALHUB_TEST_DATABASE


def _ig_csv(name: str, default: str) -> list[str]:
    raw = os.environ.get(name, "").strip() or default
    return [item.strip().lower() for item in raw.split(",") if item.strip()]


# Token encryption (rule 17): one Fernet key, or a comma-separated list (first encrypts, every
# key decrypts). Required with DJANGO_DEBUG=false; locally a key derived from
# DJANGO_SECRET_KEY stands in when it is unset, so stored tokens survive only that secret.
def _ig_encryption_keys() -> list[str]:
    import base64
    import hashlib

    from cryptography.fernet import Fernet

    keys = [key.strip() for key in os.environ.get("SOCIALHUB_ENCRYPTION_KEY", "").split(",")
            if key.strip()]
    if not keys:
        if not _IG_LOCAL:
            raise ImproperlyConfigured(
                "SOCIALHUB_ENCRYPTION_KEY must be set (a Fernet key; generate one with "
                "`python -c \"from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())\"`).")
        keys = [base64.urlsafe_b64encode(hashlib.sha256(
            f"socialhub-local-token-key:{SECRET_KEY}".encode()).digest()).decode()]
    for index, key in enumerate(keys, start=1):
        try:
            Fernet(key)
        except (ValueError, TypeError):
            raise ImproperlyConfigured(
                f"SOCIALHUB_ENCRYPTION_KEY: key {index} is not a valid Fernet key.") from None
    return keys


SOCIALHUB_ENCRYPTION_KEY = _ig_encryption_keys()
SOCIALHUB_META_APP_ID = os.environ.get("SOCIALHUB_META_APP_ID", "").strip()
SOCIALHUB_META_APP_SECRET = os.environ.get("SOCIALHUB_META_APP_SECRET", "").strip()
SOCIALHUB_META_REDIRECT_URI = (
    os.environ.get("SOCIALHUB_META_REDIRECT_URI", "").strip()
    or "http://localhost:8000/api/v1/instagram/oauth/callback/"
)
SOCIALHUB_IG_API_VERSION = os.environ.get("SOCIALHUB_IG_API_VERSION", "").strip()
SOCIALHUB_IG_HTTP_PROXY = os.environ.get("SOCIALHUB_IG_HTTP_PROXY", "").strip()
SOCIALHUB_IG_TOKEN_REFRESH_AFTER_DAYS = int(
    os.environ.get("SOCIALHUB_IG_TOKEN_REFRESH_AFTER_DAYS", "") or 7)
SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS = int(
    os.environ.get("SOCIALHUB_IG_MEDIA_URL_TTL_SECONDS", "") or 7200)
SOCIALHUB_PANEL_URL = (os.environ.get("SOCIALHUB_PANEL_URL", "").strip()
                       or "http://localhost:5173").rstrip("/")
SOCIALHUB_IG_DEFAULT_PROVIDER = (
    os.environ.get("SOCIALHUB_IG_DEFAULT_PROVIDER", "").strip().lower()
    or ("fake" if _IG_LOCAL else "manual")
)
SOCIALHUB_IG_ALLOWED_PROVIDERS = _ig_csv(
    "SOCIALHUB_IG_ALLOWED_PROVIDERS", "fake,manual,graph_api" if _IG_LOCAL else "graph_api,manual")
SOCIALHUB_IG_CAPABILITY_OVERRIDES = json.loads(
    os.environ.get("SOCIALHUB_IG_CAPABILITY_OVERRIDES", "") or "{}")

for _name in SOCIALHUB_IG_ALLOWED_PROVIDERS:
    if _name not in _IG_PROVIDERS:
        raise ImproperlyConfigured(
            f"SOCIALHUB_IG_ALLOWED_PROVIDERS: unknown provider {_name!r}; use "
            f"{', '.join(_IG_PROVIDERS)}.")
if SOCIALHUB_IG_DEFAULT_PROVIDER not in SOCIALHUB_IG_ALLOWED_PROVIDERS:
    raise ImproperlyConfigured(
        "SOCIALHUB_IG_DEFAULT_PROVIDER must be one of SOCIALHUB_IG_ALLOWED_PROVIDERS.")
if SOCIALHUB_IG_DEFAULT_PROVIDER not in SOCIALHUB_IG_IMPLEMENTED_PROVIDERS:
    # TODO(E00-S04-BE2): allow `graph_api` here when the adapter is built.
    raise ImproperlyConfigured(
        "SOCIALHUB_IG_DEFAULT_PROVIDER must be fake or manual: the graph_api adapter is not "
        "built yet (docs/INSTAGRAM-INTEGRATION.md).")
if not isinstance(SOCIALHUB_IG_CAPABILITY_OVERRIDES, dict):
    raise ImproperlyConfigured("SOCIALHUB_IG_CAPABILITY_OVERRIDES must be a JSON object.")
# Rule 42: hosted environments that allow graph_api need the whole Meta app configuration.
if not _IG_LOCAL and "graph_api" in SOCIALHUB_IG_ALLOWED_PROVIDERS:
    import re as _re

    _missing = [name for name in ("SOCIALHUB_META_APP_ID", "SOCIALHUB_META_APP_SECRET",
                                  "SOCIALHUB_IG_API_VERSION") if not globals()[name]]
    if _missing:
        raise ImproperlyConfigured(
            f"graph_api is allowed but {', '.join(_missing)} is not set; set it or remove "
            "graph_api from SOCIALHUB_IG_ALLOWED_PROVIDERS.")
    if not SOCIALHUB_META_REDIRECT_URI.startswith("https://"):
        raise ImproperlyConfigured("SOCIALHUB_META_REDIRECT_URI must start with https://.")
    if not _re.fullmatch(r"v\d+\.\d+", SOCIALHUB_IG_API_VERSION):
        raise ImproperlyConfigured("SOCIALHUB_IG_API_VERSION must look like v23.0.")
    if SOCIALHUB_MEDIA_BACKEND != "s3":  # noqa: F821  (set by build_media_settings)
        raise ImproperlyConfigured("graph_api needs SOCIALHUB_MEDIA_BACKEND=s3.")
CELERY_BEAT_SCHEDULE.update({
    "instagram.refresh_tokens": {"task": "instagram.refresh_tokens",
                                 "schedule": crontab(hour=2, minute=15)},
    "instagram.verify_all": {"task": "instagram.verify_all",
                             "schedule": crontab(hour=3, minute=0)},
})

# --- E02 --- trend research (docs/epics/E02-trend-research) ----------------------------------
INSTALLED_APPS += ["apps.research"]


def _csv_env(name: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, "").split(",") if item.strip()]


SOCIALHUB_HTTP_USER_AGENT = os.environ.get("SOCIALHUB_HTTP_USER_AGENT", "SocialHubBot/1.0")
SOCIALHUB_RESEARCH_BLOCKED_DOMAINS = _csv_env("SOCIALHUB_RESEARCH_BLOCKED_DOMAINS")
# Hosts safe_fetch may reach even when private; honoured only with DEBUG or test hooks on.
SOCIALHUB_FETCH_ALLOW_HOSTS = _csv_env("SOCIALHUB_FETCH_ALLOW_HOSTS")
SOCIALHUB_RESEARCH_MAX_TOPICS = int(os.environ.get("SOCIALHUB_RESEARCH_MAX_TOPICS", "8"))
SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS = json.loads(
    os.environ.get("SOCIALHUB_RESEARCH_EVIDENCE_WEIGHTS")
    or '{"signal_count": 0.35, "source_diversity": 0.25, "recency": 0.25, "engagement": 0.15}'
)

# --- E03-E06 --- content items, formats and briefs, scripts, assets and production ----------
INSTALLED_APPS += ["apps.selection", "apps.content", "apps.production"]

SOCIALHUB_MAX_HASHTAGS = int(os.environ.get("SOCIALHUB_MAX_HASHTAGS", "5"))
SOCIALHUB_PRODUCTION_AUTO_IMAGES = (
    os.environ.get("SOCIALHUB_PRODUCTION_AUTO_IMAGES", "false").lower() == "true")
SOCIALHUB_AI_MAX_IMAGES_PER_ITEM = int(os.environ.get("SOCIALHUB_AI_MAX_IMAGES_PER_ITEM", "12"))
SOCIALHUB_CHROMIUM_PATH = os.environ.get("SOCIALHUB_CHROMIUM_PATH", "")
SOCIALHUB_STATIC_BASE_URL = os.environ.get("SOCIALHUB_STATIC_BASE_URL",
                                           "http://localhost:8000/static/")
if "SOCIALHUB_AI_DISCLOSURE_TEXT" not in globals():
    SOCIALHUB_AI_DISCLOSURE_TEXT = json.loads(
        os.environ.get("SOCIALHUB_AI_DISCLOSURE_TEXT")
        or '{"en": "Made with the help of AI.", '
           '"fa": "این محتوا با کمک هوش مصنوعی تولید شده است."}')
