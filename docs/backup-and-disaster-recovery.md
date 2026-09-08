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
>
> The normative consistency boundary, mismatch outcomes, recovery-set metadata,
> scheduling constraints, and component-selective restore rules are defined in
> [the HRIV recovery-set contract](recovery-set-contract.md).

## Data classification

| Data            | Role          | Authoritative? | Primary protection                  | Secondary protection         |
| --------------- | ------------- | -------------- | ----------------------------------- | ---------------------------- |
| PostgreSQL DB   | Metadata      | Yes            | CNPG base backups + continuous WAL  | Azure Blob recovery catalog  |
| Source images   | User uploads  | Yes            | HRIV recovery archive               | Azure Blob off-site archive  |
| Generated tiles | Derived       | No             | Longhorn snapshot/backup (optional) | `rebuild-tiles` admin task   |
| Backup archives | Recovery data | Yes            | Azure Blob Storage replication      | Versioning and soft deletion |

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

| Volume                | Snapshot schedule                    | Backup target     | Retention                              |
| --------------------- | ------------------------------------ | ----------------- | -------------------------------------- |
| Database (PostgreSQL) | CNPG daily base backup + WAL archive | Azure Blob        | 30-day recovery window                 |
| Source images PVC     | Daily HRIV recovery archive          | Azure Blob        | 30 days                                |
| Tiles PVC             | Weekly (optional)                    | S3/NFS (optional) | 7 days (short — tiles are rebuildable) |
| Backup PVC            | Bounded state/scratch only           | Longhorn          | Operational, not authoritative         |

> **Why a short retention for tiles?** Tiles can always be regenerated from
> source images. Keeping a recent Longhorn snapshot avoids a full rebuild
> after a transient volume loss, but long-term tile backups waste storage
> because old tile trees are invalidated by any pipeline version bump.

## Python backup service role

The Python backup service (`backup/backup.py`) is **not** the primary
protection for the large generated tile tree in production. Its supported
production role is:

- **Source images only** — streams finalized `/data/source_images` files to Azure.
- **CNPG recovery binding** — records the authoritative CNPG target LSN, audit
  timestamp, and confirmed archived WAL fence; it does not invoke `pg_dump` in production.
- **Tiles excluded** — generated DZI tiles under `/data/tiles` are not included.
- **Why** — CNPG provides PostgreSQL PITR, while walking and archiving millions
  of generated tile files would waste capacity and compete with the application.

This same source-only approach is what the Admin UI's Filesystem Export uses.
Compression is parallelized with `pigz` when it is present in the container
image (the backend Dockerfile installs it); otherwise the export falls back to
single-threaded gzip automatically. The `EXPORT_PIGZ_THREADS` env var caps
pigz's worker count when set to a positive integer; the backend defaults it to
`2`, and `0` preserves the current all-cores behavior.

Set `BACKUP_MODE=production` (the Helm chart default) to enable this mode.
Use `BACKUP_MODE=development` for local dev or manual exports that include
the full `/data` tree.

Production first requires PostgreSQL `archive_timeout` to be positive and below
the configured fence wait. The CNPG target time, `pg_current_wal_lsn()` target
LSN, and `source_images` rows then come from the post-lock snapshot of one
behaviorally read-only transaction that sets local lock/statement deadlines
before `LOCK TABLE ... IN SHARE MODE; COPY ...; COMMIT;`. The maintenance gate
blocks new HTTP mutations while the SHARE lock waits out existing source writers
and blocks source writes through capture. The database deadline defaults to 120
seconds and the client aborts after a five-second grace; including the default
five-second drain, a timeout path clears maintenance within 130 seconds and
publishes nothing. The configured drain remains only a best-effort reduction of
in-flight work. After
file matching and while that gate remains enabled, the service commits its only
production write: a bounded update of the singleton
`public.backup_recovery_wal_fence` row that increments `generation` and records
`fenced_at`. The post-commit query may conservatively observe a later WAL segment
under concurrency. The service therefore treats `wal_fence_file` as an
at-or-after archive upper bound, releases the gate, and waits fail-closed for
`pg_stat_archiver` to reach that bound on the same timeline before streaming or
publication. This makes the earlier
target LSN reachable on an idle database. A mutation that commits after the
snapshot is outside the PITR target. Its file, even if visible during the
subsequent filesystem walk, is reported as an orphan and excluded rather than
being attached to the earlier database recovery point.

See [backup/README.md](../backup/README.md) for the full backup service
configuration, environment variables, and Docker Compose usage.

### Concurrent backup runs

Scheduled and on-demand calls share a non-blocking execution `flock` at
`/backups/.hriv-backup-run.lock`. If another backup holds it, the new call is
rejected and logged without disturbing the active run's publication state, and performs no database inventory,
filesystem read, or archive upload. All supported production scheduled and
on-demand invocations execute in the single backup Deployment and mount the same
`hriv-backup-backups` PVC, which makes this flock shared. Any future Job or
CronJob must mount that same claim or introduce cluster-wide coordination before
it can be a supported invocation path. Restore remains a separate operator
action; do not run a restore against an active source volume while backup
capture is in progress.

State-document coordination is separate from the execution lock. Local JSON
updates use `/backups/.hriv-backup-state.lock`, while Azure markers use ETag
compare-and-set and merge ordering. An overlap rejection appends bounded failed
attempt-history entries without changing the active run's top-level ownership,
current component sections, or last-success fields. The active run preserves
those entries when it completes; overlapping backup execution remains disabled.

Each accepted run gets a collision-resistant
`hriv-backup-<YYYYMMDD-HHMMSS>-<8 hex chars>` identity. Listing and retention
sort by the timestamp in that name, legacy timestamp-only archives remain
restorable, and conditional Azure creation prevents replacement on a genuine
key collision. Restore accepts a full name, a name without `.tar.gz`, or an
unambiguous prefix.

