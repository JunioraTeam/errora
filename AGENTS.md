# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## Big picture

Errora is an exception-tracking, performance, **logs**, and AI-auto-fix platform (Sentry-like)
with two deployables:

- **`backend/`** — Django 6 + DRF (async via **adrf**) + Celery. System of record + business logic.
  Also serves an **MCP** JSON-RPC endpoint at `/mcp` for AI agents.
- **`frontend/`** — Next.js (App Router). Talks to the backend over `/api/v1`.

Events come from the **official Sentry SDKs** (Errora is Sentry-wire-compatible); there is
no custom client library.

Data flow: **Sentry SDK → `POST /api/<project_id>/store/` or `/envelope/` → Celery `ingest` queue → normalize →
fingerprint/group → store Event + upsert Issue → fire domain signals → notifications / AI.**

## Backend conventions

- Apps live under `backend/apps/<name>/` and are referenced as `apps.<name>` in
  `INSTALLED_APPS`. Each app owns its `models`, `serializers`, `views`, `urls`, `admin`,
  `apps.py`, and (where relevant) `services.py`, `tasks.py`, `signals.py`. Beyond the core
  apps: **`logs`** (structured logs), **`sourcemaps`** (release artifacts + JS symbolication),
  **`mcp`** (JSON-RPC server + agent tools). Shared full-text-search helpers live in
  `apps/common/search.py` (vendor-gated Postgres/MySQL/SQLite FTS with an `icontains` fallback).
- **Business logic goes in `services.py`**, not views. Views are thin DRF wrappers.
- **All config comes from env vars** via `django-environ` in `errora/settings.py`. Never
  hardcode secrets, hosts, or provider keys. Add new settings with a sensible default and
  document them in `.env.example`.
- **Secrets at rest** (integration tokens, AI keys) use `apps.common.fields.EncryptedTextField`
  (Fernet via `SECRETS_ENCRYPTION_KEY`). Never store them in plain `CharField`.
- **Cross-app communication uses Django signals**, not direct imports of side-effecting code.
  Producers: `apps.issues.signals` (`issue_created`, `event_stored`, `issue_regressed`),
  `apps.ai.signals` (`autofix_started`, `autofix_mr_created`, `autofix_failed`). Subscribers
  wire up in their `AppConfig.ready()` (see `apps/notifications/apps.py`).
- **Async work is Celery on Redis.** Route by queue: `ingest` (fast, hot path), `ai` (slow),
  `notifications`, `default`. Keep the ingest request path free of blocking I/O.
- **Async views**: the ingest endpoint (`apps/ingest/views.py`) is a native-async Django view
  using async ORM (`afirst`) + async cache (`aget/aset`) — **no `sync_to_async` in app code**;
  the broker publish runs via `asyncio.to_thread`. Prefer this pattern for new hot paths. The
  app CRUD layer is now end-to-end **async via `adrf`** (async views + async serializers,
  `adata`/`asave`); multi-statement transactional services stay sync and are off-loaded with
  `sync_to_async`. A few token-authenticated, low-traffic endpoints (the **MCP** server and
  **personal access token** CRUD) are deliberately plain sync DRF.
- **RBAC** is centralized in `apps.organizations.roles` (capability matrix) and enforced via
  `apps.organizations.services.has_permission(...)`. Add capabilities there, not ad hoc.

## How to extend (the common asks)

### Send events from a new platform
Use the **official Sentry SDK** for that platform and point its `dsn` at an Errora project
key — the ingest endpoint is Sentry-wire-compatible, so no custom client is needed. Auth is
the DSN public key via the `X-Sentry-Auth` header (`sentry_key=<public_key>`), the
`?sentry_key=` query string, or the `dsn` in an envelope header; gzip/deflate bodies are
decoded. See `apps/ingest/{auth,views,normalize}.py` for the accepted event shape. Stacktrace
frames follow Sentry's order: **oldest-first** (crash frame last).

### Add a source-control provider (e.g. GitHub)
1. Add a `Provider` choice in `apps/integrations/models.py`.
2. Implement `apps/integrations/clients/base.SourceControlClient` in a new
   `clients/<provider>.py` (list repos, get file, create MR).
3. Register it in `clients/__init__.get_client`. The AI flow needs no changes.

