# syntax=docker/dockerfile:1.7
###############################################################################
# Errora backend (Django 5 + Celery) image.
#
# Multi-stage build:
#   1) builder  — installs build toolchain + Python wheels into a venv.
#   2) runtime  — slim image that copies the venv + source, runs as non-root.
#
# The same image is reused for the web (gunicorn), celery worker and celery
# beat processes; the running command is overridden by docker-compose / k8s.
#   - web    (default CMD below):  gunicorn errora.wsgi:application ...
#   - worker (override command):   celery -A errora worker -Q ingest,ai,notifications,default -l info
#   - beat   (override command):   celery -A errora beat -l info
###############################################################################

# ---------------------------------------------------------------------------
# Stage 1: builder
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build dependencies. psycopg[binary] ships its own libpq, but build-essential
# is kept for any source-only wheels (e.g. hiredis) that need a C compiler.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Create an isolated virtualenv we can copy wholesale into the runtime stage.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

WORKDIR /app

# Install deps first for better layer caching (requirements.txt rarely changes).
COPY requirements.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:${PATH}" \
    DJANGO_SETTINGS_MODULE=errora.settings

# Runtime-only OS deps. libpq5 provides the Postgres client lib at runtime;
# curl is handy for container-level healthchecks. No compilers shipped.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        libpq5 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user/group to run the application.
RUN groupadd --system --gid 1000 errora \
    && useradd --system --uid 1000 --gid errora --create-home --home-dir /home/errora errora

# Copy the prepared virtualenv from the builder stage.
COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# Copy application source. (.dockerignore keeps caches, venvs, tests out.)
COPY --chown=errora:errora . /app

# Collect static assets at build time so the image is immutable & cacheable.
# A throwaway SECRET_KEY is provided because settings import requires one; the
# real key is injected at runtime via env. STATIC_ROOT is BASE_DIR/staticfiles.
RUN SECRET_KEY="build-time-dummy-not-used-at-runtime" \
    DATABASE_URL="postgres://build:build@localhost:5432/build" \
    python manage.py collectstatic --noinput

# Drop privileges.
USER errora

EXPOSE 8000

# Default (web) command. Overridden for worker/beat in compose & k8s.
#   worker: celery -A errora worker -Q ingest,ai,notifications,default -l info
#   beat:   celery -A errora beat -l info
CMD ["gunicorn", "errora.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4"]