### Archive staging and ephemeral storage

Azure production archives stream through uncommitted block-blob blocks and are
committed only after every inventoried source file remains stable and the tar
stream completes. The complete archive is never staged on `/backups` or
pod-local storage. The archive remains a non-selectable candidate while its embedded manifest,
sidecar, backup state, and last-success marker are established; published blob
metadata is the final selectability operation. A per-snapshot publication
journal makes this sequence recoverable after process death. Reconciliation
first acquires the same execution lock, then finishes a fully established
publication or immediately restores still-owned prior state and removes a
partial journaled publication without overwriting a newer writer. The journal
contains recovery metadata only, never credentials. Unjournaled candidates
older than 24 hours and their exact sidecars are cleaned up without entering
normal retention or changing last-success state.

Filesystem restores stream the archive into a unique staging directory on the
new target data PVC, validate checksums before promotion, and do not consume the
backup PVC in proportion to archive size. A populated target temporarily needs
space for both staged restored bytes and quarantined existing bytes and can
approach twice the source-image usage. Production therefore defaults to a fresh,
empty target PVC sized from the manifest with operational headroom. `BACKUP_STAGING_DIR` remains for
bounded state, development logical dumps, and local-only legacy archives.
Stale bounded workspaces are swept after 24 hours.

## Restore order and decision points

After a failure or data loss, follow this order:

### 1. Restore the database

Restore `pg-core` through CNPG using the recovery-set manifest's
`database_recovery.cluster` and authoritative `database_recovery.target_lsn` as
CNPG `recoveryTarget.targetLSN`. Keep `target_time` for audit only. The manifest's
archived fence WAL proves that the earlier target LSN is reachable even when the
database was otherwise idle. Use explicit source-specific database and owner
values in the recovery manifest, then verify
the recovered database/role inventory before application cutover.

Production source-image archives do not contain `db.sql`. Never run a legacy
combined logical restore after a newer CNPG PITR recovery.

### 2. Restore source images

Provision a new target PVC sized for the manifest's declared source bytes, mount
it in the backup workload, and stream the matching archive in filesystem-only
mode:

```bash
kubectl exec -n hriv deploy/hriv-backup -- \
  python backup.py restore-filesystem [SNAPSHOT_NAME] \
  --data-dir /restore-target
```

Validate all checksums and DB/file mismatch reports before changing the HRIV
source-image claim. Existing target data is quarantined rather than deleted or
used to synthesize database rows.

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

2. **Restore the database** through CNPG to the exact PostgreSQL-snapshot
   `database_recovery.target_lsn` via `recoveryTarget.targetLSN`, using a fresh
   recovery cluster and explicit source database/owner settings. Treat
   `target_time` as audit metadata. The latest recovery set is accepted as a
   canary only after its restored `source_images` row inventory matches the
   manifest's included/missing/orphan outcome.

3. **Restore source images** to a fresh PVC without applying SQL:

   ```bash
   kubectl exec -n hriv deploy/hriv-backup -- \
     python backup.py restore-filesystem [SNAPSHOT_NAME]
   ```

   Verify the recovery manifest, checksums, source count, and DB/file mismatch
   report before cutover. The production archive leaves generated tiles absent.

4. **Disable maintenance mode** after target validation and cutover (the restore
   command clears its flag automatically on exit, but verify):

   ```bash
   curl -X PUT "https://<host>/api/admin/maintenance?enabled=false" \
     -H "Authorization: Bearer $TOKEN"
   ```

5. **Rebuild tiles** (if the tile volume is new or was lost):

   ```bash
   curl -X POST "https://<host>/api/admin/tasks/rebuild-tiles" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"scope": "missing_stale"}'
   ```

   Monitor progress in the Admin UI → Backups tab, or poll the task status
   via the API. Large image sets may take hours; the task is safe to cancel
   and rerun.

6. **Verify** — confirm health, viewer access, and tile-cache status as
   described above.

If you only need to restore a single file from a snapshot, use the Admin UI’s
per-file restore browser instead of a full archive restore. It reads snapshot
manifests through the backend’s read-only Azure SAS path, restores one
`data/` member at a time, and notes that Rebuild Tiles may be run if a
source-image restore leaves tiles stale.

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

| Metric                           | Target      | Notes                                                   |
| -------------------------------- | ----------- | ------------------------------------------------------- |
| Database RPO                     | ≤ 5 minutes | CNPG WAL archiving while healthy                        |
| Source-image RPO                 | ≤ 24 hours  | Daily published source-image recovery set               |
| RTO                              | Measured    | CNPG + source-image restore; tile rebuild may extend it |
| RTO (with Longhorn tile restore) | Measured    | Optional optimization when a compatible snapshot exists |

Actual values must be measured by the production-shaped DR drill tracked in
[#1230](https://github.com/bcit-tlu/hriv/issues/1230) and recorded here.

## Related documentation

- [backup/README.md](../backup/README.md) — backup service configuration and Docker Compose usage
- [deploy/README.md](../deploy/README.md) — Helm chart volume layout and PVC cutover
- [tile-cache-provenance.md](tile-cache-provenance.md) — provenance fields and staleness rules
- [admin-import-export.md](admin-import-export.md) — rebuild-tiles admin task API reference
- [image-processing-lifecycle.md](image-processing-lifecycle.md) — tile generation pipeline
- [backup-restore-runbook.md](backup-restore-runbook.md) — cold-grab operator checklist for health checks and restores
- [per-file-restore-design.md](per-file-restore-design.md) — proposal for manifest-browsed single-file restores
- [RELEASE_AND_DEPLOY_FLOW.md](RELEASE_AND_DEPLOY_FLOW.md) — release and Flux deployment flow
