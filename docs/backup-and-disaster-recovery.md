# Production Backup and Disaster Recovery Strategy

This document defines the production backup and disaster-recovery model for
HRIV deployments using Longhorn-backed Kubernetes storage. It is the
**single runbook** an operator should follow to protect and restore the
system.

> **TL;DR** — The database and source images are _authoritative_ and must
> be backed up. Generated DZI tiles are _derived_ data: protect them with
> Longhorn snapshots for fast restore, but never rely on `.tar.gz` tile-tree
> backups as the primary strategy. If the tile volume is lost, rebuild from
> source images with the `rebuild-tiles` admin task.

## Data classification

| Data            | Role          | Authoritative? | Primary protection                        | Secondary protection            |
| --------------- | ------------- | -------------- | ----------------------------------------- | ------------------------------- |
| PostgreSQL DB   | Metadata      | Yes            | HRIV backup service (`db.sql`) + Longhorn | Azure Blob (off-site archive)   |
| Source images   | User uploads  | Yes            | HRIV backup service + Longhorn snapshot   | Azure Blob (off-site archive)   |
| Generated tiles | Derived       | No             | Longhorn snapshot/backup (optional)       | `rebuild-tiles` admin task      |
| Backup archives | Recovery data | Yes            | Azure Blob Storage replication            | Longhorn snapshot of backup PVC |

## Volume layout (Kubernetes / Longhorn)

The backend chart mounts two independent PersistentVolumeClaims so that
different Longhorn policies can be applied:

| PVC               | Mount point        | Contents                                                    |
| ----------------- | ------------------ | ----------------------------------------------------------- |
| source-images PVC | `/data`            | `source_images/`, `.maintenance` flag, `admin_tasks/` state |
| tiles PVC         | `/data/tiles`      | Generated DZI tile trees + thumbnails                       |
| database PVC      | _(PostgreSQL pod)_ | PostgreSQL data (CNPG-managed)                              |
| backup PVC        | `/backups`         | Local snapshot archives (when Azure is not configured)      |

Runtime paths are unchanged from the single-PVC era (`SOURCE_IMAGES_DIR=/data/source_images`,
`TILES_DIR=/data/tiles`), so existing `stored_path` values and tile URLs remain valid
after the split. See [deploy/README.md](../deploy/README.md) for the cutover procedure.

### Recommended Longhorn policies

| Volume                | Snapshot schedule              | Backup target        | Retention                              |
| --------------------- | ------------------------------ | -------------------- | -------------------------------------- |
| Database (PostgreSQL) | Daily, before HRIV backup cron | S3/NFS backup target | 30 days                                |
| Source images PVC     | Daily                          | S3/NFS backup target | 30 days                                |
| Tiles PVC             | Weekly (optional)              | S3/NFS (optional)    | 7 days (short — tiles are rebuildable) |
| Backup PVC            | Weekly                         | S3/NFS backup target | 30 days                                |

> **Why a short retention for tiles?** Tiles can always be regenerated from
> source images. Keeping a recent Longhorn snapshot avoids a full rebuild
> after a transient volume loss, but long-term tile backups waste storage
> because old tile trees are invalidated by any pipeline version bump.

## Python backup service role

The Python backup service (`backup/backup.py`) is **not** the primary
protection for the large generated tile tree in production. Its supported
production role is:

- **Database + source images only** — archives `db.sql` and `/data/source_images`.
- **Tiles excluded** — generated DZI tiles under `/data/tiles` are not included
  in production-mode backups.
- **Why** — walking and checksumming millions of tile files is slow, produces
  enormous archives, and competes with Longhorn's efficient block-level snapshots.

This same source-only approach is what the Admin UI's Filesystem Export uses.
Compression is parallelized with `pigz` when it is present in the container
image (the backend Dockerfile installs it); otherwise the export falls back to
single-threaded gzip automatically.

Set `BACKUP_MODE=production` (the Helm chart default) to enable this mode.
Use `BACKUP_MODE=development` for local dev or manual exports that include
the full `/data` tree.

