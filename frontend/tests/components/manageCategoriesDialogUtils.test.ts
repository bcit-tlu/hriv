/**
 * Unit tests for ManageCategoriesDialog utility functions:
 * - collectImagesByParent
 * - interleavedTileOrders (shared tile-order contract, epic #975 issue #982)
 * - diffParentMoves
 * - reorderFlatOptions
 *
 * These cover the sort_order namespace fix from issue #539 (image slots
 * keep their interleaved positions) via the tile-order representation.
 */

import { describe, it, expect } from 'vitest'
import {
  collectImagesByParent,
  diffParentMoves,
  interleavedTileOrders,
  reorderFlatOptions,
  type FlatOption,
} from '../../src/components/manageCategoriesDialogUtils'
import { makeCategory, makeImage } from '../helpers/fixtures'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFlatOption(overrides: Partial<FlatOption> = {}): FlatOption {
  return {
    id: 1,
    label: 'Cat',
    depth: 0,
    imageCount: 0,
    childCount: 0,
    status: null,
    parentId: null,
    programIds: [],
    groupIds: [],
    inheritedProgramRestriction: false,
    inheritedGroupRestriction: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// collectImagesByParent
// ---------------------------------------------------------------------------

describe('collectImagesByParent', () => {
  it('returns empty map when no images exist', () => {
    const cats = [makeCategory({ id: 1, images: [] })]
    const result = collectImagesByParent(cats, [])
    expect(result.size).toBe(0)
  })

  it('collects uncategorized images under key "null"', () => {
    const uncategorized = [makeImage({ id: 10, sortOrder: 2 }), makeImage({ id: 11, sortOrder: 0 })]
    const result = collectImagesByParent([], uncategorized)
    expect(result.size).toBe(1)
    const rootImages = result.get('null')!
    expect(rootImages).toHaveLength(2)
    // Should be sorted by sortOrder
    expect(rootImages[0].id).toBe(11)
    expect(rootImages[1].id).toBe(10)
  })

  it('collects images from nested categories', () => {
    const cats = [
      makeCategory({
        id: 1,
        images: [makeImage({ id: 10, sortOrder: 1 })],
        children: [
          makeCategory({
            id: 2,
            parentId: 1,
            images: [makeImage({ id: 20, sortOrder: 2 }), makeImage({ id: 21, sortOrder: 0 })],
          }),
        ],
      }),
    ]
    const result = collectImagesByParent(cats, [])
    expect(result.size).toBe(2)
    expect(result.get('1')!.map((i) => i.id)).toEqual([10])
    // Nested images sorted by sortOrder
    expect(result.get('2')!.map((i) => i.id)).toEqual([21, 20])
  })
})

// ---------------------------------------------------------------------------
// interleavedTileOrders
// ---------------------------------------------------------------------------

describe('interleavedTileOrders', () => {
  it('returns no scopes when nothing changed', () => {
    const cats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    expect(interleavedTileOrders(cats, cats, new Map())).toEqual([])
  })

  it('returns the full category order for a same-parent swap', () => {
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    const newCats = [
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 1, parentId: null }),
    ]
    expect(interleavedTileOrders(newCats, oldCats, new Map())).toEqual([
      {
        scope: null,
        order: [
          { type: 'category', id: 2 },
          { type: 'category', id: 1 },
        ],
      },
    ])
  })

  it('interleaves categories and images preserving image positions', () => {
    // Old order: cat_A(0), img_1(1), cat_B(2), img_2(3)
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    // Swap categories: cat_B first, then cat_A
    const newCats = [
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 1, parentId: null }),
    ]
    const imagesByParent = new Map([
      ['null', [makeImage({ id: 10, sortOrder: 1 }), makeImage({ id: 11, sortOrder: 3 })]],
    ])
    expect(interleavedTileOrders(newCats, oldCats, imagesByParent)).toEqual([
      {
        scope: null,
        order: [
          { type: 'category', id: 2 },
          { type: 'image', id: 10 },
          { type: 'category', id: 1 },
          { type: 'image', id: 11 },
        ],
      },
    ])
  })

  it('handles category moved to a different parent (cross-parent move)', () => {
    // Parent null: cat_A(0), img_root(1), cat_B(2)
    // Parent 1 (cat_A): img_child(0)
    // Move cat_B under cat_A: both scopes change.
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    const newCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: 1 }), // moved under cat_A
    ]
    const imagesByParent = new Map([
      ['null', [makeImage({ id: 10, sortOrder: 1 })]],
      ['1', [makeImage({ id: 20, sortOrder: 0 })]],
    ])
    const scopes = interleavedTileOrders(newCats, oldCats, imagesByParent)

    const root = scopes.find((s) => s.scope === null)!
    // Root: cat_A, img_root — cat_B slot collapsed
    expect(root.order).toEqual([
      { type: 'category', id: 1 },
      { type: 'image', id: 10 },
    ])

    const child = scopes.find((s) => s.scope === 1)!
    // Under cat_A: img_child, cat_B appended after images
    expect(child.order).toEqual([
      { type: 'image', id: 20 },
      { type: 'category', id: 2 },
    ])
  })

  it('omits unchanged sibling scopes', () => {
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 3, parentId: 1 }),
      makeFlatOption({ id: 4, parentId: 1 }),
    ]
    const newCats = [
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 3, parentId: 1 }),
      makeFlatOption({ id: 4, parentId: 1 }),
    ]
    const scopes = interleavedTileOrders(newCats, oldCats, new Map())
    expect(scopes).toEqual([
      {
        scope: null,
        order: [
          { type: 'category', id: 2 },
          { type: 'category', id: 1 },
        ],
      },
    ])
  })

  it('includes the source scope when all categories leave it', () => {
    const oldCats = [makeFlatOption({ id: 1, parentId: null })]
    const newCats = [makeFlatOption({ id: 1, parentId: 5 })] // moved under parent 5
    const imagesByParent = new Map([
      ['null', [makeImage({ id: 10, sortOrder: 0 }), makeImage({ id: 11, sortOrder: 2 })]],
    ])
    const scopes = interleavedTileOrders(newCats, oldCats, imagesByParent)

    const root = scopes.find((s) => s.scope === null)!
    expect(root.order).toEqual([
      { type: 'image', id: 10 },
      { type: 'image', id: 11 },
    ])

    const dest = scopes.find((s) => s.scope === 5)!
    expect(dest.order).toEqual([{ type: 'category', id: 1 }])
  })

  it('skips scopes left with no members after a move', () => {
    const oldCats = [makeFlatOption({ id: 1, parentId: null })]
    const newCats = [makeFlatOption({ id: 1, parentId: 5 })]
    const scopes = interleavedTileOrders(newCats, oldCats, new Map())
    // Root lost its only member — no empty order is reported for it.
    expect(scopes.find((s) => s.scope === null)).toBeUndefined()
    expect(scopes.find((s) => s.scope === 5)!.order).toEqual([{ type: 'category', id: 1 }])
  })

  it('uses the coordinator display order as the template when provided', () => {
    // Server sortOrder says img 10 then img 11, but a pending (unsaved)
    // reorder in the coordinator has them swapped. A category-only reorder
    // must preserve the pending image order, not revert it.
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    const newCats = [
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 1, parentId: null }),
    ]
    const imagesByParent = new Map([
      ['null', [makeImage({ id: 10, sortOrder: 1 }), makeImage({ id: 11, sortOrder: 3 })]],
    ])
    const displayOrder = [
      { type: 'category' as const, id: 1 },
      { type: 'image' as const, id: 11 },
      { type: 'category' as const, id: 2 },
      { type: 'image' as const, id: 10 },
    ]
    expect(
      interleavedTileOrders(newCats, oldCats, imagesByParent, (parentId) =>
        parentId === null ? displayOrder : null,
      ),
    ).toEqual([
      {
        scope: null,
        order: [
          { type: 'category', id: 2 },
          { type: 'image', id: 11 },
          { type: 'category', id: 1 },
          { type: 'image', id: 10 },
        ],
      },
    ])
  })

  it('drops stale refs and keeps unknown members in their slot with a display-order template', () => {
    const oldCats = [makeFlatOption({ id: 1, parentId: null })]
    const newCats = [makeFlatOption({ id: 1, parentId: null })]
    const imagesByParent = new Map([['null', [makeImage({ id: 10, sortOrder: 0 })]]])
    // Display order references a category that no longer exists (99) and
    // does not know about image 10 yet.
    const displayOrder = [
      { type: 'category' as const, id: 99 },
      { type: 'category' as const, id: 1 },
    ]
    expect(interleavedTileOrders(newCats, oldCats, imagesByParent, () => displayOrder)).toEqual([])
  })

  it('does not emit a scope order for an untouched scope missing from the display order', () => {
    // The coordinator's display order does not know category 1 (e.g. its
    // cross-parent move is still refreshing). The on-screen order keeps it
    // in its original slot (reorderFlatOptions), so this untouched scope
    // must not diff as changed and must not be re-saved.
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 3, parentId: null }),
    ]
    const newCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 3, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    const displayOrder = [
      { type: 'category' as const, id: 3 },
      { type: 'category' as const, id: 2 },
    ]
    expect(interleavedTileOrders(newCats, oldCats, new Map(), () => displayOrder)).toEqual([])
  })

  it('does not emit an untouched mixed scope when the display order is missing a member', () => {
    // Scope members: C1(sort 0), C2(sort 1), image 10(sort 2). The
    // coordinator's order does not know C2 yet but has image 10 ranked
    // before C1. A ranked category must never be re-placed into an image
    // slot: the category subsequence must match reorderFlatOptions, so
    // this untouched scope must not diff as changed.
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    const newCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    const imagesByParent = new Map([['null', [makeImage({ id: 10, sortOrder: 2 })]]])
    const displayOrder = [
      { type: 'image' as const, id: 10 },
      { type: 'category' as const, id: 1 },
    ]
    expect(interleavedTileOrders(newCats, oldCats, imagesByParent, () => displayOrder)).toEqual([])
  })

  it('falls back to the sortOrder template when the display order is entirely stale', () => {
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    const newCats = [
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 1, parentId: null }),
    ]
    const imagesByParent = new Map([
      ['null', [makeImage({ id: 10, sortOrder: 1 }), makeImage({ id: 11, sortOrder: 3 })]],
    ])
    // Coordinator order references only members that no longer exist.
    const staleDisplay = [
      { type: 'category' as const, id: 98 },
      { type: 'image' as const, id: 99 },
    ]
    expect(interleavedTileOrders(newCats, oldCats, imagesByParent, () => staleDisplay)).toEqual([
      {
        scope: null,
        order: [
          { type: 'category', id: 2 },
          { type: 'image', id: 10 },
          { type: 'category', id: 1 },
          { type: 'image', id: 11 },
        ],
      },
    ])
  })

  it('preserves image positions with three categories and two images', () => {
    // Old order: cat_A(0), img_1(1), cat_B(2), cat_C(3), img_2(4)
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 3, parentId: null }),
    ]
    // Reverse categories: C, B, A
    const newCats = [
      makeFlatOption({ id: 3, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 1, parentId: null }),
    ]
    const imagesByParent = new Map([
      ['null', [makeImage({ id: 10, sortOrder: 1 }), makeImage({ id: 11, sortOrder: 4 })]],
    ])
    expect(interleavedTileOrders(newCats, oldCats, imagesByParent)).toEqual([
      {
        scope: null,
        order: [
          { type: 'category', id: 3 },
          { type: 'image', id: 10 },
          { type: 'category', id: 2 },
          { type: 'category', id: 1 },
          { type: 'image', id: 11 },
        ],
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// diffParentMoves
// ---------------------------------------------------------------------------

describe('diffParentMoves', () => {
  it('returns no moves when parents are unchanged', () => {
    const cats = [makeFlatOption({ id: 1, parentId: null }), makeFlatOption({ id: 2, parentId: 1 })]
    expect(diffParentMoves(cats, cats)).toEqual([])
  })

  it('detects a category moved to a new parent', () => {
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    const newCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: 1 }),
    ]
    expect(diffParentMoves(newCats, oldCats)).toEqual([{ categoryId: 2, newParentId: 1 }])
  })

  it('detects a move to root', () => {
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: 1 }),
    ]
    const newCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    expect(diffParentMoves(newCats, oldCats)).toEqual([{ categoryId: 2, newParentId: null }])
  })
})

