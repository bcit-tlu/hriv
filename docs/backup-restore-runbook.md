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
