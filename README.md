<div align="center">

# Errora · ارورا

### A free, open-source, AI-friendly alternative to Sentry

Self-hosted **error tracking + performance + logs** — Sentry-wire-compatible (use the official
SDKs), with an **MCP server** so AI agents can triage your issues and **one-click AI auto-fix**
that opens merge requests for you.

<br/>

![Issues — grouped exceptions with trend sparklines](docs/images/issues.png)

<br/>

[![Stack](https://img.shields.io/badge/stack-Django%206%20·%20Next.js%2016-da7756)](#repository-layout)
[![Broker](https://img.shields.io/badge/queue-Celery%20·%20Redis-da7756)](#performance-notes)
[![Sentry-compatible](https://img.shields.io/badge/ingest-Sentry--wire%20compatible-2f8f5b)](#sending-your-first-event-official-sentry-sdk)
[![MCP](https://img.shields.io/badge/AI-MCP%20server-3a7ca5)](#api-overview)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

</div>

---

## Why Errora

- **Lightweight & self-hosted** — Redis-backed queue (no Kafka), a pluggable event store, and a
  small footprint. Runs on modest hardware; bring your own Postgres or start on SQLite.
- **AI-native** — a built-in **MCP server** lets Claude / Cursor query projects, read stack
  traces, and resolve issues; **AI auto-fix** drafts a patch and opens a GitLab merge request.
- **Use what you already have** — point any **official Sentry SDK** at it; no custom client.
- **Built-in, not bolted-on** — errors, performance/tracing, and structured logs in one app.
- **Localized** — first-class **fa/en** with RTL, Jalali calendar, phone (+98) auth, Toman billing.

## What it does

- **Exception tracking** — the **official Sentry SDKs** send events (Errora is
  Sentry-wire-compatible — no custom client needed); Errora normalizes, **fingerprints**, and
  **groups** them into issues (by exception type + stacktrace, Sentry-style), tracking
  `times_seen`, first/last seen, status (unresolved/resolved/ignored) and regressions.
- **High-throughput ingestion** — the HTTP endpoint authenticates the DSN key and enqueues
  the raw payload on a **Redis-backed Celery queue** (no Kafka); a worker does the heavy
  normalization/grouping/metering off the request path.
- **Organizations & RBAC** — every user gets a personal org; create more, attach projects,
  invite teammates. Roles (owner/admin/member/billing/viewer) apply **per organization and
  per project** with a capability matrix.
- **Self-hosted GitLab** — connect a GitLab instance (any `base_url`), pick a repo as a
  project's source. The integration layer is provider-abstracted so GitHub etc. drop in.
- **AI auto-fix (Seer-like)** — gather the stacktrace + relevant source from the repo, ask an
  AI provider for a patch, open a **merge request** automatically. Providers: **OpenAI-compatible**,
  **Claude**, **Cursor Agents** — swappable per org/project.
- **Structured logs** — a logs product (`apps.logs`) alongside errors: severity levels, typed
  attributes (tags), trace/span correlation, level facets, and full-text search.
- **Full-text search** — issue & log search backed by the database's native FTS
  (**PostgreSQL** `tsvector`/GIN, **MySQL** `FULLTEXT`, **SQLite** FTS5) with an automatic
  `icontains` fallback elsewhere — word-prefix semantics across all backends.
- **Source maps & symbolication** — upload **release artifacts**; minified JavaScript stack
  frames are mapped back to original file/line/column with surrounding source context, before
  grouping (so issues group on stable original frames). Pure-Python VLQ decoder, no Rust service.
- **GitLab issue tracking** — from an issue, **create** a GitLab issue (prefilled title +
  description) or **link/search** an existing one with an optional comment, shown on the issue page.
- **MCP server** — an `/mcp` JSON-RPC endpoint (Sentry-MCP-style) lets AI agents (Claude,
  Cursor, …) list projects, search issues/logs, read stack traces, and resolve issues —
  authenticated with **personal access tokens** the user mints in account settings.
- **Per-org data retention** — each organization sets how long events are kept; a nightly job
  purges expired events (and now-empty issues), falling back to a global default.
- **Issue workflow** — archive, **bookmark** (personal star), copy share URL, unique-user
  counts, request/referrer context, and **24h / 30d event trend charts** (issue + project cards),
  with syntax-highlighted stack frames and SQL breadcrumbs.
- **Alerts & webhooks** — subscribe events (*new unique exception*, *new exception*, *issue
  regressed*, *auto-fix started / MR created / failed*) to channels: **HTTP webhook,
  Mattermost, Email, SMS**.
- **Auth** — login by **phone (+98, Kavenegar)** or **email**, via **password or OTP**. SMS
  provider is config-swappable.
- **Pricing & usage** — plans + **PAYG** metered in **تومان** (Toman). Usage counters are
  Redis-backed and flushed periodically; quota gating happens in the ingest hot path.
- **Frontend** — Next.js with **fa/en i18n**, **RTL/LTR**, **dark/light** themes, Vazirmatn
  font, Claude-style design, an animated landing page, and the full dashboard.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/images/issue-detail.png" alt="Issue detail — stack trace, trend, breadcrumbs, request & contexts" /></td>
    <td width="50%" valign="top">
      <img src="docs/images/projects.png" alt="Projects — per-project errors & transactions trend" /><br/><br/>
      <img src="docs/images/logs.png" alt="Structured logs" />
    </td>
  </tr>
</table>

The **issue detail** view: symbolicated stack trace with syntax highlighting, a 24h/30d event
trend, breadcrumbs (incl. SQL with bindings), HTTP request + referrer, contexts, tags, suspect
frame, plus actions — resolve / ignore / archive / bookmark / copy share URL / GitLab issue.

## Repository layout

```
errora/
├── backend/                 # Django + DRF + Celery
│   ├── errora/              # project: settings (env-driven), celery, urls, asgi/wsgi
│   └── apps/
│       ├── accounts/        # users, phone/email auth, OTP, JWT, SMS providers
│       ├── organizations/   # orgs, memberships, projects, DSN keys, invites, RBAC
│       ├── issues/          # Issue/Event models, fingerprinting, grouping & FTS
│       ├── performance/     # transactions + spans (throughput/latency/trace waterfall)
│       ├── logs/            # structured logs: ingest, attributes, level facets, search
│       ├── sourcemaps/      # release artifacts + JS symbolication (VLQ decoder)
│       ├── ingest/          # DSN auth, /api/<project>/store|envelope, async pipeline
│       ├── integrations/    # source-control framework + GitLab client/issue tracking
│       ├── ai/              # auto-fix orchestrator + AI providers
│       ├── mcp/             # MCP JSON-RPC server (/mcp) + tools for AI agents
│       ├── notifications/   # events → alert rules → channels
│       ├── billing/         # plans, subscriptions, usage metering (Toman)
│       └── common/          # shared crypto / encrypted fields, FTS helpers
├── frontend/                # Next.js app (App Router, next-intl, Tailwind v4)
├── deploy/k8s/              # Kubernetes manifests
├── docker-compose.yaml      # local / single-host stack
└── .env.example
```

## Quick start (Docker)

```bash
cp .env.example .env          # then set SECRET_KEY, SECRETS_ENCRYPTION_KEY, JWT_SECRET
docker compose up --build
# backend  → http://localhost:8000  (API docs at /api/docs/)
# frontend → http://localhost:3000
```

Seed the pricing plans and create an admin:

```bash
docker compose exec backend python manage.py seed_plans
docker compose exec backend python manage.py createsuperuser
```

## Quick start (backend, local)

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
export SECRET_KEY=dev DATABASE_URL=postgres://errora:errora@localhost:5432/errora
python manage.py migrate && python manage.py seed_plans
python manage.py runserver
# in another shell: celery -A errora worker -Q ingest,ai,notifications,default -l info
# and for scheduled jobs:  celery -A errora beat -l info
```

### Scheduled tasks (celery beat)

`celery -A errora beat` drives the periodic jobs in `CELERY_BEAT_SCHEDULE`:

- **flush-usage-counters** — persists Redis usage counters to the DB (every `USAGE_FLUSH_INTERVAL`s, default 300).
- **purge-expired-events** — nightly at 03:00, deletes events (and now-empty issues) older than each org's
  plan `retention_days`, falling back to `DATA_RETENTION_DAYS_DEFAULT` (90). Beat tasks run on the `default`
  queue, so the worker above (which includes `default`) executes them.

Manual one-off purge: `python manage.py purge_events --days 90 [--dry-run]`.

### Tests

```bash
cd backend
SECRET_KEY=test DATABASE_URL="sqlite:////tmp/errora_test.db" pytest      # unit/integration
ruff check . && ruff format --check .                                     # lint + format
```

Frontend has **unit tests** (vitest) and a **Playwright e2e** suite that boots a seeded backend
+ a built frontend on isolated ports (see `frontend/e2e/README.md`):

```bash
cd frontend
pnpm test            # vitest unit tests
pnpm e2e:install     # one-time: download the Chromium browser
pnpm e2e             # full browser e2e suite
```

> Tooling: backend uses **ruff** (lint + format); frontend uses **biome** (lint + format,
> `npm run lint` / `npm run format`). OTP login is **disabled by default** (`OTP_ENABLED=0`
> backend, `NEXT_PUBLIC_OTP_ENABLED` frontend); when enabled, local-dev OTP codes are a fixed
> **all-ones** value (`111111`) unless `OTP_DEBUG_CODE=0`.

## Sending your first event (official Sentry SDK)

Errora is **Sentry-wire-compatible**: use any official [Sentry SDK](https://docs.sentry.io/platforms/)
and point its DSN at your Errora project — no custom SDK to install. The DSN is
shown when you create a project (`keys[].dsn`), in Sentry's standard format
`http://<public_key>@<host>/<project_id>`.

Python:

```bash
pip install sentry-sdk
```

```python
import sentry_sdk

sentry_sdk.init(dsn="http://<public_key>@localhost:8000/<project_id>")

try:
    risky_thing()
except Exception:
    sentry_sdk.capture_exception()   # unhandled exceptions are captured automatically
```

PHP / Laravel — install `sentry/sentry-laravel`, then:

```dotenv
SENTRY_LARAVEL_DSN=http://<public_key>@localhost:8000/<project_id>
```

Under the hood SDKs `POST` events to `/api/<project_id>/store/` (legacy) or
`/api/<project_id>/envelope/` (modern, default), authenticating with the DSN
public key via the `X-Sentry-Auth` header (or `?sentry_key=` for the browser
SDK). Gzip-compressed payloads are accepted.

## API overview

App API is under `/api/v1/` (JWT `Authorization: Bearer <access>`). Highlights:

| Area | Endpoint |
| --- | --- |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `GET /auth/me` |
| Orgs | `GET/POST /organizations`, `POST /organizations/{id}/invite`, `GET .../members` |
| Projects | `GET/POST /organizations/{id}/projects`, `POST .../{id}/keys` |
| Issues | `GET /projects/{id}/issues`, `GET .../issues/{id}`, `POST .../resolve|ignore|archive|bookmark|assign` |
| Issue trends | `GET .../issues/trends?period=24h\|30d`, `GET .../issues/{id}/series` |
| Issue tracking | `GET/POST .../issues/{id}/external-issues`, `GET .../external-issues/search`, `GET .../issues/{id}/repositories` |
| Logs | `GET /projects/{id}/logs`, `GET .../logs/{id}`, `GET .../logs/attribute-keys` |
| Source maps | `POST /projects/{id}/releases/{release}/artifacts` (upload) |
| Integrations | `GET/POST /organizations/{id}/integrations`, `POST .../sync` |
| AI | `POST /projects/{id}/issues/{id}/autofix`, `GET/POST /organizations/{id}/ai-configs` |
| Alerts | `GET/POST /organizations/{id}/channels`, `.../alert-rules` |
| Billing | `GET /plans`, `GET /organizations/{id}/usage`, `GET/POST .../subscription` |
| Tokens | `GET/POST /auth/tokens`, `DELETE /auth/tokens/{id}` (personal access tokens) |
| MCP | `POST /mcp` — JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`), bearer PAT |

Interactive schema: `GET /api/schema/` and Swagger UI at `/api/docs/`.

> **MCP** — point an MCP client at `POST /mcp` with `Authorization: Bearer errora_pat_…`.
> Tools: `whoami`, `list_projects`, `list_issues`, `get_issue`, `update_issue_status`,
> `search_logs` — all scoped to the token owner's memberships.

## Performance notes

- Ingest endpoint does minimal sync work (cached DSN-key lookup + quota gate + enqueue) and
  returns `202`; grouping/storage runs on the dedicated **`ingest`** Celery queue.
- Slow AI jobs run on a separate **`ai`** queue so they never starve ingestion.
- Usage metering uses a Redis counter (no DB write per event); a beat task flushes to Postgres.
- The event store sits behind a thin layer (`apps.issues`) so it can move to ClickHouse at
  scale without changing the public API.

## Deployment

- **Docker Compose** — `docker-compose.yaml` (db, redis, backend, worker, beat, frontend).
- **Kubernetes** — manifests in `deploy/k8s/` (see `deploy/k8s/README.md` for apply order).

## Roadmap / TODO (not yet implemented)

Honest status — what is built vs. what still needs doing.

### Backend
- [x] **Async-ify the rest of the API.** The whole app API (accounts/orgs/issues/
  integrations/ai/notifications/billing) is now end-to-end async via **`adrf`** — async
  views + async serializers (`adata`/`asave`) + native async ORM (`aget`/`afirst`/`acreate`/
  `aset`). Read paths use async ORM directly; multi-statement transactional services
  (`create_*`, `merge_issues`, `usage_summary`, GitLab sync) stay sync and are off-loaded
  via `sync_to_async`. RBAC has an async twin (`ahas_permission`). (Workers/serving still
  benefit most under ASGI + async workers.)
- [x] **Async outbound I/O** — outbound HTTP (AI Cursor provider, notification webhook/Mattermost,
  Kavenegar SMS) moved `requests` → `httpx`. (Workers are still sync; true async needs async workers.)
- [x] **Event store at scale** — `Event` storage is pluggable (`apps.issues.store`,
  `EVENT_STORE_BACKEND=orm|clickhouse`); per-day/per-month event counts + per-project **sampling**
  (`sample_rate`) are implemented. (Live ClickHouse perf tuning still TODO.)
- [ ] **Grouping** — secondary/auxiliary hashes + **issue merge API** done
  (`POST .../issues/{id}/merge`); server-side grouping config per project and split UI still TODO.
- [x] **AI auto-fix** — real **unified diffs** (difflib) and **run streaming/progress** (SSE) done;
  multi-file context retrieval present. Test-running before MR still TODO.
- [x] **Invites** — org invite emails delivered on creation (async, best-effort).
- [ ] **Billing** — real payment gateway (e.g. Zarinpal/IDPay for تومان), invoices, PAYG
  settlement; USD/multi-currency price table.
- [ ] **GitHub** integration (the `integrations` framework is provider-abstract and ready).
- [x] **Performance / tracing** product (transactions, spans) — `apps.performance` ingests
  Sentry `transaction` envelope items, groups them by (name, op), and serves throughput /
  p50–p99 latency / failure-rate plus a span-op breakdown, duration histogram and a span
  **waterfall** trace view. (Profiling — sampled call stacks — still TODO.)
- [x] **Webhook deliveries** — delivery **log API** + **replay** endpoint + **exponential backoff**.
  (Signature docs page still TODO.)
- [x] Per-event **rate limiting / spike protection** and inbound payload size caps at the edge
  (`INGEST_RATE_LIMIT_PER_MIN`, `INGEST_MAX_PAYLOAD_BYTES`).
- [x] **Structured logs** product (`apps.logs`) — ingest, typed attributes, level facets,
  trace correlation, and search.
- [x] **Full-text search** for issues + logs — Postgres `tsvector`/GIN, MySQL `FULLTEXT`,
  SQLite FTS5, with an `icontains` fallback (vendor-gated, word-prefix semantics).
- [x] **Per-organization data retention** — user-settable retention window with the nightly
  purge falling back to the global default.
- [x] **MCP server** (`apps.mcp`, `/mcp`) — JSON-RPC tools for AI agents, authenticated by
  **personal access tokens** (`/auth/tokens`).

### Frontend
- [ ] **Verify Next.js 16 + next-intl** together with a real `npm install`/`next build`
  (pinned offline; not build-verified here). Likely needs the next-intl v4 migration.
- [x] **Settings** forms wired to real endpoints — members + role changes + invite,
  GitLab connect/sync, alert channels + rules CRUD, AI provider config CRUD.
- [x] **Default locale (fa) served at `/`** (no `/fa` prefix) via `localePrefix: "as-needed"`.
- [x] **Assignee picker** — searchable member dropdown wired to the multi-assignee API.
- [x] Issue **Events** and **Comments** tabs (live), usage charts with **real day/month series**.
- [x] **Rich event context** on the issue detail — Sentry-style: event metadata
  (event id / transaction / environment / release / dist / handled-mechanism), derived
  **tags**, **contexts** (browser / OS / runtime / device / trace), **breadcrumbs** (with SQL
  query bindings + timings), **HTTP request** (headers + copy-as-cURL), **packages**, **SDK**,
  **event grouping info** (hash + components), and a **suspect** frame with a repo blame link.
- [x] **Jalali (Shamsi) calendar** in fa (dates + custom date picker), localized digits,
  in-panel locale switch, View-Transitions theme switch, env-configurable brand name.
- [x] **e2e tests (Playwright)** — a seeded backend (`manage.py seed_e2e`) + a built frontend on
  isolated ports drive auth, issues (detail, stack trace, bookmark, archive, share, trends),
  projects, and MCP token creation (`frontend/e2e/`, `pnpm e2e`). Unit tests (vitest) also exist.
- [x] **Logs**, **MCP** token management, **GitLab issue create/link**, archive/bookmark,
  per-issue **trend charts**, project trend charts, and **syntax-highlighted** code/SQL UI.

### SDKs / platform
- [x] **Sentry-wire-compatible ingest** — use the official Sentry SDKs (Python, Node, PHP,
  Go, browser JS, …) directly; no custom client. `X-Sentry-Auth`/`sentry_key`, gzipped
  store + envelope endpoints.
- [x] **Breadcrumbs** captured + rendered (DB/cache/navigation/http trails).
- [x] **Source maps / symbolication for JS** — release artifact upload + VLQ-based mapping of
  minified frames to original file/line/column with source context (`apps.sourcemaps`).
  (release→commit tracking for true suspect commits still TODO — today's "suspect" is the
  deepest in-app frame + a repo blame link.)
- [ ] Run a load test of the async ingest path; tune Celery/queue concurrency.

## Contributing

Issues and pull requests are welcome. Before opening a PR: backend —
`ruff check . && ruff format --check .` and `pytest`; frontend — `pnpm lint` and `pnpm test`
(see [AGENTS.md](AGENTS.md) for architecture + conventions).

## License

Errora is free and open-source under the **MIT License** — see [LICENSE](LICENSE).
