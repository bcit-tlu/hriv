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

## Production Storage Split

For Kubernetes deployments that need different backup/retention behavior for
authoritative uploads versus generated tiles, the backend and backup charts can
mount separate PVCs for:

- source images and shared `/data` state
- generated tiles at `/data/tiles`

The backend chart keeps the source-images PVC mounted at `/data` so existing
contracts continue to work:

- `SOURCE_IMAGES_DIR=/data/source_images`
- `TILES_DIR=/data/tiles`
- maintenance flag at `/data/.maintenance`
- admin task artifacts under `/data/admin_tasks`

This means the source-images PVC also carries a small amount of shared
operational state at the volume root. The tiles PVC remains isolated and can be
backed up independently.

For an already-running pre-production system, the intended cutover is:

1. Scale the backend/worker/backup pods down.
2. Provision a new tiles PVC and a source-images PVC.
3. Copy `/data/source_images` into the source-images PVC and `/data/tiles` into
   the tiles PVC using a temporary migration pod.
4. Update Helm values to point at the new claims.
5. Start the workloads and verify upload/viewer flows before removing the old
   volume.
