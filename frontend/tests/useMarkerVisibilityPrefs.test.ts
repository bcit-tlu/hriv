import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_MARKER_VISIBILITY_ENTRIES,
  useMarkerVisibilityPrefs,
} from '../src/useMarkerVisibilityPrefs'
import { MARKER_FIXTURE as item } from '../src/components/markerFixtures'

beforeEach(() => localStorage.clear())
describe('useMarkerVisibilityPrefs', () => {
  it.each([
    null,
    '{',
    'null',
    '[]',
    '{"groups":{"mine":{"markerVisible":"no"}},"items":[null,{}, {"id":"7","source":"mine"}]}',
  ])('safely defaults corrupt/empty data %s', (raw) => {
    if (raw) localStorage.setItem('hriv.markerVisibility.9', raw)
    const { result } = renderHook(() => useMarkerVisibilityPrefs(9))
    expect(result.current.visibilityFor(item)).toEqual({ markerVisible: true, labelVisible: true })
  })
  it('hides public markers by default while leaving their labels enabled', () => {
    const { result } = renderHook(() => useMarkerVisibilityPrefs(9))
    expect(result.current.visibilityFor({ id: 7, source: 'public' })).toEqual({
      markerVisible: false,
      labelVisible: true,
    })
  })
  it('persists independent overrides across remounts; group resets only its own dimension', () => {
    const first = renderHook(() => useMarkerVisibilityPrefs(9))
    act(() => first.result.current.setGroup('mine', 'markerVisible', false))
    act(() => first.result.current.setItem(item, 'markerVisible', true))
    act(() => first.result.current.setItem(item, 'labelVisible', false))
    first.unmount()
    const { result } = renderHook(() => useMarkerVisibilityPrefs(9))
    expect(result.current.visibilityFor(item)).toEqual({ markerVisible: true, labelVisible: false })
    expect(result.current.visibilityFor({ id: 8, source: 'mine' })).toEqual({
      markerVisible: false,
      labelVisible: true,
    })
    act(() => result.current.setGroup('mine', 'markerVisible', false))
    expect(result.current.visibilityFor(item)).toEqual({
      markerVisible: false,
      labelVisible: false,
    })
    act(() => result.current.setGroup('mine', 'labelVisible', true))
    expect(result.current.visibilityFor(item)).toEqual({ markerVisible: false, labelVisible: true })
  })
  it('setItems batches overrides in one write, keeps other dimensions, and skips sourceless rows', () => {
    const other = { id: 8, source: 'instructor' as const }
    const { result } = renderHook(() => useMarkerVisibilityPrefs(9))
    act(() => result.current.setItem(item, 'labelVisible', false))
    act(() =>
      result.current.setItems([item, other, { id: 9, source: null }], 'markerVisible', false),
    )
    expect(result.current.visibilityFor(item)).toEqual({
      markerVisible: false,
      labelVisible: false,
    })
    expect(result.current.visibilityFor(other)).toEqual({
      markerVisible: false,
      labelVisible: true,
    })
    const stored = JSON.parse(localStorage.getItem('hriv.markerVisibility.9')!)
    expect(stored.items).toHaveLength(2)
    expect(stored.items).not.toContainEqual(expect.objectContaining({ id: 9 }))
    act(() => result.current.setItems([item], 'markerVisible', true))
    expect(result.current.visibilityFor(item).markerVisible).toBe(true)
  })
  it('setItems discards the other dimension when a row changed source', () => {
    const moved = { id: 8, source: 'instructor' as const }
    const { result } = renderHook(() => useMarkerVisibilityPrefs(9))
    // Override belongs to (id, source) — a source change must not revive it.
    act(() => result.current.setItem({ id: 8, source: 'public' }, 'labelVisible', false))
    act(() => result.current.setItems([moved], 'markerVisible', false))
    expect(result.current.visibilityFor(moved)).toEqual({
      markerVisible: false,
      labelVisible: true,
    })
    const stored = JSON.parse(localStorage.getItem('hriv.markerVisibility.9')!)
    expect(stored.items).toEqual([{ id: 8, source: 'instructor', markerVisible: false }])
  })
  it('isolates user changes immediately, syncs mounted panes, and consumes storage events', () => {
    const a = renderHook(({ id }) => useMarkerVisibilityPrefs(id), { initialProps: { id: 9 } })
    const b = renderHook(() => useMarkerVisibilityPrefs(9))
    act(() => a.result.current.setItem(item, 'markerVisible', false))
    expect(b.result.current.visibilityFor(item).markerVisible).toBe(false)
    a.rerender({ id: 10 })
    expect(a.result.current.visibilityFor(item).markerVisible).toBe(true)
    act(() => a.result.current.setItem(item, 'labelVisible', false))
    expect(b.result.current.visibilityFor(item).labelVisible).toBe(true)
    a.rerender({ id: 9 })
    expect(a.result.current.visibilityFor(item)).toEqual({
      markerVisible: false,
      labelVisible: true,
    })
    act(() => {
      localStorage.removeItem('hriv.markerVisibility.9')
      const event = new Event('storage')
      Object.defineProperty(event, 'key', { value: 'hriv.markerVisibility.9' })
      window.dispatchEvent(event)
    })
    expect(a.result.current.visibilityFor(item).markerVisible).toBe(true)
  })
  it('bounds saved entries and discards overrides when an item changes source', () => {
    localStorage.setItem(
      'hriv.markerVisibility.9',
      JSON.stringify({
        items: Array.from({ length: 600 }, (_, index) => ({
          id: index + 1,
          source: 'public',
          markerVisible: false,
        })),
      }),
    )
    const { result } = renderHook(() => useMarkerVisibilityPrefs(9))
    expect(result.current.visibilityFor({ id: 600, source: 'public' }).markerVisible).toBe(false)
    expect(result.current.visibilityFor({ id: 600, source: 'mine' }).markerVisible).toBe(true)
    act(() => result.current.setItem({ id: 1, source: 'mine' }, 'labelVisible', false))
    const stored = JSON.parse(localStorage.getItem('hriv.markerVisibility.9')!)
    expect(stored.items).toHaveLength(MAX_MARKER_VISIBILITY_ENTRIES)
    expect(stored.items.at(-1)).toEqual({ id: 1, source: 'mine', labelVisible: false })
  })
  it('works in memory when storage is blocked and does not touch storage when disabled', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const { result } = renderHook(() => useMarkerVisibilityPrefs(999))
    act(() => result.current.setItem(item, 'markerVisible', false))
    expect(result.current.visibilityFor(item).markerVisible).toBe(false)
    spy.mockRestore()
    const read = vi.spyOn(Storage.prototype, 'getItem')
    const disabled = renderHook(() => useMarkerVisibilityPrefs(999, false))
    act(() => disabled.result.current.setGroup('mine', 'markerVisible', false))
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
  })
})
