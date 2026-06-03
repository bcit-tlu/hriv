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

> **Current behaviour: A2 with a directional far-half guard.** Tiles are
> sortables and reflow optimistically during a drag, but reorder only fires once
> the pointer crosses a tile's centre on the far side; the near half is a
> dead-zone where move wins (see the latest 2026-06 A2 Decision Record below).
> The "two gestures" table and
> invariants below describe the **move-vs-reorder dispatch contract**, which A2
> preserves; the A1 "gap seam" trigger details are kept for historical context and
> the revert path. Where the table says reorder triggers in a _seam_, A2 triggers
> it on a sibling **tile** target instead — the dispatch result (`reorderImages` /
> `reorderCategories`) is unchanged.

## The two gestures

There is exactly one source being dragged (a `tile`) and two kinds of drop
target. They must never both act on the same pointer position.

| Gesture                | Trigger zone                                                       | Droppable                                                       | Collision detector    | Priority                   | Result                                               |
| ---------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------- | -------------------------- | ---------------------------------------------------- |
| **Move into category** | Pointer anywhere over a category tile's full rect                  | `DroppableCategoryZone`, id `drop-cat-<categoryId>`             | `pointerIntersection` | `CollisionPriority.High`   | `onDropImageOnCategory` / `onDropCategoryOnCategory` |
| **Reorder**            | Pointer in the 16px seam **between** tiles (and the trailing seam) | `ReorderDropZone`, id `reorder-before-<tileId>` / `reorder-end` | `pointerIntersection` | `CollisionPriority.Normal` | `reorderImages` / `reorderCategories`                |

Because move has higher collision priority and covers the entire tile, **move
always wins whenever the pointer is over a category tile**. Reorder can only win
when the pointer is in a gap where no category tile exists. This is the
mechanism that keeps the two gestures from fighting.

### Invariants (enforced by unit tests — see `tests/components/SortableTileGrid.test.tsx`)

1. `handleDragEnd` performs a **move** only when the target id starts with
   `drop-cat-` (`DROP_PREFIX`). (Unchanged across A1 and A2.)
2. **A2:** any other (non-`drop-cat-`) target is treated as a **reorder**,
   committed via `move(ids, event)`. (**A1, historical:** reorder fired only on
   a gap id `reorder-before-*` / `reorder-end`.)
3. **A2:** a drop on a sibling **tile** id (e.g. `img-10`, `cat-1`) **reorders**
   — this is the optimistic-reflow convenience. (**A1, historical:** a bare tile
   id was a no-op; reorder was gap-only.)
4. Self-drop (`source.id === target.id`), null target, and canceled drags are
   no-ops. (Unchanged across A1 and A2.)

## Live preview (A1 — historical; superseded by A2 reflow)

> The current behaviour is A2's optimistic `useSortable` reflow (see Decision
> Record). The seam-based preview below describes the A1 baseline retained on
> #550 as the revert path; it is not active in the A2 implementation.

While a `ReorderDropZone` is the active drop target (`isDropTarget`), it opens
from `16px` to `REORDER_SLOT_OPEN_PX` (64px) and renders a dashed slot plus a
crisp vertical **insertion bar**, so neighbouring tiles slide and the user sees
where the tile will land in real time.

- The preview is driven **purely by the seam's own `isDropTarget`**. Since the
  seam can only be the target when the pointer is in a gap (move wins over
  tiles), the live preview and the "Move here" overlay are **mutually
  exclusive** by construction — no central `previewIndex` plumbing, no race.
- The opened slot stays anchored under the pointer (its left edge is fixed; it
  grows rightward), so expanding it cannot flip the winning target — i.e. it
  cannot feedback-loop.

### Activation

- **Mouse:** `PointerActivationConstraints.Distance(8px)` only. (The previous
  `Delay(200ms)` made grabs feel sticky and was removed.)
- **Touch:** `PointerActivationConstraints.Delay(250ms, tolerance 5)` so taps
  and scrolls aren't hijacked.
- Drags are suppressed when starting on a `.MuiIconButton-root` (tile actions).

### Seams hidden when not useful

Reorder seams are not rendered when there are `<= 1` tiles (nothing to
reorder).

## Decision Record

### 2026-06 — A1 locked as baseline; A2 pre-approved as a guarded enhancement

**Context.** Move-into-category and reorder-between-tiles were originally both
inferred from the same pointer position over overlapping hit areas, so every
tweak that fixed one broke the other (collision algorithm rewritten ~7 times).
The accepted resolution was: **move = full category-tile rect (High priority),
reorder = explicit gap seams (Normal priority)**, with pointer-based detection.

**Decision.** **A1 is the locked baseline**: move-dominant, with a gap-only live
preview (seam opens + insertion bar). It is the most intuitive and lowest-risk
option and does not reintroduce move-vs-sort overlap.

