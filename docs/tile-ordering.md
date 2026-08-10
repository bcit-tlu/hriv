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

### Legacy endpoints (removed)

`PUT /api/categories/reorder` and `PUT /api/images/reorder` existed during
the staged frontend migration (#979–#982) but persisted through separate
transactions and row-by-row updates. As of #982 no frontend caller used
them for ordering — Browse and Manage Categories both persist through the
shared coordinator and `PUT /api/tile-order` — so #998 removed the
endpoints, their request schemas, the `reorderCategories`/`reorderImages`
API wrappers, and the non-coordinator fallback path in `SortableTileGrid`
(the `tileOrdering` prop is now required). `PUT /api/tile-order` is the
only ordering write path.

## Telemetry

The endpoint participates in the reorder observability contract
(`docs/reorder-telemetry.md`): `tile.reorder` spans, `reorder.persisted`
structured logs, and `hriv_reorder_*` metrics with `entity="tile"`.
The correlation ID travels in the request body (`operation_id`); the
`X-Reorder-Operation-Id` header used by the removed legacy endpoints is no
longer sent.

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

Normalization runs as ONE transaction and locks every scope's revision row
until it commits, so concurrent ordering writes (`PUT /api/tile-order`)
block for the duration of the run. This is
intentional — it is an operator-invoked repair tool and a single transaction
guarantees an all-or-nothing repair — but schedule it outside peak editing
hours on large libraries.

## Frontend reorder coordinator (#979)

Browse persists ordering through a navigation-safe coordinator owned above
the grid (`frontend/src/tileOrdering.ts`, bound to React via
`useTileOrdering`). The coordinator is a module-level singleton, so pending
saves and unsaved order survive SPA navigation and grid unmount/remount.

Per scope (root or one parent category) it tracks an explicit state machine:
`idle → dirty → saving → saved`, with `dirty-while-saving` when a drop lands
during an active save, plus `conflict` (409) and `error` (retryable failure).
The grid applies every accepted drag locally and reports the full new order;
it never calls persistence APIs directly and never discards a drop. While a
save is in flight, newer snapshots replace each other (coalescing) and only
the newest is submitted after the active request settles — never one request
per drop.

On success the coordinator stores the returned revision and applies the
authoritative order directly; the app then refreshes shared category/image
data (via `onCommitted`) so other surfaces see the saved order. If newer
local changes accumulated it immediately saves again and does not show "saved". On
failure the newest local intent is retained and retryable. On 409 the
authoritative order from the conflict body is offered to the user ("Order
changed elsewhere" → Refresh); a 400 membership rejection is treated the
same way, with the authoritative order fetched via `GET /api/tile-order`
(membership changes do not bump the revision). A `beforeunload` guard warns when unsaved
order remains. Stale grid instances are fenced by a per-scope generation
counter (`claimGeneration`), so callbacks from an unmounted grid cannot
overwrite a remounted one.

Cached per-scope state is bounded in lifetime: after each authoritative
background refresh, `releaseCleanScopes` drops the cached display order and
revision of every scope with no local intent so order changes made elsewhere
(another client, or another surface) become visible, and `reset` clears all
coordinator state on logout/user switch so cached orders, revisions, and
unsaved-change flags never leak to the next user on a shared browser.

The compact save-state readout is `ReorderStatusIndicator`
(`Unsaved order`, `Saving order…`, `Order saved`, `Order changed elsewhere`,
`Could not save order — Retry`). Coordinator transitions emit the reorder
diagnostic events (`queued`, `coalesced`, `submitted`, `committed`,
`conflicted`, `failed`) from `docs/reorder-telemetry.md`.

## Manage Categories migration (#982)

The Manage Categories dialog shares the same ordering contract as Browse —
there is no second independent ordering implementation:

- A drop in the dialog's tree is decomposed into **parent moves** and
  **per-scope orders** (`diffParentMoves` / `interleavedTileOrders` in
  `manageCategoriesDialogUtils.ts`). Move-vs-reorder stays distinct: parent
  changes persist first through the versioned `PATCH /api/categories/{id}`
  (the same validated move path as Browse, including self/descendant cycle
  rejection), then the full interleaved category+image order of every
  changed scope is reported to the shared `tileOrderingCoordinator`, which
  persists each scope atomically via `PUT /api/tile-order` with CAS
  revisions. Because the parent-move PATCH bumps the tile-order revision of
  both affected scopes server-side, the coordinator's cached revision for
  those scopes is invalidated first (`invalidateRevision`) so the follow-up
  order writes re-seed via GET instead of falsely 409ing against a stale
  token. Entity PATCHes bump revisions only when `parent_id` /
  `category_id` / `sort_order` actually change value — edit dialogs echo
  the current values back on every save, and bumping on presence alone
  would 409 clients whose cached revision is still accurate. When the coordinator already holds a newer (pending/unsaved)
  order for a scope, that order is used as the interleaving template, so a
  category-only reorder never reverts a pending image reorder for the same
  scope; scopes left with no members are skipped.
- The dialog renders sibling order from the coordinator's per-scope display
  orders (`reorderFlatOptions`), so pending/unsaved order is shown
  optimistically instead of snapping back to the last-loaded `sort_order`
  while a save is in flight — the same navigation-safe behaviour as the
  Browse grid.
- The dialog shows the same `ReorderStatusIndicator` save states (unsaved,
  saving, saved, conflict with Refresh / Keep my order, error with Retry)
  for the affected scopes of the most recent dialog reorder; when a
  cross-parent move touches two scopes, the indicator surfaces whichever
  scope most urgently needs attention (conflict/error first).
- Because Browse and Manage write through one contract, ordering is
  consistent across both interfaces after navigation and reload: whichever
  interface wrote last owns the scope revision, and stale writers get an
  explicit 409.
- Atomicity is per scope: a cross-parent move issues one entity PATCH plus
  one `PUT /api/tile-order` per affected scope (source and destination),
  so one scope's write can commit while the other 409s. The conflicted
  scope surfaces its usual Refresh / Keep-my-order recovery; the committed
  scope stays committed.

## Stale-refresh prevention and conflict recovery (#980)

Category-tree and uncategorized-image reads in `useBrowseData` use
latest-request-wins sequencing: every read (foreground or background) claims
a generation, and only the newest read may commit state, so a slow older
response can never overwrite data from a newer one regardless of completion
order. Foreground reads and authoritative refreshes
(`refreshCategories`/`refreshUncategorizedImages`) also abort the previous
read for the same data via `AbortController`; aborted requests are treated
as expected control flow (no error state, no console noise).

Background polling is paused for reads while the tile-ordering coordinator
reports unsaved work: the poll callback in `useBrowseData` returns early
(`useBackgroundRefresh` itself keeps ticking and is coordinator-unaware)
whenever `tileOrderingCoordinator.hasUnsavedChanges()` is true (dirty,
saving, queued, conflicted, or awaiting retry), so a polling response can
never replace a local pending order. Polling resumes automatically on the
next tick once the coordinator is clean.

Conflict recovery is explicit, never last-write-wins: on 409 the indicator
offers both **Refresh** (adopt the server's authoritative order via
`acceptServerOrder`) and **Keep my order** (`reapplyLocalOrder`, which
resubmits the newest local intent against the authoritative revision from
the conflict body). Inside the coordinator, the membership-drift (400)
conflict path re-fetches only the affected scope via `GET /api/tile-order`;
the UI-level **Refresh** action itself reloads the full category tree and
uncategorized images (`handleReorderComplete` in `App.tsx`) so everything the
user sees is consistent after adopting the server's order.

## Tests

`frontend/tests/tileOrdering.test.ts` covers the coordinator state machine
(queueing, coalescing, retry, conflict adoption and reapply, revision
seeding, the 20-rapid-reorder scenario);
`frontend/tests/components/SortableTileGridCoordinator.test.tsx` covers the
grid's coordinator mode; `frontend/tests/useBrowseData.test.ts` covers
latest-request-wins sequencing, abort handling, and polling pause/resume
during pending reorders.

`backend/tests/test_tile_order.py` covers the canonical rule and validation
(unit) plus PostgreSQL integration tests (atomic commit, rollback of both
entity types, 400 validation, 409 conflicts, compare-and-set exclusivity,
membership preservation, bounded statement counts on the 600+ image fixture
gallery, and deterministic normalization). Set
`REORDER_FIXTURE_DATABASE_URL` to a migrated PostgreSQL database to run the
integration layer (CI provides one).
