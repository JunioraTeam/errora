# Errora — Kubernetes manifests

Plain YAML manifests for deploying Errora (Django + Next.js + Celery + Postgres
+ Redis) to a Kubernetes cluster. Everything lives in the `errora` namespace.

## Prerequisites

- A cluster with a default `StorageClass` (for the Postgres PVC).
- [ingress-nginx](https://kubernetes.github.io/ingress-nginx/) controller.
- [cert-manager](https://cert-manager.io/) with a `ClusterIssuer` named
  `letsencrypt-prod` (referenced by `ingress.yaml`).
- [metrics-server](https://github.com/kubernetes-sigs/metrics-server) (for the HPAs).
- Images published and reachable by the cluster:
  - `errora/backend:latest`
  - `errora/frontend:latest`
  Build/push them (or retag to your registry and update `image:` fields):
  ```bash
  docker build -t errora/backend:latest  ./backend
  docker build -t errora/frontend:latest --build-arg NEXT_PUBLIC_API_URL=https://errora.example.com ./frontend
  ```

## Files

| File                        | Purpose                                              |
|-----------------------------|------------------------------------------------------|
| `namespace.yaml`            | `errora` namespace                                   |
| `configmap.yaml`            | Non-secret env (hosts, URLs, Redis URL, locale)      |
| `secret.example.yaml`       | TEMPLATE for `errora-secrets` (do not apply as-is)   |
| `postgres.yaml`             | Postgres StatefulSet + Service + PVC                 |
| `redis.yaml`                | Redis Deployment + Service                           |
| `backend-deployment.yaml`   | gunicorn web Deployment + Service (`/healthz` probes)|
| `backend-migrate-job.yaml`  | One-shot `manage.py migrate` Job                     |
| `worker-deployment.yaml`    | Celery worker (all queues; per-queue split documented)|
| `beat-deployment.yaml`      | Celery beat (single replica)                         |
| `frontend-deployment.yaml`  | Next.js Deployment + Service                         |
| `ingress.yaml`              | nginx Ingress + TLS (cert-manager)                   |
| `hpa.yaml`                  | HPAs for backend + worker (CPU)                      |
| `kustomization.yaml`        | Aggregates all of the above (minus Secret + Job)     |

## Setting secrets (never commit real values)

`secret.example.yaml` is a documented template only. Create the real Secret
out-of-band so credentials never land in git:

```bash
kubectl create namespace errora   # or: kubectl apply -f namespace.yaml

kubectl -n errora create secret generic errora-secrets \
  --from-literal=SECRET_KEY="$(openssl rand -base64 48)" \
  --from-literal=JWT_SECRET="$(openssl rand -base64 48)" \
  --from-literal=SECRETS_ENCRYPTION_KEY="$(python -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())')" \
  --from-literal=DATABASE_URL="postgres://errora:<DB_PASSWORD>@postgres:5432/errora" \
  --from-literal=POSTGRES_PASSWORD="<DB_PASSWORD>" \
  --from-literal=KAVENEGAR_API_KEY="<...>" \
  --from-literal=OPENAI_API_KEY="<...>" \
  --from-literal=ANTHROPIC_API_KEY="<...>"
```

Keep `DATABASE_URL`'s password and `POSTGRES_PASSWORD` in sync — Postgres is
initialised from `POSTGRES_PASSWORD` and the apps connect via `DATABASE_URL`.

## Apply order

1. **Namespace**
   ```bash
   kubectl apply -f namespace.yaml
   ```
2. **Secret** (out-of-band, see above) — required before any app pod starts.
3. **Config**
   ```bash
   kubectl apply -f configmap.yaml
   ```
4. **Datastores** — wait until they are ready.
   ```bash
   kubectl apply -f postgres.yaml -f redis.yaml
   kubectl -n errora rollout status statefulset/postgres
   kubectl -n errora rollout status deployment/redis
   ```
5. **Migrations** — run and wait for completion.
   ```bash
   kubectl -n errora delete job errora-migrate --ignore-not-found
   kubectl apply -f backend-migrate-job.yaml
   kubectl -n errora wait --for=condition=complete job/errora-migrate --timeout=300s
   ```
6. **Application tiers**
   ```bash
   kubectl apply -f backend-deployment.yaml \
                 -f worker-deployment.yaml \
                 -f beat-deployment.yaml \
                 -f frontend-deployment.yaml
   ```
7. **Ingress + autoscaling**
   ```bash
   kubectl apply -f ingress.yaml -f hpa.yaml
   ```

### Shortcut (everything except Secret + migrate Job)

```bash
kubectl apply -f namespace.yaml
# ...create errora-secrets out-of-band...
kubectl apply -k .
# then run the migrate job as in step 5
```

## Upgrades

```bash
# Build & push new images, then:
kubectl -n errora delete job errora-migrate --ignore-not-found
kubectl apply -f backend-migrate-job.yaml
kubectl -n errora wait --for=condition=complete job/errora-migrate --timeout=300s
kubectl -n errora set image deployment/backend  backend=errora/backend:<tag>
kubectl -n errora set image deployment/worker   worker=errora/backend:<tag>
kubectl -n errora set image deployment/beat     beat=errora/backend:<tag>
kubectl -n errora set image deployment/frontend frontend=errora/frontend:<tag>
```

## Notes

- All app pods run as **non-root** with `allowPrivilegeEscalation: false` and
  all Linux capabilities dropped.
- Backend liveness/readiness hit `GET /healthz` (returns `{"status":"ok"}`).
- `beat` must stay at **1 replica** (no HPA) to avoid duplicate scheduled tasks.
- The worker consumes all four queues (`ingest,ai,notifications,default`). See
  the comment block in `worker-deployment.yaml` for splitting into per-queue
  deployments if AI jobs starve ingestion.
