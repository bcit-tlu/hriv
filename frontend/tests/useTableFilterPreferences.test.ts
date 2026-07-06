import { useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { loadStoredTableFilters, useTableFilterPreferences } from '../src/useTableFilterPreferences'

type TestFilters = {
  text: Record<string, string>
  roles?: string[]
  programs?: number[]
  groups?: number[]
  visibility?: string[]
}

const defaultValue: TestFilters = {
  text: {},
  roles: [],
  programs: [],
  groups: [],
  visibility: [],
}

function storageKeyFor(tableKey: string, userId: number | string) {
  return `hrivpref:table-filters:${tableKey}:user:${userId}`
}

function usePreferences(tableKey = 'people', initialValue: TestFilters = defaultValue) {
  const [value, setValue] = useState<TestFilters>(initialValue)

  useTableFilterPreferences<TestFilters>({
    tableKey,
    value,
  })

  return { value, setValue }
}

describe('useTableFilterPreferences', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when nothing is stored', () => {
    expect(loadStoredTableFilters<TestFilters>('people')).toBeNull()
  })

  it('returns parsed stored filters', () => {
    const stored = {
      text: { name: 'blood' },
      roles: ['student'],
      programs: [1],
      groups: [7],
      visibility: ['active'],
    }
    localStorage.setItem(storageKeyFor('people', 1), JSON.stringify(stored))

    expect(loadStoredTableFilters<TestFilters>('people')).toEqual(stored)
  })

  it('returns null for corrupted JSON', () => {
    localStorage.setItem(storageKeyFor('people', 1), '{not-json')

    expect(loadStoredTableFilters<TestFilters>('people')).toBeNull()
  })

  it('isolates stored filters by user-scoped key', () => {
    localStorage.setItem(
      storageKeyFor('people', 1),
      JSON.stringify({
        text: { name: 'blood' },
        roles: [],
        programs: [],
        groups: [],
        visibility: [],
      }),
    )

    expect(loadStoredTableFilters<TestFilters>('people')).toEqual({
      text: { name: 'blood' },
      roles: [],
      programs: [],
      groups: [],
      visibility: [],
    })

    localStorage.setItem('hriv_user', JSON.stringify({ id: 2 }))
    expect(loadStoredTableFilters<TestFilters>('people')).toBeNull()
    expect(localStorage.getItem(storageKeyFor('people', 2))).toBeNull()
  })

  it('persists filter changes to localStorage', async () => {
    const { result } = renderHook(() => usePreferences())
    const nextValue: TestFilters = {
      text: { name: 'mira' },
      roles: ['student'],
      programs: [1],
      groups: [7],
      visibility: ['active'],
    }

    act(() => {
      result.current.setValue(nextValue)
    })

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(storageKeyFor('people', 1)) ?? '{}')).toEqual(
        nextValue,
      )
    })
  })

  it('does not overwrite stored data on mount with empty defaults', async () => {
    const storageKey = storageKeyFor('people', 1)
    const stored = {
      text: { name: 'blood' },
      roles: ['student'],
      programs: [1],
      groups: [7],
      visibility: ['active'],
    }
    localStorage.setItem(storageKey, JSON.stringify(stored))

    renderHook(() => usePreferences())

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}')).toEqual(stored)
    })
  })

  it('gracefully handles unavailable localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('unavailable')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable')
    })

    expect(loadStoredTableFilters<TestFilters>('manage-images')).toBeNull()
    const fallback = renderHook(() => usePreferences('manage-images'))
    expect(fallback.result.current.value).toEqual(defaultValue)
  })
})
