import { CollisionPriority, CollisionType } from '@dnd-kit/abstract'
import type { CollisionDetector } from '@dnd-kit/abstract'

import type { Category, ImageItem } from '../types'

// ── Tile item union type ────────────────────────────────────

export type TileItem =
  | { type: 'category'; sortOrder: number; data: Category }
  | { type: 'image'; sortOrder: number; data: ImageItem }

export function tileId(item: TileItem): string {
  return item.type === 'category' ? `cat-${item.data.id}` : `img-${item.data.id}`
}

// Category tile drop target: move into category. Reorder has no id-based
// target — it is committed via the `move()` helper from the sortable's
// reflowed index (see SortableTileGrid handleDragEnd).
export const DROP_PREFIX = 'drop-cat-'

// ── Directional "far-half" collision rule (move-wins guard) ──
//
// The move-vs-reorder guard is expressed geometrically as a single threshold
// shared by two complementary detectors: reorder only fires once the pointer
// crosses a tile's centre on the side *opposite* the edge it entered from (the
// far half); the near half is a calm dead-zone where, for a category tile, the
// High-priority move zone wins ("Move here"). This restates the locked spec's
// "move always wins over a category tile" as "reorder never fires on the near
// half of any tile", which keeps category↔category reorder possible (push past
// the far half) without an aim-for-the-gap target.

/**
 * True when `pointer` has crossed `center` on the far side relative to the
 * drag's travel direction. Direction is taken from the cumulative drag delta
 * (current − start), which is stable frame-to-frame — unlike
 * `position.direction`, which flips on the tiniest jitter. The dominant axis
 * of the delta selects the axis to test, so the same rule covers horizontal
 * neighbours and the vertical neighbours of a wrapped grid. Before any travel
 * (`delta` ≈ 0) nothing is "past centre", so the whole tile reads as near half.
 */
export function isPastTileCenterAlongDrag(
  pointer: { x: number; y: number },
  center: { x: number; y: number },
  delta: { x: number; y: number },
): boolean {
  const horizontal = Math.abs(delta.x) >= Math.abs(delta.y)
  if (horizontal) {
    if (delta.x === 0) return false
    return delta.x > 0 ? pointer.x >= center.x : pointer.x <= center.x
  }
  if (delta.y === 0) return false
  return delta.y > 0 ? pointer.y >= center.y : pointer.y <= center.y
}

/**
 * Sortable (reorder) collision detector implementing the far-half rule: a tile
 * only becomes a reorder/reflow target once the pointer is inside it AND has
 * crossed its centre on the far side. On the near half this returns `null`, so
 * the optimistic-sorting plugin has nothing to reflow against and the drag
 * sits still. Applies to every tile type.
 */
export const farHalfReorderCollision: CollisionDetector = ({ dragOperation, droppable }) => {
  const pointer = dragOperation.position.current
  if (!pointer || !droppable.shape) return null
  if (!droppable.shape.containsPoint(pointer)) return null
  const { center } = droppable.shape
  if (!isPastTileCenterAlongDrag(pointer, center, dragOperation.position.delta)) return null
  const distance = Math.hypot(center.x - pointer.x, center.y - pointer.y)
  return {
    id: droppable.id,
    value: 1 / (distance || 1),
    // Both detectors are pointer-inside-tile checks, so both report
    // PointerIntersection — keeps them consistent if a future dnd-kit
    // version starts filtering collisions by type. Resolution today sorts
    // by priority then value and ignores type.
    type: CollisionType.PointerIntersection,
    priority: CollisionPriority.Normal,
  }
}

/**
 * Move-zone collision detector implementing the complementary near-half rule:
 * a category move zone only collides while the pointer is inside it and has NOT
 * crossed the tile centre in the drag direction. This is the exact complement
 * of `farHalfReorderCollision`, so a category tile splits cleanly into "Move
 * here" on the entry side and reorder on the far side — they never overlap.
 * Kept at High priority so move wins over any reorder collision on the near
 * half.
 */
export const nearHalfMoveCollision: CollisionDetector = ({ dragOperation, droppable }) => {
  const pointer = dragOperation.position.current
  if (!pointer || !droppable.shape) return null
  if (!droppable.shape.containsPoint(pointer)) return null
  const { center } = droppable.shape
  if (isPastTileCenterAlongDrag(pointer, center, dragOperation.position.delta)) return null
  const distance = Math.hypot(center.x - pointer.x, center.y - pointer.y)
  return {
    id: droppable.id,
    value: 1 / (distance || 1),
    type: CollisionType.PointerIntersection,
    priority: CollisionPriority.High,
  }
}

// ── Descendant / tree helpers ───────────────────────────────

/** Collect all descendant category IDs (not including the root itself). */
export function collectDescendantIds(cat: Category): Set<number> {
  const ids = new Set<number>()
  const walk = (children: Category[]) => {
    for (const c of children) {
      ids.add(c.id)
      walk(c.children)
    }
  }
  walk(cat.children)
  return ids
}

/** Find a category by id anywhere in a forest. */
export function findCategory(cats: Category[], id: number): Category | undefined {
  for (const c of cats) {
    if (c.id === id) return c
    const found = findCategory(c.children, id)
    if (found) return found
  }
  return undefined
}

/** Build an interleaved, sorted list of categories and images. */
export function buildTileItems(categories: Category[], images: ImageItem[]): TileItem[] {
  const items: TileItem[] = [
    ...categories.map(
      (c): TileItem => ({
        type: 'category',
        sortOrder: c.sortOrder,
        data: c,
      }),
    ),
    ...images.map(
      (i): TileItem => ({
        type: 'image',
        sortOrder: i.sortOrder,
        data: i,
      }),
    ),
  ]

  items.sort((a, b) => {
    const d = a.sortOrder - b.sortOrder
    if (d !== 0) return d
    if (a.type !== b.type) return a.type === 'category' ? -1 : 1
    return a.data.id - b.data.id
  })

  return items
}
