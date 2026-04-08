# Testing the Backup Service

## Overview
The backup service (`backup/`) is a standalone Docker service for disaster recovery. It snapshots the PostgreSQL database and filesystem, stores archives locally or in S3-compatible storage, and supports full restore.

## Prerequisites
- Docker and Docker Compose
- The `db` service must be running: `docker compose up -d db`
- Wait for DB readiness: `docker compose exec db pg_isready -U corgi`
- Build the backup image: `docker compose --profile backup build backup`

## Devin Secrets Needed
- None for local-only testing
- For S3 testing: `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (and optionally `S3_ENDPOINT_URL` for non-AWS providers)

## Critical: PostgreSQL Version Compatibility
- The `db` service runs `postgres:16-alpine` (PG 16)
- The backup Dockerfile MUST use `postgresql-client-16` (not 17)
- PG 17's `pg_dump` emits `SET transaction_timeout = 0;` which PG 16 does not recognise, causing restore to fail with: `ERROR: unrecognized configuration parameter 'transaction_timeout'`
- The Dockerfile uses `python:3.13-slim-bookworm` (Debian Bookworm) + PGDG apt repo to pin PG 16 client
- If the server image is ever upgraded to PG 17, the backup Dockerfile should be updated to match

## Running Tests

### Clean Start
```bash
docker compose down -v
docker compose up -d db
# Wait for DB
for i in $(seq 1 15); do docker compose exec db pg_isready -U corgi && break; sleep 2; done
```

### Test 1: Full Backup-Restore Cycle
1. Verify seed data: `docker compose exec db psql -U corgi -c "SELECT count(*) FROM users"` (expect 3)
2. Create test filesystem data:
   ```bash
   docker run --rm -v corgi_image_data:/data alpine sh -c "mkdir -p /data/test_dir && echo 'test-content' > /data/test_dir/sample.txt"
   ```
3. Run backup: `docker compose --profile backup run --rm backup backup`
   - Should show "Database dump complete", "Archive created", "Local backup saved"
4. List snapshots: `docker compose --profile backup run --rm backup list`
   - Should show table with Name, Size, Date, Location columns
5. Verify archive contents:
   ```bash
   docker run --rm -v corgi_backup_data:/backups alpine sh -c "cd /tmp && tar xzf /backups/corgi-backup-*.tar.gz && ls corgi-backup-*/"
   ```
   - Should contain: `db.sql`, `manifest.json`, `data/` directory
   - `manifest.json` should have SHA-256 checksums for all files
6. Simulate disaster:
   ```bash
   docker compose exec db psql -U corgi -c "DELETE FROM users WHERE id = 1"
   docker run --rm -v corgi_image_data:/data alpine rm -rf /data/test_dir
   ```
7. Run restore: `docker compose --profile backup run --rm backup restore`
   - Should show "Database restored successfully", "Filesystem data restored"
8. Verify recovery:
   - `docker compose exec db psql -U corgi -c "SELECT count(*) FROM users"` (expect 3 again)
   - `docker run --rm -v corgi_image_data:/data alpine cat /data/test_dir/sample.txt` (expect original content)

### Test 2: Retention Policy
1. Clear old backups: `docker run --rm -v corgi_backup_data:/backups alpine rm -f /backups/corgi-backup-*.tar.gz`
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

## Troubleshooting
- If restore fails with "unrecognized configuration parameter", check PG client version in the Docker image (`pg_dump --version` inside the container). It must match the server major version.
- The `corgi_image_data` volume might not be created by Docker Compose if you're only running `db`. Use `docker run --rm -v corgi_image_data:/data alpine ...` to interact with it.
- The backup service uses Docker Compose profiles. Use `--profile backup` to include it.
- If you see "volume already exists but was not created by Docker Compose" warnings, these are harmless.
