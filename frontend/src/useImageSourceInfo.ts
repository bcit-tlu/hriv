import { useEffect, useRef, useState } from 'react'
import { fetchImageSourceInfo } from './api'
import type { ImageSourceInfo } from './types'

export function useImageSourceInfo(
  imageId: number | null,
  version: number,
  enabled: boolean,
): ImageSourceInfo | null {
  const key = imageId === null ? null : `${imageId}:${version}`
  const [sourceInfoByKey, setSourceInfoByKey] = useState<Map<string, ImageSourceInfo | null>>(
    () => new Map(),
  )
  const [requestTick, setRequestTick] = useState(0)
  const inFlightRef = useRef(new Map<string, Promise<ImageSourceInfo | null>>())
  const currentKeyRef = useRef<string | null>(key)
  const keyGenerationRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (currentKeyRef.current !== key) {
      currentKeyRef.current = key
      keyGenerationRef.current += 1
    }
  }, [key])

  useEffect(() => {
    if (!enabled || imageId === null || key === null || sourceInfoByKey.has(key)) return
    if (inFlightRef.current.has(key)) return

    const generation = keyGenerationRef.current
    const request = fetchImageSourceInfo(imageId).catch(() => null)
    inFlightRef.current.set(key, request)
    void request.then((sourceInfo) => {
      inFlightRef.current.delete(key)
      if (!mountedRef.current) return
      if (currentKeyRef.current !== key) return
      if (keyGenerationRef.current !== generation) {
        setRequestTick((tick) => tick + 1)
        return
      }
      setSourceInfoByKey((current) => new Map(current).set(key, sourceInfo))
    })
  }, [enabled, imageId, key, requestTick, sourceInfoByKey])

  if (!enabled || key === null) return null
  return sourceInfoByKey.get(key) ?? null
}
