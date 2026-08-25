import { describe, it, expect } from 'vitest'

import {
  DROP_PREFIX,
  orderTileItems,
  tileId,
  collectDescendantIds,
  findCategory,
  buildTileItems,
  buildDescendantMap,
  farHalfReorderCollision,
  nearHalfMoveCollision,
  isPastTileCenterAlongDrag,
} from '../../src/components/sortableTileGridUtils'
import { makeCategory, makeImage } from '../helpers/fixtures'

// A 100×100 tile centred at (150, 150).
const TILE = { left: 100, top: 100, right: 200, bottom: 200 }
const CENTER = { x: 150, y: 150 }

/** Build a collision input for a tile-shaped droppable. */
function collisionInput(
  pointer: { x: number; y: number },
  delta: { x: number; y: number },
  id = 'tile-1',
  sourceId?: string,
) {
  const shape = {
    center: CENTER,
    containsPoint: (p: { x: number; y: number }) =>
      p.x >= TILE.left && p.x <= TILE.right && p.y >= TILE.top && p.y <= TILE.bottom,
  }
  return {
    droppable: { id, shape },
    dragOperation: {
      position: { current: pointer, delta },
      source: sourceId ? { id: sourceId } : undefined,
    },
  } as unknown as Parameters<typeof farHalfReorderCollision>[0]
}

describe('sortableTileGridUtils', () => {
  it('exposes the category move drop prefix', () => {
    expect(DROP_PREFIX).toBe('drop-cat-')
  })

  it('creates tile ids', () => {
    expect(
      tileId({
        type: 'category',
        sortOrder: 0,
        data: makeCategory({ id: 7 }),
      }),
    ).toBe('cat-7')
    expect(
      tileId({
        type: 'image',
        sortOrder: 0,
        data: makeImage({ id: 42 }),
      }),
    ).toBe('img-42')
  })

  it('collects descendants and finds categories in tree', () => {
    const tree = [
      makeCategory({
        id: 1,
        children: [
          makeCategory({
            id: 2,
            children: [makeCategory({ id: 3 })],
          }),
        ],
      }),
    ]

    expect(collectDescendantIds(tree[0])).toEqual(new Set([2, 3]))
    expect(findCategory(tree, 3)?.id).toBe(3)
    expect(findCategory(tree, 999)).toBeUndefined()
  })

  it('builds interleaved sorted tile items with stable tiebreakers', () => {
    const result = buildTileItems(
      [makeCategory({ id: 5, sortOrder: 0 }), makeCategory({ id: 2, sortOrder: 0 })],
      [makeImage({ id: 10, sortOrder: 0 })],
    )

    expect(result.map((r) => r.type)).toEqual(['category', 'category', 'image'])
    expect(result.map((r) => r.data.id)).toEqual([2, 5, 10])
  })

  it('returns the same tile array for the same input object references', () => {
    const cat = makeCategory({ id: 5, sortOrder: 0 })
    const img = makeImage({ id: 10, sortOrder: 1 })
    const a = buildTileItems([cat], [img])
    const b = buildTileItems([cat], [img])
    expect(a).toBe(b)
    expect(a[0]).toBe(b[0])
    expect(a[1]).toBe(b[1])
  })

  it('returns a different tile array when input object references change', () => {
    const a = buildTileItems([makeCategory({ id: 5, sortOrder: 0 })], [])
    const b = buildTileItems([makeCategory({ id: 5, sortOrder: 0 })], [])
    expect(a).not.toBe(b)
  })

  it('builds a descendant map covering self and all descendants', () => {
    const grandchild = makeCategory({ id: 4 })
    const child = makeCategory({ id: 3, children: [grandchild] })
    const root = makeCategory({ id: 1, children: [makeCategory({ id: 2 }), child] })

    const map = buildDescendantMap([root])

    expect(map.get(1)).toEqual(new Set([1, 2, 3, 4]))
    expect(map.get(2)).toEqual(new Set([2]))
    expect(map.get(3)).toEqual(new Set([3, 4]))
    expect(map.get(4)).toEqual(new Set([4]))
  })
})

