import { useEffect, useRef, useCallback } from 'react'
import OpenSeadragon from 'openseadragon'
import Box from '@mui/material/Box'

export interface ViewportState {
  zoom: number
  x: number
  y: number
  rotation?: number
}

interface ImageViewerProps {
  tileSources: OpenSeadragon.TileSourceOptions | string
  height?: string
  initialViewport?: ViewportState
  onViewportChange?: (state: ViewportState) => void
}

interface DragState {
  overlayElement: HTMLDivElement
  startPos: OpenSeadragon.Point
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
  const selectionModeRef = useRef(false)
  const dragRef = useRef<DragState | null>(null)
  const overlaysRef = useRef<HTMLDivElement[]>([])
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])

  const emitViewport = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer?.viewport) return
    const zoom = viewer.viewport.getZoom()
    const center = viewer.viewport.getCenter()
    const rotation = viewer.viewport.getRotation()
    onViewportChangeRef.current?.({ zoom, x: center.x, y: center.y, rotation })
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    viewerRef.current = OpenSeadragon({
      element: containerRef.current,
      tileSources,
      prefixUrl: '/openseadragon-svg-icons/',
      navImages: {
        zoomIn: {
          REST: 'zoomin_rest.svg',
          GROUP: 'zoomin_grouphover.svg',
          HOVER: 'zoomin_hover.svg',
          DOWN: 'zoomin_pressed.svg',
        },
        zoomOut: {
          REST: 'zoomout_rest.svg',
          GROUP: 'zoomout_grouphover.svg',
          HOVER: 'zoomout_hover.svg',
          DOWN: 'zoomout_pressed.svg',
        },
        home: {
          REST: 'home_rest.svg',
          GROUP: 'home_grouphover.svg',
          HOVER: 'home_hover.svg',
          DOWN: 'home_pressed.svg',
        },
        fullpage: {
          REST: 'fullpage_rest.svg',
          GROUP: 'fullpage_grouphover.svg',
          HOVER: 'fullpage_hover.svg',
          DOWN: 'fullpage_pressed.svg',
        },
        rotateleft: {
          REST: 'rotateleft_rest.svg',
          GROUP: 'rotateleft_grouphover.svg',
          HOVER: 'rotateleft_hover.svg',
          DOWN: 'rotateleft_pressed.svg',
        },
        rotateright: {
          REST: 'rotateright_rest.svg',
          GROUP: 'rotateright_grouphover.svg',
          HOVER: 'rotateright_hover.svg',
          DOWN: 'rotateright_pressed.svg',
        },
        previous: {
          REST: 'previous_rest.svg',
          GROUP: 'previous_grouphover.svg',
          HOVER: 'previous_hover.svg',
          DOWN: 'previous_pressed.svg',
        },
        next: {
          REST: 'next_rest.svg',
          GROUP: 'next_grouphover.svg',
          HOVER: 'next_hover.svg',
          DOWN: 'next_pressed.svg',
        },
        flip: {
          REST: 'flip_rest.svg',
          GROUP: 'flip_grouphover.svg',
          HOVER: 'flip_hover.svg',
          DOWN: 'flip_pressed.svg',
        },
      },
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
      // Rotation controls
      showRotationControl: true,
      gestureSettingsTouch: { pinchRotate: true },
      // Position controls at bottom-left
      navigationControlAnchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
    })

    const viewer = viewerRef.current

    // --- Selection rectangle toolbar button ---
    const prefix = '/openseadragon-svg-icons/'
    const selectionButton = new OpenSeadragon.Button({
      tooltip: 'Draw selection rectangle',
      srcRest: prefix + 'selection_rest.svg',
      srcGroup: prefix + 'selection_grouphover.svg',
      srcHover: prefix + 'selection_hover.svg',
      srcDown: prefix + 'selection_pressed.svg',
      onClick: () => {
        selectionModeRef.current = !selectionModeRef.current
        viewer.setMouseNavEnabled(!selectionModeRef.current)
        selectionButton.element.style.outline = selectionModeRef.current
          ? '2px solid #fd0000'
          : 'none'
      },
    })
    viewer.addControl(selectionButton.element, {
      anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
    })

    // --- Mouse tracker for drawing selection rectangles ---
    const selectionTracker = new OpenSeadragon.MouseTracker({
      element: viewer.element,
      pressHandler: (event: OpenSeadragon.MouseTrackerEvent) => {
        if (!selectionModeRef.current || !event.position) return
        const overlayElement = document.createElement('div')
        overlayElement.style.border = '2px solid red'
        overlayElement.style.boxSizing = 'border-box'
        const viewportPos = viewer.viewport.pointFromPixel(event.position)
        viewer.addOverlay(
          overlayElement,
          new OpenSeadragon.Rect(viewportPos.x, viewportPos.y, 0, 0),
        )
        overlaysRef.current.push(overlayElement)
        dragRef.current = { overlayElement, startPos: viewportPos }
      },
      dragHandler: (event: OpenSeadragon.MouseTrackerEvent) => {
        if (!dragRef.current || !event.position) return
        const viewportPos = viewer.viewport.pointFromPixel(event.position)
        const diffX = viewportPos.x - dragRef.current.startPos.x
        const diffY = viewportPos.y - dragRef.current.startPos.y
        const location = new OpenSeadragon.Rect(
          Math.min(dragRef.current.startPos.x, dragRef.current.startPos.x + diffX),
          Math.min(dragRef.current.startPos.y, dragRef.current.startPos.y + diffY),
          Math.abs(diffX),
          Math.abs(diffY),
        )
        viewer.updateOverlay(dragRef.current.overlayElement, location)
      },
      releaseHandler: () => {
        if (!dragRef.current) return
        dragRef.current = null
        selectionModeRef.current = false
        viewer.setMouseNavEnabled(true)
        selectionButton.element.style.outline = 'none'
      },
    })

    // --- Clear overlays toolbar button ---
    const clearButton = new OpenSeadragon.Button({
      tooltip: 'Clear all selection rectangles',
      srcRest: prefix + 'clear_rest.svg',
      srcGroup: prefix + 'clear_grouphover.svg',
      srcHover: prefix + 'clear_hover.svg',
      srcDown: prefix + 'clear_pressed.svg',
      onClick: () => {
        for (const el of overlaysRef.current) {
          viewer.removeOverlay(el)
        }
        overlaysRef.current = []
      },
    })
    viewer.addControl(clearButton.element, {
      anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
    })

    // Restore viewport state after the image has loaded
    if (initialViewport) {
      viewer.addOnceHandler('open', () => {
        viewer.viewport.zoomTo(initialViewport.zoom, undefined, true)
        viewer.viewport.panTo(
          new OpenSeadragon.Point(initialViewport.x, initialViewport.y),
          true,
        )
        if (initialViewport.rotation) {
          viewer.viewport.setRotation(initialViewport.rotation, true)
        }
      })
    }

    // Report viewport changes after animations finish
    viewer.addHandler('animation-finish', emitViewport)

    return () => {
      selectionModeRef.current = false
      dragRef.current = null
      overlaysRef.current = []
      selectionTracker.destroy()
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
