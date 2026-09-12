# HRIV recovery-set contract

## Purpose

This contract defines the portable backup and recovery boundary for HRIV. Backup,
restore, validation, retention, and operator tooling must use the same outcomes.
An implementation is incorrect if it publishes a set that violates this contract,
even when individual database or filesystem operations succeeded.

[The isolated restore-validation contract](restore-validation.md) consumes this contract without
changing it: validation selects only the latest fully published set, binds its exact
`database_recovery.target_lsn` before provisioning, and restores to fresh resources in a
separate namespace. Restore-validation success also requires application/viewer checks and
confirmed cleanup; its durable state never writes production recovery-set state.

## Recovery set

A recoverable HRIV set consists of:

- a CloudNativePG recovery point for PostgreSQL;
- an authoritative source-image archive captured at a compatible boundary;
- immutable metadata binding those two components;
- Git and Vault references used to reconstruct deployment configuration and
  secrets.

Generated tiles are derived data. They may be restored from an optional recent
storage snapshot, but they are never required for an authoritative recovery set
and can be rebuilt from source images.

Incomplete uploads, import staging, generated tiles, admin-task scratch, local
backup staging, and maintenance markers are excluded.

## Service objectives

| Objective                   | Initial requirement                                                             |
| --------------------------- | ------------------------------------------------------------------------------- |
| PostgreSQL RPO              | At most five minutes while CNPG WAL archiving is healthy                        |
| Source-image RPO            | At most 24 hours                                                                |
| Recovery window             | 30 days                                                                         |
| Restore-validation interval | At most 14 days                                                                 |
| RTO                         | Measured by the production-shaped drill; never inferred from archive size alone |

A backup candidate does not satisfy the source-image RPO until its archive,
manifest, and success marker are committed and independently readable.

## Capture boundary

Scheduled and on-demand backups use the same capture implementation:

1. Acquire the backup execution lock. Reject an overlapping run.
2. Enable the source-image mutation gate, which blocks new HTTP mutations.
3. Wait for the configured bounded drain as a best-effort reduction of in-flight
   work; the drain is not the consistency boundary.
4. Require PostgreSQL `archive_timeout` to be positive and strictly below the
   configured WAL-fence wait timeout.
5. In one behaviorally read-only transaction, set local lock and statement
   timeouts, then execute `BEGIN; SET LOCAL ...; LOCK ... IN SHARE MODE; COPY ...;
COMMIT;`. Wait out existing source writers, then materialize UTC target time,
   `pg_current_wal_lsn()` capture-boundary LSN, and authoritative `source_images`
   rows from the post-lock snapshot while source writes remain blocked. Do not declare the
   transaction `READ ONLY`, because PostgreSQL may reject the explicit lock. The
   client deadline is five seconds longer than the database timeout and failure
   exits maintenance without matching, fencing, or publication.
6. Inventory finalized filesystem files and match them only to rows visible in
   that database snapshot. A mutation committing after the snapshot is outside
   the PITR target; any resulting file is reported as an orphan and excluded.
7. While the mutation gate remains enabled, commit a bounded update of the
   singleton `public.backup_recovery_wal_fence` row, incrementing `generation`
   and recording `fenced_at`; after commit, bind the resulting WAL boundary LSN
   and its at-or-after WAL file. That post-commit fence LSN is the authoritative
   recovery `target_lsn`. This is the only production write.
8. Release the mutation gate and fail closed while polling until CNPG reports a
   same-timeline archived WAL file lexically at or beyond the fence upper bound.
9. Hash, compress, and upload the inventoried files asynchronously.
10. Detect disappearance or mutation before and after each file read.
11. Commit the archive only after the stream completes.
12. Publish the immutable manifest sidecar and success marker only after all
    validation succeeds.

The mutation gate is only a boundary operation. It must not remain enabled for
the large checksum, compression, or Azure transfer.

## Deterministic consistency outcomes

