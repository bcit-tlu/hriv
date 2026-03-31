# Corgi Disaster Recovery Backup Service

Standalone service that snapshots the Corgi PostgreSQL database and image filesystem on a configurable cron schedule, stores archives in Azure Blob Storage, and supports full restore after a fresh redeployment.

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
docker compose --profile backup run --rm backup restore corgi-backup-20260101-020000
```

## What's in a Snapshot

Each snapshot is a `.tar.gz` archive containing:

| File | Description |
|---|---|
| `db.sql` | Full PostgreSQL dump (`pg_dump --no-owner --no-acl`) |
| `data/` | Complete copy of the image filesystem (source images + DZI tiles) |
| `manifest.json` | Metadata: timestamp, file listing with SHA-256 checksums |

## Configuration

All settings are controlled via environment variables in `docker-compose.yml`:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://corgi:corgi@db:5432/corgi` | PostgreSQL connection string |
| `DATA_DIR` | `/data` | Path to the image data volume |
| `BACKUP_CRON_SCHEDULE` | `0 2 * * *` | Cron expression for scheduled backups |
| `BACKUP_RETENTION_COUNT` | `30` | Number of snapshots to keep (older ones are deleted) |
| `AZURE_STORAGE_CONNECTION_STRING` | *(empty)* | Azure Blob Storage connection string |
| `AZURE_STORAGE_CONTAINER` | *(empty)* | Azure Blob Storage container name |
| `AZURE_BLOB_PREFIX` | `corgi-backups` | Blob name prefix (folder) inside the container |

### Local-Only Mode

If no Azure credentials are provided, snapshots are saved to the `backup_data` volume (`/backups` inside the container). This is useful for development or when using a separate volume backup strategy.

### Cloud Storage (Azure Blob Storage)

Uncomment and configure the Azure variables in `docker-compose.yml` to enable off-site storage. You will need:

1. An Azure Storage Account
2. A Blob container within that account
3. A connection string (found in the Azure Portal under Storage Account → Access keys)

## Full Disaster Recovery Procedure

After a fresh redeployment (new server, new Docker volumes):

```bash
# 1. Start the database
docker compose up -d db

# 2. Wait for it to be healthy
docker compose exec db pg_isready -U corgi

# 3. Restore the latest snapshot (database + filesystem)
docker compose --profile backup run --rm backup restore

# 4. Start the rest of the stack
docker compose up -d
```

The restore command will:
1. Download the snapshot from Azure Blob Storage (or use local `/backups` volume)
2. Drop and recreate all database tables from the `pg_dump`
3. Restore all image files (source images and DZI tiles) to the data volume

## Integration with Admin Import/Export

The backup service works alongside the admin page's database import/export feature:

- **Admin Export** (`GET /api/admin/export`): Exports a JSON document with categories, images, users, programs, and announcements. This is useful for quick manual backups of database records.
- **Backup Service**: Creates comprehensive snapshots that include the full `pg_dump` (all tables, sequences, indexes) **and** the image filesystem. This provides a complete point-in-time recovery that the admin export alone cannot achieve.

For maximum safety, the admin export can be used for quick application-level backups, while the backup service handles full disaster recovery including the image filesystem.

## Docker Compose Profile

The backup service uses the `backup` Docker Compose profile, so it does **not** start with a plain `docker compose up`. This keeps the default development workflow unchanged. To include it:

```bash
# Start everything including backup
docker compose --profile backup up -d

# Or run backup commands individually
docker compose --profile backup run --rm backup backup
```