See [backup/README.md](../backup/README.md) for the full backup service
configuration, environment variables, and Docker Compose usage.

## Restore order and decision points

After a failure or data loss, follow this order:

### 1. Restore the database

```bash
# Option A: HRIV backup archive
kubectl exec -n hriv deploy/hriv-backup -- python backup.py restore [SNAPSHOT_NAME]

# Option B: Longhorn volume restore (if the PVC was lost)
#   1. Create a Longhorn volume from the latest database backup snapshot
#   2. Update the PostgreSQL PVC to point at the new volume
#   3. Restart the PostgreSQL pod
```

**Decision:** Use the HRIV backup archive when you need point-in-time recovery
from a specific snapshot. Use Longhorn restore when the entire PVC was lost
and you need the most recent block-level state.

### 2. Restore source images

```bash
# The HRIV backup restore command (step 1) already restores source images
# from the same archive. If you used Longhorn for the DB, also restore
# the source-images PVC from Longhorn:

#   1. Create a Longhorn volume from the latest source-images backup snapshot
#   2. Update the source-images PVC to point at the new volume
#   3. Restart the backend/worker/backup pods
```

### 3. Restore or rebuild tiles

This is the key decision point:

| Situation                                      | Action                                       |
| ---------------------------------------------- | -------------------------------------------- |
| Tile volume intact, tiles current              | No action needed                             |
| Tile volume lost, DB + source images recovered | **Rebuild tiles** (see below)                |
| Tile volume intact but tiles are stale         | **Rebuild tiles** with `scope=stale`         |
| Tile volume has a recent Longhorn snapshot     | Restore from Longhorn (faster than rebuild)  |
| Tile volume lost, no Longhorn snapshot         | **Rebuild tiles** with `scope=missing_stale` |

**Rebuild tiles (preferred for missing/stale tiles):**

```bash
# Trigger the rebuild-tiles admin task via the API
TOKEN="<admin JWT>"
curl -X POST "https://<host>/api/admin/tasks/rebuild-tiles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope": "missing_stale"}'
```

This regenerates DZI tile trees from the preserved source images using the
current pipeline settings. The operation is:

- **Idempotent** — already-current tile sets are skipped (unless `scope=all`).
- **Resilient** — per-image failures are logged without aborting the batch.
- **Filesystem-aware** — checks on-disk `image.dzi` manifest, not just DB
  provenance, so it catches tiles lost from a DB-only restore.

