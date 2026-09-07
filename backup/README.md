# HRIV Disaster Recovery Backup Service

Standalone service that publishes HRIV recovery archives on a configurable schedule, stores archives in Azure Blob Storage, and supports component-selective restore after a fresh redeployment. In production, CloudNativePG backup and WAL archiving protect PostgreSQL while this service streams authoritative source images directly to Azure; generated DZI tiles are derived data that can be rebuilt from source images. Development mode retains the legacy logical database plus filesystem archive.

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

The service runs in the background and creates snapshots on the configured schedule (default: 10:00 UTC, or 02:00 PST / 03:00 PDT).

### List available snapshots

```bash
docker compose --profile backup run --rm backup list
```

### Check backup freshness

```bash
docker compose --profile backup run --rm backup status
```

### Restore from the latest snapshot

```bash
docker compose --profile backup run --rm backup restore
```

### Restore a specific snapshot

```bash
docker compose --profile backup run --rm backup restore hriv-backup-20260101-020000-9f3c1ab2
```

A snapshot may be named by its full archive name, by its name without the
`.tar.gz` suffix, or by an unambiguous prefix (for example the timestamp
`hriv-backup-20260101-020000`). An ambiguous prefix is rejected rather than
resolved arbitrarily.

## Snapshot Naming

Snapshots are named `hriv-backup-<YYYYMMDD-HHMMSS>-<8 hex chars>`, e.g.
`hriv-backup-20260101-020000-9f3c1ab2`. The random suffix gives concurrent
invocations distinct archives, manifests, and blob keys; the fixed-width
timestamp prefix keeps lexical ordering chronological, so `list`, retention, and
"latest snapshot" selection all sort by the timestamp in the name (with the full
name as tie-break) rather than by file or blob modification time.

Snapshots created before this scheme (timestamp only, no suffix) remain listable
and restorable, and sort alongside suffixed names.

## What's in a Snapshot

Each snapshot is a `.tar.gz` archive containing:

| File            | Description                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `db.sql`        | Development-only logical PostgreSQL dump (`pg_dump --no-owner --no-acl`); omitted in production         |
| `data/`         | Image filesystem (source images + DZI tiles in development mode; source images only in production mode) |
| `manifest.json` | Versioned recovery-set metadata, CNPG target time, file inventory, and SHA-256 checksums                |

## Production Role

> **See also:** [`docs/backup-and-disaster-recovery.md`](../docs/backup-and-disaster-recovery.md)
> for the full production strategy — data classification, Longhorn policies,
> restore order, and the DR runbook.
>
> **Quick operator checklist:** [`docs/backup-restore-runbook.md`](../docs/backup-restore-runbook.md).

In production deployments, the Python backup service protects authoritative source images. Its supported role is:

- **Database recovery binding:** the manifest records the CNPG cluster and target timestamp; it does not run `pg_dump` or include `db.sql`.
- **Source images:** DB-referenced files under `/data/source_images` are streamed directly to Azure without a complete local archive; missing references and orphan files are reported without reconciliation.
- **Tiles excluded:** generated DZI tiles under `/data/tiles` are excluded from HRIV backups.
- **Why:** CNPG provides database backup and PITR, while tiles are derived data that can be rebuilt with the `rebuild-tiles` admin task (see [`docs/admin-import-export.md`](../docs/admin-import-export.md)).

Set `BACKUP_MODE=production` to enable this mode. The default is `development`, which preserves the historical behavior of archiving the full `/data` tree including tiles.

### Longhorn protection policy

For Longhorn-backed Kubernetes deployments, protect each volume according to its role:

| Volume                                    | Recommended protection                          | Recovery path                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Database (PostgreSQL PVC)                 | CNPG base backups plus continuous WAL archiving | Restore through CNPG to the recovery-set target time                                                                             |
| Source images (`/data/source_images` PVC) | HRIV source-image recovery archives in Azure    | Stream and validate with `restore-filesystem` into a new target PVC                                                              |
| Generated tiles (`/data/tiles` PVC)       | Longhorn snapshot + backup (optional)           | Prefer tile rebuild from source images; restore from Longhorn only when the snapshot is newer than the last tile-pipeline change |
| Backup archives (Azure / local PVC)       | Azure Blob Storage replication                  | Restore from an archive whose publication state, manifest, and success marker are valid                                          |

### Rebuild vs restore tiles

- **Rebuild** when the database and source images are recovered but the tile volume is missing or stale. The `rebuild-tiles` admin task regenerates tiles for missing or stale sources using the current pipeline settings.
- **Restore from Longhorn** when the tile volume is intact and you want to avoid the CPU cost of regeneration.
- **Do not** rely on routine `.tar.gz` backups of the full tile tree. Walking and checksumming millions of tile files is slow, produces enormous archives, and competes with the storage layer's own efficient block-level snapshots.

### Restore responsibilities

| Data            | Restore source                                            |
| --------------- | --------------------------------------------------------- |
| Database        | CNPG base backup and WAL/PITR recovery                    |
| Source images   | Published HRIV recovery archive with `restore-filesystem` |
| Generated tiles | `rebuild-tiles` admin task or optional Longhorn restore   |
| Backup archives | Azure Blob Storage                                        |

