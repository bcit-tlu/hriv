import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMyCollectionsDrawerState } from '../src/useMyCollectionsDrawerState'

const STORAGE_KEY = 'hrivpref:my-collections-drawer:pinned:user:7'

describe('useMyCollectionsDrawerState', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('hriv_user', JSON.stringify({ id: 7 }))
  })

  it('defaults to closed and unpinned', () => {
    const { result } = renderHook(() => useMyCollectionsDrawerState())

    expect(result.current.open).toBe(false)
    expect(result.current.pinned).toBe(false)
  })

  it('loads the exact pinned preference key and starts open', () => {
    localStorage.setItem(STORAGE_KEY, 'true')

    const { result } = renderHook(() => useMyCollectionsDrawerState())

    expect(result.current.pinned).toBe(true)
    expect(result.current.open).toBe(true)
  })

  it('persists pin changes under the exact user-scoped key', () => {
    const { result } = renderHook(() => useMyCollectionsDrawerState())

    act(() => result.current.setPinned(true))

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('closes when unpinned', () => {
    const { result } = renderHook(() => useMyCollectionsDrawerState())

    act(() => {
      result.current.setOpen(true)
      result.current.setPinned(true)
    })
    act(() => result.current.setPinned(false))

    expect(result.current.pinned).toBe(false)
    expect(result.current.open).toBe(false)
  })

  it('keeps the pinned preference when collapsed', () => {
    const { result } = renderHook(() => useMyCollectionsDrawerState())

    act(() => result.current.setPinned(true))
    act(() => result.current.setOpen(true))
    act(() => result.current.setOpen(false))

    expect(result.current.pinned).toBe(true)
    expect(result.current.open).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })
})
