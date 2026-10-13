import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_COLLECTIONS_VIEW_PREFS,
  useCollectionsViewPreference,
} from '../src/useCollectionsViewPreference'

function storageKeyFor(userId: number | string) {
  return `hrivpref:collections-view:user:${userId}`
}

describe('useCollectionsViewPreference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to cards, first order, shared off', () => {
    const { result } = renderHook(() => useCollectionsViewPreference(null))

    expect(result.current[0]).toEqual(DEFAULT_COLLECTIONS_VIEW_PREFS)
  })

  it('loads the stored preference', () => {
    localStorage.setItem(
      storageKeyFor(1),
      JSON.stringify({ view: 'graph', order: 3, sharedOnly: true }),
    )

    const { result } = renderHook(() => useCollectionsViewPreference(1))

    expect(result.current[0]).toEqual({ view: 'graph', order: 3, sharedOnly: true })
  })

  it('falls back field-by-field when the stored value is invalid', () => {
    localStorage.setItem(
      storageKeyFor(1),
      JSON.stringify({ view: 'mosaic', order: 9, sharedOnly: 'yes' }),
    )

    const { result } = renderHook(() => useCollectionsViewPreference(1))

    expect(result.current[0]).toEqual(DEFAULT_COLLECTIONS_VIEW_PREFS)
  })

  it('falls back entirely on malformed JSON', () => {
    localStorage.setItem(storageKeyFor(1), '{oops')

    const { result } = renderHook(() => useCollectionsViewPreference(1))

    expect(result.current[0]).toEqual(DEFAULT_COLLECTIONS_VIEW_PREFS)
  })

  it('persists changes under the user-scoped key', () => {
    const { result } = renderHook(() => useCollectionsViewPreference(1))

    act(() => {
      result.current[1]((p) => ({ ...p, view: 'graph', order: 2 }))
    })

    expect(result.current[0].view).toBe('graph')
    expect(JSON.parse(localStorage.getItem(storageKeyFor(1)) ?? '{}')).toEqual({
      view: 'graph',
      order: 2,
      sharedOnly: false,
    })
  })

  it('keeps each user preference separate across a sign-out switch', () => {
    localStorage.setItem(
      storageKeyFor(1),
      JSON.stringify({ view: 'table', order: 1, sharedOnly: false }),
    )
    localStorage.setItem(
      storageKeyFor(2),
      JSON.stringify({ view: 'graph', order: 3, sharedOnly: true }),
    )

    const { result, rerender } = renderHook(
      ({ userId }: { userId: number | null }) => useCollectionsViewPreference(userId),
      { initialProps: { userId: 1 } },
    )

    expect(result.current[0].view).toBe('table')
    rerender({ userId: 2 })
    expect(result.current[0]).toEqual({ view: 'graph', order: 3, sharedOnly: true })
    // Signed out: anonymous scope, defaults — and writing does not touch user 2.
    rerender({ userId: null })
    expect(result.current[0]).toEqual(DEFAULT_COLLECTIONS_VIEW_PREFS)
    act(() => {
      result.current[1]({ view: 'table', order: 2, sharedOnly: false })
    })
    rerender({ userId: 2 })
    expect(result.current[0].view).toBe('graph')
  })

  it('ignores storage when persistence is disabled', () => {
    localStorage.setItem(
      storageKeyFor(1),
      JSON.stringify({ view: 'graph', order: 3, sharedOnly: true }),
    )

    const { result } = renderHook(() =>
      useCollectionsViewPreference(1, { enablePersistence: false }),
    )

    expect(result.current[0]).toEqual(DEFAULT_COLLECTIONS_VIEW_PREFS)
    act(() => {
      result.current[1]({ view: 'table', order: 1, sharedOnly: false })
    })
    expect(result.current[0].view).toBe('table')
    expect(localStorage.getItem(storageKeyFor(1))).toContain('graph')
  })
})
