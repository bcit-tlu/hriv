import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchImageMarkers, userMessage } from './api'
import type { ApiMarker } from './types'

export function useImageMarkers(imageId: number | undefined, enabled: boolean) {
  const generation = useRef({ value: 0 })
  const [state, setState] = useState<{
    imageId?: number
    items: ApiMarker[]
    error: string | null
  }>({ items: [], error: null })
  const reload = useCallback(() => {
    const token = ++generation.current.value
    if (!enabled || imageId == null) return Promise.resolve()
    return fetchImageMarkers(imageId).then(
      (items) => {
        if (token === generation.current.value)
          setState({
            imageId,
            items: items.filter((item) => item.source === 'mine' || item.source === 'instructor'),
            error: null,
          })
      },
      (error) => {
        if (token === generation.current.value)
          setState({ imageId, items: [], error: userMessage(error, 'Unable to load Markers.') })
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
    error: enabled && state.imageId === imageId ? state.error : null,
    reload,
  }
}
