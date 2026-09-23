# Backup Service

Standalone disaster-recovery backup service: publishes HRIV recovery
archives on a schedule, stores them in Azure Blob Storage, and supports
component-selective restore. Production relies on CloudNativePG backup/WAL
archiving for PostgreSQL while this service streams authoritative source
images; generated DZI tiles are derived data rebuilt from source images.

Commands run from `backup/`:

- Install dependencies: `poetry install --no-root`
- Tests: `poetry run pytest`
- One-shot local backup / list / status / restore: see `README.md`
  (docker-compose `--profile backup` commands).
- License notices: `poetry run python ../scripts/generate_third_party_licenses.py`
  after dependency changes.

Backup inventory shares an exclusive source-volume lock with tile-rebuild
fixture mutation and admin filesystem export — see
[`docs/backup-and-disaster-recovery.md`](../docs/backup-and-disaster-recovery.md)
and [`.agents/skills/testing-backup-service/SKILL.md`](../.agents/skills/testing-backup-service/SKILL.md)
for the full contract.
