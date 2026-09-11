---
name: testing-backup-service
description: Test the HRIV backup service for database and filesystem backup, local archive retention, S3-compatible storage, full restore, PostgreSQL client compatibility, Docker Compose backup profile behavior, and disaster recovery verification.
---

# Testing the Backup Service

## Overview

The backup service (`backup/`) publishes source-image recovery archives and supports component-selective restore. Production binds each source archive to an authoritative CNPG target LSN, commits a narrow WAL fence, waits for that fence to archive, and never runs `pg_dump`; local development retains the legacy logical database plus filesystem archive.

For work on scheduled production-shaped restore testing, read
[`../../../docs/restore-validation.md`](../../../docs/restore-validation.md). That contract
requires a separate component/namespace, read-only source access, fresh CNPG/PVC targets, exact
LSN recovery, no-token child workloads, durable ConfigMap/Lease coordination, application and
viewer checks, and cleanup before success. Do not add Kubernetes API access to `backup/` or
interpret the design document as a deployed restore test.

## Prerequisites

- Docker and Docker Compose
- The `db` service must be running: `docker compose up -d db`
- Wait for DB readiness: `docker compose exec db pg_isready -U hriv`
- Build the backup image: `docker compose --profile backup build backup`

## Devin Secrets Needed

- None for local-only testing
- For Azure integration testing: an isolated `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER`; never use production credentials in local tests

## Critical: PostgreSQL Version Compatibility

- The local `db` service runs `postgres:16-alpine`, and development combined archives use the image's matching PostgreSQL 16 `pg_dump`/`psql` tools.
- Production CNPG currently runs PostgreSQL 17, but production backup mode must not invoke `pg_dump`; CNPG base backups and WAL archiving are authoritative.
- Never change the local client version merely to make production source-image backups work. If local development PostgreSQL changes major version, update the client and logical-restore tests together.

## Running Tests

### Clean Start

```bash
docker compose down -v
docker compose up -d db
# Wait for DB
for i in $(seq 1 15); do docker compose exec db pg_isready -U hriv && break; sleep 2; done
```

### Test 1: Full Backup-Restore Cycle

1. Verify seed data: `docker compose exec db psql -U hriv -c "SELECT count(*) FROM users"` (expect 3)
2. Create test filesystem data:
   ```bash
   docker run --rm -v hriv_image_data:/data alpine sh -c "mkdir -p /data/test_dir && echo 'test-content' > /data/test_dir/sample.txt"
   ```
3. Run backup: `docker compose --profile backup run --rm backup backup`
   - Should show "Database dump complete", "Archive created", "Local backup saved"
4. List snapshots: `docker compose --profile backup run --rm backup list`
   - Should show table with Name, Size, Date, Location columns
5. Verify archive contents:
   ```bash
   docker run --rm -v hriv_backup_data:/backups alpine sh -c "cd /tmp && tar xzf /backups/hriv-backup-*.tar.gz && ls hriv-backup-*/"
   ```
   - Should contain: `db.sql`, `manifest.json`, `data/` directory
   - `manifest.json` should have SHA-256 checksums for all files
6. Simulate disaster:
   ```bash
   docker compose exec db psql -U hriv -c "DELETE FROM users WHERE id = 1"
   docker run --rm -v hriv_image_data:/data alpine rm -rf /data/test_dir
   ```
7. Run restore: `docker compose --profile backup run --rm backup restore`
   - Should show "Database restored successfully", "Filesystem data restored"
8. Verify recovery:
   - `docker compose exec db psql -U hriv -c "SELECT count(*) FROM users"` (expect 3 again)
   - `docker run --rm -v hriv_image_data:/data alpine cat /data/test_dir/sample.txt` (expect original content)

### Test 2: Retention Policy

1. Clear old backups: `docker run --rm -v hriv_backup_data:/backups alpine rm -f /backups/hriv-backup-*.tar.gz`
2. Run 3 backups with retention=2:
   ```bash
   docker compose --profile backup run --rm -e BACKUP_RETENTION_COUNT=2 backup backup
   sleep 2
   docker compose --profile backup run --rm -e BACKUP_RETENTION_COUNT=2 backup backup
   sleep 2
   docker compose --profile backup run --rm -e BACKUP_RETENTION_COUNT=2 backup backup
   ```
3. Third backup should log: "Local retention policy: keeping 2, deleting 1 old snapshot(s)"
4. List should show exactly 2 snapshots
   - Retention and `list` order by the `YYYYMMDD-HHMMSS` stamp in the snapshot
     name (full name as tie-break), not by file mtime, so a `touch`ed old
     archive is still the one deleted.

### Test 3: Concurrent Backups (same second)

1. Clear old backups: `docker run --rm -v hriv_backup_data:/backups alpine rm -f /backups/hriv-backup-*.tar.gz`
2. Start two backups at once:
   ```bash
   docker compose --profile backup run --rm backup backup &
   docker compose --profile backup run --rm backup backup &
   wait
   ```
