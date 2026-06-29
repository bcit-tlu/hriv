# HRIV Disaster Recovery Backup Service

Standalone service that snapshots the HRIV PostgreSQL database and image filesystem on a configurable cron schedule, stores archives in Azure Blob Storage, and supports full restore after a fresh redeployment. In production deployments the service is intentionally narrowed to backing up the database and authoritative source images; generated DZI tiles are treated as derived data that should be protected by the storage layer (Longhorn snapshots/backups) or rebuilt from source images.

## Quick Start

### Run a one-shot backup (local storage)

```bash
docker compose --profile backup run --rm backup backup
```

This creates a timestamped `.tar.gz` archive in the `backup_data` Docker volume (mounted at `/backups` inside the container).

### Enable the cron scheduler

```bash
docker compose --profile backup up -d backup
```

The service runs in the background and creates snapshots on the configured schedule (default: daily at 2:00 AM UTC).

### List available snapshots

```bash
docker compose --profile backup run --rm backup list
```

### Restore from the latest snapshot

```bash
docker compose --profile backup run --rm backup restore
```

### Restore a specific snapshot

```bash
docker compose --profile backup run --rm backup restore hriv-backup-20260101-020000
```

## What's in a Snapshot

Each snapshot is a `.tar.gz` archive containing:

| File            | Description                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `db.sql`        | Full PostgreSQL dump (`pg_dump --no-owner --no-acl`)                                                    |
| `data/`         | Image filesystem (source images + DZI tiles in development mode; source images only in production mode) |
| `manifest.json` | Metadata: timestamp, backup mode, file listing with SHA-256 checksums                                   |

## Production Role

> **See also:** [`docs/backup-and-disaster-recovery.md`](../docs/backup-and-disaster-recovery.md)
> for the full production strategy — data classification, Longhorn policies,
> restore order, and the DR runbook.

In production deployments, the Python backup service is **not** the primary protection for the large generated tile tree. Its supported production role is:

- **Database + source images:** the service archives and restores the PostgreSQL dump and the `/data/source_images` filesystem.
- **Tiles excluded:** generated DZI tiles under `/data/tiles` are excluded from HRIV backups.
- **Why:** tiles are derived data. They can be rebuilt from the authoritative source images using the `rebuild-tiles` admin task (see [`docs/admin-import-export.md`](docs/admin-import-export.md)), or protected independently by the storage layer.

Set `BACKUP_MODE=production` to enable this mode. The default is `development`, which preserves the historical behavior of archiving the full `/data` tree including tiles.

### Longhorn protection policy

For Longhorn-backed Kubernetes deployments, protect each volume according to its role:

| Volume                                    | Recommended protection                                                | Recovery path                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Database (PostgreSQL PVC)                 | Longhorn snapshot + backup                                            | Restore from Longhorn or replay from HRIV DB dump                                                                                |
| Source images (`/data/source_images` PVC) | Longhorn snapshot + backup                                            | Restore from Longhorn or HRIV backup archive                                                                                     |
| Generated tiles (`/data/tiles` PVC)       | Longhorn snapshot + backup (optional)                                 | Prefer tile rebuild from source images; restore from Longhorn only when the snapshot is newer than the last tile-pipeline change |
| Backup archives (Azure / local PVC)       | Azure Blob Storage replication or Longhorn snapshot of the backup PVC | Azure Blob Storage or Longhorn restore of the backup PVC                                                                         |

### Rebuild vs restore tiles

- **Rebuild** when the database and source images are recovered but the tile volume is missing or stale. The `rebuild-tiles` admin task regenerates tiles for missing or stale sources using the current pipeline settings.
- **Restore from Longhorn** when the tile volume is intact and you want to avoid the CPU cost of regeneration.
- **Do not** rely on routine `.tar.gz` backups of the full tile tree. Walking and checksumming millions of tile files is slow, produces enormous archives, and competes with the storage layer's own efficient block-level snapshots.

### Restore responsibilities

