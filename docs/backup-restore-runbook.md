# HRIV Backup Restore Runbook

Use this when you are under pressure and need the shortest path to a backup
health check or a restore. For the deeper design and tradeoffs, see
[`backup-and-disaster-recovery.md`](backup-and-disaster-recovery.md) and the
normative [`recovery-set-contract.md`](recovery-set-contract.md).

## 1) Is the backup running / healthy?

1. Check the freshness heartbeat:

   ```bash
   kubectl -n hriv exec deploy/hriv-backup -- python backup.py status
   ```

2. List snapshots:

   ```bash
   kubectl -n hriv exec deploy/hriv-backup -- python backup.py list
   ```

3. Find the real Azure location if you need to inspect storage directly:
   - Current `bcit-tlu/flux-fleet` overlays set
     `AZURE_STORAGE_CONTAINER=hrivbackup` and
     `AZURE_BLOB_PREFIX=hriv-backups/${CLUSTER_ENV}` in:
     - `apps/overlays/latest/hriv/backup/values-latest.yaml`
     - `apps/overlays/stable/hriv/backup/values-stable.yaml`
   - If that repo is not to hand, read the values off the running pod instead of
     hardcoding a container name:

     ```bash
     kubectl -n hriv exec deploy/hriv-backup -- \
       sh -c 'echo "$AZURE_STORAGE_CONTAINER $AZURE_BLOB_PREFIX"'
     ```

## 2) Start and monitor an on-demand backup

Use the chart-owned suspended CronJob template. Substitute the Helm release name
used in the namespace; do not unsuspend or edit the template:

```bash
namespace=hriv
cronjob=hriv-backup-on-demand
job="hriv-backup-manual-$(date -u +%Y%m%d%H%M%S)"
kubectl -n "$namespace" create job \
  --from="cronjob/$cronjob" "$job"
echo "$job"
```

`kubectl create job` returns as soon as the server stores the Job. The backup
continues after terminal closure, SSH loss, or operator logout. Save the printed
name, then monitor from any later session:

```bash
kubectl -n "$namespace" get job "$job" -o wide
kubectl -n "$namespace" get pods -l "job-name=$job" -o wide
kubectl -n "$namespace" logs "job/$job" --follow
kubectl -n "$namespace" wait --for=condition=complete --timeout=6h "job/$job"
kubectl -n "$namespace" get job "$job" -o yaml
```

If another scheduled or on-demand backup owns the shared lock, this Job is
expected to fail without retry (`backoffLimit: 0`). Inspect its logs and the
durable `BACKUP_STATE.json` attempt history; the active run's publication and
last-success state remain intact. Jobs have no automatic deletion TTL. Capture
logs, status, backup state, and any incident evidence before manual cleanup:

```bash
kubectl -n "$namespace" delete job "$job"
```

Do **not** run a long backup with
`kubectl exec deploy/... -- python backup.py backup`; that process can die with
the exec connection. The short `list` and `status` commands above, and deliberate
restore commands below, may remain exec-based.

The on-demand pod must share the Deployment's ReadWriteOnce backup PVC, so its
required hostname pod affinity selects the running backup Deployment by app name
and release instance. A stopped or unschedulable Deployment leaves the Job
Pending. Custom affinity, node selectors, and tolerations still apply; confirm
the Deployment pod and candidate node before changing scheduling policy.

## 3) Restore a specific backup from Azure

1. List snapshots and choose the one you want:

   ```bash
   kubectl -n hriv exec deploy/hriv-backup -- python backup.py list
   ```

2. Restore PostgreSQL through CNPG using a fresh recovery cluster with explicit
   source database and owner settings. Set CNPG `recoveryTarget.targetLSN` to the
   snapshot manifest's authoritative `database_recovery.target_lsn`; do **not**
   configure `targetTime` from `target_time`, which is retained only for audit.
   Confirm the manifest also has positive `archive_timeout_seconds`,
   `wal_fence_file`, and `wal_fence_archived_at`. The latter fields prove the
   bounded singleton-table UPDATE's conservative at-or-after WAL upper bound was
   archived; the named segment need not be the exact segment containing the row.