See [admin-import-export.md](admin-import-export.md#rebuild-tiles) for the
full API reference and [tile-cache-provenance.md](tile-cache-provenance.md)
for how `missing` vs `stale` is determined.

**Restore from Longhorn (faster for large tile sets):**

1. Create a Longhorn volume from the latest tiles backup snapshot.
2. Update the tiles PVC to point at the new volume.
3. Restart the backend/worker pods.
4. Run `rebuild-tiles` with `scope=stale` to catch any tiles that were
   invalidated by a pipeline version change since the snapshot was taken.

### 4. Verify

```bash
# Health check
kubectl exec -n hriv deploy/hriv-backend -- curl -s http://localhost:8000/api/health

# Maintenance mode should be off
kubectl exec -n hriv deploy/hriv-backend -- curl -s http://localhost:8000/api/status
# → {"maintenance": false, "version": "..."}

# Check tile-cache status for source images
TOKEN="<admin JWT>"
curl -s "https://<host>/api/source-images" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; [print(f'{s[\"id\"]}: {s[\"tile_cache_status\"]}') for s in json.load(sys.stdin)]"
```

Open the viewer in a browser and confirm images load. If tiles are missing,
the viewer will show a broken-image placeholder; run the rebuild task.

## Full disaster recovery runbook

Use this when the entire cluster is lost or a fresh redeployment is needed.

### Prerequisites

- Kubernetes cluster with Longhorn installed
- Flux CD configured to reconcile from `bcit-tlu/flux-fleet`
- Access to Azure Blob Storage (or local backup archives)
- Admin JWT for API calls (or ability to generate one via `flux-fleet` secrets)

### Steps

1. **Provision the cluster** — Flux reconciles the base manifests and
   stands up PostgreSQL (CNPG), backend, frontend, worker, and backup pods.

2. **Restore the database** from the most recent HRIV backup archive:

   ```bash
   kubectl exec -n hriv deploy/hriv-backup -- python backup.py restore
   ```

   This also restores source images to `/data/source_images` and enables
   maintenance mode during the restore. In production mode, the tile tree
   is left untouched (preserved if present, absent if the volume is new).

3. **Disable maintenance mode** (the restore command does this automatically
   on success, but verify):

   ```bash
   curl -X PUT "https://<host>/api/admin/maintenance?enabled=false" \
     -H "Authorization: Bearer $TOKEN"
   ```

4. **Rebuild tiles** (if the tile volume is new or was lost):

   ```bash
   curl -X POST "https://<host>/api/admin/tasks/rebuild-tiles" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"scope": "missing_stale"}'
   ```

   Monitor progress in the Admin UI → Backups tab, or poll the task status
   via the API. Large image sets may take hours; the task is safe to cancel
   and rerun.

5. **Verify** — confirm health, viewer access, and tile-cache status as
   described above.

If you only need to restore a single file from a snapshot, use the Admin UI’s
per-file restore browser instead of a full archive restore. It reads snapshot
manifests through the backend’s read-only Azure SAS path, restores one
`data/` member at a time, and notes when Rebuild Tiles may be needed after a
source-image restore.

## Known risks and tradeoffs

- **Large first backup** — the initial source-images backup can be large
  (multi-GB histology slides). The first Longhorn backup of the source-images
  PVC will also be large. Subsequent backups are incremental at the block
  level.

- **Tile file-count explosion** — a single 1 GB pyramidal image can produce
  tens of thousands of tile files. Walking and checksumming these in a
  `.tar.gz` archive is slow and produces enormous files. This is why
  production mode excludes tiles from the Python backup service and relies
  on Longhorn block-level snapshots or rebuild-from-source instead.

- **Restore-test requirement** — backups that are never tested are not
  real backups. Run a DR drill on pre-production data at least once per
  release cycle. See [#736](https://github.com/bcit-tlu/hriv/issues/736)
  for the pre-production validation checklist.

- **Rebuild time** — regenerating tiles for a large image set can take
  hours (CPU-bound `pyvips.dzsave`). Plan for this in RTO estimates. A
  Longhorn tile-volume restore is faster but only useful if the snapshot
  predates any pipeline version change.

- **Cost/time of full backups** — Azure Blob Storage egress and Longhorn
  backup target storage incur ongoing costs. The production model
  minimizes these by excluding the largest (tile) volume from routine
  backups.

## RTO / RPO expectations

| Metric                           | Target     | Notes                                                   |
| -------------------------------- | ---------- | ------------------------------------------------------- |
| RPO                              | ≤ 24 hours | Daily backup cron + Longhorn snapshots                  |
| RTO                              | 1–4 hours  | DB + source-image restore; tile rebuild may extend this |
| RTO (with Longhorn tile restore) | 30–60 min  | When a recent tile snapshot is available                |

Actual numbers should be measured during the pre-production DR drill
([#736](https://github.com/bcit-tlu/hriv/issues/736)) and updated here.

## Related documentation

- [backup/README.md](../backup/README.md) — backup service configuration and Docker Compose usage
- [deploy/README.md](../deploy/README.md) — Helm chart volume layout and PVC cutover
- [tile-cache-provenance.md](tile-cache-provenance.md) — provenance fields and staleness rules
- [admin-import-export.md](admin-import-export.md) — rebuild-tiles admin task API reference
- [image-processing-lifecycle.md](image-processing-lifecycle.md) — tile generation pipeline
- [backup-restore-runbook.md](backup-restore-runbook.md) — cold-grab operator checklist for health checks and restores
- [per-file-restore-design.md](per-file-restore-design.md) — proposal for manifest-browsed single-file restores
- [RELEASE_AND_DEPLOY_FLOW.md](RELEASE_AND_DEPLOY_FLOW.md) — release and Flux deployment flow
