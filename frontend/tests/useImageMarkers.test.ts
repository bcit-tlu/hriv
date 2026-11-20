import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useImageMarkers } from '../src/useImageMarkers'
import { BOARD_FIXTURE, MARKER_FIXTURE } from '../src/components/markerFixtures'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), boards: vi.fn() }))
vi.mock('../src/api', () => ({
  fetchImageMarkers: mocks.fetch,
  fetchBoards: mocks.boards,
  userMessage: () => 'Unable to load Markers',
}))
beforeEach(() => {
  mocks.fetch.mockReset().mockResolvedValue([])
  mocks.boards.mockReset().mockResolvedValue([])
})
describe('useImageMarkers', () => {
  it('never fetches without the flag or an image id', () => {
    const { rerender } = renderHook(({ id, enabled }) => useImageMarkers(id, enabled), {
      initialProps: { id: undefined as number | undefined, enabled: true },
    })
    rerender({ id: 42, enabled: false })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('loads through the image endpoint and refetches after changes', async () => {
    mocks.fetch.mockResolvedValueOnce([MARKER_FIXTURE]).mockResolvedValueOnce([])
    const { result } = renderHook(() => useImageMarkers(42, true))
    await waitFor(() => expect(result.current.items).toEqual([MARKER_FIXTURE]))
    await act(() => result.current.reload())
    expect(result.current.items).toEqual([])
    expect(mocks.fetch).toHaveBeenNthCalledWith(2, 42)
  })
  it('keeps every drawer-visible source but drops unclassified markers', async () => {
    const instructor = { ...MARKER_FIXTURE, id: 8, source: 'instructor' as const }
    const publicView = { ...MARKER_FIXTURE, id: 9, source: 'public' as const }
    const unclassified = { ...MARKER_FIXTURE, id: 10, source: null }
    mocks.fetch.mockResolvedValue([MARKER_FIXTURE, instructor, publicView, unclassified])
    const { result } = renderHook(() => useImageMarkers(42, true))
    await waitFor(() =>
      expect(result.current.items).toEqual([MARKER_FIXTURE, instructor, publicView]),
    )
  })
  it('fetches boards alongside markers and keeps prior boards when the board fetch fails', async () => {
    mocks.fetch.mockResolvedValue([MARKER_FIXTURE])
    mocks.boards.mockResolvedValue([BOARD_FIXTURE])
    const { result } = renderHook(() => useImageMarkers(42, true))
    await waitFor(() => expect(result.current.boards).toEqual([BOARD_FIXTURE]))
    expect(mocks.boards).toHaveBeenCalledWith({
      sort: 'sort_order',
      order: 'asc',
      page: 1,
      page_size: 200,
    })
    mocks.boards.mockRejectedValue(new Error('boards down'))
    await act(() => result.current.reload())
    expect(result.current.items).toEqual([MARKER_FIXTURE])
    expect(result.current.boards).toEqual([BOARD_FIXTURE])
    expect(result.current.error).toBeNull()
  })
  it('pages through boards until a short batch', async () => {
    const full = Array.from({ length: 200 }, (_, index) => ({
      ...BOARD_FIXTURE,
      id: index + 1,
    }))
    mocks.boards.mockResolvedValueOnce(full).mockResolvedValueOnce([BOARD_FIXTURE])
    const { result } = renderHook(() => useImageMarkers(42, true))
    await waitFor(() => expect(result.current.boards).toHaveLength(201))
    expect(mocks.boards).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }))
  })
  it('keeps loaded boards when a marker refetch fails', async () => {
    mocks.boards.mockResolvedValue([BOARD_FIXTURE])
    mocks.fetch.mockResolvedValueOnce([MARKER_FIXTURE]).mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useImageMarkers(42, true))
    await waitFor(() => expect(result.current.items).toEqual([MARKER_FIXTURE]))
    await act(() => result.current.reload())
    expect(result.current.error).toBe('Unable to load Markers')
    expect(result.current.items).toEqual([])
    expect(result.current.boards).toEqual([BOARD_FIXTURE])
  })
  it('discards an old image response, hides old records immediately and surfaces failures', async () => {
    let resolve!: (value: unknown) => void
    mocks.fetch
      .mockReturnValueOnce(
        new Promise((r) => {
          resolve = r
        }),
      )
      .mockRejectedValueOnce(new Error('network'))
    const { result, rerender } = renderHook(({ id }) => useImageMarkers(id, true), {
      initialProps: { id: 42 },
    })
    rerender({ id: 43 })
    expect(result.current.items).toEqual([])
    await waitFor(() => expect(result.current.error).toBe('Unable to load Markers'))
    await act(async () => resolve([MARKER_FIXTURE]))
    expect(result.current.items).toEqual([])
  })
})
