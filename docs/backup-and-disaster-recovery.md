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
>
> The design contract for recurring production-shaped drills is
> [isolated restore validation](restore-validation.md). It keeps orchestration and Kubernetes
> API access out of the hardened backup Deployment, restores only to fresh resources in a
> dedicated namespace, and gates success on validation plus confirmed cleanup. The design does
> not itself deploy the feature or clear `HRIVRestoreTestFailed`.

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

### Backup chart credentials and pod security

The backup chart does not render Azure credential data or accept a
connection-string value in Helm values. A non-empty
`env.AZURE_STORAGE_CONTAINER` enables Azure-backed mode, where
`azureSecretName` must identify a pre-existing Secret with key
`AZURE_STORAGE_CONNECTION_STRING`. Its default, `azure-storage-credentials`,
preserves existing externally managed installs. Vault-enabled Flux
configuration must arrange for the Vault Secrets Operator to create that target;
a standalone Azure install must precreate it. Leaving the name empty in
Azure-backed mode fails Helm rendering rather than deploying a placeholder
credential. An empty container selects local-PVC-only mode and renders no Azure
Secret reference, so backup-free frontend/backend installs and non-Azure backup
installs remain supported.

A vault-disabled upgrade may encounter a Secret owned by the previous chart,
including one whose original placeholder was replaced by an operator. Helm
`lookup` detects only an object annotated as owned by the same release and keeps
it as a metadata-only resource with `helm.sh/resource-policy: keep`; credential
data is not copied into rendered release manifests. Externally owned and
Vault-managed Secrets are never adopted. Transfer legacy objects to external
ownership by removing their Helm ownership annotations after the first hardened
upgrade; the keep policy prevents pruning when the chart subsequently omits the
resource.

The backup pod runs non-root as UID/GID `10001` by default. Pod security uses
`fsGroup: 10001`, `fsGroupChangePolicy: OnRootMismatch`, and the runtime-default
seccomp profile; container security drops all capabilities, blocks privilege
escalation, and makes the image root filesystem read-only. Service-account
token automounting is disabled. A `1Gi` `emptyDir` mounted at `/tmp` provides the
only pod-local writable path (`HOME` and `TMPDIR` point there), while
`PYTHONDONTWRITEBYTECODE=1` avoids cache writes to the image.

The storage class and CSI driver must provide UID/GID `10001` the required PVC
access. Longhorn's `ReadWriteOnceWithFSType` CSI policy applies `fsGroup` to the
RWO backup and normal restore-target volumes, but not the RWX source-images
volume. The organization deployment therefore separately requires its RWX
`/data` root to permit creation/removal of `.maintenance` and its source tree to
remain readable. Latest and stable currently satisfy this with mode `0777` on
`/data`, mode `0755` on `source_images`, and mode `0644` source files. Validate
all paths against the real storage class before rollout. `podSecurityContext`
and `containerSecurityContext` remain operator-overridable for platforms with
demonstrated ownership or policy incompatibility; record the failed check and
apply the narrowest override. Do not add a privileged or root init container
without evidence that storage permissions cannot satisfy the requirement.

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
filesystem read, or archive upload. The scheduled call runs inside the
long-lived backup Deployment; an operator creates a disconnect-safe on-demand
Job from the chart-owned suspended `<chart fullname>-on-demand` CronJob.
Both pod templates share the same image, environment and Secret references,
source/backup PVCs, security contexts, resources, and scheduling configuration.
The chart rejects on-demand enablement without the backup PVC.

Because that backup PVC is ReadWriteOnce and mounted by the Deployment, the Job
adds required hostname pod affinity selecting the Deployment's
`app.kubernetes.io/name` and `app.kubernetes.io/instance`. This term is appended
to explicit custom affinity without dropping node affinity, pod anti-affinity,
or preferred/required pod affinity. The Job does not repeat generated
backend/source-PVC affinity: selecting the already-scheduled Deployment node
inherits that placement transitively and avoids redundant required terms. The
Deployment must remain running and schedulable on a node satisfying all of
those constraints. The Job's
`backoffLimit: 0` leaves an overlap rejection terminal and inspectable rather
than retrying; no TTL removes completed or failed Jobs automatically. Restore
remains a separate operator action; do not run a restore against an active
source volume while backup capture is in progress.

Create and observe an on-demand backup without attaching its lifetime to the
operator terminal:

```bash
namespace=hriv
cronjob=hriv-backup-on-demand
job="hriv-backup-manual-$(date -u +%Y%m%d%H%M%S)"
kubectl -n "$namespace" create job \
  --from="cronjob/$cronjob" "$job"
kubectl -n "$namespace" get job "$job" -o wide
kubectl -n "$namespace" logs "job/$job" --follow
kubectl -n "$namespace" wait --for=condition=complete --timeout=6h "job/$job"
kubectl -n "$namespace" get job "$job" -o yaml
```

