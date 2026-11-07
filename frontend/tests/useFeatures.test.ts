import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFeatures } from '../src/useFeatures'
import { DEFAULT_FEATURES } from '../src/types'

const fetchFeatures = vi.hoisted(() => vi.fn())
vi.mock('../src/api', () => ({ fetchFeatures }))

describe('useFeatures', () => {
  beforeEach(() => {
    fetchFeatures.mockReset()
  })

  it('is null until the flags arrive, then reflects the response', async () => {
    fetchFeatures.mockResolvedValue({ collections: true, collections_home_shelf: true })
    const { result } = renderHook(() => useFeatures())
    expect(result.current).toBeNull()
    await waitFor(() =>
      expect(result.current).toEqual({
        collections: true,
        collectionsStudentAccess: true,
        collectionsHomeShelf: true,
        counting: false,
      }),
    )
    expect(fetchFeatures).toHaveBeenCalledTimes(1)
  })

  it('keeps the shelf off when collections are disabled', async () => {
    fetchFeatures.mockResolvedValue({ collections: false, collections_home_shelf: true })
    const { result } = renderHook(() => useFeatures())
    await waitFor(() =>
      expect(result.current).toEqual({
        collections: false,
        collectionsStudentAccess: true,
        collectionsHomeShelf: false,
        counting: false,
      }),
    )
  })

  it('reads a missing or non-boolean flag as off', async () => {
    fetchFeatures.mockResolvedValue({})
    const { result } = renderHook(() => useFeatures())
    await waitFor(() =>
      expect(result.current).toEqual({
        collections: false,
        collectionsStudentAccess: true,
        collectionsHomeShelf: false,
        counting: false,
      }),
    )
  })

  it('exposes the counting flag only when it is true', async () => {
    fetchFeatures.mockResolvedValue({ counting: true })
    const { result } = renderHook(() => useFeatures())
    await waitFor(() =>
      expect(result.current).toEqual({
        collections: false,
        collectionsStudentAccess: true,
        collectionsHomeShelf: false,
        counting: true,
      }),
    )
    fetchFeatures.mockResolvedValue({ counting: false })
    const second = renderHook(() => useFeatures())
    await waitFor(() =>
      expect(second.result.current).toEqual({
        collections: false,
        collectionsStudentAccess: true,
        collectionsHomeShelf: false,
        counting: false,
      }),
    )
  })

  it.each([true, false])('maps collections_student_access=%s', async (studentAccess) => {
    fetchFeatures.mockResolvedValue({
      collections: true,
      collections_student_access: studentAccess,
    })
    const { result } = renderHook(() => useFeatures())
    await waitFor(() => expect(result.current?.collectionsStudentAccess).toBe(studentAccess))
  })

  it('resolves to DEFAULT_FEATURES (everything off) when the request fails', async () => {
    fetchFeatures.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useFeatures())
    await waitFor(() => expect(result.current).toEqual(DEFAULT_FEATURES))
    expect(DEFAULT_FEATURES.collections).toBe(false)
    expect(DEFAULT_FEATURES.collectionsHomeShelf).toBe(false)
    expect(DEFAULT_FEATURES.collectionsStudentAccess).toBe(true)
  })

  it('ignores a response that lands after unmount', async () => {
    let resolve: (v: { collections: boolean; collections_home_shelf: boolean }) => void = () => {}
    fetchFeatures.mockReturnValue(
      new Promise<{ collections: boolean; collections_home_shelf: boolean }>((r) => {
        resolve = r
      }),
    )
    const { result, unmount } = renderHook(() => useFeatures())
    unmount()
    resolve({ collections: true, collections_home_shelf: true })
    await Promise.resolve()
    expect(result.current).toBeNull()
  })
})
