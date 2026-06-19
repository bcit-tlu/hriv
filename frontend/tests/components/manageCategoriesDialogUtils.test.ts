/**
 * Unit tests for ManageCategoriesDialog utility functions:
 * - collectImagesByParent
 * - interleavedSortOrders
 *
 * These cover the sort_order namespace fix from issue #539.
 */

import { describe, it, expect } from 'vitest'
import {
  collectImagesByParent,
  interleavedSortOrders,
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
// interleavedSortOrders
// ---------------------------------------------------------------------------

describe('interleavedSortOrders', () => {
  it('assigns dense sort_orders when no images exist', () => {
    const cats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
    ]
    const { catItems, imgItems } = interleavedSortOrders(cats, cats, new Map())
    expect(imgItems).toHaveLength(0)
    expect(catItems).toEqual([
      { id: 1, parent_id: null, sort_order: 0 },
      { id: 2, parent_id: null, sort_order: 1 },
    ])
  })

  it('assigns dense sort_orders to images when no categories at that parent', () => {
    const imagesByParent = new Map([
      ['null', [makeImage({ id: 10, sortOrder: 0 }), makeImage({ id: 11, sortOrder: 1 })]],
    ])
    const { catItems, imgItems } = interleavedSortOrders([], [], imagesByParent)
    expect(catItems).toHaveLength(0)
    expect(imgItems).toEqual([
      { id: 10, sort_order: 0 },
      { id: 11, sort_order: 1 },
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
    const { catItems, imgItems } = interleavedSortOrders(newCats, oldCats, imagesByParent)

    // Expected: cat_B(0), img_1(1), cat_A(2), img_2(3)
    expect(catItems).toEqual([
      { id: 2, parent_id: null, sort_order: 0 },
      { id: 1, parent_id: null, sort_order: 2 },
    ])
    expect(imgItems).toEqual([
      { id: 10, sort_order: 1 },
      { id: 11, sort_order: 3 },
    ])
  })

  it('handles category moved to a different parent (cross-parent move)', () => {
    // Parent null: cat_A(0), img_root(1), cat_B(2)
    // Parent 1 (cat_A): img_child(0)
    // Move cat_B under cat_A:
    // Parent null: cat_A(0), img_root(1) — cat_B removed
    // Parent 1 (cat_A): img_child(0), cat_B(1) — cat_B added

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
    const { catItems, imgItems } = interleavedSortOrders(newCats, oldCats, imagesByParent)

    // Root: cat_A(0), img_root(1) — cat_B slot collapsed
    const rootCats = catItems.filter((c) => c.parent_id === null)
    expect(rootCats).toEqual([{ id: 1, parent_id: null, sort_order: 0 }])

    const rootImgs = imgItems.filter((i) => {
      // img_10 is at root
      return i.id === 10
    })
    expect(rootImgs).toEqual([{ id: 10, sort_order: 1 }])

    // Under cat_A: img_child(0), cat_B(1) — cat_B appended after images
    const childCats = catItems.filter((c) => c.parent_id === 1)
    expect(childCats).toEqual([{ id: 2, parent_id: 1, sort_order: 1 }])

    const childImgs = imgItems.filter((i) => i.id === 20)
    expect(childImgs).toEqual([{ id: 20, sort_order: 0 }])
  })

  it('handles multiple parents independently', () => {
    const oldCats = [
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 3, parentId: 1 }),
      makeFlatOption({ id: 4, parentId: 1 }),
    ]
    const newCats = [
      makeFlatOption({ id: 2, parentId: null }),
      makeFlatOption({ id: 1, parentId: null }),
      makeFlatOption({ id: 4, parentId: 1 }),
      makeFlatOption({ id: 3, parentId: 1 }),
    ]
    const { catItems } = interleavedSortOrders(newCats, oldCats, new Map())

    const rootCats = catItems.filter((c) => c.parent_id === null)
    expect(rootCats).toEqual([
      { id: 2, parent_id: null, sort_order: 0 },
      { id: 1, parent_id: null, sort_order: 1 },
    ])

    const childCats = catItems.filter((c) => c.parent_id === 1)
    expect(childCats).toEqual([
      { id: 4, parent_id: 1, sort_order: 0 },
      { id: 3, parent_id: 1, sort_order: 1 },
    ])
  })

  it('handles all categories removed from a parent (images get dense sort_orders)', () => {
    // All categories moved away from root, leaving only images
    const oldCats = [makeFlatOption({ id: 1, parentId: null })]
    const newCats = [makeFlatOption({ id: 1, parentId: 5 })] // moved under parent 5
    const imagesByParent = new Map([
      ['null', [makeImage({ id: 10, sortOrder: 0 }), makeImage({ id: 11, sortOrder: 2 })]],
    ])
    const { catItems, imgItems } = interleavedSortOrders(newCats, oldCats, imagesByParent)

    // Root images get dense values
    const rootImgs = imgItems.filter((i) => i.id === 10 || i.id === 11)
    expect(rootImgs).toEqual([
      { id: 10, sort_order: 0 },
      { id: 11, sort_order: 1 },
    ])

    // Cat 1 moved to parent 5 (no images there)
    expect(catItems).toEqual([{ id: 1, parent_id: 5, sort_order: 0 }])
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
    const { catItems, imgItems } = interleavedSortOrders(newCats, oldCats, imagesByParent)

    // Expected: cat_C(0), img_1(1), cat_B(2), cat_A(3), img_2(4)
    expect(catItems).toEqual([
      { id: 3, parent_id: null, sort_order: 0 },
      { id: 2, parent_id: null, sort_order: 2 },
      { id: 1, parent_id: null, sort_order: 3 },
    ])
    expect(imgItems).toEqual([
      { id: 10, sort_order: 1 },
      { id: 11, sort_order: 4 },
    ])
  })
})