| Data            | Restore source                                           |
| --------------- | -------------------------------------------------------- |
| Database        | HRIV backup archive (`db.sql`) or Longhorn restore       |
| Source images   | HRIV backup archive or Longhorn restore                  |
| Generated tiles | `rebuild-tiles` admin task or Longhorn restore           |
| Backup archives | Azure Blob Storage or Longhorn restore of the backup PVC |

## Configuration

All settings are controlled via environment variables in `docker-compose.yml` or the Helm chart:

| Variable                          | Default                                                   | Description                                                                        |
| --------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | `postgresql://hriv:hriv@db:5432/hriv`                     | PostgreSQL connection string                                                       |
| `DATA_DIR`                        | `/data`                                                   | Path to the image data volume                                                      |
| `BACKUP_CRON_SCHEDULE`            | `0 2 * * *`                                               | Cron expression for scheduled backups                                              |
| `BACKUP_RETENTION_COUNT`          | `30`                                                      | Number of snapshots to keep (older ones are deleted)                               |
| `BACKUP_MODE`                     | `development` (docker-compose), `production` (Helm chart) | `development` = DB + source images + tiles; `production` = DB + source images only |
| `AZURE_STORAGE_CONNECTION_STRING` | _(empty)_                                                 | Azure Blob Storage connection string                                               |
| `AZURE_STORAGE_CONTAINER`         | _(empty)_                                                 | Azure Blob Storage container name                                                  |
| `AZURE_BLOB_PREFIX`               | `hriv-backups`                                            | Blob name prefix (folder) inside the container                                     |

## Kubernetes Volume Layout

For production-style Helm deployments, the backup chart keeps the existing
runtime paths unchanged while mounting only the volumes the backup service
actively uses by default:

- source-images PVC mounted at `/data`
- backup archives PVC mounted at `/backups`

When `BACKUP_MODE=production` (the Helm chart default), the backup pod does
not mount or provision the tiles PVC because generated tiles are excluded from
backup and restore. If you override the chart to `BACKUP_MODE=development` for
manual or local-style use, the tiles PVC is mounted at `/data/tiles` again so
the service can include tiles in the archive.

The source-images PVC remains the `/data` root so the backup service can still
share the maintenance-mode flag at `/data/.maintenance` with the backend.

For pre-production migrations, cut over by scaling workloads down, copying
`/data/source_images` and `/data/tiles` into their new PVCs with a temporary
pod, updating Helm values, and then starting the workloads again. No image
reimport should be required as long as the visible paths remain
`/data/source_images` and `/data/tiles`.

If you are upgrading from the older single-data-PVC layout, update any values
that still use `persistence.data.*` to the new `persistence.sourceImages.*`
and `persistence.tiles.*` keys. The old backend chart PVC named
`{fullname}-data` is not migrated or deleted automatically.

### Local-Only Mode

If no Azure credentials are provided, snapshots are saved to the `backup_data` volume (`/backups` inside the container). This is useful for development or when using a separate volume backup strategy.

### Cloud Storage (Azure Blob Storage)

Uncomment and configure the Azure variables in `docker-compose.yml` to enable off-site storage. You will need:

1. An Azure Storage Account
2. A Blob container within that account
3. A connection string (found in the Azure Portal under Storage Account → Access keys)

## Full Restore

Follow these steps to restore from a backup on a running cluster.

### 1. List available snapshots

```bash
kubectl exec -n hriv deploy/hriv-backup -- python backup.py list
```

Pick the snapshot you want to restore (or omit the name in step 3 to use the latest).

### 2. Run the restore

```bash
kubectl exec -n hriv deploy/hriv-backup -- python backup.py restore [SNAPSHOT_NAME]
```

The restore command automatically:

1. **Enables maintenance mode** — writes a flag file to the shared data volume. The backend middleware returns `503 Service Unavailable` on all non-health endpoints, and the frontend shows a "Maintenance in Progress" overlay.
2. **Downloads** the snapshot archive from Azure Blob Storage (or uses a local archive).
3. **Drops all tables** in the PostgreSQL database and restores from the `db.sql` dump.
4. **Replaces files** in the data volume. In `development` mode this includes source images and DZI tiles. In `production` mode the tile tree is preserved and left untouched; regenerate tiles afterward with the `rebuild-tiles` admin task if needed.
5. **Disables maintenance mode** — removes the flag file. The frontend automatically detects the change and reloads within 10 seconds.