## Configuration

All settings are controlled via environment variables in `docker-compose.yml` or the Helm chart:

| Variable                          | Default                                                   | Description                                                                              |
| --------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | `postgresql://hriv:hriv@db:5432/hriv`                     | PostgreSQL connection string                                                             |
| `DATA_DIR`                        | `/data`                                                   | Path to the image data volume                                                            |
| `BACKUP_CRON_SCHEDULE`            | `0 10 * * *`                                              | Cron expression for scheduled backups                                                    |
| `BACKUP_TIMEZONE`                 | `UTC`                                                     | IANA timezone used to evaluate the schedule; UTC avoids DST gaps                         |
| `BACKUP_MUTATION_DRAIN_SECONDS`   | `5`                                                       | Brief write-drain interval before the finalized source-image inventory is captured       |
| `CNPG_CLUSTER_NAME`               | `pg-core`                                                 | CNPG cluster bound into production recovery-set metadata                                 |
| `BACKUP_RETENTION_COUNT`          | `30`                                                      | Number of snapshots to keep (older ones are deleted)                                     |
| `BACKUP_STAGING_DIR`              | `/backups/.staging`                                       | Bounded state/development scratch; Azure production archives bypass full local staging   |
| `BACKUP_STALE_HOURS`              | `26`                                                      | Freshness threshold for the `status` command before a backup is considered stale         |
| `BACKUP_MODE`                     | `development` (docker-compose), `production` (Helm chart) | `development` = logical DB + full data; `production` = CNPG binding + source images only |
| `AZURE_STORAGE_CONNECTION_STRING` | _(empty)_                                                 | Azure Blob Storage connection string                                                     |
| `AZURE_STORAGE_CONTAINER`         | _(empty)_                                                 | Azure Blob Storage container name                                                        |
| `AZURE_BLOB_PREFIX`               | `hriv-backups`                                            | Blob name prefix (folder) inside the container                                           |

## Observability markers

The backup service writes two small JSON marker files alongside the retained
archives:

- `BACKUP_STATE.json` is the authoritative observability state. It is
  versioned (`schema_version: 2`) and records the latest database and
  filesystem attempt timestamps, outcomes, durations, payload sizes, and the
  last successful values for each backup type independently.
- `LAST_SUCCESS.json` is retained as a compatibility marker for older tooling
  that only expects a single last-success heartbeat.

`BACKUP_STATE.json` is updated at attempt start and completion so a failed
current backup remains visible even when an older success exists.

### Concurrent runs

More than one run can be in flight at a time — the cron loop plus an on-demand
`kubectl exec … backup` invocation, or two containers sharing the `/backups`
volume. Every marker update is therefore a read → merge → write cycle rather
than a blind overwrite:

- Local markers are serialised with an advisory `flock` on
  `/backups/.hriv-backup-state.lock`, a sidecar file that lives on the same
  volume as the markers so the lock is visible to every process sharing it. The
  kernel releases the lock when a writer is killed or evicted, so a dead writer
  cannot block later backups; if the lock is still unavailable after 30 seconds
  the marker update is skipped rather than written without serialisation, so a
  wedged holder costs an observability update and never a backup.
- Azure Blob Storage markers are updated with an ETag compare-and-set
  (`If-Not-Modified`) and re-merged on conflict, because a local lock cannot
  coordinate writers that only share a storage account. A marker whose current
  contents cannot be read is retried rather than replaced, so an unreadable
  blob costs an observability update instead of another run's result.

Correctness comes from the merge rules rather than the lock:

- an attempt record is only replaced by a _more recently finished_ attempt
  (ordered by `completed_at`, then `started_at`, then run id), so a slower or
  older run cannot overwrite a newer result;
- `last_success_*` fields only advance to a newer success, so a late-finishing
  failure records the failed attempt without erasing a newer success;
- database and filesystem are merged independently, and each document carries
  the `run_id` that produced it plus a bounded `attempts` history (10 entries)
  so a run whose record lost the comparison is still visible for debugging.

### Timestamps

`created_at` is the snapshot's own timestamp — it names the archive — while
`completed_at` (added to `LAST_SUCCESS.json` alongside `run_id` and a per-type
`types` block) is when the snapshot actually became restorable. Freshness in
`backup status` and in the backend health signal is measured from
`completed_at`, falling back to `created_at` for markers written before this
field existed. Reported age is therefore lower than before by roughly the
duration of a backup; `BACKUP_STALE_HOURS` is unchanged.

## Kubernetes Volume Layout

For production-style Helm deployments, the backup chart keeps the existing
runtime paths unchanged while mounting only the volumes the backup service
actively uses by default:

- source-images PVC mounted at `/data`
- backup state/scratch PVC mounted at `/backups`
- optional `restoreTarget.existingClaim` mounted at `restoreTarget.mountPath`
  (default `/restore-target`) for validated source-only recovery

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

### Pod Resources

