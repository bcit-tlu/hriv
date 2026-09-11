# HRIV Restore Validation

`hriv-restore-validation` is the isolated Kubernetes controller for issue #1251. It selects one fully published recovery set through the fixed backup image, immutably binds its evidence, creates a fresh source PVC and CloudNativePG cluster, validates database fidelity, restores source images, validates consistency, and removes exact-owned children.

## #1251 boundary

A clean core run records terminal `state: SUCCEEDED`, `outcome: succeeded`, and `core_succeeded` evidence, but deliberately leaves `last_complete_success` unchanged. Full success remains reserved for #1252 application/viewer validation. Retained-run expiry cleanup/controller garbage collection is also deliberately deferred to #1253; this component retains failed resources and does not reap them merely because `expires_at` has passed. #1253 scheduling, failed-child and Job reapers, exporter, telemetry/alerts, approved Azure egress and Flux rollout are absent. The CLI has only `run`, `validate-database`, and `validate-consistency`.

## Fixed recovery authority

The strict versioned source profile fixes:

- source cluster/server `pg-core`, external cluster `pg-core-source`, database/owner `app`/`app`, and application database `hriv`;
- validation-local ObjectStore `hriv-restore-validation-pg-core` and Barman `serverName: pg-core`;
- PostgreSQL 17 digest and storage, expected system identifier, complete database-owner and static-role attribute/membership inventories, dynamic Vault-role prefixes, Alembic revision, table/source-image counts and one synthetic identity; recovered fence generation/time are validated against each selected run's bound capture window, not static profile state;
- controller and backup image digests plus fixed Azure container/prefix.

CNPG recovery uses exact `recoveryTarget.targetLSN` and decimal-string `targetTLI`; `latest`, missing targets, or metadata-controlled images/specifications fail closed. The controller never runs `db.sql` and never calls the Secret API.

Selection and restore Jobs receive `AZURE_READ_SAS_URL` from external Secret `hriv-restore-validation-azure-read`, key `azureReadSasUrl`. The restore target is `/restore/data`, below the mounted PVC root. The default reviewed source PVC request is 40Gi and runtime preflight also requires it to cover selected source bytes.

CNPG advances only when `Ready=True`, phase is exactly `Cluster in healthy state`, and `readyInstances == instances == 1`; Ready alone is insufficient. Database and consistency children run this controller image with no API token. Psycopg connects using the fresh CNPG-generated `<cluster>-superuser` Secret mounted into those children. Database checks are read-only and cover system ID, completed recovery/timeline, the sorted `datallowconn` database inventory (retaining `allow_connections: true` evidence), exact role inventory, migration/count/synthetic evidence, target LSN reachability, and exactly one positive-generation/non-null-time WAL fence row. Recovery proof uses a fixed bounded read-only poll because CNPG readiness can precede the final recovery/TLI/LSN observation. Machine output is one bounded final JSON log line. The Kubernetes adapter accepts success or bounded failure output only from exactly one owned, single-container Pod with the expected zero or nonzero exit status, and the controller preserves only a schema-valid, operation-specific allowlisted emitted failure code.

## Runtime configuration

The orchestrator reads mounted, strict documents:

- `RESTORE_VALIDATION_CONFIG` (`/etc/hriv/config.json`)
- `RESTORE_VALIDATION_PROFILE` (`/etc/hriv/profile.json`)
- `RESTORE_VALIDATION_POLICY` (`/etc/hriv/policy.json`)
- `RESTORE_VALIDATION_TEMPLATES` (`/etc/hriv/templates.yaml`)

The fixed ConfigMap state is schema 1, bounded by configured `state_max_bytes` with a hard ceiling of 512 KiB, and updated with `resourceVersion` CAS. It retains at most two full failed ownership records and ten history summaries. Selection immutably records all bounded machine evidence, exact exclusions, and local profile/policy identities and digests. The Lease holder tuple is `v1|<job-uid>|<run-id>|<acquired>|<renewed>`; both holder timestamps and Lease fields are normalized to exact UTC seconds before every write and checked after API round trips. Cleanup is asynchronous: UID-preconditioned foreground deletes are issued once and reconciliation remains in `CLEANUP` until every bound and run-labelled child is absent. CNPG-added labels are permitted, and controlled CNPG Pod/Service descendants are distinguished by required labels and exact controller owner UID rather than mistaken for spoofed direct children.

## Development

```bash
nix-shell -p poetry python311 --run 'poetry install --with dev'
poetry run python -m unittest discover -s tests -v
poetry run coverage run -m unittest discover -s tests
poetry run coverage report -m
poetry run python scripts/generate_third_party_licenses.py
```

The image runs as UID/GID 65532 with a read-only-root-compatible filesystem. OTEL auto-instrumentation follows repository conventions and exporters default to `none`.
