import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getCollapsedDescendantIds,
  resetCategoryTreeExpansionPreferencesForTests,
  useCategoryTreeExpansionPreferences,
} from '../src/useCategoryTreeExpansionPreferences'

interface TestOption {
  id: number
  depth: number
  childCount: number
}

const options: TestOption[] = [
  { id: 1, depth: 0, childCount: 2 },
  { id: 2, depth: 1, childCount: 1 },
  { id: 3, depth: 2, childCount: 0 },
  { id: 4, depth: 1, childCount: 0 },
  { id: 5, depth: 0, childCount: 0 },
]

function renderExpansionHook(currentOptions: TestOption[] = options) {
  return renderHook(() => useCategoryTreeExpansionPreferences(currentOptions))
}

function storageKeyFor(userId: number | string) {
  return `hrivpref:category-tree-collapsed:user:${userId}`
}

describe('useCategoryTreeExpansionPreferences', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCategoryTreeExpansionPreferencesForTests()
  })

  describe('getCollapsedDescendantIds', () => {
    it('returns an empty set when nothing is collapsed', () => {
      expect(getCollapsedDescendantIds(options, new Set())).toEqual(new Set())
    })

    it('hides all descendants of a collapsed root category', () => {
      expect(getCollapsedDescendantIds(options, new Set([1]))).toEqual(new Set([2, 3, 4]))
    })

    it('only hides descendants of the collapsed nested branch', () => {
      expect(getCollapsedDescendantIds(options, new Set([2]))).toEqual(new Set([3]))
    })

    it('ignores stale collapsed ids for leaf categories', () => {
      expect(getCollapsedDescendantIds(options, new Set([3, 5]))).toEqual(new Set())
    })
  })

  it('defaults to everything expanded when no stored preferences exist', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderExpansionHook()

    expect(result.current.collapsedIds).toEqual(new Set())
    expect(result.current.collapsedDescendantIds).toEqual(new Set())
    expect(result.current.visibleOptions).toEqual(options)
    expect(result.current.isExpanded(1)).toBe(true)
  })

  it('toggleExpanded collapses a branch, updates visibility, and persists the user-scoped state', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderExpansionHook()

    act(() => {
      result.current.toggleExpanded(1)
    })

    expect(result.current.collapsedIds).toEqual(new Set([1]))
    expect(result.current.collapsedDescendantIds).toEqual(new Set([2, 3, 4]))
    expect(result.current.visibleOptions).toEqual([options[0], options[4]])
    expect(result.current.isExpanded(1)).toBe(false)
    expect(JSON.parse(localStorage.getItem(storageKeyFor(1)) ?? '[]')).toEqual([1])
  })

  it('loads stored state independently for different users', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    const firstUser = renderExpansionHook()

    act(() => {
      firstUser.result.current.toggleExpanded(2)
    })
    firstUser.unmount()

    localStorage.setItem('hriv_user', JSON.stringify({ id: 2 }))
    const secondUser = renderExpansionHook()

    expect(secondUser.result.current.collapsedIds).toEqual(new Set())
    expect(secondUser.result.current.visibleOptions).toEqual(options)
    expect(JSON.parse(localStorage.getItem(storageKeyFor(1)) ?? '[]')).toEqual([2])
    expect(localStorage.getItem(storageKeyFor(2))).toBeNull()
  })

  it('keeps separate hook instances synchronized through the shared store', async () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const firstInstance = renderExpansionHook()
    const secondInstance = renderExpansionHook()

    act(() => {
      firstInstance.result.current.toggleExpanded(2)
    })

    await waitFor(() => {
      expect(secondInstance.result.current.collapsedIds).toEqual(new Set([2]))
    })
    expect(secondInstance.result.current.visibleOptions).toEqual([
      options[0],
      options[1],
      options[3],
      options[4],
    ])
    expect(secondInstance.result.current.isExpanded(2)).toBe(false)
  })

  it('resetCategoryTreeExpansionPreferencesForTests clears the cached snapshot between renders', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(storageKeyFor(1), JSON.stringify([1]))

    const initial = renderExpansionHook()
    expect(initial.result.current.collapsedIds).toEqual(new Set([1]))
    initial.unmount()

    localStorage.removeItem(storageKeyFor(1))

    const withoutReset = renderExpansionHook()
    expect(withoutReset.result.current.collapsedIds).toEqual(new Set([1]))
    withoutReset.unmount()

    resetCategoryTreeExpansionPreferencesForTests()

    const afterReset = renderExpansionHook()
    expect(afterReset.result.current.collapsedIds).toEqual(new Set())
    expect(afterReset.result.current.visibleOptions).toEqual(options)
  })
})