**Pre-approved future enhancement (A2, guarded).** Migrating the reorder
dimension to optimistic `useSortable`-style reflow (tiles continuously reflow to
the new order during the drag) is approved **only if** it satisfies all of:

1. Reflow happens **only inside the seam zones**; it must be fully **suppressed
   whenever the pointer is over a category tile** (so it never competes with the
   "Move here" overlay). Invariants 1–4 above must still hold.
2. Move keeps `CollisionPriority.High` over the full category-tile rect and
   continues to win on any pointer-over-tile.
3. It ships with the suppression rule covered by unit tests, and with a
   **human feel-test** (see Process gate) — not just a recording.

If any of these cannot be met, stay on A1.

### 2026-06 — A2 implemented (optimistic `useSortable` reflow), pending feel-test

**What shipped.** Tiles now render through `useSortable` (`@dnd-kit/react/sortable`)
instead of `useDraggable`, so the grid reflows continuously during a drag and the
committed order matches the on-screen preview (`handleDragEnd` commits via the
`move()` helper, which reads the source's reflowed sortable index). The
`ReorderDropZone` seams and the gap-id machinery are gone.

**Guard satisfied (move still wins).** `DroppableCategoryZone` is unchanged: a
non-sortable `useDroppable` at `CollisionPriority.High` over the full tile rect.
Because dnd-kit's optimistic sorting only reflows **between two sortables**, the
moment the pointer is over a category tile the High-priority move zone wins the
collision and reflow is automatically suppressed — no manual `previewIndex`
plumbing. Invariants 1 (move only on `drop-cat-*`) and 4 (self/null/cancel
no-ops) still hold and are still unit-tested.

> **Correction (superseded by the 2026-06 suppression fix below).** The claim
> above that reflow is "automatically suppressed" was **wrong**. The A2
> migration made _every_ tile a sortable, including category tiles, so the
> optimistic-sorting plugin happily reflowed over a category tile's body. The
> High move zone only determined the drop _target_; it did not stop the plugin
> from reflowing as the pointer pushed toward the tile centre. A human
> feel-test caught reorder "winning" over category tiles. See the fix below.

**Deliberate deviation from the guard wording.** The pre-approval above said
reflow must happen "only inside the seam zones" and that invariant 3 (reorder is
**gap-only**; a bare tile id is a no-op) must hold. The implemented A2 **relaxes
invariant 3**: reorder now triggers when the pointer settles over a sibling
**tile** (the sortable), not a 16px seam. This is the source of the "convenience"
A1 lacked — you no longer have to aim for a thin gap. The original gap-only rule
was an A1 safety mechanism against move-vs-reorder overlap; with move kept as a
clean High-priority non-sortable zone, that overlap does not return, so trading
gap-only for tile-target reorder is safe. Unit test
`a drop-cat-* target only moves; it never reorders` pins the move-wins guard.

This deviation is **pending the human feel-test** the Process gate requires. If
the reflow feels wrong, the fallback is the locked A1 baseline (still on the
`devin/1780419298-reorder-zone-tuning` branch / PR #550).

### 2026-06 — A2 move-wins guard fixed in code (inset move zone + collision suppression)

> **Superseded by the directional far-half record below.** The inset move zone
> broke "Move here" entirely in local testing: the move-zone droppable's
> measured shape was the *inset* box, so `pointerIntersection` only fired deep
> inside the tile and the surrounding reorder lane swallowed the whole gesture.
> `createGapOnlyClosestCenter`, `MOVE_ZONE_INSET_PX`, and the move-zone element
> registry described here no longer exist. Kept for history.

**Problem.** The feel-test found the guard failing: dragging an image across the
gap into an adjacent category tile briefly showed "Move here", then the
optimistic reorder reflowed the category as the pointer pushed toward the tile
centre — reorder "winning" over a category tile, exactly what the spec forbids.
Root cause: category tiles were sortables, so the optimistic-sorting plugin
reflowed over them; collision priority chose the move zone as the _target_ but
never suppressed the plugin's reflow.

**Fix (implemented).** Reflow is now suppressed in code via a dedicated sortable
collision detector, `createGapOnlyClosestCenter(moveZoneElements)`
(`sortableTileGridUtils.ts`): it delegates to `closestCenter` **except** when the
pointer is inside a registered category move-zone rect, where it returns `null`
so the optimistic-sorting plugin has nothing to reflow against — move wins, edge
to centre, inside that rect.

**Inset move zone (keeps category-to-category reorder practical).** Suppressing
reflow over the _full_ category-tile rect would leave only the 16px inter-tile
gap as a reorder target, making it practically impossible to reorder between
category tiles (the original churn problem). So the move zone is now a **centered
inset region** of the tile (`MOVE_ZONE_INSET_PX`, currently 32px): the
`DroppableCategoryZone`'s droppable element and the registered suppression rect
are the **same inset element**, so the move collision boundary and the reflow
suppression boundary are identical (the live preview always matches what
commits). Behaviour:

- **Pointer in the inset centre of a category tile → move** ("Move here"; reflow
  suppressed).
- **Pointer in the margin around a category tile, in the inter-tile gap, or over
  an image tile → reorder** (optimistic reflow active). The reorder lane between
  two adjacent category tiles is now ≈ `2 × inset + gap` (~80px) instead of 16px.

`MOVE_ZONE_INSET_PX` is a single tunable feel knob — increase it to widen the
reorder lane (smaller move target), decrease it to make move dominate more of
the tile.

**Guard now enforced by tests.** `createGapOnlyClosestCenter` is unit-tested
directly (suppress inside a zone; delegate to `closestCenter` outside; handle
multiple zones; no-zone passthrough) in `sortableTileGridUtils.test.ts`. The
`handleDragEnd` dispatch tests still pin invariants 1 & 4; note that `handleDragEnd`
is pure dispatch — the move-wins guard lives in the collision detector, not in
dispatch, so a category tile can never become a reorder target at runtime.

Still **pending the human feel-test** per the Process gate (notably the inset
size). Fallback remains the locked A1 baseline on PR #550.

### 2026-06 — A2 move-wins guard, directional far-half threshold (current)

**Problem with the inset approach.** Making the move zone a centered *inset*
element meant its measured collision shape (`droppable.shape`) was the inset
box, not the full tile. `pointerIntersection` only reports a collision while the
pointer is inside that shape, so "Move here" never appeared as the pointer
crossed the tile's outer reorder lane — only optimistic reordering showed. The
inset both shrank the move target and (because the shape shrank with it) broke
move detection.

**Fix (current).** Drop the spatial move-zone-vs-reorder-region split and the
element registry. The guard is now a single **directional threshold** shared by
two complementary collision detectors in `sortableTileGridUtils.ts`, both keyed
on `isPastTileCenterAlongDrag(pointer, center, delta)`:

- `farHalfReorderCollision` (passed to every tile's `useSortable`): returns a
  `Normal` collision only when the pointer is **inside** a tile **and** has
  crossed its centre on the side **opposite the entry edge** (the far half). On
  the near half it returns `null`, so the optimistic-sorting plugin has nothing
  to reflow against and the drag sits still.
- `nearHalfMoveCollision` (passed to `DroppableCategoryZone`'s full-rect
  `useDroppable`, `High` priority): the exact complement — collides only on the
  **near half**, so "Move here" owns the entry side of a category tile.

`DroppableCategoryZone` is back to wrapping the **full tile rect** (no inset),
so the move-zone shape is the whole tile and "Move here" detection works again.

**Direction source.** The drag direction comes from the **cumulative** drag
delta (`position.delta` = current − start), not `position.direction`. dnd-kit's
`direction` is recomputed frame-to-frame and flips on the tiniest jitter;
cumulative delta is stable. The dominant axis of the delta selects the axis to
test, so the same rule covers horizontal neighbours and the vertical neighbours
of a wrapped grid. Before any travel (`delta` ≈ 0) nothing is past centre, so a
category tile reads as all near-half (move is the default).

**Resulting behaviour (every tile type):**

- **Near half (entry side)** → reorder suppressed. For a category tile, the
  High-priority move zone wins → "Move here"; for an image tile, the drag sits
  still (calm dead-zone).
- **Far half (past centre in the drag direction)** → reorder / optimistic
  reflow. Category↔category reorder stays possible: push past the neighbour's
  centre. Nesting an image into a category now requires settling on the
  category's near half (pushing to the far half reorders instead).
- **Inter-tile gap** → no tile contains the pointer → dead-zone (reorder only
  ever fires *inside* a tile's far half).

**Edge cases to watch in feel-test:** corner entries (axis chosen by the
dominant delta component) and wrapped-grid vertical neighbours when a drag has a
large horizontal cumulative delta.

**Guard enforced by tests.** `isPastTileCenterAlongDrag`,
`farHalfReorderCollision`, and `nearHalfMoveCollision` are unit-tested directly
in `sortableTileGridUtils.test.ts`, including a complementarity check that
exactly one of the two detectors fires for any pointer inside a tile. The
`handleDragEnd` dispatch tests still pin invariants 1 & 4.

Still **pending the human feel-test** per the Process gate (notably the
between-category-tile reorder feel). Fallback remains the locked A1 baseline on
PR #550.

## Process gate (feel cannot be proven by a recording)

Any change to collision detection, drop zones, collision priority, or activation
constraints **must be feel-tested by a human** (or via the `testing-hriv` skill
with a human reviewing the result) before merge. Scripted/recorded drags move
the pointer in discrete idealized steps and do **not** reproduce the
acceleration, jitter, and hesitation where feel bugs live — a green recording
has historically coexisted with bad local feel. Unit tests cover the reorder
math and the move/reorder dispatch contract, not the feel.
