# Deployment

## Flux GitOps

Flux deployment manifests for hriv have moved to the dedicated fleet repository:

**[bcit-tlu/flux-fleet](https://github.com/bcit-tlu/flux-fleet)**

The fleet repo is the single source of truth for what runs on our Kubernetes clusters. It manages deployments for all applications in the org, including hriv.

- **Manifests:** `flux-fleet/apps/hriv/` (base, latest, stable overlays)
- **Cluster entrypoints:** `flux-fleet/clusters/cluster01/` (stable), `cluster03/` (latest)

## Helm Charts

Helm charts for hriv's components remain in this repository under `charts/`:

- `charts/frontend/` — Frontend (React SPA + nginx)
- `charts/backend/` — Backend (FastAPI + tile sidecar)
- `charts/backup/` — Backup service

Charts are automatically packaged and published as OCI artifacts to `oci://ghcr.io/bcit-tlu/hriv/charts` by the CI pipeline on every push to `main` and on release tags.
