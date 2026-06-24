# Tile-Cache Provenance and Staleness

Generated DZI tiles are **derived data**: they can always be regenerated from
the authoritative source image. To treat tiles as recoverable — and to support
the production backup/disaster-recovery work in
[#738](https://github.com/bcit-tlu/hriv/issues/738) — each `SourceImage` records
enough provenance to answer one question without inspecting the filesystem:

> Does the tile tree on disk still match the current source file and the current
> tile-generation settings?

This page documents the model, the staleness rules, and the API surface.
Implementation lives in `backend/app/tile_provenance.py`.

## Provenance fields (`source_images`)

Added in migration `0014_add_tile_provenance`. All columns are nullable. The
migration backfills already-`completed` source images (`tiles_generated_at =
updated_at`, `tile_settings_hash` = the v1 settings hash) so their existing,
known-good tiles report as `current` rather than `missing`; `source_checksum`
stays `NULL` for those rows since it can't be recomputed without re-reading the
source files. Rows in any other state are left untouched and evaluate as
`missing` (or `failed`).

| Field                | Type          | Meaning                                                         |
| -------------------- | ------------- | --------------------------------------------------------------- |
| `source_checksum`    | `varchar(64)` | SHA-256 of the source file used to generate the tiles.          |
| `tile_settings_hash` | `varchar(64)` | Fingerprint of the tile-generation settings + pipeline version. |
| `tiles_generated_at` | `timestamptz` | When tiles were last generated for this source.                 |

The existing source-image lifecycle fields are **reused** rather than
duplicated: `status` (`pending`/`processing`/`completed`/`failed`) and
`error_message` already capture processing state and the last error, so no
separate "last tile-generation error" column is added.

## Effective cache status (computed, not stored)

`SourceImage.tile_cache_status` is a **computed property**, not a column. It is
derived at read time from the stored provenance plus the current in-process
settings hash, so it can never drift from the live pipeline version. Resolution
order (`evaluate_tile_cache_status`):

1. `failed` — processing failed, or tiles were never generated while the source
   is in a terminal `failed` state.
2. `missing` — tiles have never been generated (`tiles_generated_at is NULL`).
3. `stale` — tiles exist but were generated under a different
   `tile_settings_hash` than the current pipeline.
4. `current` — tiles exist and match the current pipeline settings.

This distinguishes **missing** tiles (never built, or wiped by a restore that
omitted the tile volume) from **stale** tiles (built under an older pipeline).

## When does a tile set become stale?

- **Source-image replacement** — replacement creates a _new_ `SourceImage`,
  processed fresh; its provenance is recorded at generation time, so the new
  tile tree is `current` while the old source's tiles are removed.
- **Tile-generation setting changes** — the DZI parameters (`tile_size`,
  `overlap`, JPEG suffix/quality) are centralised in `tile_provenance.py` and
  feed the settings hash. Changing any of them changes the hash.
- **Format/version changes** — bump `TILE_GENERATION_VERSION` whenever a change
  makes previously generated tiles incompatible. Every existing tile set then
  evaluates as `stale` automatically, keeping restore/rebuild state unambiguous.

## API exposure

`SourceImageOut` includes `source_checksum`, `tile_settings_hash`,
`tiles_generated_at`, and the computed `tile_cache_status`. These are returned by
the source-image endpoints (`GET /api/source-images`,
`GET /api/source-images/{id}`) and the replace endpoint, so an operator or admin
UI can evaluate currentness without manual filesystem inspection.

## Backup / restore relevance

`source_checksum` lets the rebuild operation verify that a regenerated tile tree
came from the same source bytes.

## Rebuild operation ([#735](https://github.com/bcit-tlu/hriv/issues/735))

Because tiles are derived data, missing or stale tile trees are regenerated from
the preserved source images by the `rebuild_tiles` admin task
(`POST /admin/tasks/rebuild-tiles`). See
[Admin import / export & task lifecycle](admin-import-export.md#rebuild-tiles)
for scopes, the API, and lifecycle.

One important nuance: a DB-only restore (database back, tile volume gone) leaves
the stored provenance intact, so `tile_cache_status` can still report `current`
even though the tile files are missing. The computed property cannot see the
filesystem. The rebuild operation therefore checks the on-disk `image.dzi`
manifest directly (`processing.tiles_present_on_disk`) when selecting `missing`
targets, rather than trusting provenance alone — provenance answers "were these
tiles built under the current pipeline?", while disk presence answers "do the
tile files still exist?".

## Related

- `backend/app/tile_provenance.py` — settings hash, checksum, status evaluation.
- `backend/app/processing.py` — records provenance on upload and replacement.
- [`docs/image-processing-lifecycle.md`](image-processing-lifecycle.md) — full
  upload/processing flow.
- [`docs/domain-model.md`](domain-model.md) — `SourceImage` schema.
