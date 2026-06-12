import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTableColumnPreferences } from '../src/useTableColumnPreferences'

type TestColumn = 'name' | 'email' | 'role'

const allColumns = ['name', 'email', 'role'] as const satisfies readonly TestColumn[]
const defaultVisibleColumns = ['name', 'role'] as const satisfies readonly TestColumn[]

function renderPreferencesHook(tableKey = 'people') {
  return renderHook(() =>
    useTableColumnPreferences<TestColumn>({
      tableKey,
      allColumns,
      defaultVisibleColumns,
    }),
  )
}

function storageKeyFor(userId: number | string) {
  return storageKeyForTable('people', userId)
}

function storageKeyForTable(tableKey: string, userId: number | string) {
  return `hrivpref:table-columns:${tableKey}:user:${userId}`
}

describe('useTableColumnPreferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the default visibility when no stored preferences exist', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderPreferencesHook()

    expect(result.current.visibleColumns).toEqual({
      name: true,
      email: false,
      role: true,
    })
    expect(result.current.isColumnVisible('name')).toBe(true)
    expect(result.current.isColumnVisible('email')).toBe(false)
  })

  it('loads stored preferences from localStorage on mount', () => {
    const storageKey = storageKeyFor(1)
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(storageKey, JSON.stringify({
      name: false,
      email: true,
      role: false,
    }))

    const { result } = renderPreferencesHook()

    expect(result.current.visibleColumns).toEqual({
      name: false,
      email: true,
      role: false,
    })
  })

  it('setColumnVisible updates state and persists to localStorage', () => {
    const storageKey = storageKeyFor(1)
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderPreferencesHook()

    act(() => {
      result.current.setColumnVisible('email', true)
    })

    expect(result.current.visibleColumns.email).toBe(true)
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}')).toMatchObject({
      name: true,
      email: true,
      role: true,
    })
  })

  it('toggleColumn flips a column visibility value', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderPreferencesHook()

    act(() => {
      result.current.toggleColumn('role')
    })

    expect(result.current.visibleColumns.role).toBe(false)
  })

  it('isColumnVisible returns the current boolean visibility state', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderPreferencesHook()

    expect(result.current.isColumnVisible('name')).toBe(true)
    expect(result.current.isColumnVisible('email')).toBe(false)

    act(() => {
      result.current.toggleColumn('email')
    })

    expect(result.current.isColumnVisible('email')).toBe(true)
  })

  it('stores preferences in user-scoped keys so different users stay isolated', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    const firstUser = renderPreferencesHook()

    act(() => {
      firstUser.result.current.setColumnVisible('name', false)
    })
    firstUser.unmount()

    localStorage.setItem('hriv_user', JSON.stringify({ id: 2 }))
    const secondUser = renderPreferencesHook()

    expect(secondUser.result.current.visibleColumns).toEqual({
      name: true,
      email: false,
      role: true,
    })
    expect(JSON.parse(localStorage.getItem(storageKeyFor(1)) ?? '{}')).toMatchObject({
      name: false,
      email: false,
      role: true,
    })
    expect(localStorage.getItem(storageKeyFor(2))).toBeNull()
  })

  it('falls back to default visibility when stored preference JSON is corrupted', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(storageKeyFor(1), '{not-json')

    const { result } = renderPreferencesHook()

    expect(result.current.visibleColumns).toEqual({
      name: true,
      email: false,
      role: true,
    })
  })

  it('gracefully falls back to in-memory state when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })

    const { result } = renderPreferencesHook()

    expect(result.current.visibleColumns).toEqual({
      name: true,
      email: false,
      role: true,
    })

    act(() => {
      result.current.toggleColumn('email')
    })

    expect(result.current.visibleColumns.email).toBe(true)
  })

  it('does not rewrite the current visibility snapshot on initial mount', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    renderPreferencesHook()

    expect(setItemSpy).not.toHaveBeenCalledWith(
      storageKeyFor(1),
      JSON.stringify({
        name: true,
        email: false,
        role: true,
      }),
    )
  })

  it('does not write stale visibility data when the storage key changes', async () => {
    const firstState = {
      name: false,
      email: true,
      role: false,
    }
    const secondState = {
      name: true,
      email: false,
      role: true,
    }
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(storageKeyForTable('people', 1), JSON.stringify(firstState))
    localStorage.setItem(storageKeyForTable('admin', 1), JSON.stringify(secondState))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const { result, rerender } = renderHook(
      ({ tableKey }) =>
        useTableColumnPreferences<TestColumn>({
          tableKey,
          allColumns,
          defaultVisibleColumns,
        }),
      { initialProps: { tableKey: 'people' } },
    )

    setItemSpy.mockClear()
    rerender({ tableKey: 'admin' })

    expect(result.current.visibleColumns).toEqual(secondState)
    expect(setItemSpy).not.toHaveBeenCalledWith(
      storageKeyForTable('admin', 1),
      JSON.stringify(firstState),
    )
  })
})
