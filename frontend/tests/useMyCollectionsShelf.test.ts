import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import * as api from '../src/api'
import { apiCollectionSummaryToSummary } from '../src/collectionUtils'
import { useMyCollectionsShelf } from '../src/useMyCollectionsShelf'
import { makeApiCollectionSummary } from './helpers/fixtures'

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  fetchCollections: vi.fn(),
}))

const fetchCollections = vi.mocked(api.fetchCollections)

describe('useMyCollectionsShelf', () => {
  beforeEach(() => {
    fetchCollections.mockReset()
  })

  it('fetches eight owned collections and maps the API summaries', async () => {
    const row = makeApiCollectionSummary()
    fetchCollections.mockResolvedValue([row])
    const { result } = renderHook(() => useMyCollectionsShelf(true))

    expect(result.current.collections).toBeNull()
    await waitFor(() =>
      expect(result.current.collections).toEqual([apiCollectionSummaryToSummary(row)]),
    )
    expect(fetchCollections).toHaveBeenCalledWith({ mine: true, limit: 8 })
  })

  it('does not fetch while disabled and returns null', () => {
    const { result } = renderHook(() => useMyCollectionsShelf(false))

    expect(result.current.collections).toBeNull()
    expect(fetchCollections).not.toHaveBeenCalled()
  })

  it('returns an empty list when the fetch fails', async () => {
    fetchCollections.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useMyCollectionsShelf(true))

    await waitFor(() =>
      expect(result.current.collections).toEqual([apiCollectionSummaryToSummary(first)]),
    )
  })

  it('retains previous rows while refetching after being disabled and re-enabled', async () => {
    const first = makeApiCollectionSummary({ id: 1, name: 'First collection' })
    const second = makeApiCollectionSummary({ id: 2, name: 'New collection' })
    let resolveRefetch: ((rows: (typeof first)[]) => void) | undefined
    fetchCollections.mockResolvedValueOnce([first]).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefetch = resolve
        }),
    )
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMyCollectionsShelf(enabled),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(result.current.collections).toEqual([]))

    act(() => rerender({ enabled: false }))
    expect(result.current.collections).toBeNull()
    act(() => rerender({ enabled: true }))
    expect(result.current.collections).toEqual([apiCollectionSummaryToSummary(first)])
    await waitFor(() => expect(fetchCollections).toHaveBeenCalledTimes(2))
    act(() => resolveRefetch?.([second]))
    await waitFor(() =>
      expect(result.current.collections).toEqual([apiCollectionSummaryToSummary(second)]),
    )
  })

  it('reload() refetches without blanking the current rows', async () => {
    const first = makeApiCollectionSummary({ id: 1 })
    const second = makeApiCollectionSummary({ id: 2 })
    fetchCollections.mockResolvedValueOnce([first]).mockResolvedValueOnce([second])
    const { result } = renderHook(() => useMyCollectionsShelf(true))
    await waitFor(() =>
      expect(result.current.collections).toEqual([apiCollectionSummaryToSummary(first)]),
    )

    act(() => result.current.reload())
    // In-place refresh keeps the stale rows until the fetch lands.
    expect(result.current.collections).toEqual([apiCollectionSummaryToSummary(first)])
    await waitFor(() =>
      expect(result.current.collections).toEqual([apiCollectionSummaryToSummary(second)]),
    )
    expect(fetchCollections).toHaveBeenCalledTimes(2)
  })
})
