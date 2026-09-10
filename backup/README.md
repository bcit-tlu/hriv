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
`hriv-backup-20260101-020000-9f3c1ab2`. Overlapping invocations are rejected by
the shared execution lock; the random suffix still prevents identity collisions
between accepted runs. The fixed-width timestamp prefix keeps lexical ordering
chronological, so `list`, retention, and
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
| `manifest.json` | Versioned recovery-set metadata, CNPG target LSN/time, WAL fence, file inventory, and SHA-256 checksums |

## Production Role

> **See also:** [`docs/backup-and-disaster-recovery.md`](../docs/backup-and-disaster-recovery.md)
> for the full production strategy — data classification, Longhorn policies,
> restore order, and the DR runbook.
>
> **Quick operator checklist:** [`docs/backup-restore-runbook.md`](../docs/backup-restore-runbook.md).
>
> **Automated restore-validation contract:**
> [`docs/restore-validation.md`](../docs/restore-validation.md) defines the future, isolated
> `hriv-restore-validation` component. Issue #1250 implements only its backup-service read-only
> selection and stateless filesystem primitives. Kubernetes orchestration, deployment, and the
> end-to-end validation component remain future work; no Kubernetes API access is added here.

In production deployments, the Python backup service protects authoritative source images. Its supported role is:

- **Database recovery binding:** the manifest records the CNPG cluster, authoritative target LSN, audit target time, and an archived WAL fence; it does not run `pg_dump` or include `db.sql`.
- **Source images:** DB-referenced files under `/data/source_images` are streamed directly to Azure without a complete local archive; missing references and orphan files are reported without reconciliation. After verifying that PostgreSQL `archive_timeout` is positive and below the fence wait timeout, one behaviorally read-only `BEGIN; LOCK TABLE ... IN SHARE MODE; COPY ...; COMMIT;` transaction waits out existing source writers and returns the UTC target time, `pg_current_wal_lsn()` target LSN, and authoritative row inventory from its post-lock snapshot boundary. While maintenance still gates new mutations, the service performs its only production write—a bounded update of the singleton `public.backup_recovery_wal_fence` row that increments its generation and records `fenced_at`—then queries a conservative at-or-after WAL segment upper bound and waits after maintenance for that file to be archived before streaming or publication. Files from mutations committed after the snapshot are outside the target recovery point and are excluded as orphans. The configured drain is best effort, not the consistency boundary.
- **Tiles excluded:** generated DZI tiles under `/data/tiles` are excluded from HRIV backups.
- **Why:** CNPG provides database backup and PITR, while tiles are derived data that can be rebuilt with the `rebuild-tiles` admin task (see [`docs/admin-import-export.md`](../docs/admin-import-export.md)).

Set `BACKUP_MODE=production` to enable this mode. The default is `development`, which preserves the historical behavior of archiving the full `/data` tree including tiles.

The lock and COPY each use `BACKUP_INVENTORY_TIMEOUT_SECONDS`; the `psql` client
has a five-second grace before it is killed. On an inventory timeout, maintenance
is therefore cleared after at most the configured drain plus 125 seconds by
default (130 seconds total), with no file matching, fence, or publication. A
successful inventory remains in maintenance for the subsequent filesystem
matching and fence operations.

### Longhorn protection policy

For Longhorn-backed Kubernetes deployments, protect each volume according to its role:

| Volume                                    | Recommended protection                          | Recovery path                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Database (PostgreSQL PVC)                 | CNPG base backups plus continuous WAL archiving | Restore through CNPG to the recovery-set authoritative target LSN                                                                |
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

