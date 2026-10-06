# Drag-and-Drop Spec (Browse grid tiles)

Single source of truth for the **move/add vs. reorder** behaviour of
category/image/collection tiles on the Browse page
(`frontend/src/components/SortableTileGrid.tsx`). Since #1529, collection
tiles (`col-<id>`) share the same grid: they are drag sources and reorder
participants like image tiles. Since #1530, an editable collection tile also
carries a second near-half zone, `drop-col-<id>` — an **add-member** target
that accepts `img-` sources only. `drop-cat-<id>` remains the only move zone,
and a `col-` source dropped there files the collection into that category
(`onDropCollectionOnCategory`) instead of reordering.

> **Scope.** This contract is Browse-grid-specific. The collection member
> manager (`CollectionManageDialog`, #1566) runs its own `DragDropProvider`
> with plain `useSortable` member tiles plus a trash `useDroppable`
> (`collection-manage-trash`, `cmi-` sources only) — none of the near/far-half
> machinery applies there, though the same sensor policy and the human
> feel-test gate below still do.

Read this before changing any collision detection, drop-zone, or activation
code. The behaviour below thrashed across ~8 PRs because there was no written
contract; treat the rules here as the contract, and change the doc in the same
PR if you intentionally change the behaviour.

> **Library:** This grid uses **`@dnd-kit/react` v2** (`useSortable`,
> `useDroppable`, `DragDropProvider`, and `move()` from `@dnd-kit/helpers`) —
> **not** v1 `@dnd-kit/core` (`SortableContext`). APIs differ; do not mix v1
> examples into this component.

> **Current behaviour: optimistic reflow with a directional far-half guard.**
> Tiles are sortables and reflow live during a drag, but reorder fires only once
> the pointer crosses a tile's centre along the drag direction (the **far
> half**). The **near half** — the side the pointer entered from — is a
> dead-zone where move wins on a category tile ("Move here"), add-member wins
> on an editable collection tile ("Add to collection", #1530), and the drag
> sits still on an image tile. This keeps "move/add always wins inside a tile's
> near half" while leaving tile↔tile reorder reachable (push past the
> neighbour's centre).

## The gestures

There is exactly one source being dragged (a `tile`) and three kinds of drop
target. They must never both act on the same pointer position — the directional
threshold makes them mutually exclusive inside any tile.

| Gesture                       | Trigger zone                                                            | Droppable                                               | Collision detector        | Priority                   | Result                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Move into category**        | Pointer on the **near half** of a category tile (entry side of centre)  | `DroppableCategoryZone`, id `drop-cat-<categoryId>`     | `nearHalfMoveCollision`   | `CollisionPriority.High`   | `onDropImageOnCategory` / `onDropCategoryOnCategory` / `onDropCollectionOnCategory` (`col-` sources, #1529)  |
| **Add to collection** (#1530) | Pointer on the **near half** of an editable (`canEdit`) collection tile | `DroppableCollectionZone`, id `drop-col-<collectionId>` | `nearHalfMoveCollision`   | `CollisionPriority.High`   | `onDropImageOnCollection` — `accept` admits `img-` sources only; dedupe + capacity checks run in the handler |
| **Reorder**                   | Pointer past a tile's **centre** (far half) along the drag axis         | the sibling tile's `useSortable`                        | `farHalfReorderCollision` | `CollisionPriority.Normal` | coordinator `reportOrder` → `PUT /api/tile-order` (via `move()`)                                             |

Every reorder persists through the shared coordinator
(`frontend/src/tileOrdering.ts`), which submits the scope's full order
atomically through `PUT /api/tile-order` with compare-and-set revisions.
Drops that land while a save is in flight are **queued and coalesced** —
never discarded. See `docs/tile-ordering.md` for the save-state lifecycle.
(The legacy non-coordinator grid mode was removed in #998.)

The two detectors share one predicate, `isPastTileCenterAlongDrag`, and are
exact complements inside a tile: for any pointer inside a tile, **exactly one**
fires. Move/add have higher priority, so on the near half of a category or
editable collection tile the zone always wins; reorder can only win once the
pointer crosses the centre.

### Invariants (enforced by unit tests — see `tests/components/SortableTileGrid.test.tsx`)

1. `handleDragEnd` performs a **move** only when the target id starts with
   `drop-cat-` (`DROP_PREFIX`), and an **add-member** dispatch only when it
   starts with `drop-col-` (`DROP_COL_PREFIX`, #1530). The collection zone's
   `accept` filter admits `img-` sources only, and the dispatch guard mirrors
   it — a `cat-`/`col-` drop on `drop-col-*` is a no-op, never a reorder.
2. Any other target is treated as a **reorder**, committed via
   `move(ids, event)` which reads the source's reflowed sortable index, so the
   committed order matches the on-screen preview.
3. Reorder only becomes possible once `farHalfReorderCollision` reports a tile
   (pointer past its centre along the drag axis); the near half and the
   inter-tile gap never produce a reorder target at runtime.
4. Null target and canceled drags are explicit no-ops **unless** the source has
   been optimistically reflowed (`source.index !== source.initialIndex`). After a
   reflow the source tile itself is a valid reorder target, so `farHalfReorderCollision`
   bypasses the far-half check when the droppable is the source, and
   `handleDragEnd` falls back to `target = source` when `operation.target` is
   otherwise missing. `move()` then computes the correct reordered array using the
   source's projected sortable index. True self-drops (no actual movement) are
   still caught downstream by the identity check (`reorderedIds.every((id, i) => id === ids[i])`).

## Live preview

Tiles render through `useSortable`, so the grid reflows continuously during a
drag once the pointer is on a tile's far half — neighbours slide to open the
landing slot and the drop commits exactly the order shown. There is no separate
insertion-bar / seam machinery and no central `previewIndex`: the preview _is_
the optimistic reflow, and it is gated by `farHalfReorderCollision`, so it can
never appear while move owns the pointer (near half of a category tile).

### Direction source

The drag direction comes from the **cumulative** drag delta
(`dragOperation.position.delta` = current − start), not `position.direction`.
dnd-kit's `direction` is recomputed frame-to-frame and flips on the tiniest
jitter; cumulative delta is stable. The dominant axis of the delta selects the
axis to test, so the same rule covers horizontal neighbours and the vertical
neighbours of a wrapped grid. Before any travel (`delta` ≈ 0) nothing is past
centre, so a tile reads as all near-half and the zone gesture (move/add) is the
default.

### Activation

- **Mouse:** `PointerActivationConstraints.Distance(8px)` only. (A previous
  `Delay(200ms)` made grabs feel sticky and was removed.)
- **Touch:** `PointerActivationConstraints.Delay(250ms, tolerance 5)` so taps
  and scrolls aren't hijacked.
- Drags are suppressed when starting on a `.MuiIconButton-root` (tile actions).

## Decision Record

### A1 baseline (fallback) — gap-seam reorder, no optimistic reflow

The locked-baseline alternative still available on PR #550 / branch
`devin/1780419298-reorder-zone-tuning`. Move = full category-tile rect
(`pointerIntersection`, `High`); reorder = explicit 16px gap seams that open with
a dashed slot + insertion bar (`Normal`); a bare tile-id drop is a no-op. It is
move-dominant and intuitive but trades away the optimistic-reflow convenience
(you must aim for a thin gap). Kept as the revert path if the current behaviour
ever needs to be backed out.

### Current — optimistic reflow with a directional far-half guard

**Why not the obvious approaches.** Two earlier attempts failed:

- _"dnd-kit auto-suppresses reflow over category tiles."_ False — the migration
  made every tile a sortable, so the optimistic-sorting plugin reflowed over a
  category tile's body; collision priority only chose the drop _target_, it
  never stopped the reflow. Reorder "won" as the pointer pushed toward a
  category-tile centre.
- _Centered inset move zone._ Shrinking the move droppable to an inset box made
  its measured `droppable.shape` the inset box, so `pointerIntersection` never
  fired over the outer lane and **"Move here" stopped appearing at all**.

**The guard.** Split move vs reorder by **drag direction relative to each tile's
centre**, via two complementary collision detectors in `sortableTileGridUtils.ts`
keyed on `isPastTileCenterAlongDrag(pointer, center, delta)`:

- `farHalfReorderCollision` (passed to every tile's `useSortable`): returns a
  `Normal` collision only when the pointer is **inside** a tile **and** past its
  centre on the side opposite the entry edge. On the near half it returns
  `null`, so the plugin has nothing to reflow against. The **source tile is an
  exception**: after `OptimisticSortingPlugin` reflows the source to a new slot,
  the pointer can land on its near half while `delta` is still anchored to the
  original drag start. The far-half rule would then reject the source and clear
  `operation.target`, so the source always collides while the pointer is inside
  it, regardless of which half the pointer is on.
- `nearHalfMoveCollision` (passed to the full-rect `useDroppable` inside the
  shared `TileDropZone` — `DroppableCategoryZone` "Move here" and
  `DroppableCollectionZone` "Add to collection", `High` priority): the exact
  complement — collides only on the near half, so the zone owns the entry side
  of a tile. The source category's own move zone is explicitly excluded,
  because a category tile is both a sortable and a move-zone droppable and the
  two detectors would otherwise overlap on the dragged tile. The collection
  zone adds a source-type `accept` filter (`img-` only) — it renders only for
  `permissions.canEdit` collections, so read-only collection tiles behave like
  image tiles (near-half dead-zone, far-half reorder). Membership editing is
  ownership-gated, not curatorial: when the grid contains an editable
  collection, a non-`canEditContent` viewer's image sortables run
  `{ draggable: false, droppable: true }` — draggable toward `drop-col-*`
  zones but never reorder targets, so move/reorder/category filing stay
  `canEditContent`-gated while owners of any role can drop-add.

`DroppableCategoryZone` wraps the **full tile rect** (no inset), so the move-zone
shape is the whole tile and "Move here" detection works.

**Resulting behaviour (every tile type):**

- **Near half (entry side)** → reorder suppressed. Category tile → "Move here"
  (move wins); editable collection tile → "Add to collection" for image drags
  (add wins, #1530); image tile and non-editable collection tile → calm
  dead-zone.
- **Far half (past centre in the drag direction)** → optimistic reflow.
  Category↔category reorder stays possible (push past the neighbour's centre);
  nesting an image into a category or adding it to a collection requires
  settling on the near half.
- **Inter-tile gap** → no tile contains the pointer → dead-zone (reorder only
  ever fires _inside_ a tile's far half).

**Status.** Accepted via human feel-test (the Process gate below), including the
between-category-tile behaviour. Edge cases verified mechanically: corner entries
(axis chosen by the dominant delta component) and wrapped-grid vertical
neighbours.

## Instrumentation

Dev-mode DnD tracing can be enabled in the browser console with:

```js
localStorage.setItem('hriv-dnd-trace', '1')
```

Reload the page, then drag a tile. The trace logs `dragstart`, throttled
`dragmove`/`collision`, `dragover`, and `dragend` events, plus grid-level
`handleDragStart` / `handleDragEnd` details (source, target, reordered indexes)
and `App.handleReorderComplete` (coordinator refresh start/end/deferred). This is
off in production and only logs when `import.meta.env.DEV` is true or the
`localStorage` flag is set.

`dndInstrumentation.ts` also keeps two dev-mode counters (issue #1100):

- **Per-drag tile re-renders** — `GridTile` counts committed renders via a
  commit-phase `useEffect`; the count resets on `dragstart` and `dragend` logs
  a `render summary` line (`tileRenders`, `distinctTiles`). At the 599-tile
  fixture scope the observed steady state is ~1 render per tile per drag
  (page-level state transitions churn the tile render-callback props —
  measured in `docs/reorder-performance.md`). The regression signal is
  superlinear growth — renders scaling per dragmove or per tile × frame.
- **Browse-tree poll outcomes** — `useBrowseData` calls
  `recordBrowseTreePoll('not_modified' | 'applied' | 'unchanged')` for each
  committed `GET /api/categories/tree` response. Cumulative counts live on
  `window.__hrivBrowseStats` (`polls`, `not_modified`, `applied`, `unchanged`)
  and each poll is traced as `browse-tree poll`. A long-idle Browse tab should
  show `not_modified` dominating `polls` — the client-side view of the backend
  `hriv.browse_tree.requests` short-circuit metric.

## Process gate (feel cannot be proven by a recording)

Any change to collision detection, drop zones, collision priority, or activation
constraints **must be feel-tested by a human** before merge. Scripted/recorded
drags move the pointer in discrete idealized steps and do **not** reproduce the
acceleration, jitter, and hesitation where feel bugs live — a green recording
has historically coexisted with bad local feel. Unit tests cover the reorder
math and the move/reorder dispatch contract, not the feel.

## Human feel-test protocol (production-scale fixture)

The canonical checklist for a feel-test at production scale (issue #1100, epic
#975). Record the result in `docs/reorder-performance.md` (or the validating
PR/issue) with tester, date, environment, and per-item pass/fail.

**Setup**

1. `docker compose up -d --build` — wait for the seed to finish (~10 s).
2. Seed the reorder fixture
   (`docs/reorder-fixture.md`):
   ```bash
   cd backend
   DATABASE_URL=postgresql+asyncpg://hriv:hriv@localhost:5432/hriv \
     poetry run python -m app.reorder_fixture
   ```
3. Log in as `instructor@example.ca`, then enable the dev trace:
   `localStorage.setItem('hriv-dnd-trace', '1')` and reload.

**Checklist**

| #   | Scope / action                                               | Pass criteria                                                                                                                                                  |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `RF-Root-01` flat scope (80 categories): 5+ reorders         | Tiles slide to make room as the pointer crosses a neighbour's centre; drag never appears frozen; drop commits the previewed order                              |
| 2   | Same scope: hover the **near half** of a category tile       | "Move here" appears (move wins); no reorder preview                                                                                                            |
| 3   | Same scope: hover the near half of an **image** tile         | Calm dead-zone — no reflow, no affordance                                                                                                                      |
| 4   | 10–20 rapid successive drops while a save is in flight       | Every accepted drop commits (queued/coalesced); `ReorderStatusIndicator` cycles dirty→saving→saved; nothing silently reverts                                   |
| 5   | `RF-Root-02` gallery scope (600 images): repeat gestures 1–4 | Same behaviour at scale; note whether the ~370 ms drag-activation stall measured in `docs/reorder-performance.md` is perceptible                               |
| 6   | Drop, then immediately navigate into a category and back     | Order retained, no duplicates, no stale-order flash                                                                                                            |
| 7   | Reload the browser                                           | Displayed order matches `GET /api/tile-order?parent_category_id=<id>` exactly                                                                                  |
| 8   | (Two tabs) reorder the same scope concurrently               | Second writer gets the explicit conflict UX ("Order changed elsewhere"), never silent last-write-wins                                                          |
| 9   | Console: `[dnd]` `render summary` after each drag            | `tileRenders` bounded (~≤ item count per drag; superlinear growth is the regression signal); `window.__hrivBrowseStats.not_modified` grows during idle polling |

**Sign-off** — paste into `docs/reorder-performance.md` or the tracking issue:

```
Feel-test sign-off — issue #1100
Tester: <name>   Date: <YYYY-MM-DD>   Env: <local docker-compose / latest / stable>
Items 1–9: <pass/fail each>
Activation stall at 600 tiles: <imperceptible / noticeable / disruptive>
Notes: <…>
```
