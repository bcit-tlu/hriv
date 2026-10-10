import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useImageInfoExpandedPreference } from '../src/useImageInfoExpandedPreference'

function storageKeyFor(userId: number | string) {
  return `hrivpref:image-info-expanded:user:${userId}`
}

describe('useImageInfoExpandedPreference', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to collapsed', () => {
    const { result } = renderHook(() => useImageInfoExpandedPreference())

    expect(result.current[0]).toBe(false)
  })

  it('loads the stored expanded preference', () => {
    localStorage.setItem(storageKeyFor(1), '1')

    const { result } = renderHook(() => useImageInfoExpandedPreference())

    expect(result.current[0]).toBe(true)
  })

  it('treats missing and invalid values as collapsed', () => {
    localStorage.setItem(storageKeyFor(1), 'true')

    const { result } = renderHook(() => useImageInfoExpandedPreference())

    expect(result.current[0]).toBe(false)
  })

  it('persists changes using the user-scoped key', () => {
    const { result } = renderHook(() => useImageInfoExpandedPreference())

    act(() => {
      result.current[1](true)
    })

    expect(result.current[0]).toBe(true)
    expect(localStorage.getItem(storageKeyFor(1))).toBe('1')
  })

  it('tolerates localStorage read and write failures', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('unavailable')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable')
    })

    const { result } = renderHook(() => useImageInfoExpandedPreference())

    expect(result.current[0]).toBe(false)
    act(() => {
      result.current[1](true)
    })
    expect(result.current[0]).toBe(true)
  })
})
