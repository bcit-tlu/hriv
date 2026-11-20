import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBoardsData } from '../src/useBoardsData'
import * as api from '../src/api'
import { BOARDS_FIXTURES, BOARD_ITEMS } from '../src/components/boardsFixtures'

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchBoards: vi.fn(),
  fetchBoard: vi.fn(),
  fetchMarkers: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchBoards).mockResolvedValue(BOARDS_FIXTURES)
  vi.mocked(api.fetchBoard).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.fetchMarkers).mockResolvedValue(BOARD_ITEMS)
})
describe('useBoardsData', () => {
  it('refreshes silently and retains the overview while opening and closing a Board', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: number | null }) => useBoardsData(id, false),
      {
        initialProps: { id: null },
      },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    const items = result.current.recent
    let finish = () => {}
    vi.mocked(api.fetchBoards).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve(BOARDS_FIXTURES)
      }),
    )
    let refresh: Promise<void>
    act(() => {
      refresh = result.current.reload()
    })
    await waitFor(() => expect(api.fetchBoards).toHaveBeenCalledTimes(2))
    expect(result.current.loading).toBe(false)
    expect(result.current.recent).toBe(items)
    await act(async () => {
      finish()
      await refresh
    })
    const refreshed = result.current.recent
    vi.clearAllMocks()
    rerender({ id: 1 })
    await waitFor(() => expect(result.current.board?.id).toBe(1))
    expect(result.current.recent).toBe(refreshed)
    expect(api.fetchBoards).not.toHaveBeenCalled()
    expect(api.fetchMarkers).not.toHaveBeenCalled()
    rerender({ id: null })
    expect(result.current.loading).toBe(false)
    expect(result.current.recent).toBe(refreshed)
  })
  it('retains loaded data and reports a silent refresh error', async () => {
    const { result } = renderHook(() => useBoardsData(null, false))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const items = result.current.recent
    const boards = result.current.boards
    vi.mocked(api.fetchBoards).mockRejectedValueOnce(new Error('offline'))
    await act(() => result.current.reload())
    expect(result.current.recent).toBe(items)
    expect(result.current.boards).toBe(boards)
    expect(result.current.error).toBeTruthy()
    expect(result.current.loading).toBe(false)
  })
  it('is dark when disabled', () => {
    renderHook(() => useBoardsData(1, false, false))
    expect(api.fetchBoards).not.toHaveBeenCalled()
    expect(api.fetchBoard).not.toHaveBeenCalled()
  })
  it('loads the overview, including its favourites filter', async () => {
    const { result } = renderHook(() => useBoardsData(null, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.recent).toHaveLength(6)
    expect(api.fetchMarkers).toHaveBeenCalledWith(
      expect.objectContaining({ favourite: true, page: 1, page_size: 200 }),
    )
  })
  it('paginates all Boards, avoiding truncated owner order', async () => {
    vi.mocked(api.fetchBoards)
      .mockResolvedValueOnce(
        Array.from({ length: 200 }, (_, id) => ({ ...BOARDS_FIXTURES[0], id })),
      )
      .mockResolvedValueOnce([BOARDS_FIXTURES[1]])
    const { result } = renderHook(() => useBoardsData(null, false))
    await waitFor(() => expect(result.current.boards).toHaveLength(201))
    expect(api.fetchBoards).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, page_size: 200 }),
    )
  })
  it('paginates all visible Markers beyond the former recent limit', async () => {
    vi.mocked(api.fetchMarkers)
      .mockResolvedValueOnce(Array.from({ length: 200 }, (_, id) => ({ ...BOARD_ITEMS[0], id })))
      .mockResolvedValueOnce([{ ...BOARD_ITEMS[0], id: 201 }])
    const { result } = renderHook(() => useBoardsData(null, false))
    await waitFor(() => expect(result.current.recent).toHaveLength(201))
    expect(api.fetchMarkers).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, page_size: 200 }),
    )
  })
  it('loads the selected Board and overview for the dialog backdrop', async () => {
    const { result } = renderHook(() => useBoardsData(1, false))
    await waitFor(() => expect(result.current.board?.id).toBe(1))
    expect(api.fetchMarkers).toHaveBeenCalled()
  })
  it('handles empty and error results and recovers on reload', async () => {
    vi.mocked(api.fetchBoards).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useBoardsData(null, false))
    await waitFor(() => expect(result.current.error).toBeTruthy())
    vi.mocked(api.fetchBoards).mockResolvedValue([])
    vi.mocked(api.fetchMarkers).mockResolvedValue([])
    await act(() => result.current.reload())
    expect(result.current.error).toBeNull()
    expect(result.current.recent).toEqual([])
  })
  it('ignores a late response after navigating to another Board', async () => {
    let resolve: (value: (typeof BOARDS_FIXTURES)[0]) => void = () => {}
    vi.mocked(api.fetchBoard)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done
        }),
      )
      .mockResolvedValueOnce(BOARDS_FIXTURES[1])
    const { result, rerender } = renderHook(({ id }) => useBoardsData(id, false), {
      initialProps: { id: 1 },
    })
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledWith(1))
    rerender({ id: 3 })
    await waitFor(() => expect(result.current.board?.id).toBe(3))
    await act(async () => resolve(BOARDS_FIXTURES[0]))
    expect(result.current.board?.id).toBe(3)
  })
})
