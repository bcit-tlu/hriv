import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMyCollectionsDrawerState } from '../src/useMyCollectionsDrawerState'

const STORAGE_KEY = 'hrivpref:my-collections-drawer:pinned:user:7'

describe('useMyCollectionsDrawerState', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to closed and unpinned', () => {
    const { result } = renderHook(() => useMyCollectionsDrawerState('anonymous'))

    expect(result.current.open).toBe(false)
    expect(result.current.pinned).toBe(false)
  })

  it('uses the passed user scope for the pinned preference key', () => {
    localStorage.setItem(STORAGE_KEY, 'true')

    const { result } = renderHook(() => useMyCollectionsDrawerState('7'))

    expect(result.current.pinned).toBe(true)
    expect(result.current.open).toBe(true)
  })

  it('reloads the preference when the user scope changes and writes to the new key', () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    const { result, rerender } = renderHook(
      ({ userScope }: { userScope: string }) => useMyCollectionsDrawerState(userScope),
      { initialProps: { userScope: 'anonymous' } },
    )

    expect(result.current.pinned).toBe(false)
    rerender({ userScope: '7' })

    expect(result.current.pinned).toBe(true)
    expect(result.current.open).toBe(true)

    localStorage.removeItem(STORAGE_KEY)
    act(() => result.current.setPinned(true))

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
    expect(localStorage.getItem('hrivpref:my-collections-drawer:pinned:user:anonymous')).toBeNull()
  })

  it('closes when unpinned', () => {
    const { result } = renderHook(() => useMyCollectionsDrawerState('7'))

    act(() => {
      result.current.setOpen(true)
      result.current.setPinned(true)
    })
    act(() => result.current.setPinned(false))

    expect(result.current.pinned).toBe(false)
    expect(result.current.open).toBe(false)
  })

  it('keeps the pinned preference when collapsed', () => {
    const { result } = renderHook(() => useMyCollectionsDrawerState('7'))

    act(() => result.current.setPinned(true))
    act(() => result.current.setOpen(true))
    act(() => result.current.setOpen(false))

    expect(result.current.pinned).toBe(true)
    expect(result.current.open).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })
})