3. Exactly one run should acquire the shared backup lock and complete. The other
   must fail with `overlapping_backup_run` without creating an archive.
4. The successful run produces one
   `hriv-backup-<YYYYMMDD-HHMMSS>-<8 hex>.tar.gz` archive and manifest sidecar.
5. `/backups/.staging` should be empty after the successful local run.

### Test 4: Production recovery archive

Use fake or isolated Azure storage and a representative source-image inventory.

1. Set `BACKUP_MODE=production`, `CNPG_CLUSTER_NAME=pg-core`, and Azure settings.
2. Run `backup` and confirm no `pg_dump` command executes.
3. Confirm the backup PVC does not contain a full `.tar.gz` staging artifact.
4. Inspect the archive and sidecar: only DB-referenced source images are present;
   `db.sql`, tiles, incomplete uploads, and orphan files are absent.
5. Confirm manifest format 2 records one snapshot's UTC target time and target
   LSN, `archive_timeout_seconds`, the fence WAL/commit/archive timestamps,
   checksums, counts, missing-source rows, and orphan-file reports.
6. Verify archive-timeout query → `BEGIN` → local lock/statement deadlines →
   source-table SHARE lock → inventory `COPY` → `COMMIT` → filesystem matching →
   committed singleton-row UPDATE fence occurs in order while maintenance exists. Archive polling follows maintenance;
   `.partial` segments normalize, while NULL, history, backup, and prior-timeline
   statuses keep polling. A timeout or subprocess failure must leave no archive,
   sidecar, journal, or new success marker and preserve prior last-success values.
7. Configure test polling with positive `BACKUP_WAL_FENCE_TIMEOUT_SECONDS` and
   `BACKUP_WAL_FENCE_POLL_SECONDS`; verify invalid, zero, and poll-greater-than-timeout
   values fail startup. PostgreSQL `archive_timeout` must also be positive and
   strictly lower than the configured fence timeout. Validate finite positive
   `BACKUP_INVENTORY_TIMEOUT_SECONDS` values and confirm database/client inventory
   timeouts clear maintenance, publish nothing, and preserve prior success.
8. Restore with `restore-filesystem` into a new data target and verify `psql` is
   never invoked. Database/all restore against the production archive must fail
   safely and direct the operator to CNPG.

### Test 5: Kubernetes on-demand Job template

1. Run `bash scripts/test-helm-chart-regressions.sh`. It verifies that the chart
   renders a suspended `<fullname>-on-demand` CronJob with an inert schedule,
   one-shot `backup` args, no retries/TTL, a bounded deadline, and parity with
   the Deployment's image, env/Secrets, PVCs, security, resources, and scheduling.
2. Render with custom node affinity, pod anti-affinity, preferred and required
   pod affinity, node selector, and tolerations. Confirm all custom terms remain
   and the Job appends required `kubernetes.io/hostname` affinity for the backup
   Deployment's app-name and release-instance labels without duplicate YAML keys.
3. Confirm local-only mode has no Azure credential env, while external-Secret and
   Vault-target modes reference the configured Secret name/key and never render
   credential values.
4. Confirm `persistence.backups.enabled=false` fails while on-demand remains
   enabled, and succeeds only when `onDemandBackup.enabled=false` is explicit.
5. In a disposable acceptance namespace, create (do not exec) a timestamped Job:

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

   The create command returns after server-side Job creation; disconnect and
   reconnect once to prove the run survives the client. Keep the Job until logs,
   terminal status, state markers, archive/sidecar, and freshness are recorded.

6. Start a second Job while the first holds the lock. It must fail once with
   `overlapping_backup_run` and no retry, while durable attempt history records
   the rejection without changing the active publication or last-success fields.
7. Verify the Job pod is on the Deployment node (required for the shared RWO
   backup PVC). A missing/unschedulable Deployment should leave it Pending rather
   than moving the RWO mount to another node.
8. Delete Jobs manually only after evidence capture. Never validate a multi-hour
   run with `kubectl exec ... backup`; exec disconnect can terminate that process.
   Short list/status and controlled restore commands may remain exec-based.

### Test 6: Read-only stateless validation primitives

No live Azure account is required for unit coverage; fake container/blob clients must expose only
head/download/get/list/exists-style reads and tests must fail if upload, delete, metadata, block
commit, publication reconciliation, local backup state, restore state, maintenance, or database
restore is reached.

```bash
cd backup
poetry run python -m unittest tests.test_backup
poetry run python -m py_compile backup.py tests/test_backup.py
```

