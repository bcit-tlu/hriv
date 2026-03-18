import { useEffect, useRef } from 'react'
import OpenSeadragon from 'openseadragon'
import Box from '@mui/material/Box'

interface ImageViewerProps {
  tileSources: OpenSeadragon.TileSourceOptions | string
  height?: string
}

export default function ImageViewer({
  tileSources,
  height = '70vh',
}: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    viewerRef.current = OpenSeadragon({
      element: containerRef.current,
      tileSources,
      prefixUrl:
        'https://cdn.jsdelivr.net/npm/openseadragon@6/build/openseadragon/images/',
      animationTime: 0.4,
      blendTime: 0.1,
      minZoomImageRatio: 0.8,
      maxZoomPixelRatio: 4,
      visibilityRatio: 1,
      constrainDuringPan: true,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      navigatorSizeRatio: 0.15,
      gestureSettingsMouse: { scrollToZoom: true },
    })

    return () => {
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [tileSources])

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'grey.900',
      }}
    />
  )
}