| Condition                                                                              | Required outcome                                                                                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Database row exists and source file exists with expected identity                      | Include and validate normally.                                                                                                               |
| Database row exists but source file is missing                                         | Emit a durable error, preserve and skip the row, do not delete it, do not synthesize downstream state, and skip tile rebuild until repaired. |
| Source file exists without a database row                                              | Report it as an orphan quarantined by policy and exclude it; leave it in place, create no row, and do not delete it.                         |
| Source file disappears or changes identity, size, or modification time after inventory | Reject the candidate; commit no archive or success marker.                                                                                   |
| File checksum differs from the manifest                                                | Reject backup validation or restore promotion.                                                                                               |
| Manifest/schema/archive version is unsupported                                         | Fail closed before target promotion.                                                                                                         |
| Upload or staging artifact is incomplete                                               | Exclude it from authoritative counts and content.                                                                                            |
| Generated tile is absent or stale                                                      | Preserve authoritative data and report derived rebuild work; do not reject the recovery set.                                                 |

Reconciliation is reporting and validation, not destructive repair. Automated
backup or restore code must never delete database rows, fabricate rows, delete
orphans, or generate replacement source files.

## Recovery-set metadata

A successful manifest is versioned and records at least:

```json
{
  "format_version": 2,
  "recovery_set_id": "<stable identifier>",
  "snapshot_name": "<archive identity>",
  "run_id": "<execution identity>",
  "capture_started_at": "<UTC timestamp>",
  "capture_boundary_at": "<UTC timestamp>",
  "capture_boundary_lsn": "<PostgreSQL LSN>",
  "completed_at": "<UTC timestamp>",
  "backup_mode": "production",
  "database_name": "hriv",
  "database_recovery": {
    "provider": "cloudnative-pg",
    "cluster": "pg-core",
    "target_time": "<UTC timestamp for audit>",
    "target_lsn": "<authoritative PostgreSQL recovery LSN>",
    "archive_timeout_seconds": 300,
    "wal_fence_file": "<24-hex-character WAL archive upper bound>",
    "wal_fence_committed_at": "<UTC timestamp>",
    "wal_fence_archived_at": "<UTC timestamp>",
    "logical_dump_role": "not-included"
  },
  "versions": {
    "hriv": "<version>",
    "backup": "<version>",
    "archive_format": 2
  },
  "source_images": {
    "file_count": 0,
    "total_bytes": 0,
    "files": {
      "data/source_images/<storage-name>": {
        "size": 0,
        "sha256": "<digest>"
      }
    }
  },
  "validation": {
    "missing_sources": [],
    "orphan_sources": [],
    "excluded_incomplete_artifacts": [],
    "accepted": true
  }
}
```

The top-level format-2 `database_name` is the application connection database inventoried at the
snapshot boundary (`hriv` for HRIV). It is not a CNPG bootstrap/recovery database name, database
owner, or restore-validation source profile; those recovery settings are independently controlled
and cross-checked. Existing format-2 manifests already emit `database_name`, so this is a contract
documentation correction and requires no manifest-schema or backup-code change.

Implementations may add fields but cannot change the meaning of existing fields
without a format-version change. These WAL-fence fields are additive-compatible
with format 2. Production capture first verifies that PostgreSQL `archive_timeout`
is positive and strictly less than the configured fence wait timeout, recording
it as `archive_timeout_seconds`. The inventory statement captures `target_time`,
`capture_boundary_lsn`, and rows from one snapshot acquired after the
source-table SHARE lock; `capture_boundary_lsn` precedes the separately
committed singleton-row update fence. The post-commit WAL boundary query
provides the authoritative `database_recovery.target_lsn` and
`wal_fence_file`. Because that query can observe later WAL under concurrent
database activity, `wal_fence_file` is a conservative at-or-after archive upper
bound, not necessarily the segment containing the fence tuple. Publication
safely waits until `pg_stat_archiver` reaches that bound on the same timeline,
making the fence-containing target reachable even on an otherwise idle
database. High-cardinality mismatch details belong in the manifest and
structured logs, not metric labels.