### Add an AI provider
Subclass `apps/ai/providers/base.AIProvider`, implement `generate_fix(context) -> FixResult`,
and register it in `apps/ai/providers/__init__.get_provider`. Keep the heavy SDK import
**inside** the method (lazy) so Django startup stays light.

### Add a notification channel
Subclass `apps/notifications/channels/base.Channel`, implement `send(message)`, register in
`channels/__init__._REGISTRY`, and add the type to `ChannelType`.

### Add an SMS provider
Subclass `apps/accounts/sms.BaseSMSProvider` and register in `sms.PROVIDERS`. Selected by
`SMS_PROVIDER` env var.

### Add a notifiable event type
Add to `apps/notifications/events.EventType`, emit/forward it in `dispatch.py` + a signal, and
handle the body text in `dispatch.build_message`.

### Add an MCP tool (for AI agents)
Define a `Tool` in `apps/mcp/tools.py` (name + description + JSON-Schema `input_schema` +
`handler(user, args)`) and append it to `TOOLS`. Scope every query to the calling user's
memberships and raise `ToolError` for user-facing failures. The handler runs sync; the
transport (`apps/mcp/views.py`) authenticates the bearer **personal access token** and wraps the
result. Tokens are managed via `apps/accounts/token_views.py` (`/auth/tokens`).

### Add a searchable field (full-text)
Use the helpers in `apps/common/search.py` (e.g. `pg_fts_filter` / `sqlite_fts_filter`) so the
query degrades gracefully across Postgres/MySQL/SQLite; see `apps/issues/search.py` and
`apps/logs/search.py` for the pattern (FTS where available, `icontains` otherwise).

## Testing

- `pytest` from `backend/`. Tests run on **SQLite** and **eager Celery** by default
  (`conftest.py`), so no Postgres/Redis is required locally.
- Run: `SECRET_KEY=test DATABASE_URL="sqlite:////tmp/errora_test.db" pytest`.
- Add tests next to existing ones in `backend/tests/`. Use the shared fixtures
  (`api`, `auth_api`, `user`, `org`, `project`).
- Before finishing backend work, run `python manage.py check` and `makemigrations --check`.
- **Frontend**: unit tests with **vitest** (`pnpm test`) and a **Playwright e2e** suite
  (`frontend/e2e/`, `pnpm e2e`). The e2e harness boots a seeded backend (`manage.py seed_e2e`,
  throwaway SQLite) + a production-built frontend on isolated ports `8001`/`3001`, serialized
  (`workers: 1`). Fixed login: phone `9123456789` / `Password123!`. See `frontend/e2e/README.md`.

## Style

- Python: type hints, `from __future__ import annotations`, **ruff** for lint **and** format
  (`ruff check .`, `ruff format .`; line length 100). Migrations are excluded from lint.
- Frontend: **biome** for lint **and** format (`npm run lint`, `npm run format`). No eslint/prettier.
- **Lint + format must always pass before finishing any change.** Backend: `ruff check .` and
  `ruff format --check .` clean. Frontend: `npm run lint` (`biome check .`) clean — run
  `npm run format` to auto-fix. CI gates on these, so a red lint blocks the merge.
  - **Run the project's pinned tools, not a global one.** Frontend CI runs
    `pnpm exec biome check .` from `frontend/`; a stray global `biome`/`npx biome` can be a
    different version that silently skips the `organizeImports` assist (CI fails on import
    order while your local passes). Use `pnpm exec biome check --write .` (or
    `./node_modules/.bin/biome`) and check the **whole** repo (`.`), not a single file —
    `biome check .` enforces both formatting and import sorting. Backend: run `ruff` from
    `backend/` (the repo root has none of the Python config). Note the untracked vendored
    `sentry/` checkout has its own pre-existing ruff errors — ignore it; scope ruff to
    `backend/` or your changed files.
- Keep modules small and single-purpose; match the surrounding code's idiom and comment density.
- Don't introduce Kafka — the broker is intentionally Redis.

## Frontend conventions

- All user-facing text is translated via `next-intl` (`messages/fa.json`, `messages/en.json`).
  **No hardcoded strings.** `fa` is default + RTL.
- Design tokens are CSS variables (Claude-style palette); support dark/light + RTL/LTR.
- API access goes through `lib/api.ts`; data fetching via TanStack Query.
