import { describe, expect, it } from 'vitest'
import {
  flattenCategoryOptions,
  formatCategoryItemCounts,
  formatCategoryItemCountsForCategory,
} from '../../src/components/categoryOptionUtils'
import { makeCategory, makeImage } from '../helpers/fixtures'

describe('formatCategoryItemCounts', () => {
  it('returns Empty when there are no sub-categories or images', () => {
    expect(formatCategoryItemCounts(0, 0)).toBe('Empty')
  })

  it('formats image counts only', () => {
    expect(formatCategoryItemCounts(0, 1)).toBe('1 image')
    expect(formatCategoryItemCounts(0, 3)).toBe('3 images')
  })

  it('formats sub-category counts only', () => {
    expect(formatCategoryItemCounts(1, 0)).toBe('1 sub-category')
    expect(formatCategoryItemCounts(3, 0)).toBe('3 sub-categories')
  })

  it('formats sub-categories and images separated by a middle dot', () => {
    expect(formatCategoryItemCounts(2, 5)).toBe('2 sub-categories · 5 images')
  })
})

describe('formatCategoryItemCountsForCategory', () => {
  it('counts descendant sub-categories and images recursively', () => {
    const category = makeCategory({
      id: 1,
      label: 'Parent',
      children: [
        makeCategory({
          id: 2,
          label: 'Child',
          parentId: 1,
          images: [makeImage({ id: 10 }), makeImage({ id: 11 })],
          children: [
            makeCategory({
              id: 3,
              label: 'Grandchild',
              parentId: 2,
              images: [makeImage({ id: 12 })],
            }),
          ],
        }),
      ],
      images: [makeImage({ id: 13 })],
    })

    expect(formatCategoryItemCountsForCategory(category)).toBe('2 sub-categories · 4 images')
  })

  it('returns Empty for an empty leaf category', () => {
    const category = makeCategory({ id: 1, label: 'Empty' })
    expect(formatCategoryItemCountsForCategory(category)).toBe('Empty')
  })
})

describe('flattenCategoryOptions', () => {
  it('computes total descendant image and child counts', () => {
    const categories = [
      makeCategory({
        id: 1,
        label: 'Root',
        children: [
          makeCategory({
            id: 2,
            label: 'Child',
            parentId: 1,
            images: [makeImage({ id: 10 })],
          }),
        ],
        images: [makeImage({ id: 11 }), makeImage({ id: 12 })],
      }),
    ]

    const options = flattenCategoryOptions(categories)
    const root = options.find((o) => o.id === 1)!
    const child = options.find((o) => o.id === 2)!

    expect(root.childCount).toBe(1)
    expect(root.imageCount).toBe(3)
    expect(child.childCount).toBe(0)
    expect(child.imageCount).toBe(1)
  })
})