## Candidate state model

```text
requested
  -> boundary_pending
  -> inventory_captured
  -> streaming
  -> validating
  -> committed
  -> published

Any non-terminal state
  -> rejected
  -> failed
  -> cancelled
```

`published` is the only successful terminal state. A committed archive without a
valid sidecar and success marker is not selectable as a recovery set. Rejected,
failed, and cancelled candidates never replace last-success metadata.

## Restore contract

Production restoration is component-selective:

1. Require and validate `manifest.json` before side effects. Historical manifests
   without a format version remain valid only when their `files` map supplies a
   valid size and SHA-256 for every selected member; manifestless archives fail
   closed.
2. Restore PostgreSQL through CNPG with `recoveryTarget.targetLSN` set to the manifest's authoritative `database_recovery.target_lsn`; `target_time` is audit metadata, not the restore target.
3. Restore source images using filesystem-only mode to a fresh empty target PVC
   sized from manifest bytes plus headroom. A populated target may temporarily
   require staged restored bytes plus quarantined existing bytes, approaching
   twice the source-image usage.
4. Validate all archive and per-file checksums before promotion.
5. Report database/file mismatches using the deterministic outcomes above.
6. Quiesce HRIV and cut over only after the new targets pass validation.
7. Rebuild derived tiles with the supported serial operation.
8. Treat the latest recovery set as the acceptance canary: restore CNPG to the
   exact post-commit WAL-fence `target_lsn`, verify its source inventory against the
   manifest, then verify health, authentication, browsing, representative viewer
   behavior, and metadata before disabling maintenance mode.

A filesystem-only restore must never execute `db.sql`. A database-only restore
must never modify source-image or tile paths. Legacy combined archives remain
readable, but combined restore is not the default after CNPG recovery.

## Scheduling and execution

Heavy source-image backup and restore operations run asynchronously. The default
scheduled backup window is 10:00 UTC (02:00 PST / 03:00 PDT), avoiding ambiguous
or nonexistent DST-local times; deployments may choose another explicitly
approved non-peak window. Kubernetes orchestration must
prevent overlapping scheduled and on-demand runs.

A production Kubernetes on-demand backup is a server-side Job instantiated from
a chart-owned suspended CronJob template. The template must never schedule
itself, must use the same runtime configuration and shared execution-lock/state
PVC as the scheduled Deployment, and must not retry lock rejection. Where that
PVC is ReadWriteOnce and mounted by the Deployment, the Job requires same-node
affinity to that Deployment while preserving all operator scheduling
constraints. Job completion/failure status and logs remain retained until an
operator captures evidence and manually deletes the Job; client disconnect is
not a cancellation mechanism.

API request handlers must not perform checksum, compression, archive transfer,
or extraction work on the event loop. Status and failure reasons remain durable
when a Job or pod restarts.

## Retention

Retention applies only to complete published sets. Deleting a set requires its
manifest and archive to be deleted as one logical operation. A failed candidate
never causes the last known-good set to be removed. At least one accepted set
must remain available even when the nominal retention count or window would
otherwise remove it.

## Required validation

Tests and operational drills must cover:

- scheduled and on-demand parity;
- overlap rejection;
- mutation gate release before heavy reads;
- files created after inventory;
- file disappearance and mutation;
- checksum and version mismatch;
- partial Azure block upload;
- missing source and orphan reporting without reconciliation;
- database-only, filesystem-only, and legacy combined restoration;
- CNPG recovery plus filesystem-only restore without SQL overwrite;
- interrupted restore before promotion;
- last-good retention after candidate failure;
- production-shaped restore and serial tile rebuild.

## Deferred optimization

Longhorn CSI snapshots, full-copy clones, and linked clones are optional future
optimizations tracked separately. Baseline correctness, scheduling, backup,
restore, and DR acceptance cannot depend on them.
