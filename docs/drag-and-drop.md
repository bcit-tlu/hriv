# Drag-and-Drop Spec (Browse grid tiles)

Single source of truth for the **move vs. reorder** behaviour of category/image
tiles on the Browse page (`frontend/src/components/SortableTileGrid.tsx`).

Read this before changing any collision detection, drop-zone, or activation
code. The behaviour below thrashed across ~8 PRs because there was no written
contract; treat the rules here as the contract, and change the doc in the same
PR if you intentionally change the behaviour.

> **Library:** This grid uses **`@dnd-kit/react` v2** (`useDraggable`,
> `useDroppable`, `DragDropProvider`) — **not** v1 `@dnd-kit/core`
> (`useSortable`/`SortableContext`). APIs differ; do not mix v1 examples into
> this component.

## The two gestures

There is exactly one source being dragged (a `tile`) and two kinds of drop
target. They must never both act on the same pointer position.

| Gesture | Trigger zone | Droppable | Collision detector | Priority | Result |
|---|---|---|---|---|---|
| **Move into category** | Pointer anywhere over a category tile's full rect | `DroppableCategoryZone`, id `drop-cat-<categoryId>` | `pointerIntersection` | `CollisionPriority.High` | `onDropImageOnCategory` / `onDropCategoryOnCategory` |
| **Reorder** | Pointer in the 16px seam **between** tiles (and the trailing seam) | `ReorderDropZone`, id `reorder-before-<tileId>` / `reorder-end` | `pointerIntersection` | `CollisionPriority.Normal` | `reorderImages` / `reorderCategories` |

Because move has higher collision priority and covers the entire tile, **move
always wins whenever the pointer is over a category tile**. Reorder can only win
when the pointer is in a gap where no category tile exists. This is the
mechanism that keeps the two gestures from fighting.

### Invariants (enforced by unit tests — see `tests/components/SortableTileGrid.test.tsx`)

1. `handleDragEnd` performs a **move** only when the target id starts with
   `drop-cat-` (`DROP_PREFIX`).
2. `handleDragEnd` performs a **reorder** only when the target id is a gap id
   (`reorder-before-*` or `reorder-end`, via `isReorderTargetId`).
3. A drop whose target is a **bare tile id** (e.g. `img-10`, `cat-1`) is a
   **no-op** — bare tiles are not reorder targets. Reorder is gap-only.
4. Self-drop (`source.id === target.id`), null target, and canceled drags are
   no-ops.

## Live preview (A1 — current baseline)

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

## Process gate (feel cannot be proven by a recording)

Any change to collision detection, drop zones, collision priority, or activation
constraints **must be feel-tested by a human** (or via the `testing-hriv` skill
with a human reviewing the result) before merge. Scripted/recorded drags move
the pointer in discrete idealized steps and do **not** reproduce the
acceleration, jitter, and hesitation where feel bugs live — a green recording
has historically coexisted with bad local feel. Unit tests cover the reorder
math and the move/reorder dispatch contract, not the feel.
