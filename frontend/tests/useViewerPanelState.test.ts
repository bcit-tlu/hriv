import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useViewerPanelState } from '../src/useViewerPanelState'

let userId = 0
let key: string
beforeEach(() => {
  localStorage.clear()
  userId += 1
  key = `hrivpref:viewer-panel:user:${userId}`
})
afterEach(() => vi.restoreAllMocks())

it('defaults closed on Inuksuks and restores both preferences after remounting', () => {
  const first = renderHook(() => useViewerPanelState(userId))
  expect(first.result.current).toMatchObject({ open: false, tab: 'inuksuks' })
  act(() => {
    first.result.current.setOpen(true)
    first.result.current.setTab('details')
  })
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ open: true, tab: 'details' })
  first.unmount()
  expect(renderHook(() => useViewerPanelState(userId)).result.current).toMatchObject({
    open: true,
    tab: 'details',
  })
})

it('isolates users without writing the previous users preference to the new key', () => {
  localStorage.setItem(key, JSON.stringify({ open: true, tab: 'details' }))
  const { result, rerender } = renderHook(({ user }) => useViewerPanelState(user), {
    initialProps: { user: userId },
  })
  rerender({ user: userId + 1000 })
  expect(result.current).toMatchObject({ open: false, tab: 'inuksuks' })
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ open: true, tab: 'details' })
  rerender({ user: userId })
  expect(result.current).toMatchObject({ open: true, tab: 'details' })
})
it('restores the Shared View tab', () => {
  localStorage.setItem(key, JSON.stringify({ open: true, tab: 'share' }))
  expect(renderHook(() => useViewerPanelState(userId)).result.current).toMatchObject({
    open: true,
    tab: 'share',
  })
})

it.each(['{bad json', 'null', '{"open":"yes","tab":"bad"}'])(
  'handles invalid storage %s',
  (value) => {
    localStorage.setItem(key, value)
    expect(renderHook(() => useViewerPanelState(userId)).result.current).toMatchObject({
      open: false,
      tab: 'inuksuks',
    })
  },
)

it.each([undefined, 9])(
  'does not read or write storage when synchronization is disabled, user=%s',
  (user) => {
    const read = vi.spyOn(Storage.prototype, 'getItem')
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useViewerPanelState(user, false))
    act(() => result.current.setOpen(true))
    expect(result.current.open).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  },
)

it.each(['reads and writes', 'writes'])(
  'keeps per-user memory across remounts when storage blocks %s',
  (blocked) => {
    if (blocked === 'reads and writes') {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
    }
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result, unmount } = renderHook(() => useViewerPanelState(userId))
    act(() => {
      result.current.setOpen(true)
      result.current.setTab('details')
    })
    expect(result.current).toMatchObject({ open: true, tab: 'details' })
    unmount()
    expect(renderHook(() => useViewerPanelState(userId + 1000)).result.current).toMatchObject({
      open: false,
      tab: 'inuksuks',
    })
    expect(renderHook(() => useViewerPanelState(userId)).result.current).toMatchObject({
      open: true,
      tab: 'details',
    })
    expect(renderHook(() => useViewerPanelState(userId, false)).result.current).toMatchObject({
      open: false,
      tab: 'inuksuks',
    })
  },
)
