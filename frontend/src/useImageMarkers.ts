import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchBoards, fetchImageMarkers, userMessage } from './api'
import type { ApiBoardSummary, ApiMarker } from './types'

async function allBoards(): Promise<ApiBoardSummary[] | null> {
  try {
    const rows: ApiBoardSummary[] = []
    for (let page = 1; ; page++) {
      const batch = await fetchBoards({ sort: 'sort_order', order: 'asc', page, page_size: 200 })
      rows.push(...batch)
      if (batch.length < 200) return rows
    }
  } catch {
    return null
  }
}

export function useImageMarkers(imageId: number | undefined, enabled: boolean) {
  const generation = useRef({ value: 0 })
  const [state, setState] = useState<{
    imageId?: number
    items: ApiMarker[]
    boards: ApiBoardSummary[] | null
    error: string | null
  }>({ items: [], boards: null, error: null })
  const reload = useCallback(() => {
    const token = ++generation.current.value
    if (!enabled || imageId == null) return Promise.resolve()
    return Promise.all([fetchImageMarkers(imageId), allBoards()]).then(
      ([items, boards]) => {
        if (token === generation.current.value)
          setState((previous) => ({
            imageId,
            items: items.filter((item) => item.source !== null),
            boards: boards ?? previous.boards ?? [],
            error: null,
          }))
      },
      (error) => {
        if (token === generation.current.value)
          setState((previous) => ({
            imageId,
            items: [],
            boards: previous.boards,
            error: userMessage(error, 'Unable to load Markers.'),
          }))
      },
    )
  }, [imageId, enabled])
  useEffect(() => {
    const counter = generation.current
    void reload()
    return () => {
      counter.value++
    }
  }, [reload])
  return {
    items: enabled && state.imageId === imageId ? state.items : [],
    boards: enabled ? state.boards : null,
    error: enabled && state.imageId === imageId ? state.error : null,
    reload,
  }
}
