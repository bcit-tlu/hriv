import { useCallback, useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useTableFilterPreferences } from '../src/useTableFilterPreferences'

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
  const onHydrate = useCallback((nextValue: TestFilters) => {
    setValue(nextValue)
  }, [])

  useTableFilterPreferences<TestFilters>({
    tableKey,
    value,
    onHydrate,
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

  it('returns without calling onHydrate when nothing is stored', () => {
    const onHydrate = vi.fn()
    renderHook(() => {
      const [value] = useState<TestFilters>(defaultValue)
      useTableFilterPreferences<TestFilters>({
        tableKey: 'people',
        value,
        onHydrate,
      })
    })

    expect(onHydrate).not.toHaveBeenCalled()
  })

  it('calls onHydrate with parsed stored filters on mount', async () => {
    const stored = {
      text: { name: 'blood' },
      roles: ['student'],
      programs: [1],
      groups: [7],
      visibility: ['active'],
    }
    localStorage.setItem(storageKeyFor('people', 1), JSON.stringify(stored))

    const { result } = renderHook(() => usePreferences())

    await waitFor(() => {
      expect(result.current.value).toEqual(stored)
    })
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

  it('isolates stored filters by user-scoped key', async () => {
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

    const { result } = renderHook(() => usePreferences())

    await waitFor(() => {
      expect(result.current.value.text).toEqual({ name: 'blood' })
    })

    localStorage.setItem('hriv_user', JSON.stringify({ id: 2 }))
    const second = renderHook(() => usePreferences())

    expect(second.result.current.value).toEqual(defaultValue)
    expect(localStorage.getItem(storageKeyFor('people', 2))).toBeNull()
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

  it('gracefully handles corrupted JSON and unavailable localStorage', () => {
    localStorage.setItem(storageKeyFor('people', 1), '{not-json')

    const { result } = renderHook(() => usePreferences())
    expect(result.current.value).toEqual(defaultValue)

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('unavailable')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable')
    })

    const fallback = renderHook(() => usePreferences('manage-images'))
    expect(fallback.result.current.value).toEqual(defaultValue)
  })
})
