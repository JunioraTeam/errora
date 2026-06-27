#!/bin/sh
# =============================================================================
# Errora merged container entrypoint.
#   1) wait/verify DB is reachable, then run migrations (idempotent) as the
#      unprivileged app user, BEFORE any app process starts serving;
#   2) exec the CMD (supervisord), keeping it as PID 1's child under tini.
#
# Set RUN_MIGRATIONS=0 to skip step 1 (e.g. when a separate job owns schema).
# =============================================================================
set -eu

cd /app/backend

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
    echo "[entrypoint] applying database migrations…"
    runuser -u errora -- python manage.py migrate --noinput
    echo "[entrypoint] migrations done."
fi

echo "[entrypoint] starting supervisord…"
exec "$@"
