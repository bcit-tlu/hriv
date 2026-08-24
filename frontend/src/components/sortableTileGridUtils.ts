import { CollisionPriority, CollisionType } from '@dnd-kit/abstract'
import type { CollisionDetector } from '@dnd-kit/abstract'

import type { Category, ImageItem } from '../types'

// ── Content-addressable memoization for tile lists ────────────
//
// `useBrowseData` now normalizes API responses into a stable identity map,
// so unchanged categories and images keep the same object reference. These
// caches key the computed tile lists by those object identities, not by the
// transient array references that React creates for derived arrays. This keeps
// `TileItem` object references stable across renders and lets `GridTile`'s
// `React.memo` actually skip re-renders.

const objectIdMap = new WeakMap<object, number>()
let nextObjectId = 1

function getObjectId(obj: object): number {
  let id = objectIdMap.get(obj)
  if (id === undefined) {
    id = nextObjectId++
    objectIdMap.set(obj, id)
  }
  return id
}

class LRUCache<K, V> {
  private cache: Map<K, V>
  private max: number

  constructor(max: number) {
    this.cache = new Map()
    this.max = max
  }

  get(key: K): V | undefined {
    return this.cache.get(key)
  }

  set(key: K, value: V): V {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.max) {
      const first = this.cache.keys().next().value
      if (first !== undefined) this.cache.delete(first)
    }
    this.cache.set(key, value)
    return value
  }
}

const orderTileItemsCache = new LRUCache<string, TileItem[]>(16)

function orderTileItemsContentKey(
  items: TileItem[],
  order: Array<{ type: 'category' | 'image'; id: number }>,
): string {
  let key = ''
  for (const item of items) key += `${getObjectId(item)},`
  key += '|'
  for (const ref of order) key += `${ref.type}:${ref.id},`
  return key
}

const buildTileItemsCache = new LRUCache<string, TileItem[]>(16)

function buildTileItemsContentKey(categories: Category[], images: ImageItem[]): string {
  let key = ''
  for (const c of categories) key += `${getObjectId(c)},`
  key += '|'
  for (const i of images) key += `${getObjectId(i)},`
  return key
}

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

/**
 * Reorder `items` to match a coordinator-provided order of `{type, id}` refs
 * (issue #979). Items missing from `order` keep their relative position and
 * are appended after the ordered ones; refs with no matching item are
 * ignored, so membership changes (uploads, moves, deletions) can never drop
 * or duplicate tiles.
 */
export function orderTileItems(
  items: TileItem[],
  order: Array<{ type: 'category' | 'image'; id: number }>,
): TileItem[] {
  const key = orderTileItemsContentKey(items, order)
  const cached = orderTileItemsCache.get(key)
  if (cached) return cached

  const position = new Map(order.map((ref, i) => [`${ref.type}-${ref.id}`, i] as const))
  const known: Array<{ item: TileItem; pos: number }> = []
  const unknown: TileItem[] = []
  for (const item of items) {
    const pos = position.get(`${item.type}-${item.data.id}`)
    if (pos === undefined) unknown.push(item)
    else known.push({ item, pos })
  }
  known.sort((a, b) => a.pos - b.pos)
  return orderTileItemsCache.set(key, [...known.map((k) => k.item), ...unknown])
}

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
  const key = buildTileItemsContentKey(categories, images)
  const cached = buildTileItemsCache.get(key)
  if (cached) return cached

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

  return buildTileItemsCache.set(key, items)
}

/** Build a map from every category id to the set of ids it contains
 *  (including itself and all descendants). Walks the tree once and
 *  reuses subtree results so each node is processed exactly once. */
export function buildDescendantMap(categories: Category[]): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>()
  const walk = (cat: Category): Set<number> => {
    let ids = map.get(cat.id)
    if (ids) return ids
    ids = new Set<number>()
    ids.add(cat.id)
    for (const child of cat.children) {
      const childIds = walk(child)
      for (const id of childIds) ids.add(id)
    }
    map.set(cat.id, ids)
    return ids
  }
  for (const cat of categories) walk(cat)
  return map
}
