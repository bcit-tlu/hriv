import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useViewerPanelState } from '../src/useViewerPanelState'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())
const key = 'hrivpref:viewer-panel:user:9'

it('defaults closed on Inuksuks and restores both preferences after remounting', () => {
  const first = renderHook(() => useViewerPanelState(9))
  expect(first.result.current).toMatchObject({ open: false, tab: 'inuksuks' })
  act(() => {
    first.result.current.setOpen(true)
    first.result.current.setTab('details')
  })
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ open: true, tab: 'details' })
  first.unmount()
  expect(renderHook(() => useViewerPanelState(9)).result.current).toMatchObject({
    open: true,
    tab: 'details',
  })
})

it('isolates users without writing the previous users preference to the new key', () => {
  localStorage.setItem(key, JSON.stringify({ open: true, tab: 'details' }))
  const { result, rerender } = renderHook(({ user }) => useViewerPanelState(user), {
    initialProps: { user: 9 },
  })
  rerender({ user: 10 })
  expect(result.current).toMatchObject({ open: false, tab: 'inuksuks' })
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ open: true, tab: 'details' })
  rerender({ user: 9 })
  expect(result.current).toMatchObject({ open: true, tab: 'details' })
})

it.each(['{bad json', 'null', '{"open":"yes","tab":"bad"}'])(
  'handles invalid storage %s',
  (value) => {
    localStorage.setItem(key, value)
    expect(renderHook(() => useViewerPanelState(9)).result.current).toMatchObject({
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

it('falls back to memory when browser storage throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const { result } = renderHook(() => useViewerPanelState(9))
  act(() => {
    result.current.setOpen(true)
    result.current.setTab('details')
  })
  expect(result.current).toMatchObject({ open: true, tab: 'details' })
})
