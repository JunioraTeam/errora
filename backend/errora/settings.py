"""
Django settings for Errora.

All configuration is environment-driven (see .env.example). Read once into a
module-level `env` so deployment is 12-factor and nothing secret is hardcoded.
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import environ
from celery.schedules import crontab
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["*"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:3000"]),
)
# Load .env from repo root or backend/ if present (no-op in prod where real env vars are set).
for candidate in (BASE_DIR / ".env", BASE_DIR.parent / ".env"):
    if candidate.exists():
        environ.Env.read_env(str(candidate))
        break

# --- Core -----------------------------------------------------------------
SECRET_KEY = env("SECRET_KEY", default="dev-insecure-change-me")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")
SITE_URL = env("SITE_URL", default="http://localhost:8000")
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000")

# --- Security (enforced in production) -------------------------------------
# Don't sniff content types; available regardless of DEBUG.
SECURE_CONTENT_TYPE_NOSNIFF = True
if not DEBUG:
    if "*" in ALLOWED_HOSTS:
        raise ImproperlyConfigured("ALLOWED_HOSTS must list real hostnames when DEBUG=False.")
    # Behind a TLS-terminating proxy/ingress; trust its forwarded scheme.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31_536_000)  # 1 year
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # third party
    "rest_framework",
    "adrf",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # errora apps
    "apps.accounts",
    "apps.organizations",
    "apps.issues",
    "apps.performance",
    "apps.logs",
    "apps.sourcemaps",
    "apps.ingest",
    "apps.integrations",
    "apps.ai",
    "apps.notifications",
    "apps.billing",
    "apps.mcp",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "errora.urls"
WSGI_APPLICATION = "errora.wsgi.application"
ASGI_APPLICATION = "errora.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- Database --------------------------------------------------------------
DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://errora:errora@localhost:5432/errora",
    )
}
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)
DATABASES["default"].setdefault("OPTIONS", {})

# --- Event store -----------------------------------------------------------
# High-volume events can live in ClickHouse instead of the OLTP DB. Issues,
# grouping, assignments etc. always stay in the OLTP DB. See apps.issues.store.
EVENT_STORE_BACKEND = env("EVENT_STORE_BACKEND", default="orm")  # "orm" | "clickhouse"
CLICKHOUSE_HOST = env("CLICKHOUSE_HOST", default="localhost")
CLICKHOUSE_PORT = env.int("CLICKHOUSE_PORT", default=8123)
CLICKHOUSE_USER = env("CLICKHOUSE_USER", default="default")
CLICKHOUSE_PASSWORD = env("CLICKHOUSE_PASSWORD", default="")
CLICKHOUSE_DATABASE = env("CLICKHOUSE_DATABASE", default="errora")

# --- Ingest edge protection ------------------------------------------------
# Reject payloads larger than this (decompressed bytes; 0 disables the cap).
INGEST_MAX_PAYLOAD_BYTES = env.int("INGEST_MAX_PAYLOAD_BYTES", default=1_000_000)
# Hard cap on decompressed body size — bounds gzip/deflate "bombs" before the
# payload check runs. Always enforced (independent of the cap above).
INGEST_MAX_DECOMPRESSED_BYTES = env.int("INGEST_MAX_DECOMPRESSED_BYTES", default=20_000_000)
# Per-project events accepted per minute (0 disables rate limiting). A non-zero
# default gives spike protection out of the box; raise/lower per deployment.
INGEST_RATE_LIMIT_PER_MIN = env.int("INGEST_RATE_LIMIT_PER_MIN", default=6000)

# --- Outbound SSRF guard ---------------------------------------------------
# Loopback/link-local/metadata addresses are always blocked for user-supplied
# outbound URLs (webhooks, AI/GitLab base_url). Enable this to ALSO block RFC1918
# private ranges — recommended for multi-tenant deployments, off by default so
# self-hosters can integrate with internal GitLab/Mattermost/LLM services.
SSRF_BLOCK_PRIVATE = env.bool("SSRF_BLOCK_PRIVATE", default=False)

# --- Cache & Redis ---------------------------------------------------------
REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

# --- Celery (Redis broker — chosen over Kafka per project spec) ------------
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=env("REDIS_URL", default=REDIS_URL))
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default=REDIS_URL)
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = env.int("CELERY_PREFETCH", default=4)
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_DEFAULT_QUEUE = "default"
# Dedicated queues keep slow AI work from starving fast ingestion.
CELERY_TASK_ROUTES = {
    "apps.ingest.tasks.*": {"queue": "ingest"},
    "apps.ai.tasks.*": {"queue": "ai"},
    "apps.notifications.tasks.*": {"queue": "notifications"},
}
# Periodic tasks (run by `celery -A errora beat`).
CELERY_BEAT_SCHEDULE = {
    "flush-usage-counters": {
        "task": "apps.billing.tasks.flush_usage",
        "schedule": env.int("USAGE_FLUSH_INTERVAL", default=300),  # seconds
    },
    # Nightly retention purge (per-org, by plan retention_days).
    "purge-expired-events": {
        "task": "apps.billing.tasks.purge_expired_events",
        "schedule": crontab(hour=3, minute=0),
    },
}

# Default event retention (days) for orgs without a plan-defined retention.
DATA_RETENTION_DAYS_DEFAULT = env.int("DATA_RETENTION_DAYS_DEFAULT", default=90)

# --- Auth ------------------------------------------------------------------
# One-time-code (OTP) login. Temporarily disabled by default; flip to re-enable.
OTP_ENABLED = env.bool("OTP_ENABLED", default=False)
# Allow new account creation. Set SIGNUP_ENABLED=0 to freeze registration
# (existing users can still log in; unknown identifiers are rejected).
SIGNUP_ENABLED = env.bool("SIGNUP_ENABLED", default=True)
AUTH_USER_MODEL = "accounts.User"
AUTHENTICATION_BACKENDS = [
    "apps.accounts.backends.EmailBackend",
    "django.contrib.auth.backends.ModelBackend",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

# --- DRF + JWT -------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.accounts.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_RATES": {
        "otp": "5/min",
        "anon": "60/min",
        # Brute-force / abuse guard for password login & signup (per client IP).
        "auth": env("AUTH_THROTTLE_RATE", default="10/min"),
    },
}
SPECTACULAR_SETTINGS = {
    "TITLE": "Errora API",
    "DESCRIPTION": "Exception tracking & performance monitoring.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

JWT_SECRET = env("JWT_SECRET", default=SECRET_KEY)
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TTL = timedelta(minutes=env.int("JWT_ACCESS_TTL_MIN", default=30))
JWT_REFRESH_TTL = timedelta(days=env.int("JWT_REFRESH_TTL_DAYS", default=14))

# --- OTP / SMS providers ---------------------------------------------------
# Provider is swappable by config — default Kavenegar for +98.
SMS_PROVIDER = env("SMS_PROVIDER", default="kavenegar")
KAVENEGAR_API_KEY = env("KAVENEGAR_API_KEY", default="")
KAVENEGAR_OTP_TEMPLATE = env("KAVENEGAR_OTP_TEMPLATE", default="errora-otp")
OTP_TTL_SECONDS = env.int("OTP_TTL_SECONDS", default=120)
OTP_LENGTH = env.int("OTP_LENGTH", default=6)
# In local dev, emit a fixed all-ones code (e.g. "111111") so no real SMS/email
# is needed. Defaults to DEBUG; force off in any deployed env.
OTP_DEBUG_CODE = env.bool("OTP_DEBUG_CODE", default=DEBUG)
DEFAULT_PHONE_REGION = env("DEFAULT_PHONE_REGION", default="+98")

# --- Email -----------------------------------------------------------------
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-reply@errora.dev")

# --- Encryption for stored integration secrets -----------------------------
# Fernet key (base64, 32 bytes). Generate with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
SECRETS_ENCRYPTION_KEY = env("SECRETS_ENCRYPTION_KEY", default="")

# Fail fast in production: without a dedicated key, stored integration tokens /
# AI keys would be encrypted under a key derived from a (defaultable) SECRET_KEY
# — effectively plaintext. Refuse to boot rather than silently do that.
if not DEBUG:
    if not SECRETS_ENCRYPTION_KEY:
        raise ImproperlyConfigured(
            "SECRETS_ENCRYPTION_KEY must be set when DEBUG=False; without it, secrets at "
            "rest are encrypted under a key derived from SECRET_KEY."
        )
    if SECRET_KEY == "dev-insecure-change-me":
        raise ImproperlyConfigured("SECRET_KEY must be set to a real value when DEBUG=False.")

# --- AI auto-fix defaults ---------------------------------------------------
AI_DEFAULT_PROVIDER = env("AI_DEFAULT_PROVIDER", default="claude")
AI_REQUEST_TIMEOUT = env.int("AI_REQUEST_TIMEOUT", default=120)

# --- Internationalization --------------------------------------------------
LANGUAGE_CODE = env("LANGUAGE_CODE", default="fa")
TIME_ZONE = env("TIME_ZONE", default="Asia/Tehran")
USE_I18N = True
USE_TZ = True
LANGUAGES = [("fa", "فارسی"), ("en", "English")]

# --- Static ----------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# --- CORS ------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Logging ---------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"format": "%(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}