3. Set `restoreTarget.existingClaim` on the backup chart to mount a new
   source-image target PVC at `/restore-target`, then restore only the filesystem
   component:

   ```bash
   kubectl -n hriv exec deploy/hriv-backup -- \
     python backup.py restore-filesystem <SNAPSHOT_NAME> \
     --data-dir /restore-target
   ```

   The restore command toggles maintenance mode automatically. The unqualified
   `restore` command is legacy/development-only and must not be run after a
   newer CNPG recovery because it also attempts `db.sql`. Current production
   archives reject that combined path before invoking `psql`.

   The isolated validation workflow does not use this operator command. Its #1250 child first runs
   `validation-select`, then runs `restore-filesystem-stateless` with the exact selected snapshot,
   recovery-set ID, manifest SHA-256, and a dedicated absent/empty subdirectory on a validation
   PVC. Those commands require only `AZURE_READ_SAS_URL`, emit one bounded JSON document, and cannot
   update backup/restore state or maintenance. The normal backup Deployment is deliberately not
   given that SAS; #1251's fixed child template owns credential mounting. This primitive does not
   provision the child or claim that #1229 is deployed.

   `<SNAPSHOT_NAME>` may be the full archive name
   (`hriv-backup-20260101-020000-9f3c1ab2.tar.gz`), the name without the
   `.tar.gz` suffix, or an unambiguous prefix such as the bare timestamp
   `hriv-backup-20260101-020000`. Old timestamp-only snapshots restore
   unchanged. If a prefix matches more than one snapshot the command fails and
   logs the matches — rerun it with the full name.

4. Rebuild tiles after the files restore:

   ```bash
   curl -X POST "https://<host>/api/admin/tasks/rebuild-tiles" \
     -H "Authorization: Bearer <ADMIN_JWT>" \
     -H "Content-Type: application/json" \
     -d '{"scope":"missing_stale"}'
   ```

   Wait for the task to finish.

5. Verify the system:
   - `kubectl -n hriv exec deploy/hriv-backend -- curl -s http://localhost:8000/api/health`
   - `kubectl -n hriv exec deploy/hriv-backend -- curl -s http://localhost:8000/api/status`
   - Confirm maintenance mode is off.
   - Open the viewer and confirm an image loads.

### Important caveat

A cross-environment restore replaces the `users` table. Your current session
may immediately start returning `401/403` after the restore commits because
your JWT no longer matches the new user row. The restore still completes on the
server; log back in and check Recent Tasks to confirm it finished.

## 4) Tile-rebuild scale rehearsal (opt-in, issue #1189)

This is the documented production-shaped rehearsal that validates the durable
parallel rebuild scheduler before `REBUILD_PARALLEL_ENABLED` is flipped on for
an environment. It is **opt-in and disruptive**: it force-rebuilds every
linked source image and adds a large fixture population. Run it only on
`latest` (or another non-production environment) inside a change window, with
the serial rebuild path verified healthy first.

The fixture is deliberately excluded from recoverable artifacts. Admin JSON
exports omit only images carrying the exact `metadata.rebuild_fixture=true`
marker and their linked sources inside the fixture directory; fixture mutation, admin filesystem export, and
the backup service share an exclusive source-volume lock that closes the
check/inventory race. Exports and backups fail closed before creating an archive
while `source_images/rebuild-fixture/` exists, and blocked backup attempts are
persisted for both components with `failure_reason=rebuild_fixture_active`.
Confirm no
backup is already running before seeding; backup attempts during the rehearsal
will fail with `backup.rebuild_fixture_blocked` and must not be treated as
recovery points.

### Prepare the population

1. Record the real linked-source count — these provide the real libvips
   throughput measurements:

   ```bash
   kubectl -n hriv exec deploy/hriv-backend -- python - <<'PY'
   import asyncio
   from sqlalchemy import func, select
   from app.database import get_async_session
   from app.models import SourceImage
   async def main():
       async with get_async_session()() as s:
           n = await s.scalar(select(func.count()).select_from(SourceImage).where(
               SourceImage.status == "completed", SourceImage.image_id.is_not(None)))
           print("real linked sources:", n)
   asyncio.run(main())
   PY
   ```

