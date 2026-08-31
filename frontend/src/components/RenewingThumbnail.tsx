import { useCallback, useRef, useState } from 'react'
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
}

export default function RenewingThumbnail({
  image,
  sx,
  onImageRenewed,
  ...imgProps
}: RenewingThumbnailProps) {
  const [renewed, setRenewed] = useState<{
    imageId: number
    originalThumb: string
    thumb: string
  } | null>(null)
  const retriedKeysRef = useRef(new Set<string>())
  const src =
    renewed?.imageId === image.id && renewed.originalThumb === image.thumb
      ? renewed.thumb
      : image.thumb

  const handleError = useCallback(() => {
    const retryKey = `${image.id}:${image.thumb}`
    if (retriedKeysRef.current.has(retryKey)) return
    retriedKeysRef.current.add(retryKey)

    renewImageRecord(image.id)
      .then((fresh) => {
        if (fresh.id !== image.id) return
        onImageRenewed?.(fresh)
        if (fresh.thumb && fresh.thumb !== src) {
          setRenewed({ imageId: image.id, originalThumb: image.thumb, thumb: fresh.thumb })
        }
      })
      .catch(() => {
        // The broken thumbnail remains visible as the browser's fallback.
      })
  }, [image.id, image.thumb, onImageRenewed, src])

  return <Box component="img" src={src} onError={handleError} sx={sx} {...imgProps} />
}
