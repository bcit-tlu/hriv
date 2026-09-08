# HRIV recovery-set contract

## Purpose

This contract defines the portable backup and recovery boundary for HRIV. Backup,
restore, validation, retention, and operator tooling must use the same outcomes.
An implementation is incorrect if it publishes a set that violates this contract,
even when individual database or filesystem operations succeeded.

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
4. In one read-only PostgreSQL snapshot statement, materialize the UTC
   CNPG-recoverable target timestamp and inventory the authoritative
   `source_images` rows. The returned timestamp, not a local process clock, is
   the database boundary.
5. Inventory finalized filesystem files and match them only to rows visible in
   that database snapshot. A mutation committing after the snapshot is outside
   the PITR target; any resulting file is reported as an orphan and excluded.
6. Release the mutation gate.
7. Hash, compress, and upload the inventoried files asynchronously.
8. Detect disappearance or mutation before and after each file read.
9. Commit the archive only after the stream completes.
10. Publish the immutable manifest sidecar and success marker only after all
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
  "completed_at": "<UTC timestamp>",
  "backup_mode": "production",
  "database_recovery": {
    "provider": "cloudnative-pg",
    "cluster": "pg-core",
    "target_time": "<UTC timestamp>",
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

Implementations may add fields but cannot change the meaning of existing fields
without a format-version change. High-cardinality mismatch details belong in
the manifest and structured logs, not metric labels.

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
2. Restore PostgreSQL through CNPG to the bound recovery point.
3. Restore source images using filesystem-only mode to a new target PVC.
4. Validate all archive and per-file checksums before promotion.
5. Report database/file mismatches using the deterministic outcomes above.
6. Quiesce HRIV and cut over only after the new targets pass validation.
7. Rebuild derived tiles with the supported serial operation.
8. Verify health, authentication, browsing, representative viewer behavior, and
   metadata before disabling maintenance mode.

A filesystem-only restore must never execute `db.sql`. A database-only restore
must never modify source-image or tile paths. Legacy combined archives remain
readable, but combined restore is not the default after CNPG recovery.

## Scheduling and execution

Heavy source-image backup and restore operations run asynchronously. The default
scheduled backup window is 10:00 UTC (02:00 PST / 03:00 PDT), avoiding ambiguous
or nonexistent DST-local times; deployments may choose another explicitly
approved non-peak window. Kubernetes orchestration must
prevent overlapping scheduled and on-demand runs.

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
