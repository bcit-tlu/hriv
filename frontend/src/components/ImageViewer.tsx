import { useEffect, useRef, useCallback, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import Box from '@mui/material/Box'
import {
  emitEvent,
  emitEventNow,
  emitFrontendError,
  emitFrontendPerformance,
} from '../observability'
import CanvasOverlay from './CanvasOverlay'
import type { CanvasAnnotation } from './CanvasOverlay'
import {
  formatMeasurement,
  createMeasurementLabel,
  computeMagnification,
  createPinchRotationTracker,
  MAX_SHARE_OVERLAYS,
  type ViewportState,
  type MeasurementConfig,
  type OverlayRect,
} from './imageViewerUtils'

interface ImageViewerProps {
  tileSources: OpenSeadragon.TileSourceOptions | string
  /** Id of the image being viewed; emitted as a structured telemetry field. */
  imageId?: number
  /** Id of the image's category; emitted as a structured telemetry field. */
  categoryId?: number
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

export default function ImageViewer({
  tileSources,
  imageId,
  categoryId,
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
  const viewStartTimeRef = useRef<number | null>(null)
  const imageIdRef = useRef(imageId)
  const categoryIdRef = useRef(categoryId)
  useEffect(() => {
    imageIdRef.current = imageId
  }, [imageId])
  useEffect(() => {
    categoryIdRef.current = categoryId
  }, [categoryId])
  const emitToolbarAction = useCallback((action: string) => {
    emitEvent({
      event: 'ui.toolbar_action',
      action,
      outcome: 'success',
      image_id: imageIdRef.current,
      category_id: categoryIdRef.current,
    })
  }, [])
  const updateLockUiRef = useRef<(() => void) | null>(null)
  const updateCanvasEditUiRef = useRef<((active: boolean) => void) | null>(null)
  const updateMagnificationRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])
  useEffect(() => {
    onOverlaysChangeRef.current = onOverlaysChange
  }, [onOverlaysChange])
  useEffect(() => {
    measurementRef.current = measurement
    updateMagnificationRef.current?.()
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
    (rect: OpenSeadragon.Rect, widthLabel: HTMLDivElement, heightLabel: HTMLDivElement) => {
      const viewer = viewerRef.current
      if (!viewer?.viewport) return

      const size = getContentSize()

      const wText = formatMeasurement(rect.width, size.x, measurementRef.current)
      const hText = formatMeasurement(rect.height, size.x, measurementRef.current)
      widthLabel.textContent = wText
      heightLabel.textContent = hText

      // Convert viewport rect corners to web (pixel) coordinates
      const topLeft = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(rect.x, rect.y))
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

    viewStartTimeRef.current = performance.now()
    emitEvent({
      event: 'image.view.started',
      action: 'view',
      image_id: imageIdRef.current,
      category_id: categoryIdRef.current,
    })

    try {
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
    } catch (error) {
      emitFrontendError({
        action: 'image_viewer_init',
        error: 'image_viewer',
        errorCode: 'image_viewer_init_failed',
        imageId: imageIdRef.current,
        categoryId: categoryIdRef.current,
      })
      throw error
    }

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

    // --- Toolbar buttons ---
    const prefix = '/openseadragon-svg-icons/'

    // --- Clear overlays toolbar button ---
    const clearButton = new OpenSeadragon.Button({
      tooltip: 'Clear all selection rectangles',
      srcRest: prefix + 'clear_rest.svg',
      srcGroup: prefix + 'clear_grouphover.svg',
      srcHover: prefix + 'clear_hover.svg',
      srcDown: prefix + 'clear_pressed.svg',
      onClick: () => {
        if (overlaysLockedRef.current) return
        emitToolbarAction('clear_overlays')
        for (const el of overlaysRef.current) {
          viewer.removeOverlay(el)
        }
        overlaysRef.current = []
        for (const pair of labelPairs) {
          pair.widthLabel.remove()
          pair.heightLabel.remove()
        }
        labelPairs.length = 0
        emitOverlays()
        updateClearButtonState()
        updateLockIcon()
        onClearOverlaysRef.current?.()
      },
    })
    const clearWrapper = document.createElement('div')
    clearWrapper.style.display = 'inline-block'
    clearButton.element.style.lineHeight = '0'
    clearWrapper.appendChild(clearButton.element)

    const updateClearButtonState = () => {
      const locked = overlaysLockedRef.current
      const empty = overlaysRef.current.length === 0
      const disabled = locked || empty
      clearButton.element.style.opacity = disabled ? '0.3' : '1'
      clearButton.element.style.pointerEvents = disabled ? 'none' : 'auto'
      clearWrapper.style.cursor = disabled ? 'not-allowed' : 'pointer'
      clearWrapper.title = locked
        ? 'Overlays are locked by the instructor'
        : empty
          ? 'No selection rectangles to clear'
          : 'Clear all selection rectangles'
    }

    // --- Selection rectangle toolbar button ---
    const selectionButton = new OpenSeadragon.Button({
      tooltip: 'Draw selection rectangle',
      srcRest: prefix + 'selection_rest.svg',
      srcGroup: prefix + 'selection_grouphover.svg',
      srcHover: prefix + 'selection_hover.svg',
      srcDown: prefix + 'selection_pressed.svg',
      onClick: () => {
        selectionModeRef.current = !selectionModeRef.current
        emitToolbarAction(selectionModeRef.current ? 'selection_mode_on' : 'selection_mode_off')
        viewer.setMouseNavEnabled(!selectionModeRef.current)
        selectionButton.element.style.outline = selectionModeRef.current ? '2px solid red' : 'none'
        selectionButton.element.style.outlineOffset = selectionModeRef.current ? '-2px' : ''
      },
    })
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
        updateMeasurementLabels(location, dragRef.current.widthLabel, dragRef.current.heightLabel)
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
          updateClearButtonState()
          updateLockIcon()
        } else {
          // Remove phantom overlay and labels for click-without-drag
          viewer.removeOverlay(dragRef.current.overlayElement)
          overlaysRef.current = overlaysRef.current.filter(
            (el) => el !== dragRef.current!.overlayElement,
          )
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
    let lockWrapper: HTMLDivElement | null = null
    const updateLockIcon = () => {
      if (!lockButton) return
      const locked = overlaysLockedRef.current
      const empty = overlaysRef.current.length === 0
      const state = locked ? 'lock_closed' : 'lock_open'
      const imgs = lockButton.element.querySelectorAll('img')
      const suffixes = ['rest', 'grouphover', 'hover', 'pressed']
      imgs.forEach((img, i) => {
        if (i < suffixes.length) {
          img.src = prefix + state + '_' + suffixes[i] + '.svg'
        }
      })
      lockButton.element.style.outline = locked ? '2px solid red' : 'none'
      lockButton.element.style.outlineOffset = locked ? '-2px' : ''
      // Disable when not locked and no rectangles exist
      const disabled = !locked && empty
      lockButton.element.style.opacity = disabled ? '0.3' : '1'
      lockButton.element.style.pointerEvents = disabled ? 'none' : 'auto'
      if (lockWrapper) {
        lockWrapper.style.cursor = disabled ? 'not-allowed' : 'pointer'
        const titleText = locked
          ? 'Unlock selection rectangles'
          : empty
            ? 'No selection rectangles to lock'
            : 'Lock selection rectangles'
        lockWrapper.title = titleText
        lockButton.element.title = titleText
      }
    }
    if (canEditContentRef.current) {
      lockButton = new OpenSeadragon.Button({
        tooltip: 'Lock selection rectangles',
        srcRest: prefix + 'lock_open_rest.svg',
        srcGroup: prefix + 'lock_open_grouphover.svg',
        srcHover: prefix + 'lock_open_hover.svg',
        srcDown: prefix + 'lock_open_pressed.svg',
        onClick: () => {
          emitToolbarAction(overlaysLockedRef.current ? 'overlays_unlock' : 'overlays_lock')
          if (overlaysLockedRef.current) {
            onUnlockOverlaysRef.current?.()
          } else {
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
      lockWrapper = document.createElement('div')
      lockWrapper.style.display = 'inline-block'
      lockWrapper.appendChild(lockButton.element)
      viewer.addControl(lockWrapper, {
        anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
      })
      updateLockIcon()
    }

    // Add clear button to toolbar (created above, before selection tracker)
    updateClearButtonState()
    viewer.addControl(clearWrapper, {
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
          emitToolbarAction(entering ? 'canvas_edit_on' : 'canvas_edit_off')
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

    // --- Magnification factor badge (inside the navigator mini-map) ---
    // Only visible when the image has measurement settings (scale + unit).
    const magBadge = document.createElement('div')
    magBadge.style.position = 'absolute'
    magBadge.style.bottom = '2px'
    magBadge.style.left = '2px'
    magBadge.style.minWidth = '28px'
    magBadge.style.height = '18px'
    magBadge.style.lineHeight = '18px'
    magBadge.style.textAlign = 'center'
    magBadge.style.padding = '0 3px'
    magBadge.style.fontFamily = 'monospace'
    magBadge.style.fontSize = '11px'
    magBadge.style.fontWeight = '700'
    magBadge.style.color = '#e0e0e0'
    magBadge.style.background = 'rgba(0,0,0,0.6)'
    magBadge.style.borderRadius = '3px'
    magBadge.style.userSelect = 'none'
    magBadge.style.pointerEvents = 'none'
    magBadge.style.zIndex = '1'
    magBadge.style.display = 'none'
    if (viewer.navigator) {
      viewer.navigator.element.appendChild(magBadge)
    }

    const updateMagnification = () => {
      if (!viewer.viewport) return
      const imageZoom = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom())
      const mag = computeMagnification(imageZoom, measurementRef.current, window.devicePixelRatio)
      if (mag === undefined) {
        magBadge.style.display = 'none'
        return
      }
      magBadge.style.display = ''
      const rounded = Math.round(mag)
      magBadge.textContent = rounded < 1 ? '<1X' : `${rounded}X`
    }
    viewer.addHandler('animation', updateMagnification)
    viewer.addHandler('animation-finish', updateMagnification)
    updateMagnificationRef.current = updateMagnification

    // Expose a function to reactively update lock/clear UI when overlaysLocked changes
    updateLockUiRef.current = () => {
      updateLockIcon()
      updateClearButtonState()
    }

    // Expose viewer instance to React state for child components
    setViewerInstance(viewer)

    // Restore viewport state and initial overlays after the image has loaded
    viewer.addOnceHandler('open', () => {
      const duration = viewStartTimeRef.current
        ? Math.round(performance.now() - viewStartTimeRef.current)
        : undefined
      emitEvent({
        event: 'image.view.ready',
        action: 'view',
        outcome: 'success',
        duration_ms: duration,
        image_id: imageIdRef.current,
        category_id: categoryIdRef.current,
      })
      if (duration !== undefined) {
        emitFrontendPerformance({
          metric: 'image_ready',
          value: duration,
          unit: 'ms',
          imageId: imageIdRef.current,
          categoryId: categoryIdRef.current,
        })
      }
      if (initialViewport) {
        viewer.viewport.zoomTo(initialViewport.zoom, undefined, true)
        viewer.viewport.panTo(new OpenSeadragon.Point(initialViewport.x, initialViewport.y), true)
        if (initialViewport.rotation) {
          viewer.viewport.setRotation(initialViewport.rotation, true)
        }
      }
      // Restore overlay rectangles from share link
      if (initialOverlays?.length) {
        for (const r of initialOverlays.slice(0, MAX_SHARE_OVERLAYS)) {
          addOverlayRect(r)
        }
        updateClearButtonState()
        updateLockIcon()
      }
      updateMagnification()
    })

    viewer.addHandler('open-failed', () => {
      const duration = viewStartTimeRef.current
        ? Math.round(performance.now() - viewStartTimeRef.current)
        : undefined
      emitEvent({
        event: 'image.view.failed',
        action: 'view',
        outcome: 'failure',
        duration_ms: duration,
        image_id: imageIdRef.current,
        category_id: categoryIdRef.current,
      })
      emitFrontendError({
        action: 'image_viewer_open',
        error: 'image_viewer',
        errorCode: 'image_viewer_open_failed',
        imageId: imageIdRef.current,
        categoryId: categoryIdRef.current,
      })
    })

    // Reset rotation to 0 when the home button is clicked
    viewer.addHandler('home', () => {
      emitToolbarAction('home')
      viewer.viewport.setRotation(0)
    })
    viewer.addHandler('full-page', (event) => {
      // Fires on both enter and exit; count only entering full screen.
      if (event.fullPage) emitToolbarAction('full_screen')
    })

    const pinchRotationTracker = createPinchRotationTracker()

    // Damp the touch pinch-rotate gesture. OpenSeadragon rotates the viewport
    // 1:1 with finger movement, which is hard to control on mobile. Require a
    // clear rotation before activating, then apply a scaled-down delta.
    viewer.addHandler('canvas-pinch', (event) => {
      const points = event.gesturePoints
      if (!points || points.length < 2) return
      event.preventDefaultRotateAction = true
      const timestamp = event.originalEvent?.timeStamp ?? performance.now()
      const delta = pinchRotationTracker.update(
        points[0].lastPos,
        points[1].lastPos,
        points[0].currentPos,
        points[1].currentPos,
        timestamp,
      )
      if (delta === 0) return
      const pivot = viewer.viewport.pointFromPixel(event.center, true)
      viewer.viewport.rotateTo(viewer.viewport.getRotation(true) + delta, pivot, true)
    })

    // Report viewport changes after animations finish
    viewer.addHandler('animation-finish', emitViewport)

    return () => {
      const dwellMs = viewStartTimeRef.current
        ? Math.round(performance.now() - viewStartTimeRef.current)
        : undefined
      emitEventNow({
        event: 'image.view.ended',
        action: 'view',
        outcome: 'success',
        duration_ms: dwellMs,
        image_id: imageIdRef.current,
        category_id: categoryIdRef.current,
      })
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
  }, [
    tileSources,
    initialViewport,
    initialOverlays,
    emitViewport,
    updateMeasurementLabels,
    emitToolbarAction,
  ])

  // Reactively update lock/clear button UI when overlaysLocked prop changes
  useEffect(() => {
    updateLockUiRef.current?.()
  }, [overlaysLocked])

  // Handle canvas edit mode toggle from the CanvasOverlay (e.g. "Done" button)
  const handleCanvasEditModeChange = useCallback(
    (mode: boolean) => {
      canvasEditModeRef.current = mode
      setCanvasEditMode(mode)
      viewerRef.current?.setMouseNavEnabled(!mode)
      updateCanvasEditUiRef.current?.(mode)
      onCanvasEditModeChange?.(mode)
    },
    [onCanvasEditModeChange],
  )

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
