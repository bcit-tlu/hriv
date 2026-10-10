import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useImageInfoExpandedPreference } from '../src/useImageInfoExpandedPreference'

function storageKeyFor(userId: number | string) {
  return `hrivpref:image-info-expanded:user:${userId}`
}

describe('useImageInfoExpandedPreference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to collapsed', () => {
    const { result } = renderHook(() => useImageInfoExpandedPreference(null))

    expect(result.current[0]).toBe(false)
  })

  it('loads the stored expanded preference', () => {
    localStorage.setItem(storageKeyFor(1), '1')

    const { result } = renderHook(() => useImageInfoExpandedPreference(1))

    expect(result.current[0]).toBe(true)
  })

  it('treats missing and invalid values as collapsed', () => {
    localStorage.setItem(storageKeyFor(1), 'true')

    const { result } = renderHook(() => useImageInfoExpandedPreference(1))

    expect(result.current[0]).toBe(false)
  })

  it('persists changes using the user-scoped key', () => {
    const { result } = renderHook(() => useImageInfoExpandedPreference(1))

    act(() => {
      result.current[1](true)
    })

    expect(result.current[0]).toBe(true)
    expect(localStorage.getItem(storageKeyFor(1))).toBe('1')
  })

  it('loads each active user preference without overwriting the previous user', () => {
    localStorage.setItem(storageKeyFor(1), '1')
    localStorage.setItem(storageKeyFor(2), '0')

    const { result, rerender } = renderHook(
      ({ userId }: { userId: number }) => useImageInfoExpandedPreference(userId),
      { initialProps: { userId: 1 } },
    )

    expect(result.current[0]).toBe(true)
    rerender({ userId: 2 })
    expect(result.current[0]).toBe(false)
    expect(localStorage.getItem(storageKeyFor(1))).toBe('1')
    expect(localStorage.getItem(storageKeyFor(2))).toBe('0')

    rerender({ userId: 1 })
    expect(result.current[0]).toBe(true)
  })

  it('resolves functional updates against the current preference', () => {
    localStorage.setItem(storageKeyFor(1), '1')
    const { result } = renderHook(() => useImageInfoExpandedPreference(1))

    act(() => {
      result.current[1]((expanded) => !expanded)
    })

    expect(result.current[0]).toBe(false)
    expect(localStorage.getItem(storageKeyFor(1))).toBe('0')
  })

  it('does not access localStorage when persistence is disabled', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() =>
      useImageInfoExpandedPreference(1, { enablePersistence: false }),
    )

    expect(result.current[0]).toBe(false)
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()

    act(() => {
      result.current[1](true)
    })

    expect(result.current[0]).toBe(true)
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('tolerates localStorage read and write failures', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('unavailable')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable')
    })

    const { result } = renderHook(() => useImageInfoExpandedPreference(1))

    expect(result.current[0]).toBe(false)
    act(() => {
      result.current[1](true)
    })
    expect(result.current[0]).toBe(true)
  })
})