2. Top up to the target item count with the deterministic fixture (choose
   `--count` so real + fixture ≥ 3,400; each fixture source is a tiny valid
   TIFF under `source_images/rebuild-fixture/`):

   ```bash
   kubectl -n hriv exec deploy/hriv-backend -- \
     python -m app.rebuild_fixture --count 2900
   ```

3. Verify disk headroom on the tile PVC before starting (each rebuilt source
   materializes a full DZI tree plus the retained prior tree during
   promotion).

### Measure

1. **Serial baseline** — run the serial `POST /api/admin/tasks/rebuild-tiles`
   on a representative subset (`image_ids`) and record images/hour. Full
   serial runs are allowed but expensive; the baseline exists to anchor the
   parallel speedup, not to exhaust the environment.
2. **Parallel candidates** — run `POST /api/jobs/rebuild-tiles` with
   `scope=all` at `REBUILD_PARALLELISM=1`, then `2`, then `4` where worker
   resources permit. Between runs, cancel or let each job reach a terminal
   state before creating the next (only one rebuild may be active).
3. **Fault drills** — during one candidate run each:
   - delete the worker pod mid-run and confirm in-flight items are reclaimed
     after their leases expire and retried by a replacement pod;
   - restart Redis and confirm committed claims resume through
     reconciliation (committed-before-enqueue gaps repump);
   - request `POST /api/jobs/{id}/cancel` mid-run and confirm pending items
     cancel while started children drain;
   - retry failed items through `POST /api/jobs/{id}/retry-failed`.
4. **Correctness invariants** — after every run verify:
   - every `job_items` row is in exactly one terminal state;
   - no duplicated logical rebuilds (each source's `image.dzi` reflects one
     promotion);
   - `hriv_tile_rebuild_queued_items` returns to 0 and
     `hriv_tile_rebuild_active_children` returns to 0;
   - the tile PVC contains no orphaned `.rebuild-*` temp trees.

### Metrics to read

- `histogram_quantile` over `hriv.tile_rebuild.item.duration` → p50/p95/p99
  child duration.
- `rate(hriv.tile_rebuild.items.completed[1h])` → images/hour.
- `hriv.tile_rebuild.item.queue_wait` → scheduler handoff latency.
- `hriv_tile_rebuild_active_children` → effective parallelism.
- `hriv.tile_rebuild.cancellation.latency` → time to drain after cancel.
- `hriv.tile_rebuild.lease.reclaims` → recovery after worker loss.
- Platform dashboards → worker CPU/memory peaks, DB connections, Redis depth.
- `hriv.tile_rebuild.item.timeouts`, `hriv.tile_rebuild.item.retries`,
  `hriv.tile_rebuild.enqueue.failures` → failure/retry accounting.

### Rehearsal record

Append one row per run to the rehearsal log in the change ticket or a
confluence attachment; copy this table:

| Field                        | Value |
| ---------------------------- | ----- |
| Deployment version           |       |
| Environment                  |       |
| Fixture/source count + scope |       |
| Worker CPU/memory limits     |       |
| Database + Redis limits      |       |
| Child timeout                |       |
| Lease / heartbeat            |       |
| Retry backoff                |       |
| Parallelism                  |       |
| Start / end (UTC)            |       |
| Images/hour                  |       |
| Item p50 / p95 / p99         |       |
| Resource peaks               |       |
| Failures / reclaims          |       |
| Cancellation latency         |       |
| Reclaim/recovery time        |       |
| Selected next setting        |       |

### Teardown

```bash
kubectl -n hriv exec deploy/hriv-backend -- \
  python -m app.rebuild_fixture --purge
```

This removes only exact `metadata.rebuild_fixture=true` images, their linked
sources whose stored paths are inside `rebuild-fixture`, and tile/temp/`.old-*`
trees for those exact source IDs. Fixture filesystem work
runs off the CLI event loop so thousands of small files do not block database
or cancellation progress. Trigger or wait for the next scheduled backup after
purge and confirm it succeeds; do not retain or use any failed backup attempt
from the fixture window.
