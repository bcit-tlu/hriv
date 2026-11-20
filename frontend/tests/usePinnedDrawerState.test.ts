import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePinnedDrawerState } from '../src/usePinnedDrawerState'

describe('usePinnedDrawerState', () => {
  beforeEach(() => localStorage.clear())

  it('isolates drawer and user preferences and reopens pinned drawers on remount', () => {
    const first = renderHook(() => usePinnedDrawerState('9', 'markers-drawer'))
    expect(first.result.current).toMatchObject({ open: false, pinned: false })
    act(() => {
      first.result.current.setOpen((open) => !open)
      first.result.current.setPinned(true)
    })
    expect(localStorage.getItem('hrivpref:markers-drawer:pinned:user:9')).toBe('true')
    first.unmount()
    const { result, rerender } = renderHook(
      ({ user, drawer }) => usePinnedDrawerState(user, drawer),
      { initialProps: { user: '9', drawer: 'markers-drawer' } },
    )
    expect(result.current).toMatchObject({ open: true, pinned: true })
    rerender({ user: '9', drawer: 'my-collections-drawer' })
    expect(result.current).toMatchObject({ open: false, pinned: false })
    rerender({ user: '10', drawer: 'markers-drawer' })
    expect(result.current).toMatchObject({ open: false, pinned: false })
    rerender({ user: '9', drawer: 'markers-drawer' })
    act(() => result.current.setPinned(false))
    expect(result.current).toMatchObject({ open: true, pinned: false })
    expect(localStorage.getItem('hrivpref:markers-drawer:pinned:user:9')).toBe('false')
  })

  it('defaults malformed values to unpinned', () => {
    localStorage.setItem('hrivpref:markers-drawer:pinned:user:9', 'not true')
    const { result } = renderHook(() => usePinnedDrawerState('9', 'markers-drawer'))
    expect(result.current).toMatchObject({ open: false, pinned: false })
  })

  it('disables storage reads and writes while retaining in-memory state and scope isolation', () => {
    localStorage.setItem('hrivpref:markers-drawer:pinned:user:9', 'true')
    const read = vi.spyOn(Storage.prototype, 'getItem')
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const { result, rerender } = renderHook(
      ({ user, sync }) => usePinnedDrawerState(user, 'markers-drawer', sync),
      { initialProps: { user: '9', sync: false } },
    )
    expect(result.current).toMatchObject({ open: false, pinned: false })
    act(() => {
      result.current.setOpen(true)
      result.current.setPinned(true)
    })
    expect(result.current).toMatchObject({ open: true, pinned: true })
    rerender({ user: '10', sync: false })
    expect(result.current).toMatchObject({ open: false, pinned: false })
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    rerender({ user: '10', sync: true })
    act(() => result.current.setPinned(true))
    expect(write).toHaveBeenCalledWith('hrivpref:markers-drawer:pinned:user:10', 'true')
    write.mockClear()
    rerender({ user: '10', sync: false })
    act(() => result.current.setPinned(false))
    expect(result.current).toMatchObject({ pinned: false })
    expect(write).not.toHaveBeenCalled()
    read.mockRestore()
    write.mockRestore()
  })

  it('keeps working in memory when storage reads and writes fail', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => usePinnedDrawerState('9', 'markers-drawer'))
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
