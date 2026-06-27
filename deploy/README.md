# Errora — Deployment

Errora is a Django 5 + Celery backend, a Next.js frontend, with Postgres and
Redis. This directory holds everything needed to run it locally and in
production.

```
errora/
├── docker-compose.yaml        # local / single-host stack
├── backend/
│   ├── Dockerfile             # Django + Celery image (gunicorn/worker/beat)
│   └── .dockerignore
├── frontend/
│   ├── Dockerfile             # Next.js standalone image
│   └── .dockerignore
└── deploy/
    ├── README.md              # (this file)
    └── k8s/                   # production Kubernetes manifests
```

## Image naming (consistent everywhere)

- `errora/backend:latest`  — used by web (gunicorn), worker (celery) and beat.
- `errora/frontend:latest` — Next.js standalone server.

The backend image is **built once and reused** for the web/worker/beat roles;
the runtime command is overridden per role.

---

## Local development — Docker Compose

Run the full stack on one host:

```bash
# 1. Create a .env next to docker-compose.yaml with your secrets, e.g.:
#    SECRET_KEY=...
#    JWT_SECRET=...
#    SECRETS_ENCRYPTION_KEY=...        # python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"
#    KAVENEGAR_API_KEY=...
#    POSTGRES_PASSWORD=errora
#    (datastore URLs default to the compose service names; no need to set them)
#
# 2. Bring it up:
docker compose up --build
```

Services / ports:

| Service    | Image                    | Port (host) | Notes                                   |
|------------|--------------------------|-------------|-----------------------------------------|
| `db`       | postgres:16-alpine       | 5432        | volume `pgdata`, healthcheck            |
| `redis`    | redis:7-alpine           | 6379        | volume `redisdata`, healthcheck         |
| `backend`  | errora/backend:latest    | 8000        | runs `migrate` then gunicorn            |
| `worker`   | errora/backend:latest    | —           | `celery -A errora worker -Q ingest,ai,notifications,default` |
| `beat`     | errora/backend:latest    | —           | `celery -A errora beat`                 |
| `frontend` | errora/frontend:latest   | 3000        | Next.js standalone                      |

- Backend health: `curl http://localhost:8000/healthz` → `{"status":"ok"}`
- Frontend: <http://localhost:3000>
- `backend` waits for `db` + `redis` to be **healthy** before starting; `worker`
  and `beat` wait for `backend` so migrations finish first.

Tear down (keep data): `docker compose down`
Tear down (wipe volumes): `docker compose down -v`

---

## Production — Kubernetes

Manifests live in [`deploy/k8s/`](./k8s/). See
[`deploy/k8s/README.md`](./k8s/README.md) for the full apply order and the
out-of-band secret-creation procedure. Quick version:

```bash
cd deploy/k8s

# 1. Namespace
kubectl apply -f namespace.yaml

# 2. Secrets — NEVER commit real values; create them out-of-band:
kubectl -n errora create secret generic errora-secrets \
  --from-literal=SECRET_KEY="$(openssl rand -base64 48)" \
  --from-literal=JWT_SECRET="$(openssl rand -base64 48)" \
  --from-literal=SECRETS_ENCRYPTION_KEY="$(python -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())')" \
  --from-literal=DATABASE_URL="postgres://errora:<PW>@postgres:5432/errora" \
  --from-literal=POSTGRES_PASSWORD="<PW>" \
  --from-literal=KAVENEGAR_API_KEY="<...>"

# 3. Everything else (config, datastores, app tiers, ingress, HPAs)
kubectl apply -k .

# 4. Run database migrations (the migrate Job is excluded from kustomize):
kubectl -n errora delete job errora-migrate --ignore-not-found
kubectl apply -f backend-migrate-job.yaml
kubectl -n errora wait --for=condition=complete job/errora-migrate --timeout=300s
```

### Local vs prod — what differs

| Concern        | Local (compose)                    | Prod (k8s)                                   |
|----------------|------------------------------------|----------------------------------------------|
| Config         | inline env + `.env`                | ConfigMap + Secret (`envFrom`)               |
| Migrations     | run inline in `backend` command    | dedicated `errora-migrate` Job               |
| Postgres       | container + named volume           | StatefulSet + PVC (or managed DB)            |
| Redis          | container + named volume           | Deployment (ephemeral)                       |
| Scaling        | single replica per service         | HPA on backend + worker (CPU)                |
| TLS / routing  | direct host ports                  | nginx Ingress + cert-manager TLS             |
| Secrets        | `.env` (gitignored)                | k8s Secret created out-of-band               |

### Production best-practices baked in

- Multi-stage images; **non-root** runtime users for backend and frontend.
- Readiness/liveness probes (backend on `/healthz`, datastores via native checks).
- Resource requests + limits on every workload.
- No plaintext secrets committed — `secret.example.yaml` is a template only.
- `beat` pinned to a single replica to prevent duplicate scheduled tasks.
- `collectstatic` runs at backend image build time; static served via whitenoise.