If the restore fails, maintenance mode is still disabled automatically so the previous state remains accessible.

### 3. Verify

After the restore completes, confirm the application is working:

```bash
# Health check
kubectl exec -n hriv deploy/hriv-backend -- curl -s http://localhost:8000/api/health

# Maintenance mode should be off
kubectl exec -n hriv deploy/hriv-backend -- curl -s http://localhost:8000/api/status
# → {"maintenance": false, "version": "..."}
```

### Manual maintenance mode toggle

Admins can also toggle maintenance mode manually via the API (requires an admin JWT):

```bash
# Enable
curl -X PUT "https://<host>/api/admin/maintenance?enabled=true" -H "Authorization: Bearer <TOKEN>"

# Disable
curl -X PUT "https://<host>/api/admin/maintenance?enabled=false" -H "Authorization: Bearer <TOKEN>"
```

> **Note:** Auth endpoints are blocked during maintenance, so the admin JWT must still be valid. If the JWT expires while maintenance is active, remove the flag file directly:
>
> ```bash
> kubectl exec -n hriv deploy/hriv-backup -- rm /data/.maintenance
> ```

## Full Disaster Recovery Procedure

After a fresh redeployment (new server, new Docker volumes):

```bash
# 1. Start the database
docker compose up -d db

# 2. Wait for it to be healthy
docker compose exec db pg_isready -U hriv

# 3. Restore the latest snapshot (database + source images; tiles are excluded in production mode)
docker compose --profile backup run --rm backup restore

# 4. Start the rest of the stack
docker compose up -d
```

The restore command will:

1. Enable maintenance mode (frontend shows overlay)
2. Download the snapshot from Azure Blob Storage (or use local `/backups` volume)
3. Drop and recreate all database tables from the `pg_dump`
4. Restore image files to the data volume. In `production` mode source images are restored and the existing tile tree is preserved; use the `rebuild-tiles` admin task or a Longhorn tile-volume restore to bring tiles back
5. Disable maintenance mode (frontend recovers automatically)

## Maintenance Mode

The backup service and the backend share a file-based maintenance flag at `<DATA_DIR>/.maintenance`. When this file exists:

- **Backend**: The `MaintenanceMiddleware` returns `503` with `{"maintenance": true}` for all endpoints except `/api/health`, `/api/health/ready`, `/api/status`, and `/api/admin/maintenance`.
- **Frontend**: The `MaintenanceBanner` component polls `GET /api/status` every 10 seconds. When `maintenance` is `true`, a full-screen overlay replaces the application UI. When `maintenance` returns to `false`, the overlay disappears and the app resumes.
- **Restore**: The `restore` command automatically sets and clears the flag. No manual intervention needed.

## Integration with Admin Import/Export

The backup service works alongside the admin page's database import/export feature:

- **Admin Export** (`GET /api/admin/export`): Exports a JSON document with categories, images, users, programs, and announcements. This is useful for quick manual backups of database records.
- **Backup Service**: In `development` mode, creates comprehensive snapshots that include the full `pg_dump` (all tables, sequences, indexes) **and** the image filesystem. In `production` mode it backs up the `pg_dump` and source images only; generated tiles are recovered from Longhorn snapshots or regenerated with the `rebuild-tiles` admin task.

For maximum safety, the admin export can be used for quick application-level backups, while the backup service handles full disaster recovery including the image filesystem.

## Docker Compose Profile

The backup service uses the `backup` Docker Compose profile, so it does **not** start with a plain `docker compose up`. This keeps the default development workflow unchanged. To include it:

```bash
# Start everything including backup
docker compose --profile backup up -d

# Or run backup commands individually
docker compose --profile backup run --rm backup backup
```
