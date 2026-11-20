import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchBoard, fetchBoards, fetchMarkers, userMessage } from './api'
import type { ApiBoard, ApiBoardSummary, ApiMarker } from './types'

export function useBoardsData(boardId: number | null, favourites: boolean, enabled = true) {
  const generation = useRef({ value: 0 })
  const boardGeneration = useRef({ value: 0 })
  const key = `${favourites}:${enabled}`
  const [state, setState] = useState<{
    key: string
    boards: ApiBoardSummary[]
    recent: ApiMarker[]
    error: string | null
  } | null>(null)
  const [detail, setDetail] = useState<{
    id: number
    board: ApiBoard | null
    error: string | null
  } | null>(null)
  const reloadOverview = useCallback(async () => {
    const token = ++generation.current.value
    if (!enabled) return
    await Promise.resolve()
    if (token !== generation.current.value) return
    try {
      const allBoards = async () => {
        const rows: ApiBoardSummary[] = []
        for (let page = 1; ; page++) {
          const batch = await fetchBoards({
            sort: 'sort_order',
            order: 'asc',
            page,
            page_size: 200,
          })
          rows.push(...batch)
          if (batch.length < 200 || token !== generation.current.value) return rows
        }
      }
      const allMarkers = async () => {
        const rows: ApiMarker[] = []
        for (let page = 1; ; page++) {
          const batch = await fetchMarkers({
            sort: 'sort_order',
            order: 'asc',
            favourite: favourites || undefined,
            page,
            page_size: 200,
          })
          rows.push(...batch)
          if (batch.length < 200 || token !== generation.current.value) return rows
        }
      }
      const [boards, recent] = await Promise.all([allBoards(), allMarkers()])
      if (token === generation.current.value) setState({ key, boards, recent, error: null })
    } catch (error) {
      if (token === generation.current.value)
        setState((previous) => ({
          key,
          boards: previous?.key === key ? previous.boards : [],
          recent: previous?.key === key ? previous.recent : [],
          error: userMessage(error, 'Unable to load Boards.'),
        }))
    }
  }, [favourites, enabled, key])
  const reloadBoard = useCallback(async () => {
    const token = ++boardGeneration.current.value
    if (!enabled || boardId == null) return
    try {
      const board = await fetchBoard(boardId)
      if (token === boardGeneration.current.value) setDetail({ id: boardId, board, error: null })
    } catch (error) {
      if (token === boardGeneration.current.value)
        setDetail((previous) => ({
          id: boardId,
          board: previous?.id === boardId ? previous.board : null,
          error: userMessage(error, 'Unable to load Board.'),
        }))
    }
  }, [boardId, enabled])
  useEffect(() => {
    const counter = generation.current
    void reloadOverview()
    return () => {
      counter.value++
    }
  }, [reloadOverview])
  useEffect(() => {
    const counter = boardGeneration.current
    void reloadBoard()
    return () => {
      counter.value++
    }
  }, [reloadBoard])
  const reload = useCallback(async () => {
    await Promise.all([reloadOverview(), reloadBoard()])
  }, [reloadOverview, reloadBoard])
  const upsertBoard = useCallback(
    (board: ApiBoardSummary) => {
      setState((previous) =>
        previous?.key !== key
          ? previous
          : {
              ...previous,
              boards: [...previous.boards.filter((row) => row.id !== board.id), board].sort(
                (a, b) => a.sort_order - b.sort_order || a.id - b.id,
              ),
            },
      )
    },
    [key],
  )
  const current = enabled && state?.key === key ? state : null
  const currentBoard = enabled && detail?.id === boardId ? detail : null
  return {
    boards: current?.boards ?? [],
    board: currentBoard?.board ?? null,
    recent: current?.recent ?? [],
    error: current?.error ?? currentBoard?.error ?? null,
    loading: enabled && !current,
    boardLoading: enabled && boardId != null && !currentBoard,
    reload,
    upsertBoard,
  }
}
