import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchImageInuksuks, userMessage } from './api'
import type { ApiInuksuk } from './types'

export function useImageInuksuks(imageId: number | undefined, enabled: boolean) {
  const generation = useRef({ value: 0 })
  const [state, setState] = useState<{
    imageId?: number
    items: ApiInuksuk[]
    error: string | null
  }>({ items: [], error: null })
  const reload = useCallback(() => {
    const token = ++generation.current.value
    if (!enabled || imageId == null) return Promise.resolve()
    return fetchImageInuksuks(imageId).then(
      (items) => {
        if (token === generation.current.value) setState({ imageId, items, error: null })
      },
      (error) => {
        if (token === generation.current.value)
          setState({ imageId, items: [], error: userMessage(error, 'Unable to load Inuksuks.') })
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
