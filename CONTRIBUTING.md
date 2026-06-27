# Contributing to Errora

Thanks for your interest! Issues and pull requests are welcome.

## Getting started

- Architecture, conventions, and "how to extend" recipes live in [AGENTS.md](AGENTS.md).
- Local setup is in the [README](README.md) (Docker or local backend/frontend).

## Before opening a PR

**Backend** (`backend/`):

```bash
ruff check . && ruff format --check .
SECRET_KEY=test DATABASE_URL="sqlite:////tmp/errora_test.db" pytest
python manage.py check && python manage.py makemigrations --check --dry-run
```

**Frontend** (`frontend/`):

```bash
pnpm lint        # biome
pnpm exec tsc --noEmit
pnpm test        # vitest
# optional, browser e2e:
pnpm e2e:install && pnpm e2e
```

## Guidelines

- Keep changes focused; match the surrounding code's idiom and comment density.
- Business logic goes in `services.py`, not views (see AGENTS.md).
- All user-facing strings are translated via `next-intl` (`messages/fa.json`,
  `messages/en.json`) — no hardcoded strings; keep `fa`/`en` keys in parity.
- Add tests next to existing ones. New env settings get a sensible default and a
  line in `.env.example`.
- Don't introduce Kafka — the broker is intentionally Redis.

## Reporting security issues

See [SECURITY.md](SECURITY.md) — please don't file public issues for vulnerabilities.

## License

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE).