| Variable                              | Default                                                   | Description                                                                                |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                        | `postgresql://hriv:hriv@db:5432/hriv`                     | PostgreSQL connection string                                                               |
| `DATA_DIR`                            | `/data`                                                   | Path to the image data volume                                                              |
| `BACKUP_CRON_SCHEDULE`                | `0 10 * * *`                                              | Cron expression for scheduled backups                                                      |
| `BACKUP_TIMEZONE`                     | `UTC`                                                     | IANA timezone used to evaluate the schedule; UTC avoids DST gaps                           |
| `BACKUP_MUTATION_DRAIN_SECONDS`       | `5`                                                       | Brief write-drain interval before the finalized source-image inventory is captured         |
| `BACKUP_INVENTORY_TIMEOUT_SECONDS`    | `120`                                                     | DB lock/COPY deadline; the client aborts five seconds later if PostgreSQL does not return  |
| `BACKUP_WAL_FENCE_TIMEOUT_SECONDS`    | `600`                                                     | Fail-closed archive wait; PostgreSQL `archive_timeout` must be positive and lower          |
| `BACKUP_WAL_FENCE_POLL_SECONDS`       | `5`                                                       | Poll interval while waiting for `pg_stat_archiver` to reach the fence on its timeline      |
| `CNPG_CLUSTER_NAME`                   | `pg-core`                                                 | CNPG cluster bound into production recovery-set metadata                                   |
| `BACKUP_RETENTION_COUNT`              | `30`                                                      | Number of snapshots to keep (older ones are deleted)                                       |
| `BACKUP_STAGING_DIR`                  | `/backups/.staging`                                       | Bounded state/development scratch; Azure production archives bypass full local staging     |
| `BACKUP_STALE_HOURS`                  | `26`                                                      | Freshness threshold for the `status` command before a backup is considered stale           |
| `BACKUP_MODE`                         | `development` (docker-compose), `production` (Helm chart) | `development` = logical DB + full data; `production` = CNPG binding + source images only   |
| `AZURE_STORAGE_CONNECTION_STRING`     | _(empty)_                                                 | Azure Blob Storage connection string used only by backup/publication and operator commands |
| `AZURE_STORAGE_CONTAINER`             | _(empty)_                                                 | Azure Blob Storage container name for write-backed backup/operator commands                |
| `AZURE_READ_SAS_URL`                  | _(empty)_                                                 | HTTPS container SAS for validation commands; permissions must be exactly read and list     |
| `VALIDATION_MIN_SAS_VALIDITY_SECONDS` | `21600`                                                   | Minimum remaining SAS lifetime accepted by validation; finite, positive, and at most 86400 |
| `AZURE_BLOB_PREFIX`                   | `hriv-backups`                                            | Blob name prefix (folder) inside the container                                             |

### Read-only validation primitives

Issue #1250 adds three machine-oriented commands for an isolated validation child:

```bash
python backup.py validation-list
python backup.py validation-select [EXACT_SNAPSHOT]
python backup.py restore-filesystem-stateless EXACT_SNAPSHOT \
  --data-dir /mounted-validation-pvc/fresh-run \
  --expected-recovery-set-id EXACT_RECOVERY_SET_ID \
  --expected-manifest-sha256 LOWERCASE_SHA256
```

Both commands require `AZURE_READ_SAS_URL`. The URL is validated without being logged: it must be
an unexpired HTTPS container URL whose SAS resource is `c`, whose permissions contain only
read/list, and whose remaining lifetime is at least `VALIDATION_MIN_SAS_VALIDITY_SECONDS` (six
hours by default), measured from the later of current time and an optional SAS start. A valid token
below that threshold fails with `READ_SAS_EXPIRING` before Azure reads begin. Only `sv`, `se`, `sr`,
`sp`, and `sig` are required; `st`, `spr`, `sip`, `skoid`, `sktid`, `skt`, `ske`, `sks`, `skv`,
`saoid`, `suoid`, `scid`, and `ses` are allowed when Azure emits them. Unknown fields, account-SAS
`ss`/`srt`, policy/response-override fields, blank or oversized values, and any `spr` other than
exactly `https` fail with `READ_SAS_FIELDS_INVALID` without exposing names or values in output.
#1251's fixed validation-child configuration owns any override: it must choose a finite positive
value no greater than 86400 seconds that covers the maximum source restore time and mint/mount a
SAS whose expiry exceeds that value at child startup. The child must not derive this setting from
recovery metadata. The raw configuration is parsed only inside machine-command validation; invalid
configuration produces one `VALIDATION_CONFIG_INVALID` JSON document for each machine command and
is ignored by unrelated backup/operator commands. `validation-list` boundedly lists at most 1000 exact published
archive candidates from metadata only, newest first; it ignores candidate, unknown, and legacy
metadata and does not download sidecars. The list is discovery output, not recovery-set authority.
`validation-select` follows `LAST_SUCCESS.json` and verifies the coherent `BACKUP_STATE.json`,
but intentionally binds marker identity to each component's `last_success_*` fields rather than
state's top-level/current attempt. A newer pending or failed attempt may own those current fields
without invalidating the previously published marker; the marker's immutable run ID/snapshot plus
last-success timestamps, sizes, and archive keys bind its manifest safely even though state has no
`last_success_run_id`. Marker top-level `created_at` binds canonical manifest `capture_started_at`;
each marker type's separate `created_at` binds only its component's `last_success_started_at`, since
database and filesystem starts are independently timestamped. Selection also verifies published archive metadata, absent publication journal, immutable format-2
manifest sidecar, production component rules, source indexes/checksums/counts, and CNPG LSN/WAL
fence. It never chooses by blob modification time. Each command writes exactly one bounded JSON
result to stdout and exits nonzero with a bounded code/stage on failure. The manifest sidecar is
limited to 16 MiB; public `source_state` missing/orphan lists and the exact excluded-artifact list
are each limited to 256 entries with bounded fields. Machine output deliberately omits the
high-volume manifest file list and all internal handles and credentials.

