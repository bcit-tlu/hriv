import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchBoard, fetchBoards, fetchInuksuks, userMessage } from './api'
import type { ApiBoard, ApiBoardSummary, ApiInuksuk } from './types'

export function useBoardsData(boardId: number | null, favourites: boolean, enabled = true) {
  const generation = useRef({ value: 0 })
  const key = `${boardId}:${favourites}:${enabled}`
  const [state, setState] = useState<{
    key: string
    boards: ApiBoardSummary[]
    board: ApiBoard | null
    recent: ApiInuksuk[]
    error: string | null
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const reload = useCallback(async () => {
    const token = ++generation.current.value
    if (!enabled) return
    await Promise.resolve()
    if (token !== generation.current.value) return
    setLoading(true)
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
      const [boards, board, recent] = await Promise.all([
        allBoards(),
        boardId == null ? Promise.resolve(null) : fetchBoard(boardId),
        boardId == null
          ? fetchInuksuks({
              sort: 'updated_at',
              order: 'desc',
              favourite: favourites || undefined,
              limit: 60,
            })
          : Promise.resolve([]),
      ])
      if (token === generation.current.value) setState({ key, boards, board, recent, error: null })
    } catch (error) {
      if (token === generation.current.value)
        setState({
          key,
          boards: [],
          board: null,
          recent: [],
          error: userMessage(error, 'Unable to load Boards.'),
        })
    } finally {
      if (token === generation.current.value) setLoading(false)
    }
  }, [boardId, favourites, enabled, key])
  useEffect(() => {
    const counter = generation.current
    void reload()
    return () => {
      counter.value++
    }
  }, [reload])
  const current = enabled && state?.key === key ? state : null
  return {
    boards: current?.boards ?? [],
    board: current?.board ?? null,
    recent: current?.recent ?? [],
    error: current?.error ?? null,
    loading: enabled && (loading || !current),
    reload,
  }
}
