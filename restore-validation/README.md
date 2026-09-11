# HRIV Restore Validation

`hriv-restore-validation` is the isolated Kubernetes controller for the #1251 core engine and simplified #1253 weekly/operator drill. It selects one fully published recovery set through the fixed backup image, immutably binds its evidence, creates a fresh source PVC and CloudNativePG cluster, validates database fidelity, restores source images, validates consistency, removes exact-owned successful children, and emits bounded final operator JSON.

## Simplified #1253 boundary

A clean core run records terminal `state: SUCCEEDED`, `outcome: succeeded`, and `core_succeeded` evidence after confirmed child absence. Failed children remain as exactly one retained environment until an operator invokes `cleanup-retained`; there is no expiry reaper. The cleanup command accepts no arbitrary run ID, shares the Lease/CAS state, verifies exact state-bound UID/labels/template identity, waits through partial deletion, and removes state only at zero children. #1252 application/viewer validation, credential-init, Redis, tile rebuild, exporter, dashboard, custom metrics, and autonomous Job/child reapers are excluded. The CLI exposes only `run`, `cleanup-retained`, `validate-database`, and `validate-consistency`.

## Fixed recovery authority

The strict versioned source profile fixes:

- source cluster/server `pg-core`, external cluster `pg-core-source`, database/owner `app`/`app`, and application database `hriv`;
- validation-local ObjectStore `hriv-restore-validation-pg-core` and Barman `serverName: pg-core`;
- PostgreSQL 17 digest and storage, expected system identifier, required-subset database/owner and static-role attribute/membership inventories, dynamic Vault-role prefixes, exact Alembic revision, minimum table row counts, and one synthetic `{id,email_sha256}` identity; the selected recovery set's `database_row_count` supplies the non-static expected `source_images` count, and recovered fence generation/time are validated against the selected run's bound capture window;
- controller and backup image digests plus fixed Azure container/prefix.

CNPG recovery uses exact `recoveryTarget.targetLSN` and decimal-string `targetTLI`; `latest`, missing targets, or metadata-controlled images/specifications fail closed. The controller never runs `db.sql` and never calls the Secret API.

Selection and restore Jobs receive `AZURE_READ_SAS_URL` from external Secret `hriv-restore-validation-azure-read`, key `azureReadSasUrl`, and use only `HTTPS_PROXY` for Azure egress. CNPG has the same proxy environment in `spec.env`; controller/database/consistency have none. The restore target is `/restore/data`, below the mounted PVC root. Latest defaults to 40Gi; stable requires 160Gi for the corrected 128,986,771,498-byte source set, and runtime preflight enforces the larger of 1Gi or 5% free margin.

CNPG advances only when `Ready=True`, phase is exactly `Cluster in healthy state`, and `readyInstances == instances == 1`; Ready alone is insufficient. Database and consistency children run this controller image with no API token. Psycopg connects using the fresh CNPG-generated `<cluster>-superuser` Secret mounted into those children. Database checks are read-only and cover system ID, completed recovery/timeline, required database and role subsets, exact migration, minimum counts, selected-set source count, lowercase-email SHA-256 synthetic evidence (never plaintext email), target LSN reachability, and exactly one positive-generation/non-null-time WAL fence row. Recovery proof uses a fixed bounded read-only poll because CNPG readiness can precede the final recovery/TLI/LSN observation. Machine output is one bounded final JSON log line. The Kubernetes adapter accepts success or bounded failure output only from exactly one owned, single-container Pod with the expected zero or nonzero exit status, and the controller preserves only a schema-valid, operation-specific allowlisted emitted failure code.

## Runtime configuration

The orchestrator reads mounted, strict documents:

- `RESTORE_VALIDATION_CONFIG` (`/etc/hriv/config.json`)
- `RESTORE_VALIDATION_PROFILE` (`/etc/hriv/profile.json`)
- `RESTORE_VALIDATION_POLICY` (`/etc/hriv/policy.json`)
- `RESTORE_VALIDATION_TEMPLATES` (`/etc/hriv/templates.yaml`)

The fixed ConfigMap state is schema 1, bounded by configured `state_max_bytes` with a hard ceiling of 512 KiB, and updated with `resourceVersion` CAS. The parser hard ceiling remains two for compatibility, but operational configuration requires exactly one retained ownership record and keeps ten bounded history summaries. The mounted source policy contains only version 1, the reviewed source-state SHA-256, and missing/orphan counts (each at most 256). Selection independently canonicalizes the complete backup-emitted lists, verifies their digest/counts, and immutably records the full selected state plus local profile/policy identities. Consistency recomputes DB/file missing evidence, preserves unsafe/duplicate reasons only after exact row/status/path identity matching, reports restored files absent from the DB as unexpected orphans, and must reproduce the selected missing state and full `source_files_sha256`; selected orphans remain publication evidence that restore excluded them. The Lease holder tuple is `v1|<job-uid>|<run-id>|<acquired>|<renewed>`; both holder timestamps and Lease fields are normalized to exact UTC seconds before every write and checked after API round trips. Cleanup is asynchronous: UID-preconditioned foreground deletes are issued once and reconciliation remains in `CLEANUP` until every bound and run-labelled child is absent. CNPG-added labels are permitted, and controlled CNPG Pod/Service descendants are distinguished by required labels and exact controller owner UID rather than mistaken for spoofed direct children.

## Development

```bash
nix-shell -p poetry python311 --run 'poetry install --with dev'
poetry run python -m unittest discover -s tests -v
poetry run coverage run -m unittest discover -s tests
poetry run coverage report -m
poetry run python scripts/generate_third_party_licenses.py
```

The image runs as UID/GID 65532 with a read-only-root-compatible filesystem. OTEL auto-instrumentation follows repository conventions and exporters default to `none`.
