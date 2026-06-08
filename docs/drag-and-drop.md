# Drag-and-Drop Spec (Browse grid tiles)

Single source of truth for the **move vs. reorder** behaviour of category/image
tiles on the Browse page (`frontend/src/components/SortableTileGrid.tsx`).

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
> dead-zone where move wins on a category tile ("Move here") and the drag sits
> still on an image tile. This keeps "move always wins inside a category tile"
> while leaving category↔category reorder reachable (push past the neighbour's
> centre).

## The two gestures

There is exactly one source being dragged (a `tile`) and two kinds of drop
target. They must never both act on the same pointer position — the directional
threshold makes them mutually exclusive inside any tile.

| Gesture                | Trigger zone                                                           | Droppable                                           | Collision detector        | Priority                   | Result                                               |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- | ------------------------- | -------------------------- | ---------------------------------------------------- |
| **Move into category** | Pointer on the **near half** of a category tile (entry side of centre) | `DroppableCategoryZone`, id `drop-cat-<categoryId>` | `nearHalfMoveCollision`   | `CollisionPriority.High`   | `onDropImageOnCategory` / `onDropCategoryOnCategory` |
| **Reorder**            | Pointer past a tile's **centre** (far half) along the drag axis        | the sibling tile's `useSortable`                    | `farHalfReorderCollision` | `CollisionPriority.Normal` | `reorderImages` / `reorderCategories` (via `move()`) |

The two detectors share one predicate, `isPastTileCenterAlongDrag`, and are
exact complements inside a tile: for any pointer inside a tile, **exactly one**
fires. Move has higher priority, so on the near half of a category tile move
always wins; reorder can only win once the pointer crosses the centre.

### Invariants (enforced by unit tests — see `tests/components/SortableTileGrid.test.tsx`)

1. `handleDragEnd` performs a **move** only when the target id starts with
   `drop-cat-` (`DROP_PREFIX`).
2. Any other target is treated as a **reorder**, committed via
   `move(ids, event)` which reads the source's reflowed sortable index, so the
   committed order matches the on-screen preview.
3. Reorder only becomes possible once `farHalfReorderCollision` reports a tile
   (pointer past its centre along the drag axis); the near half and the
   inter-tile gap never produce a reorder target at runtime.
4. Null target and canceled drags are explicit no-ops. After optimistic reflow,
   the collision detector may resolve the target as the source itself
   (`source.id === target.id`); this is **not** short-circuited — `move()` still
   computes the correct reordered array using the source's projected sortable
   index. True self-drops (no actual movement) are caught downstream by the
   identity check (`reorderedIds.every((id, i) => id === ids[i])`).

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
centre, so a category tile reads as all near-half and move is the default.

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
  `null`, so the plugin has nothing to reflow against.
- `nearHalfMoveCollision` (passed to `DroppableCategoryZone`'s full-rect
  `useDroppable`, `High` priority): the exact complement — collides only on the
  near half, so "Move here" owns the entry side of a category tile.

`DroppableCategoryZone` wraps the **full tile rect** (no inset), so the move-zone
shape is the whole tile and "Move here" detection works.

**Resulting behaviour (every tile type):**

- **Near half (entry side)** → reorder suppressed. Category tile → "Move here"
  (move wins); image tile → calm dead-zone.
- **Far half (past centre in the drag direction)** → optimistic reflow.
  Category↔category reorder stays possible (push past the neighbour's centre);
  nesting an image into a category requires settling on its near half.
- **Inter-tile gap** → no tile contains the pointer → dead-zone (reorder only
  ever fires _inside_ a tile's far half).

**Status.** Accepted via human feel-test (the Process gate below), including the
between-category-tile behaviour. Edge cases verified mechanically: corner entries
(axis chosen by the dominant delta component) and wrapped-grid vertical
neighbours.

## Process gate (feel cannot be proven by a recording)

Any change to collision detection, drop zones, collision priority, or activation
constraints **must be feel-tested by a human** before merge. Scripted/recorded
drags move the pointer in discrete idealized steps and do **not** reproduce the
acceleration, jitter, and hesitation where feel bugs live — a green recording
has historically coexisted with bad local feel. Unit tests cover the reorder
math and the move/reorder dispatch contract, not the feel.