// ---------------------------------------------------------------------------
// Move-wins guard (docs/drag-and-drop.md), restated as a directional far-half
// threshold: reorder/reflow only fires once the pointer crosses a tile's
// centre on the side opposite the entry edge (the far half). The near half is
// a dead-zone where, for a category tile, the High-priority move zone wins
// ("Move here"). `farHalfReorderCollision` (sortables) and
// `nearHalfMoveCollision` (category move zones) are exact complements built on
// the same `isPastTileCenterAlongDrag` predicate, so a single tile splits into
// move on the entry side and reorder on the far side with no overlap.
// ---------------------------------------------------------------------------

describe('isPastTileCenterAlongDrag (directional centre threshold)', () => {
  it('uses the dominant axis of the cumulative drag delta', () => {
    // Dragging right → far half is the right half (past centre.x).
    expect(
      isPastTileCenterAlongDrag({ x: 160, y: 150 }, CENTER, {
        x: 10,
        y: 0,
      }),
    ).toBe(true)
    expect(
      isPastTileCenterAlongDrag({ x: 140, y: 150 }, CENTER, {
        x: 10,
        y: 0,
      }),
    ).toBe(false)
    // Dragging left → far half is the left half.
    expect(
      isPastTileCenterAlongDrag({ x: 140, y: 150 }, CENTER, {
        x: -10,
        y: 0,
      }),
    ).toBe(true)
    expect(
      isPastTileCenterAlongDrag({ x: 160, y: 150 }, CENTER, {
        x: -10,
        y: 0,
      }),
    ).toBe(false)
    // Vertical drag (delta.y dominates) → tests against centre.y.
    expect(
      isPastTileCenterAlongDrag({ x: 150, y: 170 }, CENTER, {
        x: 2,
        y: 10,
      }),
    ).toBe(true)
    // Dragging down, the top half is the near half → not past centre.
    expect(
      isPastTileCenterAlongDrag({ x: 150, y: 130 }, CENTER, {
        x: 2,
        y: 10,
      }),
    ).toBe(false)
    expect(
      isPastTileCenterAlongDrag({ x: 150, y: 170 }, CENTER, {
        x: 2,
        y: -10,
      }),
    ).toBe(false)
  })

  it('treats the whole tile as near half before any drag travel', () => {
    expect(
      isPastTileCenterAlongDrag({ x: 199, y: 199 }, CENTER, {
        x: 0,
        y: 0,
      }),
    ).toBe(false)
  })
})

