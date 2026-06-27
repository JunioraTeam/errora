# syntax=docker/dockerfile:1.7
###############################################################################
# Errora frontend (Next.js, app router, standalone output) image.
#
# Multi-stage build:
#   1) deps    — install node_modules (cached on lockfile changes only).
#   2) builder — `next build` producing the standalone server bundle.
#   3) runner  — minimal image with only the standalone output, non-root.
#
# Requires `output: "standalone"` in next.config.{js,ts,mjs}. The build emits
# .next/standalone/server.js plus the trimmed node_modules it needs.
###############################################################################

# ---------------------------------------------------------------------------
# Stage 1: dependencies
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps

# libc6-compat keeps some native npm deps happy on Alpine.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy only manifests first for maximal layer caching, then install with the
# lockfile that exists (npm / yarn / pnpm all supported).
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN \
    if [ -f pnpm-lock.yaml ]; then \
        corepack enable && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
        yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
        npm ci; \
    else \
        echo "No lockfile found — falling back to npm install" && npm install; \
    fi

# ---------------------------------------------------------------------------
# Stage 2: builder
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Reuse installed deps, then bring in the rest of the source.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined at build time. Provide a sane default that
# can be overridden with `--build-arg NEXT_PUBLIC_API_URL=...`.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN \
    if [ -f pnpm-lock.yaml ]; then \
        corepack enable && pnpm run build; \
    elif [ -f yarn.lock ]; then \
        yarn build; \
    else \
        npm run build; \
    fi

# ---------------------------------------------------------------------------
# Stage 3: runner
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root user.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Standalone output: server.js + minimal node_modules. Static assets and the
# public/ folder are copied alongside because standalone does not include them.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

# Standalone server entrypoint (honours PORT/HOSTNAME env above).
CMD ["node", "server.js"]
