---
name: testing-backup-service
description: Test the HRIV backup service for database and filesystem backup, local archive retention, S3-compatible storage, full restore, PostgreSQL client compatibility, Docker Compose backup profile behavior, and disaster recovery verification.
---

# Testing the Backup Service

## Overview

The backup service (`backup/`) publishes source-image recovery archives and supports component-selective restore. Production binds each source archive to a CNPG recovery timestamp and never runs `pg_dump`; local development retains the legacy logical database plus filesystem archive.

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
5. Confirm manifest format 2 records the CNPG target time, checksums, counts,
   missing-source rows, and orphan-file reports.
6. Verify a mutation or inventory failure leaves no published archive or success marker.
7. Restore with `restore-filesystem` into a new data target and verify `psql` is
   never invoked. Database/all restore against the production archive must fail
   safely and direct the operator to CNPG.

## Troubleshooting

- If a development logical restore fails with "unrecognized configuration parameter", verify the backup image client matches the local server major version. Production database recovery uses CNPG instead.
- The `hriv_image_data` volume might not be created by Docker Compose if you're only running `db`. Use `docker run --rm -v hriv_image_data:/data alpine ...` to interact with it.
- The backup service uses Docker Compose profiles. Use `--profile backup` to include it.
- If you see "volume already exists but was not created by Docker Compose" warnings, these are harmless.
