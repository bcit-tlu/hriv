import { useEffect, useRef, useCallback, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import Box from '@mui/material/Box'
import CanvasOverlay from './CanvasOverlay'
import type { CanvasAnnotation } from './CanvasOverlay'

export interface ViewportState {
  zoom: number
  x: number
  y: number
  rotation?: number
}

export interface MeasurementConfig {
  /** Number of image pixels per one real-world unit (e.g. pixels per mm) */
  scale?: number
  /** Unit label (e.g. "mm", "um", "cm") */
  unit?: string
}

/** Maximum number of overlay rectangles included in share-view links */
export const MAX_SHARE_OVERLAYS = 15

/** Serialisable representation of an overlay rectangle in viewport coordinates */
export interface OverlayRect {
  x: number
  y: number
  w: number
  h: number
}

interface ImageViewerProps {
  tileSources: OpenSeadragon.TileSourceOptions | string
  height?: string
  initialViewport?: ViewportState
  onViewportChange?: (state: ViewportState) => void
  measurement?: MeasurementConfig
  /** Overlay rectangles to restore (e.g. from a share link) */
  initialOverlays?: OverlayRect[]
  /** Called whenever the set of overlay rectangles changes */
  onOverlaysChange?: (overlays: OverlayRect[]) => void
  /** Whether the current user can edit content (admin/instructor) */
  canEditContent?: boolean
  /** Whether overlays are currently locked (persisted to image metadata) */
  overlaysLocked?: boolean
  /** Called when the user locks overlays — parent should persist to metadata */
  onLockOverlays?: (overlays: OverlayRect[]) => void
  /** Called when the user unlocks overlays — parent should remove from metadata */
  onUnlockOverlays?: () => void
  /** Called when overlays are cleared — parent should remove locked_overlays from metadata */
  onClearOverlays?: () => void
  /** Canvas annotations (shapes, text, links) persisted in image metadata */
  canvasAnnotations?: CanvasAnnotation[]
  /** Called when canvas annotations change — parent should persist to metadata */
  onCanvasAnnotationsChange?: (annotations: CanvasAnnotation[]) => void
  /** Flush any pending canvas annotation save immediately (bypass debounce) */
  onFlushCanvasAnnotations?: () => Promise<void>
  /** Notified when canvas edit mode changes (so parent can disable conflicting UI) */
  onCanvasEditModeChange?: (active: boolean) => void
}

interface DragState {
  overlayElement: HTMLDivElement
  startPos: OpenSeadragon.Point
  widthLabel: HTMLDivElement
  heightLabel: HTMLDivElement
}

/** Format a measurement value with appropriate precision */
function formatMeasurement(
  viewportDim: number,
  imageSize: number,
  config: MeasurementConfig | undefined,
): string {
  // Convert viewport units to image pixels.
  // In OSD, viewport width=1 corresponds to the full image width in pixels.
  const pixels = viewportDim * imageSize
  if (config?.scale && config.scale > 0) {
    const realValue = pixels / config.scale
    const unit = config.unit ?? ''
    if (realValue >= 100) return `${realValue.toFixed(0)} ${unit}`
    if (realValue >= 1) return `${realValue.toFixed(1)} ${unit}`
    return `${realValue.toFixed(2)} ${unit}`
  }
  return `${Math.round(pixels)} px`
}

/** Create a styled label element for measurement display */
function createMeasurementLabel(): HTMLDivElement {
  const label = document.createElement('div')
  label.style.position = 'absolute'
  label.style.color = '#ff0000'
  label.style.fontSize = '12px'
  label.style.fontFamily = 'monospace'
  label.style.fontWeight = '600'
  label.style.whiteSpace = 'nowrap'
  label.style.pointerEvents = 'none'
  label.style.textShadow =
    '-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff'
  label.style.zIndex = '10'
  label.style.display = 'none'
  return label
}

export default function ImageViewer({
  tileSources,
  height = '70vh',
  initialViewport,
  onViewportChange,
  measurement,
  initialOverlays,
  onOverlaysChange,
  canEditContent = false,
  overlaysLocked = false,
  onLockOverlays,
  onUnlockOverlays,
  onClearOverlays,
  canvasAnnotations,
  onCanvasAnnotationsChange,
  onFlushCanvasAnnotations,
  onCanvasEditModeChange,
}: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const [canvasEditMode, setCanvasEditMode] = useState(false)
  const [viewerInstance, setViewerInstance] = useState<OpenSeadragon.Viewer | null>(null)
  const canvasEditModeRef = useRef(false)
  const onViewportChangeRef = useRef(onViewportChange)
  const onOverlaysChangeRef = useRef(onOverlaysChange)
  const selectionModeRef = useRef(false)
  const dragRef = useRef<DragState | null>(null)
  const overlaysRef = useRef<HTMLDivElement[]>([])
  const measurementRef = useRef(measurement)
  const onLockOverlaysRef = useRef(onLockOverlays)
  const onUnlockOverlaysRef = useRef(onUnlockOverlays)
  const onClearOverlaysRef = useRef(onClearOverlays)
  const overlaysLockedRef = useRef(overlaysLocked)
  const canEditContentRef = useRef(canEditContent)
  const updateLockUiRef = useRef<(() => void) | null>(null)
  const updateCanvasEditUiRef = useRef<((active: boolean) => void) | null>(null)
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])
  useEffect(() => {
    onOverlaysChangeRef.current = onOverlaysChange
  }, [onOverlaysChange])
  useEffect(() => {
    measurementRef.current = measurement
  }, [measurement])
  useEffect(() => {
    onLockOverlaysRef.current = onLockOverlays
  }, [onLockOverlays])
  useEffect(() => {
    onUnlockOverlaysRef.current = onUnlockOverlays
  }, [onUnlockOverlays])
  useEffect(() => {
    onClearOverlaysRef.current = onClearOverlays
  }, [onClearOverlays])
  useEffect(() => {
    overlaysLockedRef.current = overlaysLocked
  }, [overlaysLocked])
  useEffect(() => {
    canEditContentRef.current = canEditContent
  }, [canEditContent])

  const emitViewport = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer?.viewport) return
    const zoom = viewer.viewport.getZoom()
    const center = viewer.viewport.getCenter()
    const rotation = viewer.viewport.getRotation()
    onViewportChangeRef.current?.({ zoom, x: center.x, y: center.y, rotation })
  }, [])

  /** Get the content size of the tiled image */
  const getContentSize = useCallback((): OpenSeadragon.Point => {
    const viewer = viewerRef.current
    if (!viewer) return new OpenSeadragon.Point(1, 1)
    const tiledImage = viewer.world.getItemAt(0)
    if (!tiledImage) return new OpenSeadragon.Point(1, 1)
    return tiledImage.getContentSize()
  }, [])

  /**
   * Position the width label centered along the bottom edge of the rectangle,
   * and the height label centered along the right edge.
   */
  const updateMeasurementLabels = useCallback(
    (
      rect: OpenSeadragon.Rect,
      widthLabel: HTMLDivElement,
      heightLabel: HTMLDivElement,
    ) => {
      const viewer = viewerRef.current
      if (!viewer?.viewport) return

      const size = getContentSize()

      const wText = formatMeasurement(rect.width, size.x, measurementRef.current)
      const hText = formatMeasurement(rect.height, size.x, measurementRef.current)
      widthLabel.textContent = wText
      heightLabel.textContent = hText

      // Convert viewport rect corners to web (pixel) coordinates
      const topLeft = viewer.viewport.pixelFromPoint(
        new OpenSeadragon.Point(rect.x, rect.y),
      )
      const bottomRight = viewer.viewport.pixelFromPoint(
        new OpenSeadragon.Point(rect.x + rect.width, rect.y + rect.height),
      )

      // Width label: centered below the bottom edge
      const wMidX = (topLeft.x + bottomRight.x) / 2
      widthLabel.style.left = `${wMidX}px`
      widthLabel.style.top = `${bottomRight.y + 4}px`
      widthLabel.style.transform = 'translateX(-50%)'
      widthLabel.style.display = 'block'

      // Height label: centered to the right of the right edge
      const hMidY = (topLeft.y + bottomRight.y) / 2
      heightLabel.style.left = `${bottomRight.x + 4}px`
      heightLabel.style.top = `${hMidY}px`
      heightLabel.style.transform = 'translateY(-50%)'
      heightLabel.style.display = 'block'
    },
    [getContentSize],
  )

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

    // --- Measurement label container (lives inside the OSD canvas) ---
    const labelContainer = document.createElement('div')
    labelContainer.style.position = 'absolute'
    labelContainer.style.top = '0'
    labelContainer.style.left = '0'
    labelContainer.style.width = '100%'
    labelContainer.style.height = '100%'
    labelContainer.style.pointerEvents = 'none'
    labelContainer.style.overflow = 'visible'
    labelContainer.style.zIndex = '10'
    viewer.canvas.appendChild(labelContainer)

    // Track all label pairs so we can reposition them on zoom/pan
    const labelPairs: Array<{
      rect: OpenSeadragon.Rect
      widthLabel: HTMLDivElement
      heightLabel: HTMLDivElement
    }> = []

    /** Notify the parent about the current set of overlay rects (max MAX_SHARE_OVERLAYS) */
    const emitOverlays = () => {
      const rects: OverlayRect[] = labelPairs.slice(0, MAX_SHARE_OVERLAYS).map((p) => ({
        x: p.rect.x,
        y: p.rect.y,
        w: p.rect.width,
        h: p.rect.height,
      }))
      onOverlaysChangeRef.current?.(rects)
    }

    /** Add an overlay rectangle with measurement labels programmatically */
    const addOverlayRect = (r: OverlayRect) => {
      const el = document.createElement('div')
      el.style.border = '2px solid red'
      el.style.boxSizing = 'border-box'
      const rect = new OpenSeadragon.Rect(r.x, r.y, r.w, r.h)
      viewer.addOverlay(el, rect)
      overlaysRef.current.push(el)
      const wl = createMeasurementLabel()
      const hl = createMeasurementLabel()
      labelContainer.appendChild(wl)
      labelContainer.appendChild(hl)
      labelPairs.push({ rect, widthLabel: wl, heightLabel: hl })
      updateMeasurementLabels(rect, wl, hl)
    }

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
          ? '2px solid red'
          : 'none'
        selectionButton.element.style.outlineOffset = selectionModeRef.current
          ? '-2px'
          : ''
      },
    })
    // Eliminate inline-block descender gap so inset border aligns with visible button area
    selectionButton.element.style.lineHeight = '0'
    viewer.addControl(selectionButton.element, {
      anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
    })

    // --- Mouse tracker for drawing selection rectangles ---
    let currentRect: OpenSeadragon.Rect | null = null

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

        // Create measurement labels
        const widthLabel = createMeasurementLabel()
        const heightLabel = createMeasurementLabel()
        labelContainer.appendChild(widthLabel)
        labelContainer.appendChild(heightLabel)

        dragRef.current = { overlayElement, startPos: viewportPos, widthLabel, heightLabel }
        currentRect = new OpenSeadragon.Rect(viewportPos.x, viewportPos.y, 0, 0)
      },
      dragHandler: (event: OpenSeadragon.MouseTrackerEvent) => {
        if (!dragRef.current || !event.position) return
        const viewportPos = viewer.viewport.pointFromPixel(event.position)
        let diffX = viewportPos.x - dragRef.current.startPos.x
        let diffY = viewportPos.y - dragRef.current.startPos.y

        // Hold Shift to constrain the rectangle to a square
        const origEvent = event.originalEvent as MouseEvent | undefined
        if (origEvent?.shiftKey) {
          const maxDim = Math.max(Math.abs(diffX), Math.abs(diffY))
          diffX = (Math.sign(diffX) || 1) * maxDim
          diffY = (Math.sign(diffY) || 1) * maxDim
        }

        const location = new OpenSeadragon.Rect(
          Math.min(dragRef.current.startPos.x, dragRef.current.startPos.x + diffX),
          Math.min(dragRef.current.startPos.y, dragRef.current.startPos.y + diffY),
          Math.abs(diffX),
          Math.abs(diffY),
        )
        viewer.updateOverlay(dragRef.current.overlayElement, location)
        currentRect = location

        // Update measurement labels during drag
        updateMeasurementLabels(
          location,
          dragRef.current.widthLabel,
          dragRef.current.heightLabel,
        )
      },
      releaseHandler: () => {
        if (!dragRef.current) return
        // Store the final rect and labels for repositioning on zoom/pan
        if (currentRect && currentRect.width > 0 && currentRect.height > 0) {
          labelPairs.push({
            rect: currentRect,
            widthLabel: dragRef.current.widthLabel,
            heightLabel: dragRef.current.heightLabel,
          })
          emitOverlays()
        } else {
          // Remove labels if the rectangle is too small (click without drag)
          dragRef.current.widthLabel.remove()
          dragRef.current.heightLabel.remove()
        }
        dragRef.current = null
        currentRect = null
        selectionModeRef.current = false
        viewer.setMouseNavEnabled(true)
        selectionButton.element.style.outline = 'none'
        selectionButton.element.style.outlineOffset = ''
      },
    })

    // Reposition measurement labels when the viewport changes (zoom/pan)
    const repositionLabels = () => {
      for (const pair of labelPairs) {
        updateMeasurementLabels(pair.rect, pair.widthLabel, pair.heightLabel)
      }
      // Also reposition labels for the rectangle currently being drawn
      if (dragRef.current && currentRect) {
        updateMeasurementLabels(
          currentRect,
          dragRef.current.widthLabel,
          dragRef.current.heightLabel,
        )
      }
    }
    viewer.addHandler('animation', repositionLabels)
    viewer.addHandler('animation-finish', repositionLabels)

    // --- Lock overlay toolbar button (visible to admin/instructor) ---
    let lockButton: OpenSeadragon.Button | null = null
    const updateLockIcon = () => {
      if (!lockButton) return
      const locked = overlaysLockedRef.current
      const state = locked ? 'lock_closed' : 'lock_open'
      // Update all four OSD button image states (REST, HOVER, GROUP, DOWN)
      const imgs = lockButton.element.querySelectorAll('img')
      // OSD Button appends imgs as: imgRest, imgGroup, imgHover, imgDown
      const suffixes = ['rest', 'grouphover', 'hover', 'pressed']
      imgs.forEach((img, i) => {
        if (i < suffixes.length) {
          img.src = prefix + state + '_' + suffixes[i] + '.svg'
        }
      })
      lockButton.element.title = locked
        ? 'Unlock overlays (re-enable clear button)'
        : 'Lock overlays (persist to image metadata)'
      lockButton.element.style.outline = locked ? '2px solid red' : 'none'
      lockButton.element.style.outlineOffset = locked ? '-2px' : ''
    }
    if (canEditContentRef.current) {
      lockButton = new OpenSeadragon.Button({
        tooltip: 'Lock overlays (persist to image metadata)',
        srcRest: prefix + 'lock_open_rest.svg',
        srcGroup: prefix + 'lock_open_grouphover.svg',
        srcHover: prefix + 'lock_open_hover.svg',
        srcDown: prefix + 'lock_open_pressed.svg',
        onClick: () => {
          if (overlaysLockedRef.current) {
            // Unlock: re-enable clear button (does not remove metadata)
            onUnlockOverlaysRef.current?.()
          } else {
            // Lock: persist current overlays
            const rects: OverlayRect[] = labelPairs.slice(0, MAX_SHARE_OVERLAYS).map((p) => ({
              x: p.rect.x,
              y: p.rect.y,
              w: p.rect.width,
              h: p.rect.height,
            }))
            if (rects.length > 0) {
              onLockOverlaysRef.current?.(rects)
            }
          }
        },
      })
      lockButton.element.style.lineHeight = '0'
      viewer.addControl(lockButton.element, {
        anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
      })
      updateLockIcon()
    }

    // --- Clear overlays toolbar button ---
    const clearButton = new OpenSeadragon.Button({
      tooltip: 'Clear all selection rectangles',
      srcRest: prefix + 'clear_rest.svg',
      srcGroup: prefix + 'clear_grouphover.svg',
      srcHover: prefix + 'clear_hover.svg',
      srcDown: prefix + 'clear_pressed.svg',
      onClick: () => {
        // Prevent clearing when lock is engaged
        if (overlaysLockedRef.current) return
        for (const el of overlaysRef.current) {
          viewer.removeOverlay(el)
        }
        overlaysRef.current = []
        // Also remove all measurement labels
        for (const pair of labelPairs) {
          pair.widthLabel.remove()
          pair.heightLabel.remove()
        }
        labelPairs.length = 0
        emitOverlays()
        // Also remove persisted overlays from metadata
        onClearOverlaysRef.current?.()
      },
    })
    // Visually disable clear button when locked
    const updateClearButtonState = () => {
      clearButton.element.style.opacity = overlaysLockedRef.current ? '0.3' : '1'
      clearButton.element.style.pointerEvents = overlaysLockedRef.current ? 'none' : 'auto'
    }
    updateClearButtonState()
    viewer.addControl(clearButton.element, {
      anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
    })

    // --- Canvas edit mode toolbar button (visible to admin/instructor) ---
    if (canEditContentRef.current) {
      const canvasEditButton = new OpenSeadragon.Button({
        tooltip: 'Canvas annotations (add shapes, text, links)',
        srcRest: prefix + 'canvas_edit_rest.svg',
        srcGroup: prefix + 'canvas_edit_grouphover.svg',
        srcHover: prefix + 'canvas_edit_hover.svg',
        srcDown: prefix + 'canvas_edit_pressed.svg',
        onClick: () => {
          const entering = !canvasEditModeRef.current
          canvasEditModeRef.current = entering
          setCanvasEditMode(entering)
          viewer.setMouseNavEnabled(!entering)
          canvasEditButton.element.style.outline = entering ? '2px solid #2196F3' : 'none'
          canvasEditButton.element.style.outlineOffset = entering ? '-2px' : ''
        },
      })
      canvasEditButton.element.style.lineHeight = '0'
      viewer.addControl(canvasEditButton.element, {
        anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
      })

      // Allow external code (e.g. CanvasOverlay "Done" button) to update the button outline
      updateCanvasEditUiRef.current = (active: boolean) => {
        canvasEditButton.element.style.outline = active ? '2px solid #2196F3' : 'none'
        canvasEditButton.element.style.outlineOffset = active ? '-2px' : ''
      }
    }

    // Expose a function to reactively update lock/clear UI when overlaysLocked changes
    updateLockUiRef.current = () => {
      updateLockIcon()
      updateClearButtonState()
    }

    // Expose viewer instance to React state for child components
    setViewerInstance(viewer)

    // Restore viewport state and initial overlays after the image has loaded
    viewer.addOnceHandler('open', () => {
      if (initialViewport) {
        viewer.viewport.zoomTo(initialViewport.zoom, undefined, true)
        viewer.viewport.panTo(
          new OpenSeadragon.Point(initialViewport.x, initialViewport.y),
          true,
        )
        if (initialViewport.rotation) {
          viewer.viewport.setRotation(initialViewport.rotation, true)
        }
      }
      // Restore overlay rectangles from share link
      if (initialOverlays?.length) {
        for (const r of initialOverlays.slice(0, MAX_SHARE_OVERLAYS)) {
          addOverlayRect(r)
        }
      }
    })

    // Report viewport changes after animations finish
    viewer.addHandler('animation-finish', emitViewport)

    return () => {
      selectionModeRef.current = false
      dragRef.current = null
      overlaysRef.current = []
      labelPairs.length = 0
      canvasEditModeRef.current = false
      setCanvasEditMode(false)
      setViewerInstance(null)
      selectionTracker.destroy()
      viewer.destroy()
      viewerRef.current = null
    }
  }, [tileSources, initialViewport, initialOverlays, emitViewport, updateMeasurementLabels])

  // Reactively update lock/clear button UI when overlaysLocked prop changes
  useEffect(() => {
    updateLockUiRef.current?.()
  }, [overlaysLocked])

  // Handle canvas edit mode toggle from the CanvasOverlay (e.g. "Done" button)
  const handleCanvasEditModeChange = useCallback((mode: boolean) => {
    canvasEditModeRef.current = mode
    setCanvasEditMode(mode)
    viewerRef.current?.setMouseNavEnabled(!mode)
    updateCanvasEditUiRef.current?.(mode)
    onCanvasEditModeChange?.(mode)
  }, [onCanvasEditModeChange])

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'grey.900',
      }}
    >
      <Box
        ref={containerRef}
        sx={{
          width: '100%',
          height: '100%',
        }}
      />
      {viewerInstance && (
        <CanvasOverlay
          viewer={viewerInstance}
          annotations={canvasAnnotations ?? []}
          onAnnotationsChange={onCanvasAnnotationsChange ?? (() => {})}
          canEdit={canEditContent}
          editMode={canvasEditMode}
          onEditModeChange={handleCanvasEditModeChange}
          onFlushAnnotations={onFlushCanvasAnnotations}
        />
      )}
    </Box>
  )
}
