# Per-file Restore Design

Proposal only — this document captures the go/no-go shape of a per-file
restore flow without implementing it.

## Why this is feasible

Every snapshot already contains a `manifest.json` with the full file list,
sizes, and SHA-256 checksums. The manifest is cheap to inspect, so an operator
or UI can browse snapshot contents without unpacking the archive first.

That means a restore flow can:

1. Read the snapshot manifest.
2. Let the operator choose one source file.
3. Stream just that one tar member out of the `.tar.gz` archive.

## Sketch of the API and UI

Read-only browse endpoint:

- `GET /api/admin/backups/{snapshot_name}/manifest`

This would return the snapshot metadata plus the manifest file listing so the
Admin UI can search, filter, and inspect contents before taking action.

Restore endpoint sketch:

- `POST /api/admin/backups/{snapshot_name}/files/restore`
- Body includes the manifest path to restore and the destination path.

The Admin UI would present:

1. A snapshot picker.
2. A manifest browser with file sizes and hashes.
3. A confirm dialog before restore.
4. A progress/result panel that shows the restore outcome.

## Cost tradeoff

`.tar.gz` is not random-access. Azure egress is driven by bytes read from the
start of the blob until the requested member is reached. That is acceptable for
HRIV because the database dump and source images sit near the front of the
archive, so a single source-image restore should only read a small fraction of
the blob.

The alternative is storing every source file as its own blob. That would make a
single-file restore O(1), but it would also multiply blob count, list costs, and
operational overhead. At HRIV's scale that looks more expensive than the
benefit.

## Recommendation

Use the manifest to browse first, then stream one member out of the existing
archive when the operator confirms the restore. That is the cost-effective
middle ground for the current system size.
