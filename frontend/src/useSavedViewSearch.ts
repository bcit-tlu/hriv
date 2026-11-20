import { useEffect, useState } from 'react'
import { fetchBoards, fetchMarkers, userMessage } from './api'
import type { ApiBoardSummary, ApiMarker } from './types'
import { parseSearchQuery } from './searchQuery'

const EMPTY_RESULTS = { boards: [] as ApiBoardSummary[], markers: [] as ApiMarker[], error: null }

export function useSavedViewSearch(enabled: boolean, query: string) {
  const key = `${enabled}:${query}`
  const [state, setState] = useState<{
    key: string
    boards: ApiBoardSummary[]
    markers: ApiMarker[]
    error: string | null
  } | null>(null)
  useEffect(() => {
    if (!enabled || !query.trim()) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const boards = new Map<number, ApiBoardSummary>()
        const markers = new Map<number, ApiMarker>()
        await Promise.all(
          parseSearchQuery(query).map(async (q) => {
            for (let page = 1; !controller.signal.aborted; page++) {
              const batch = await fetchBoards(
                { q, page, page_size: 200 },
                { signal: controller.signal },
              )
              batch.forEach((row) => boards.set(row.id, row))
              if (batch.length < 200) break
            }
            for (let page = 1; !controller.signal.aborted; page++) {
              const batch = await fetchMarkers(
                { q, page, page_size: 200 },
                { signal: controller.signal },
              )
              batch.forEach((row) => markers.set(row.id, row))
              if (batch.length < 200) break
            }
          }),
        )
        if (!controller.signal.aborted)
          setState({
            key,
            boards: [...boards.values()],
            markers: [...markers.values()],
            error: null,
          })
      } catch (err) {
        if (!controller.signal.aborted)
          setState({
            key,
            boards: [],
            markers: [],
            error: userMessage(err, 'Unable to search saved views.'),
          })
      }
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, query, key])
  return state?.key === key ? state : EMPTY_RESULTS
}
