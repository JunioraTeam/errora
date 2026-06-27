#!/usr/bin/env bash
# Boots the Django backend for the Playwright e2e run: a throwaway SQLite DB,
# migrated + seeded fresh each time, served over ASGI on :8000. Invoked by the
# Playwright `webServer` config (cwd = frontend/).
set -euo pipefail

cd "$(dirname "$0")/../../backend"

DB_FILE="$(pwd)/e2e_db.sqlite3"
rm -f "$DB_FILE"

export SECRET_KEY="${SECRET_KEY:-e2e-insecure-secret}"
export DEBUG="1"
export ALLOWED_HOSTS="*"
export DATABASE_URL="sqlite:///${DB_FILE}"
export SITE_URL="http://localhost:8001"
export FRONTEND_URL="http://localhost:3001"
export CORS_ALLOWED_ORIGINS="http://localhost:3001"
export CELERY_TASK_ALWAYS_EAGER="1"
export CELERY_BROKER_URL="memory://"
export SIGNUP_ENABLED="1"
export OTP_ENABLED="0"
export LANGUAGE_CODE="en"
# The suite logs in once per test; relax the brute-force throttle so later
# tests aren't rejected with HTTP 429.
export AUTH_THROTTLE_RATE="10000/min"

PY=.venv/bin/python

"$PY" manage.py migrate --no-input
"$PY" manage.py seed_e2e
exec "$PY" -m uvicorn errora.asgi:application --host 127.0.0.1 --port 8001
