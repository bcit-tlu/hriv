# Atomic, revisioned tile ordering

Browse and Manage Categories present one combined visual order of child
categories and images per scope (the root, or a single parent category).
Issue #978 (epic #975) introduced a single atomic, revisioned ordering
contract so a reorder can never partially persist and stale writers get an
explicit conflict.

## Data model

- `tile_order_revisions` (`backend/app/models.py::TileOrderRevision`,
  migration `0018_tile_order_revisions`): one row per scope.
  - `scope_key`: the parent category ID, or `0` for the root scope
    (category IDs are serial and start at 1).
  - `revision`: monotonically increasing ordering revision, starting at 1.
    Rows are created lazily on the first write (or by normalization).
- `categories.sort_order` / `images.sort_order` keep holding positions;
  after a tile-order write they are contiguous (`0..n-1`) across the
  combined scope.

## Canonical ordering rule

Reads, writes, and normalization all share one deterministic tie-breaker
(`backend/app/tile_order.py::canonical_sort_key`):

```text
sort_order, item_type_priority (category=0, image=1), item_id
```

Labels and file names are never used as persistence tie-breakers.

## API

Both endpoints require the `instructor` role (or `admin`).

### `GET /api/tile-order?parent_category_id=<id|omitted>`

Returns the scope's authoritative order and current revision (revision `1`
if the scope has never been written). `sort_order` in responses is always
the contiguous canonical position (`0..n-1`), even if the stored values
still contain duplicates or gaps from before normalization:

```json
{
  "scope": { "parent_category_id": 123 },
  "revision": 17,
  "items": [
    { "type": "category", "id": 41, "sort_order": 0 },
    { "type": "image", "id": 901, "sort_order": 1 }
  ]
}
```

### `PUT /api/tile-order`

```json
{
  "scope": { "parent_category_id": 123 },
  "expected_revision": 17,
  "operation_id": "uuid",
  "items": [
    { "type": "category", "id": 41 },
    { "type": "image", "id": 901 },
    { "type": "image", "id": 902 }
  ]
}
```

For the root scope, `parent_category_id` is `null`. The response has the
same shape as `GET`, with the incremented revision and the authoritative
positions.

Within **one database transaction** the endpoint:

1. locks the scope's revision row (`INSERT … ON CONFLICT DO NOTHING` +
   `SELECT … FOR UPDATE`), serializing concurrent writers per scope;
2. loads the scope's member IDs with two set-based queries;
3. rejects duplicated, foreign-scope, or missing IDs (HTTP 400) — the
   submitted items must be exactly the scope's members. A 400 can also mean
   scope membership changed underneath the client (a tile was moved in or
   out); membership changes do not bump the revision, so clients should
   treat 400 like 409 and refresh via `GET /api/tile-order`;
4. compares `expected_revision` with the current revision and returns
   HTTP 409 with the current revision and authoritative order for stale
   requests;
5. rewrites positions with **one set-based `UPDATE … FROM (VALUES …)` per
   entity type** (statement count is constant regardless of item count);
6. increments the scope revision and commits.

Any failure rolls back both entity types — partial persistence is
impossible. Two writers holding the same revision can never both succeed.

Reordering never rewrites membership: `parent_id` / `category_id` are
untouched. Moving a tile into another category stays on the existing
category/image endpoints, preserving the projected-index drop behaviour
from PR #631 (this contract changes persistence only).

### Legacy endpoints

`PUT /api/categories/reorder` and `PUT /api/images/reorder` remain during
the staged frontend migration (#979–#982) but are **deprecated for
ordering**: they persist through separate transactions and row-by-row
updates. They DO bump the tile-order revision of every scope they touch
(`bump_scopes`), so a tile-order client holding a pre-reorder revision
gets a 409 instead of silently overwriting a legacy write while both
paths coexist. The legacy endpoints take the revision locks BEFORE
mutating category/image rows — the same revision-then-rows lock order as
`PUT /api/tile-order` — so concurrent same-scope writes across both paths
serialize instead of deadlocking. Remove them once Browse and Manage Categories use `PUT
/api/tile-order` exclusively (#982).

## Telemetry

The endpoint participates in the reorder observability contract
(`docs/reorder-telemetry.md`): `tile.reorder` spans, `reorder.persisted`
structured logs, and `hriv_reorder_*` metrics with `entity="tile"`.
`X-Reorder-Operation-Id` is superseded by the request-body `operation_id`
for this endpoint.

## Ordering normalization

An administrative repair routine walks every root/category scope, resolves
duplicate positions with the canonical tie-breaker, rewrites positions into
a contiguous sequence, and initializes each scope's revision row:

```bash
cd backend
DATABASE_URL=postgresql+asyncpg://hriv:hriv@localhost:5432/hriv \
  poetry run python -m app.tile_order
```

Normalization is deterministic: running it twice yields the same order.

## Tests

`backend/tests/test_tile_order.py` covers the canonical rule and validation
(unit) plus PostgreSQL integration tests (atomic commit, rollback of both
entity types, 400 validation, 409 conflicts, compare-and-set exclusivity,
membership preservation, bounded statement counts on the 600+ image fixture
gallery, and deterministic normalization). Set
`REORDER_FIXTURE_DATABASE_URL` to a migrated PostgreSQL database to run the
integration layer (CI provides one).