Cover SAS acceptance and fail-closed cases (missing, malformed, expired, insufficient usable
lifetime measured from the later of now/start, future start, wrong resource, missing read/list, and
extra write/delete permissions) without asserting or logging the secret URL. Include `sv` in every
valid fixture; cover service and user-delegation shapes, the fixed optional-field allowlist,
unknown/account-SAS/response-override rejection, and exact-HTTPS `spr`. Invalid raw minimum-lifetime
configuration must import successfully, produce one bounded `VALIDATION_CONFIG_INVALID` document
for all machine commands, and remain irrelevant to non-machine commands. Exercise
`validation-list` with read-only fakes: exact published entries sort newest first, candidate/unknown/
legacy entries are ignored, malformed published entries and more than 1000 candidates fail boundedly,
and no sidecar or mutation method is reached. Selection fixtures must bind `LAST_SUCCESS.json`,
`BACKUP_STATE.json`, published
archive properties, absent journal, and exact sidecar bytes; mutate each identity, component,
size/key/count/checksum, format, CNPG, LSN, fence, and timestamp field independently and require a
bounded JSON failure. Prove a marker for successful attempt A still selects A while top-level/current
state records pending or permanently failed attempt B; corrupting any component `last_success_*`
field must fail. Component start/completion timestamps must be ordered and their serialized duration
must match the microsecond-precision delta. Override `CNPG_CLUSTER_NAME` away from the bound source
profile and require `CNPG_METADATA_INVALID`. Read fakes use slots/spec-conforming read-only interfaces and forbid adding or
calling mutation capabilities. Never select by blob mtime or ambiguous prefix. Assert that successful selection and stateless restore both emit canonical UTC `capture_started_at`, uppercase 24-hex `wal_fence_file`, `wal_fence_committed_at`, and `wal_fence_archived_at`, and that the first eight fence hex digits equal `target_timeline`. Failed machine commands must emit exactly `schema_version`, `operation`, `success:false`, and bounded `failure_code` so the #1251 controller can preserve the child code.

The #1251 consistency query must preserve every recovered `source_images` row, including inactive/non-active statuses; status participates in canonical missing-source evidence and is never a row filter.

For stateless restore, use an exact snapshot/recovery-set/digest and an absent or empty temporary
target. Prove source files restore, `db.sql`/tiles do not, and checksum, path/type, embedded-manifest,
version, identity, interruption, and stream errors leave no promoted `source_images`. Unsafe,
production, `/backups`-overlapping, and nonempty targets must fail before archive download. Add a
deterministic rename-plus-symlink race proving extraction/promotion stay on the pinned target inode,
the replacement destination remains untouched, cleanup does not follow the absolute replacement,
and the operation fails `TARGET_CHANGED`. Inject unrelated target entries before pinned yield,
during extraction, and around promotion; no path may report success unless the pinned target ends
with exactly `source_images`. Run the `fchdir` path only as an isolated single-thread test process.
Exercise `main()` for all three machine commands and parse
stdout as exactly one JSON document. The production
backup Deployment must not gain `AZURE_READ_SAS_URL`; #1251's isolated fixed child template mounts
it.

### Test 7: Restore-validation component and chart

Keep restore validation as the separate `restore-validation/` Python release component; do not move orchestration or Kubernetes API permissions into `backup/`. Run:

```bash
cd restore-validation
poetry install --with dev
poetry run python -m unittest discover tests
poetry run python -m compileall -q hriv_restore_validation tests
cd ..
helm lint charts/restore-validation
bash scripts/test-helm-chart-regressions.sh
```

The #1251 chart regression block is the minimum static safety gate. It verifies strict schema-valid reviewed inventories/policies, production-parser acceptance of rendered profile/policy/templates when the component environment is installed, empty retained state coordination objects, no chart-created Secret or unrelated CronJob/exporter/reaper surface, render-blocked invocation, mandatory digest-pinned images, token-free fixed child templates, retained Job evidence with no TTL and zero retries, and namespace-scoped non-wildcard RBAC without Secret verbs or production namespace references. It also binds exact CNPG `recoveryTarget.targetLSN` and decimal `recoveryTarget.targetTLI` (derived from the first eight `wal_fence_file` hex characters), exact source/ObjectStore/server names, fixed `app` database/owner, controller-side restore identity arguments and `/restore/data`, and absence of `db.sql`. Fence generation is dynamic target evidence, never static profile configuration. #1251 renders default-deny only and cannot enable invocation; #1253 owns fixed reviewed Azure/API/DNS/CNPG egress and admission enforcement. Also retain unit coverage for fail-closed strict parsing, bounded state, source selection, and exact recovery binding described in [`../../../docs/restore-validation.md`](../../../docs/restore-validation.md).

## Troubleshooting

- If a development logical restore fails with "unrecognized configuration parameter", verify the backup image client matches the local server major version. Production database recovery uses CNPG instead.
- The `hriv_image_data` volume might not be created by Docker Compose if you're only running `db`. Use `docker run --rm -v hriv_image_data:/data alpine ...` to interact with it.
- The backup service uses Docker Compose profiles. Use `--profile backup` to include it.
- If you see "volume already exists but was not created by Docker Compose" warnings, these are harmless.
