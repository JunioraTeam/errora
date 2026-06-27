# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately via GitHub's **"Report a vulnerability"** (Security → Advisories)
on this repository, or email the maintainer. Include:

- a description and impact of the issue,
- steps to reproduce (PoC if possible),
- affected version/commit and configuration.

We aim to acknowledge reports within a few days and will coordinate a fix and
disclosure timeline with you.

## Supported versions

Errora is pre-1.0; security fixes target the `main` branch. Pin to a tagged
commit for deployments and update regularly.

## Hardening notes for self-hosters

- Set `DEBUG=0` in production. The app refuses to boot without a real
  `SECRET_KEY` and `SECRETS_ENCRYPTION_KEY`, and then enforces secure cookies +
  HSTS + HTTPS redirect.
- Set `ALLOWED_HOSTS` to your real hostnames (the app rejects `*` when `DEBUG=0`).
- Outbound integration URLs (webhooks, AI/GitLab `base_url`) are SSRF-guarded
  (loopback/link-local/metadata blocked). On multi-tenant deployments also set
  `SSRF_BLOCK_PRIVATE=1` and add a network egress policy on the worker.
- Keep `INGEST_MAX_DECOMPRESSED_BYTES` and `INGEST_RATE_LIMIT_PER_MIN` at sane
  values for your traffic.

See the **Pre-publication hardening** checklist in the README for the current
status of known items.