The stateless restore accepts only a supplied absent or empty safe target, streams only
`data/source_images`, verifies the embedded manifest against the selected sidecar and checks every
file before promoting `source_images`. Production opens and pins the verified target directory by
file descriptor, performs temporary extraction and relative promotion while its process cwd is that
inode, then compares the original absolute path's device/inode before reporting success. A rename,
replacement, disappearance, or symlink race fails `TARGET_CHANGED`; writes and cleanup remain on
the pinned inode and never follow the replacement path. It never restores `db.sql` or tiles and never reads or writes
`RESTORE_STATE.json`, backup publication state, maintenance state, or `/backups` scratch. Existing
`backup`, `list`, `status`, and operator restore behavior remains connection-string backed; when
both credentials exist, validation uses the SAS and publication/writes use the connection string.

The normal backup Deployment intentionally does **not** receive `AZURE_READ_SAS_URL`. The fixed
validation child template in #1251 is responsible for mounting the isolated read credential. These
primitives do not create Kubernetes resources and do not mean #1229 is deployed.

### Kubernetes Azure Secret contract

The Helm chart never creates or embeds Azure credentials. A non-empty
`env.AZURE_STORAGE_CONTAINER` enables Azure-backed mode; `azureSecretName`
(default `azure-storage-credentials`) must then name a pre-existing Kubernetes
Secret with the key `AZURE_STORAGE_CONNECTION_STRING`. Flux deployments with
Vault enabled use the Vault Secrets Operator target name created outside this
chart; standalone Azure installs must precreate the Secret before the Deployment
starts. The default name is retained for compatibility with existing externally
managed Secrets. Do not put a connection string in Helm values: Azure-backed
rendering with an empty `azureSecretName` fails with instructions to provide the
external Secret.

When `env.AZURE_STORAGE_CONTAINER` is empty, the chart uses local-PVC-only mode
and neither requires nor references an Azure Secret. This keeps the backup chart
usable without Azure; frontend/backend-only installs remain independent of the
backup chart.

For upgrade compatibility, a vault-disabled release that already owns the named
Secret is detected with Helm `lookup`. The chart retains that object as a
metadata-only shell with `helm.sh/resource-policy: keep`; it never copies Secret
data into the rendered release. This prevents Helm from pruning an
operator-replaced credential during the transition to external ownership.
Pre-existing Secrets not owned by the release and Vault-managed Secrets are not
adopted. After transferring ownership, remove the Helm ownership annotations;
the keep policy protects the Secret when a later upgrade omits it.

### Kubernetes on-demand backups

The chart installs a suspended `batch/v1` CronJob named
`<chart fullname>-on-demand` (`hriv-backup-on-demand` in the organization
deployment) by default. It is a server-side Job template,
not a second schedule: `suspend: true` is fixed and its default
`onDemandBackup.schedule` is the inert but syntactically valid `0 0 31 2 *`.
The long-running Deployment continues to run `backup.py cron` with
`BACKUP_CRON_SCHEDULE=0 10 * * *` in UTC.

Create a uniquely named one-shot Job and return immediately after the API server
accepts it:

```bash
namespace=hriv
cronjob=hriv-backup-on-demand
job="hriv-backup-manual-$(date -u +%Y%m%d%H%M%S)"
kubectl -n "$namespace" create job \
  --from="cronjob/$cronjob" "$job"
echo "$job"
```

The Job runs independently of the terminal and survives logout or disconnect.
Reconnect and inspect it with:

```bash
kubectl -n "$namespace" get job "$job" -o wide
kubectl -n "$namespace" get pods -l "job-name=$job" -o wide
kubectl -n "$namespace" logs "job/$job" --follow
kubectl -n "$namespace" wait --for=condition=complete --timeout=6h "job/$job"
kubectl -n "$namespace" get job "$job" -o yaml
```

