import { useEffect, useRef, useCallback } from 'react'
import OpenSeadragon from 'openseadragon'
import Box from '@mui/material/Box'

export interface ViewportState {
  zoom: number
  x: number
  y: number
}

interface ImageViewerProps {
  tileSources: OpenSeadragon.TileSourceOptions | string
  height?: string
  initialViewport?: ViewportState
  onViewportChange?: (state: ViewportState) => void
}

export default function ImageViewer({
  tileSources,
  height = '70vh',
  initialViewport,
  onViewportChange,
}: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const onViewportChangeRef = useRef(onViewportChange)
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])

  const emitViewport = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer?.viewport) return
    const zoom = viewer.viewport.getZoom()
    const center = viewer.viewport.getCenter()
    onViewportChangeRef.current?.({ zoom, x: center.x, y: center.y })
  }, [])

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

    const viewer = viewerRef.current

    // Restore viewport state after the image has loaded
    if (initialViewport) {
      viewer.addOnceHandler('open', () => {
        viewer.viewport.zoomTo(initialViewport.zoom, undefined, true)
        viewer.viewport.panTo(
          new OpenSeadragon.Point(initialViewport.x, initialViewport.y),
          true,
        )
      })
    }

    // Report viewport changes after animations finish
    viewer.addHandler('animation-finish', emitViewport)

    return () => {
      viewer.destroy()
      viewerRef.current = null
    }
  }, [tileSources, initialViewport, emitViewport])

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
