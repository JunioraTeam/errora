# syntax=docker/dockerfile:1.7
###############################################################################
# Errora — merged single-container production image.
#
# One image runs the whole stack behind Nginx, supervised by supervisord:
#
#   nginx          :80  — reverse proxy / router (the only published port)
#     ├─ /api/ /admin/ /healthz /mcp /static/  → gunicorn  (127.0.0.1:8000)
#     └─ everything else                       → next.js   (127.0.0.1:3000)
#   gunicorn       127.0.0.1:8000  — Django (WSGI)
#   next.js        127.0.0.1:3000  — standalone server
#   celery worker  — queues: ingest, ai, notifications, default
#   celery beat    — periodic scheduler
#
# External datastores (Postgres + Redis) are NOT in this image — point at them
# via DATABASE_URL / REDIS_URL / CELERY_BROKER_URL env at runtime.
#
# Build (single public origin — bake it into the client bundle):
#   docker build -t errora/app \
#     --build-arg NEXT_PUBLIC_API_URL=https://errora.example.com .
#
# Run:
#   docker run -p 80:80 --env-file .env errora/app
#
# Layout: multi-stage. Frontend builds on node:alpine; the python:slim runtime
# borrows a glibc `node` binary from node:bookworm-slim to run the standalone
# server (alpine/musl node would not run on the debian-based runtime).
###############################################################################


# ===========================================================================
# Stage 1: frontend deps — node_modules, cached on lockfile changes only.
# ===========================================================================
FROM node:20-alpine AS frontend-deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml* frontend/pnpm-workspace.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile


# ===========================================================================
# Stage 2: frontend builder — `next build` -> .next/standalone bundle.
# ===========================================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=frontend-deps /app/node_modules ./node_modules
COPY frontend/ ./

# NEXT_PUBLIC_* are inlined into the client bundle at build time.
# For the merged single-origin deployment leave this EMPTY: the client then
# falls back to window.location.origin at runtime (frontend + /api share a
# domain behind nginx), so the image is portable across domains with no rebuild.
# Set it only when the API lives on a DIFFERENT origin than the frontend.
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN corepack enable && pnpm run build


# ===========================================================================
# Stage 3: backend builder — Python wheels into an isolated venv + static.
# ===========================================================================
FROM python:3.12-slim AS backend-builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH="/opt/venv/bin:${PATH}"

# Build toolchain for any source-only wheels (hiredis, mysqlclient headers…).
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        build-essential \
        libpq-dev \
        default-libmysqlclient-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# App source, then collect static at build time (immutable, cacheable layer).
# Throwaway secrets satisfy settings import; real values come from runtime env.
COPY backend/ ./
RUN SECRET_KEY="build-time-dummy-not-used-at-runtime" \
    DATABASE_URL="postgres://build:build@localhost:5432/build" \
    python manage.py collectstatic --noinput


# ===========================================================================
# Stage 4: runtime — debian slim with python + nginx + supervisor + node.
# ===========================================================================
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:${PATH}" \
    DJANGO_SETTINGS_MODULE=errora.settings \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# Runtime OS deps: libpq5 (psycopg), libmariadb (mysqlclient), nginx, supervisor,
# tini (PID 1 / reaper), curl (healthcheck), gettext-base for envsubst if needed.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        libpq5 \
        libmariadb3 \
        nginx \
        supervisor \
        tini \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

# glibc node binary to run the Next.js standalone server on this debian image.
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node

# Unprivileged users for the app processes (nginx runs as www-data, built in).
RUN groupadd --system --gid 1000 errora \
    && useradd --system --uid 1000 --gid errora --create-home --home-dir /home/errora errora \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# --- Python venv + backend source (+ collected static) ---
COPY --from=backend-builder /opt/venv /opt/venv
COPY --from=backend-builder --chown=errora:errora /app /app/backend

# --- Frontend standalone bundle (server.js + trimmed node_modules + assets) ---
WORKDIR /app/frontend
COPY --from=frontend-builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=frontend-builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=frontend-builder --chown=nextjs:nodejs /app/public ./public

# --- Process / proxy config ---
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
    # Writable runtime dirs for nginx (cache/logs/pid) and supervisor socket.
    && mkdir -p /var/cache/nginx /var/lib/nginx /var/log/nginx /run \
    && chown -R www-data:www-data /var/cache/nginx /var/lib/nginx /var/log/nginx

WORKDIR /app/backend

EXPOSE 80

# nginx is the single entry; check the backend's app-level health through it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:80/healthz || exit 1

# tini reaps zombies (celery/node fork children) and forwards signals.
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