The create request returns immediately after server-side persistence and the Job
survives disconnect. Capture logs, final status, and backup state before manual
`kubectl delete job`; retained Jobs are operational evidence. Never use
`kubectl exec ... backup` for a multi-hour backup, although short list/status and
controlled restore operations may remain exec-based.

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

### Shared source-volume archive lock

Backup inventory, tile-rebuild fixture mutation
(`backend/app/rebuild_fixture.py`), and admin filesystem export serialize on
one exclusive `flock` at `<source_images>/.rebuild-fixture-archive.lock`. The
file lives inside `source_images` because the backend creates that directory
on demand; locking anywhere else would let a first-time fixture seed and a
backup lock different files.

The two sides run as different users on the shared PVC. The backend (and its
worker) own `source_images` (`0755`), while the backup pod runs as UID `10001`
and `fsGroupChangePolicy: OnRootMismatch` only adjusts the volume root, not
backend-created subdirectories. The lock contract therefore is:

- The backend pre-creates the lock file at startup and whenever it takes the
  lock, with mode `0666` (`ensure_archive_lock_file`). Chmod is best-effort so
  a non-owner never fails on it.
- The backup service opens the file read-write when it can, and falls back to a
  read-only open when `source_images` denies creation — `flock` needs only an
  open descriptor. A lock file that is missing _and_ cannot be created raises
  `ArchiveLockUnavailable`; the run never proceeds unlocked.
- Any exception that escapes `run_backup()` before or around
  `_run_backup_inner` is persisted as a failed attempt for both components
  (`failure_reason=archive_lock_unavailable` or `unexpected_error`) before it
  is re-raised. Because the run held the run lock it is an accepted run, so
  the write goes through the normal state merge and advances the current
  `database` / `filesystem` outcomes (which the metrics read) rather than the
  history-only path used for overlap / fixture-blocked rejections. If the run
  had already recorded state of its own, components it finished (a published
  success before local retention cleanup raised, say) stay authoritative while
  any it started but never completed — or never started — are finalized as
  failed rather than left in progress. If every component already had an
  outcome, the exception is appended to the attempt history only, so a
  published run's record never gains a spurious failure reason. Thus
  `HRIVDatabaseBackupFailed` / `HRIVFilesystemBackupFailed` fire on the next
  scrape instead of only `HRIVDatabaseBackupOverdue` ~26h
  later.

On a fresh volume where the backend has never started, the lock cannot be
created by the backup pod and the run fails closed with
`archive_lock_unavailable`; starting the backend once resolves it. Existing
volumes whose lock predates this contract keep working: the backend widens the
mode on its next start.

### Scheduler placement: in-process cron vs `batch/v1` CronJob

The scheduled run currently executes inside the long-lived Deployment
(`backup.py cron`), while operators trigger on-demand runs as Jobs from the
suspended `<fullname>-on-demand` CronJob. Incident #1324 (every scheduled run
crashing at lock acquisition for ~26h with no failure state) prompted an
evaluation of moving the schedule to a real CronJob reusing that Job template.

What a CronJob would add:

- Job-level failure status (`kubectl get jobs`, `kube_job_status_failed`) that
  is visible even when the process dies before writing any state document —
  this alone would have surfaced #1324 within minutes.
- A fresh process per run: no scheduler-loop state, no slow leaks across days
  of uptime, and image rollouts take effect at the next run without a
  Deployment restart.
- `concurrencyPolicy: Forbid` as a second overlap guard alongside the run
  `flock`.

What the Deployment still provides and a CronJob cannot replace on its own:

- RWO PVC pinning: the `/backups` claim is ReadWriteOnce, so the Deployment is
  the node-affinity anchor that every Job (scheduled or on-demand) must
  colocate with. Removing the Deployment would require a different anchor or an
  RWX backup volume.
- The `kubectl exec` operator surface (`list`, `status`, `restore`,
  `restore-filesystem`, `validation-*`) and startup publication/state
  reconciliation.

Decision: keep the Deployment, and do **not** move the schedule in this change.
The fail-closed state persistence above closes the observability gap that made
the incident invisible, at far lower operational risk than re-plumbing the
scheduler. A CronJob-based schedule remains a reasonable follow-up once the
`/backups` anchor question is settled; the recommended shape is a second,
non-suspended CronJob rendered from the same `hriv-backup.podSpec` and
`hriv-backup.onDemandAffinity` helpers, with the Deployment's `cron` arg
replaced by an idle `serve`-style entrypoint that only reconciles state and
hosts the exec surface. Alert on `kube_job_status_failed` for that CronJob in
addition to the state-document alerts.

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

When the deployment has `REBUILD_PARALLEL_ENABLED=true`, the Admin UI's
**Rebuild Tiles** button and `POST /api/jobs/rebuild-tiles` create a durable
parallel rebuild job instead; the Backups tab's **Parallel tile rebuilds**
section then offers per-item inspection, cancellation, and failed-item retry.
The serial endpoint above remains valid in either mode. See
[jobs.md](jobs.md#api) for the durable API surface.

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
