import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ImgHTMLAttributes } from 'react'
import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ApiImage } from '../api'
import { renewImageRecord } from '../tileTokenRenewal'

interface RenewingThumbnailProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'onError'
> {
  image: { id: number; thumb: string }
  sx?: SxProps<Theme>
  onImageRenewed?: (image: ApiImage) => void
  /**
   * Alternative renewal fetch for thumbs that are not `GET /api/images/{id}`
   * records (e.g. a collection cover keyed by collection id). Must resolve to
   * a fresh tokenized thumb for the same `id`. `onImageRenewed` is not called
   * on this path because there is no image record to hand back.
   */
  renewThumb?: (id: number) => Promise<{ id: number; thumb: string | null }>
}

export default function RenewingThumbnail({
  image,
  sx,
  onImageRenewed,
  renewThumb,
  ...imgProps
}: RenewingThumbnailProps) {
  const [renewed, setRenewed] = useState<{
    imageId: number
    originalThumb: string
    thumb: string
  } | null>(null)
  const retriedKeysRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const currentRetryKey = `${image.id}:${image.thumb}`
  const currentKeyRef = useRef(currentRetryKey)
  const src =
    renewed?.imageId === image.id && renewed.originalThumb === image.thumb
      ? renewed.thumb
      : image.thumb

  useLayoutEffect(() => {
    currentKeyRef.current = currentRetryKey
  }, [currentRetryKey])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleError = useCallback(() => {
    const retryKey = currentRetryKey
    if (retriedKeysRef.current.has(retryKey)) return
    retriedKeysRef.current.add(retryKey)

    const renewal: Promise<{
      fresh: { id: number; thumb: string | null }
      record: ApiImage | null
    }> = renewThumb
      ? renewThumb(image.id).then((fresh) => ({ fresh, record: null }))
      : renewImageRecord(image.id).then((fresh) => ({ fresh, record: fresh }))
    renewal
      .then(({ fresh, record }) => {
        if (!mountedRef.current || fresh.id !== image.id || currentKeyRef.current !== retryKey) {
          return
        }
        if (record) onImageRenewed?.(record)
        if (fresh.thumb && fresh.thumb !== src) {
          setRenewed({ imageId: image.id, originalThumb: image.thumb, thumb: fresh.thumb })
        }
      })
      .catch(() => {
        // The broken thumbnail remains visible as the browser's fallback.
      })
  }, [currentRetryKey, image.id, image.thumb, onImageRenewed, renewThumb, src])

  return <Box component="img" src={src} onError={handleError} sx={sx} {...imgProps} />
}
