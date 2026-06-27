# End-to-end tests (Playwright)

Browser-level specs that drive the real UI against a real backend.

## What runs

`playwright.config.ts` starts two servers automatically (dedicated ports so it
won't clash with your dev stack on 3000/8000):

- **Backend** (`e2e/run-backend.sh`) — Django on `:8001`, a throwaway SQLite DB
  that is wiped, migrated and re-seeded (`manage.py seed_e2e`) on every run.
- **Frontend** — a production `next build && next start` on `:3001`, built to an
  isolated `.next-e2e/` dir (so it coexists with a running `next dev`). Dev mode
  isn't used because Next allows only one dev server per project directory.

The suite is serialized (`workers: 1`): all tests share the one seeded backend,
and parallel async writers would hit SQLite lock contention.

## Seeded account

`seed_e2e` creates a fixed login + dataset (see `helpers.ts`):

- phone `9123456789`, password `Password123!`
- one project `E2E Project` with 3 issues (events across 24h / 30d), plus
  transactions and logs.

## Running

```bash
pnpm e2e:install   # one-time: download the Chromium browser
pnpm e2e           # run the suite (starts both servers)
pnpm e2e:ui        # interactive UI mode
```

Ports 8001 / 3001 must be free. The Django venv at `../../backend/.venv` is used
to run migrations + the seed + uvicorn.

## Coverage

`auth` (login, wrong password, phone validation) · `issues` (list, search,
detail + stack trace, bookmark, archive, copy-share-URL, trend toggle) ·
`projects` (card + errors/transactions chart) · `mcp` (create a personal access
token).