The chart sets explicit `resources` for the backup pod. In Azure-backed
production mode, compressed tar data is written to uncommitted block-blob
blocks and committed only after every inventoried file is read and validated;
no complete archive is staged on `/backups` or pod-local storage. The backup PVC
holds bounded state, locks, and database-dump or restore scratch used by legacy
and development paths. Local-only backups and local legacy restores still use
`BACKUP_STAGING_DIR`, so their capacity must match the selected archive.

### Local-Only Mode

If no Azure credentials are provided, snapshots are saved to the `backup_data` volume (`/backups` inside the container). This is useful for development or when using a separate volume backup strategy.

### Cloud Storage (Azure Blob Storage)

Uncomment and configure the Azure variables in `docker-compose.yml` to enable off-site storage. You will need:

1. An Azure Storage Account
2. A Blob container within that account
3. A connection string (found in the Azure Portal under Storage Account → Access keys)

## Component-selective restore

List published snapshots and select one whose recovery-set metadata matches the
intended CNPG recovery point:

```bash
kubectl exec -n hriv deploy/hriv-backup -- python backup.py list
```

The production sequence restores PostgreSQL through CNPG first, then restores
the matching source-image archive to a new target PVC without applying SQL. Set
`restoreTarget.existingClaim` on the backup chart to mount the prepared claim at
`/restore-target`, then run:

```bash
kubectl exec -n hriv deploy/hriv-backup -- \
  python backup.py restore-filesystem [SNAPSHOT_NAME] \
  --data-dir /restore-target
```

Equivalent explicit syntax is:

```bash
python backup.py restore [SNAPSHOT_NAME] --components filesystem --data-dir /restore-target
```

Azure archives are read sequentially. Selected source files are extracted into
a unique staging directory on the target data filesystem, validated against the
manifest, and promoted only after validation succeeds. Existing unmatched
target content is quarantined rather than reconciled or deleted. Production
operators should use a fresh target PVC so validation and rollback do not depend
on spare capacity in the active source-image volume.

`restore-database` and `--components database` are available only for legacy or
development archives containing `db.sql`. A current production source-only
archive rejects database or combined restore before invoking `psql` and directs
the operator to CNPG recovery. The unqualified `restore` command remains the
legacy combined default for backward compatibility; do not run it after a newer
CNPG PITR recovery.

Operator restores enable and clear HRIV maintenance mode. Restore validation
failure never performs automatic database-row deletion, row creation, orphan
file deletion, or tile generation.

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

For Kubernetes production recovery:

1. Reconcile infrastructure and HRIV configuration from Flux and Vault.
2. Select a published recovery set and inspect its manifest sidecar.
3. Restore `pg-core` through CNPG to the manifest's `database_recovery.target_time`.
4. Provision a new source-image PVC with capacity for the manifest's declared bytes.
5. Run `restore-filesystem` against that target without executing `db.sql`.
6. Verify checksums and review missing-source/orphan reports before cutover.
7. Point the HRIV deployment at the validated CNPG/source-image targets.
8. Rebuild derived tiles with the supported admin task.
9. Verify health, authentication, browsing, representative viewer behavior, metadata, and annotations.

Development and local-only recovery may continue to use the legacy combined
archive after starting the local PostgreSQL service:

```bash
docker compose up -d db
docker compose exec db pg_isready -U hriv
docker compose --profile backup run --rm backup restore
docker compose up -d
```

The authoritative production sequence is defined in
[`docs/recovery-set-contract.md`](../docs/recovery-set-contract.md). It never
restores a logical dump over a newer CNPG recovery point.

## Maintenance Mode

The backup service and the backend share a file-based maintenance flag at `<DATA_DIR>/.maintenance`. When this file exists:

- **Backend**: The `MaintenanceMiddleware` returns `503` with `{"maintenance": true}` for all endpoints except `/api/health`, `/api/health/ready`, `/api/status`, and `/api/admin/maintenance`.
- **Frontend**: The `MaintenanceBanner` component polls `GET /api/status` every 10 seconds. When `maintenance` is `true`, a full-screen overlay replaces the application UI. When `maintenance` returns to `false`, the overlay disappears and the app resumes.
- **Restore**: The `restore` command automatically sets and clears the flag. No manual intervention needed.

## Integration with Admin Import/Export

The backup service works alongside the admin page's database import/export feature:

- **Admin Export** (`GET /api/admin/export`): Exports a JSON document with categories, images, users, programs, and announcements. This is useful for quick manual backups of database records.
- **Backup Service**: In `development` mode, creates legacy combined archives containing `db.sql` and the image filesystem. In `production`, it streams source images only and binds them to the CNPG recovery target in the manifest; generated tiles are rebuilt or optionally restored from Longhorn.

The admin export remains useful for quick application-level logical exports. Production disaster recovery uses CNPG for PostgreSQL and the backup service for the authoritative source-image filesystem.

## Docker Compose Profile

The backup service uses the `backup` Docker Compose profile, so it does **not** start with a plain `docker compose up`. This keeps the default development workflow unchanged. To include it:

```bash
# Start everything including backup
docker compose --profile backup up -d

# Or run backup commands individually
docker compose --profile backup run --rm backup backup
```