A concurrent scheduled or manual backup is expected to fail immediately on the
shared execution lock. The template uses `backoffLimit: 0`, so Kubernetes does
not retry that rejection; durable `BACKUP_STATE.json` attempt history and the
Job status/logs provide the evidence while the active backup continues. The
chart sets no automatic Job TTL. Capture logs, terminal status, and relevant
state before manually cleaning up with
`kubectl -n "$namespace" delete job "$job"`.

Do **not** use `kubectl exec deploy/... -- python backup.py backup` for a
multi-hour backup: that process is attached to the exec session and a disconnect
can terminate it. Short `list`, `status`, and operator-controlled restore
commands may remain exec-based.

The Job mounts exactly the Deployment's source and backup PVCs, configuration,
Secrets, security settings, resources, and scheduling constraints. Because the
backup PVC is ReadWriteOnce and already mounted by the Deployment, the Job adds
required pod affinity for the Deployment's app-name and release-instance labels
on `kubernetes.io/hostname`. Generated backend/source-PVC affinity is not
repeated on the Job: selecting the already-scheduled Deployment node inherits
that placement transitively and avoids redundant required terms. The Deployment
must be running and schedulable; its node must also satisfy any explicit custom
node affinity, pod affinity/anti-affinity, node selector, and tolerations. Disabling `persistence.backups.enabled` therefore
requires explicitly disabling `onDemandBackup.enabled` as well.

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

Scheduled and on-demand backup calls share a non-blocking `flock` on
`/backups/.hriv-backup-run.lock`. Only one run may inventory or stream data; an
overlapping call returns failure and appends two bounded failed attempt-history entries without changing the active publication's top-level ownership, current component sections, or last-success fields. Supported
production triggers execute in the single backup Deployment with the same
`hriv-backup-backups` PVC. A future Job or CronJob must mount that claim or use
cluster-wide coordination. Marker coordination remains separate and uses read →
merge → write semantics:

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

### Pod security and writable paths

The chart defaults the pod to UID/GID `10001`, requires non-root execution, and
uses `fsGroup: 10001` with `fsGroupChangePolicy: OnRootMismatch` for filesystem
volumes on which the CSI driver applies group ownership. The container drops
every Linux capability, disallows privilege escalation, uses the runtime-default
seccomp profile and a read-only root filesystem, and does not automount a
service-account token. No privileged or root ownership init container is added.

`/tmp` is an explicit `emptyDir` limited to `1Gi`; `HOME` and `TMPDIR` point
there and Python bytecode writes are disabled. Persistent writes remain on the
mounted PVCs: maintenance state under `/data`, locks/staging/state under
`/backups`, and restore output under the configured restore target.

Longhorn's `ReadWriteOnceWithFSType` CSI policy applies `fsGroup` to the RWO
backup and normal restore-target volumes, but not to the RWX source-images
volume. The organization deployment therefore also requires the RWX `/data`
root to permit UID `10001` to create and remove `.maintenance`, while source
files and directories remain readable. Latest and stable were verified with a
root-owned mode-`0777` `/data`, readable mode-`0755` `source_images`, and
mode-`0644` source files. Validate equivalent permissions before other platform
rollouts. Operators can override `podSecurityContext` or
`containerSecurityContext` when platform or PVC evidence requires it, but
should document the failed ownership/security check and use the narrowest
change rather than adding a privileged/root init container.

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
blocks and committed only after every inventoried file is read and validated.
The committed blob stays a candidate until its sidecar and shared state/marker
transaction succeeds; published metadata is the final selectability step. A
per-snapshot journal lets lock-owning startup/list reconciliation finish a
complete interrupted publication or roll back partial still-owned state. No
complete archive is staged on `/backups` or pod-local storage. The backup PVC
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

Azure archives are read sequentially. `manifest.json` is mandatory; historical
unversioned manifests are accepted only when their `files` map has valid size
and SHA-256 metadata for every selected member. Selected source files are
extracted into a unique staging directory on the target data filesystem,
validated against the manifest, and promoted only after validation succeeds. Existing unmatched
target content is quarantined rather than reconciled or deleted. A populated
target can temporarily require staged restored bytes plus quarantined existing
bytes, approaching twice the source-image usage. Production operators should use
a fresh empty target PVC sized from the manifest plus headroom so validation and
rollback do not depend on spare capacity in the active volume.

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
3. Restore `pg-core` through CNPG with `recoveryTarget.targetLSN` set to the manifest's authoritative `database_recovery.target_lsn`; retain `target_time` only for audit.
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