describe('farHalfReorderCollision (reorder only on the far half)', () => {
  it('returns a Normal-priority collision once the pointer is past centre on the far side', () => {
    const result = farHalfReorderCollision(collisionInput({ x: 170, y: 150 }, { x: 10, y: 0 }))
    expect(result).not.toBeNull()
    expect(result?.id).toBe('tile-1')
    expect(result?.priority).toBe(2) // CollisionPriority.Normal
  })

  it('returns null on the near half (entry side) so reorder is suppressed', () => {
    expect(farHalfReorderCollision(collisionInput({ x: 130, y: 150 }, { x: 10, y: 0 }))).toBeNull()
  })

  it('returns null when the pointer is outside the tile (gap / other tile)', () => {
    expect(farHalfReorderCollision(collisionInput({ x: 250, y: 150 }, { x: 10, y: 0 }))).toBeNull()
  })

  it('returns null before any drag travel (delta ≈ 0)', () => {
    expect(farHalfReorderCollision(collisionInput({ x: 170, y: 150 }, { x: 0, y: 0 }))).toBeNull()
  })

  it('always collides with the source tile, even on the near half, after a reflow', () => {
    // Pointer is on the left (near) half of the source tile while dragging
    // right. Without the source exception the far-half rule would reject this.
    const result = farHalfReorderCollision(
      collisionInput({ x: 130, y: 150 }, { x: 10, y: 0 }, 'tile-1', 'tile-1'),
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('tile-1')
    expect(result?.priority).toBe(2) // CollisionPriority.Normal
  })
})

describe('nearHalfMoveCollision (move wins on the near half)', () => {
  it('returns a High-priority collision on the near half (entry side)', () => {
    const result = nearHalfMoveCollision(collisionInput({ x: 130, y: 150 }, { x: 10, y: 0 }))
    expect(result).not.toBeNull()
    expect(result?.priority).toBe(3) // CollisionPriority.High
  })

  it('returns null on the far half so reorder (not move) wins there', () => {
    expect(nearHalfMoveCollision(collisionInput({ x: 170, y: 150 }, { x: 10, y: 0 }))).toBeNull()
  })

  it('returns null when the pointer is outside the tile', () => {
    expect(nearHalfMoveCollision(collisionInput({ x: 50, y: 150 }, { x: 10, y: 0 }))).toBeNull()
  })

  it('is the exact complement of farHalfReorderCollision inside the tile', () => {
    // For every inside pointer, exactly one detector fires (no overlap, no gap).
    for (const x of [110, 130, 149, 150, 151, 170, 190]) {
      const input = collisionInput({ x, y: 150 }, { x: 10, y: 0 })
      const move = nearHalfMoveCollision(input)
      const reorder = farHalfReorderCollision(input)
      expect(Boolean(move) !== Boolean(reorder)).toBe(true)
    }
  })

  it('returns null for the source category own move zone', () => {
    // A category tile is both a sortable and a move-zone droppable. The source
    // category's own zone must not claim the pointer, otherwise the reorder
    // detector could be masked by a High-priority move collision.
    expect(
      nearHalfMoveCollision(
        collisionInput(
          { x: 130, y: 150 },
          { x: 10, y: 0 },
          `${DROP_PREFIX}1`,
          'cat-1',
        ),
      ),
    ).toBeNull()
  })
})

describe('orderTileItems', () => {
  const items = buildTileItems(
    [makeCategory({ id: 1, sortOrder: 0 })],
    [makeImage({ id: 1, sortOrder: 1 }), makeImage({ id: 2, sortOrder: 2 })],
  )

  it('reorders items to match the provided refs exactly', () => {
    const ordered = orderTileItems(items, [
      { type: 'image', id: 2 },
      { type: 'category', id: 1 },
      { type: 'image', id: 1 },
    ])
    expect(ordered.map(tileId)).toEqual(['img-2', 'cat-1', 'img-1'])
  })

  it('ignores refs with no matching item (deletions/moves out)', () => {
    const ordered = orderTileItems(items, [
      { type: 'image', id: 99 },
      { type: 'image', id: 2 },
      { type: 'category', id: 7 },
      { type: 'image', id: 1 },
      { type: 'category', id: 1 },
    ])
    expect(ordered.map(tileId)).toEqual(['img-2', 'img-1', 'cat-1'])
  })

  it('appends items missing from the order, preserving their relative position', () => {
    const ordered = orderTileItems(items, [{ type: 'image', id: 2 }])
    expect(ordered.map(tileId)).toEqual(['img-2', 'cat-1', 'img-1'])
  })

  it('never drops or duplicates tiles', () => {
    const ordered = orderTileItems(items, [
      { type: 'image', id: 1 },
      { type: 'image', id: 1 },
    ])
    expect(ordered.map(tileId).sort()).toEqual(items.map(tileId).sort())
  })

  it('returns the same array for the same items and order references', () => {
    const order = [
      { type: 'image' as const, id: 2 },
      { type: 'category' as const, id: 1 },
      { type: 'image' as const, id: 1 },
    ]
    const a = orderTileItems(items, order)
    const b = orderTileItems(items, order)
    expect(a).toBe(b)
  })
})
