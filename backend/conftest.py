"""
Pytest bootstrap. Runs the suite on SQLite by default (no Postgres needed in
CI) and forces Celery tasks to execute eagerly so signal-driven flows are
testable inline. Override DATABASE_URL to run against Postgres.
"""

import os

os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("DEBUG", "true")  # tests run in debug; skips prod-only config guards
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_TASK_ALWAYS_EAGER", "1")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "errora.settings")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _test_env(settings):
    from django.core.cache import cache

    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = True
    # Use in-process cache so tests need no Redis (ingest key cache + usage counters).
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    # Reset cache between tests so rate-limit/throttle + OTP counters don't leak
    # across cases (the LocMemCache is process-global).
    cache.clear()
    # OTP is disabled by default in prod; enable it for the suite (a dedicated
    # test overrides this to assert the disabled path).
    settings.OTP_ENABLED = True


@pytest.fixture
def api():
    from rest_framework.test import APIClient

    return APIClient()


@pytest.fixture
def user(db):
    from apps.accounts.models import User

    return User.objects.create_user(email="alice@errora.dev", password="password123")


@pytest.fixture
def auth_api(user):
    from rest_framework.test import APIClient

    from apps.accounts.authentication import issue_token_pair

    client = APIClient()
    tokens = issue_token_pair(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return client


@pytest.fixture
def org(user):
    # Created automatically by the post_save signal.
    return user.organizations.first()


@pytest.fixture
def project(org):
    from apps.organizations.services import create_project

    return create_project(organization=org, name="Test Project", platform="python")