// ---------------------------------------------------------------------------
// reorderFlatOptions
// ---------------------------------------------------------------------------

describe('reorderFlatOptions', () => {
  const options = [
    makeFlatOption({ id: 1, parentId: null, depth: 0 }),
    makeFlatOption({ id: 3, parentId: 1, depth: 1 }),
    makeFlatOption({ id: 4, parentId: 1, depth: 1 }),
    makeFlatOption({ id: 2, parentId: null, depth: 0 }),
  ]

  it('keeps the original order when no display orders exist', () => {
    expect(reorderFlatOptions(options, () => null).map((o) => o.id)).toEqual([1, 3, 4, 2])
  })

  it('reorders siblings per the scope display order', () => {
    const displayOrders = new Map<number | null, { type: 'category' | 'image'; id: number }[]>([
      [
        null,
        [
          { type: 'category', id: 2 },
          { type: 'category', id: 1 },
        ],
      ],
      [
        1,
        [
          { type: 'image', id: 99 },
          { type: 'category', id: 4 },
          { type: 'category', id: 3 },
        ],
      ],
    ])
    const result = reorderFlatOptions(options, (parentId) => displayOrders.get(parentId) ?? null)
    expect(result.map((o) => o.id)).toEqual([2, 1, 4, 3])
  })

  it('keeps categories missing from the display order in their original slot', () => {
    const result = reorderFlatOptions(options, (parentId) =>
      parentId === null ? [{ type: 'category', id: 2 }] : null,
    )
    expect(result.map((o) => o.id)).toEqual([1, 3, 4, 2])
  })

  it('does not push a just-moved-away category to the end of its old parent', () => {
    const opts = [
      makeFlatOption({ id: 1, parentId: null, depth: 0 }),
      makeFlatOption({ id: 2, parentId: null, depth: 0 }),
      makeFlatOption({ id: 5, parentId: null, depth: 0 }),
    ]
    // Category 1 moved to another parent: the coordinator's display order for
    // the old scope omits it (and reorders the remaining two), but the stale
    // category tree still lists it first. It must keep its slot, not sink.
    const result = reorderFlatOptions(opts, (parentId) =>
      parentId === null
        ? [
            { type: 'category', id: 5 },
            { type: 'category', id: 2 },
          ]
        : null,
    )
    expect(result.map((o) => o.id)).toEqual([1, 5, 2])
  })
})
