import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBoardsData } from '../src/useBoardsData'
import * as api from '../src/api'
import { BOARDS_FIXTURES, BOARD_ITEMS } from '../src/components/boardsFixtures'

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchBoards: vi.fn(),
  fetchBoard: vi.fn(),
  fetchInuksuks: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchBoards).mockResolvedValue(BOARDS_FIXTURES)
  vi.mocked(api.fetchBoard).mockResolvedValue(BOARDS_FIXTURES[0])
  vi.mocked(api.fetchInuksuks).mockResolvedValue(BOARD_ITEMS)
})
describe('useBoardsData', () => {
  it('is dark when disabled', () => {
    renderHook(() => useBoardsData(1, false, false))
    expect(api.fetchBoards).not.toHaveBeenCalled()
    expect(api.fetchBoard).not.toHaveBeenCalled()
  })
  it('loads the overview, including its favourites filter', async () => {
    const { result } = renderHook(() => useBoardsData(null, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.recent).toHaveLength(6)
    expect(api.fetchInuksuks).toHaveBeenCalledWith(
      expect.objectContaining({ favourite: true, limit: 60 }),
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
  it('loads a selected Board without a second recent request', async () => {
    const { result } = renderHook(() => useBoardsData(1, false))
    await waitFor(() => expect(result.current.board?.id).toBe(1))
    expect(api.fetchInuksuks).not.toHaveBeenCalled()
  })
  it('handles empty and error results and recovers on reload', async () => {
    vi.mocked(api.fetchBoards).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useBoardsData(null, false))
    await waitFor(() => expect(result.current.error).toBeTruthy())
    vi.mocked(api.fetchBoards).mockResolvedValue([])
    vi.mocked(api.fetchInuksuks).mockResolvedValue([])
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
