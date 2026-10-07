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

function orderStorageKeyFor(userId: number | string) {
  return orderStorageKeyForTable('people', userId)
}

function orderStorageKeyForTable(tableKey: string, userId: number | string) {
  return `hrivpref:table-column-order:${tableKey}:user:${userId}`
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
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        name: false,
        email: true,
        role: false,
      }),
    )

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

  it('defaults column order to allColumns order when no stored order exists', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderPreferencesHook()

    expect(result.current.columnOrder).toEqual(['name', 'email', 'role'])
    expect(result.current.orderedVisibleColumns).toEqual(['name', 'role'])
  })

  it('loads stored column order from localStorage on mount', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(orderStorageKeyFor(1), JSON.stringify(['role', 'name', 'email']))

    const { result } = renderPreferencesHook()

    expect(result.current.columnOrder).toEqual(['role', 'name', 'email'])
  })

  it('setColumnOrder updates state and persists to localStorage', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderPreferencesHook()

    act(() => {
      result.current.setColumnOrder(['email', 'role', 'name'])
    })

    expect(result.current.columnOrder).toEqual(['email', 'role', 'name'])
    expect(JSON.parse(localStorage.getItem(orderStorageKeyFor(1)) ?? '[]')).toEqual([
      'email',
      'role',
      'name',
    ])
    // Visibility storage stays under its own key and untouched by ordering.
    expect(localStorage.getItem(storageKeyFor(1))).toBeNull()
  })

  it('drops unknown keys from a stored order and appends new columns at the end', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(orderStorageKeyFor(1), JSON.stringify(['role', 'removed_column', 'name']))

    const { result } = renderPreferencesHook()

    expect(result.current.columnOrder).toEqual(['role', 'name', 'email'])
  })

  it('deduplicates repeated keys and ignores non-string entries in a stored order', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(orderStorageKeyFor(1), JSON.stringify(['email', 'email', 42, 'name']))

    const { result } = renderPreferencesHook()

    expect(result.current.columnOrder).toEqual(['email', 'name', 'role'])
  })

  it('normalizes setColumnOrder input the same way as stored data', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderPreferencesHook()

    act(() => {
      result.current.setColumnOrder(['role', 'bogus' as TestColumn, 'role'])
    })

    expect(result.current.columnOrder).toEqual(['role', 'name', 'email'])
  })

  it('orderedVisibleColumns follows order and visibility together', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderPreferencesHook()

    act(() => {
      result.current.setColumnOrder(['role', 'email', 'name'])
    })
    expect(result.current.orderedVisibleColumns).toEqual(['role', 'name'])

    act(() => {
      result.current.setColumnVisible('email', true)
    })
    expect(result.current.orderedVisibleColumns).toEqual(['role', 'email', 'name'])

    act(() => {
      result.current.setColumnVisible('name', false)
    })
    expect(result.current.orderedVisibleColumns).toEqual(['role', 'email'])
  })

  it('stores column order in user-scoped keys so different users stay isolated', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    const firstUser = renderPreferencesHook()

    act(() => {
      firstUser.result.current.setColumnOrder(['role', 'name', 'email'])
    })
    firstUser.unmount()

    localStorage.setItem('hriv_user', JSON.stringify({ id: 2 }))
    const secondUser = renderPreferencesHook()

    expect(secondUser.result.current.columnOrder).toEqual(['name', 'email', 'role'])
    expect(JSON.parse(localStorage.getItem(orderStorageKeyFor(1)) ?? '[]')).toEqual([
      'role',
      'name',
      'email',
    ])
    expect(localStorage.getItem(orderStorageKeyFor(2))).toBeNull()
  })

  it('falls back to allColumns order when stored order JSON is corrupted', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(orderStorageKeyFor(1), '{not-json')

    const { result } = renderPreferencesHook()

    expect(result.current.columnOrder).toEqual(['name', 'email', 'role'])
  })

  it('falls back to allColumns order when stored order is not an array', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(orderStorageKeyFor(1), JSON.stringify({ order: ['role'] }))

    const { result } = renderPreferencesHook()

    expect(result.current.columnOrder).toEqual(['name', 'email', 'role'])
  })

  it('keeps reordering in memory when localStorage writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })

    const { result } = renderPreferencesHook()

    act(() => {
      result.current.setColumnOrder(['email', 'name', 'role'])
    })

    expect(result.current.columnOrder).toEqual(['email', 'name', 'role'])
  })

  it('does not rewrite the current order snapshot on initial mount', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    renderPreferencesHook()

    expect(setItemSpy).not.toHaveBeenCalledWith(
      orderStorageKeyFor(1),
      JSON.stringify(['name', 'email', 'role']),
    )
  })

  it('does not write stale order data when the storage key changes', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(orderStorageKeyForTable('people', 1), JSON.stringify(['role']))
    localStorage.setItem(
      orderStorageKeyForTable('admin', 1),
      JSON.stringify(['email', 'name', 'role']),
    )
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

    expect(result.current.columnOrder).toEqual(['email', 'name', 'role'])
    expect(setItemSpy).not.toHaveBeenCalledWith(
      orderStorageKeyForTable('admin', 1),
      JSON.stringify(['role', 'name', 'email']),
    )
  })
})
