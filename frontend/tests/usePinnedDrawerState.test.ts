import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePinnedDrawerState } from '../src/usePinnedDrawerState'

describe('usePinnedDrawerState', () => {
  beforeEach(() => localStorage.clear())

  it('isolates drawer and user preferences and reopens pinned drawers on remount', () => {
    const first = renderHook(() => usePinnedDrawerState('9', 'inuksuks-drawer'))
    expect(first.result.current).toMatchObject({ open: false, pinned: false })
    act(() => {
      first.result.current.setOpen((open) => !open)
      first.result.current.setPinned(true)
    })
    expect(localStorage.getItem('hrivpref:inuksuks-drawer:pinned:user:9')).toBe('true')
    first.unmount()
    const { result, rerender } = renderHook(
      ({ user, drawer }) => usePinnedDrawerState(user, drawer),
      { initialProps: { user: '9', drawer: 'inuksuks-drawer' } },
    )
    expect(result.current).toMatchObject({ open: true, pinned: true })
    rerender({ user: '9', drawer: 'my-collections-drawer' })
    expect(result.current).toMatchObject({ open: false, pinned: false })
    rerender({ user: '10', drawer: 'inuksuks-drawer' })
    expect(result.current).toMatchObject({ open: false, pinned: false })
    rerender({ user: '9', drawer: 'inuksuks-drawer' })
    act(() => result.current.setPinned(false))
    expect(result.current).toMatchObject({ open: true, pinned: false })
    expect(localStorage.getItem('hrivpref:inuksuks-drawer:pinned:user:9')).toBe('false')
  })

  it('defaults malformed values to unpinned', () => {
    localStorage.setItem('hrivpref:inuksuks-drawer:pinned:user:9', 'not true')
    const { result } = renderHook(() => usePinnedDrawerState('9', 'inuksuks-drawer'))
    expect(result.current).toMatchObject({ open: false, pinned: false })
  })

  it('keeps working in memory when storage reads and writes fail', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => usePinnedDrawerState('9', 'inuksuks-drawer'))
    expect(result.current).toMatchObject({ open: false, pinned: false })
    act(() => {
      result.current.setOpen(true)
      result.current.setPinned(true)
    })
    expect(result.current).toMatchObject({ open: true, pinned: true })
    read.mockRestore()
    write.mockRestore()
  })
})
