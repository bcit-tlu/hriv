import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRowsPerPagePreference } from '../src/useRowsPerPagePreference'

function storageKeyFor(tableKey: string, userId: number | string) {
  return `hrivpref:rows-per-page:${tableKey}:user:${userId}`
}

describe('useRowsPerPagePreference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the default when no stored preference exists', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderHook(() => useRowsPerPagePreference('manage-images'))

    expect(result.current[0]).toBe(25)
  })

  it('loads a stored preference on mount', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(storageKeyFor('manage-images', 1), '50')

    const { result } = renderHook(() => useRowsPerPagePreference('manage-images'))

    expect(result.current[0]).toBe(50)
  })

  it('persists changes to localStorage', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))

    const { result } = renderHook(() => useRowsPerPagePreference('manage-images'))

    act(() => {
      result.current[1](10)
    })

    expect(result.current[0]).toBe(10)
    expect(localStorage.getItem(storageKeyFor('manage-images', 1))).toBe('10')
  })

  it('falls back to the default for values outside the allowed options', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(storageKeyFor('manage-images', 1), '9999')

    const { result } = renderHook(() => useRowsPerPagePreference('manage-images'))

    expect(result.current[0]).toBe(25)
  })

  it('falls back to the default for unparseable stored values', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(storageKeyFor('manage-images', 1), 'not-a-number')

    const { result } = renderHook(() => useRowsPerPagePreference('manage-images'))

    expect(result.current[0]).toBe(25)
  })

  it('scopes the stored preference per user', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 2 }))
    localStorage.setItem(storageKeyFor('manage-images', 1), '50')

    const { result } = renderHook(() => useRowsPerPagePreference('manage-images'))

    expect(result.current[0]).toBe(25)
  })

  it('scopes the stored preference per table', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    localStorage.setItem(storageKeyFor('people', 1), '5')

    const { result } = renderHook(() => useRowsPerPagePreference('manage-images'))

    expect(result.current[0]).toBe(25)
  })

  it('keeps the in-memory value when localStorage writes fail', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    const { result } = renderHook(() => useRowsPerPagePreference('manage-images'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    act(() => {
      result.current[1](50)
    })

    expect(result.current[0]).toBe(50)
  })
})
