import { useEffect, useEffectEvent, useRef, useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import OpenSeadragon from 'openseadragon'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'
import type { ResponsiveStyleValue } from '@mui/system'
import {
  emitEvent,
  emitEventNow,
  emitFrontendError,
  emitFrontendPerformance,
} from '../observability'
import { userMessage, type ApiImage } from '../api'
import { isTileTokenAuthorizationFailure, renewImageRecord } from '../tileTokenRenewal'
import CanvasOverlay from './CanvasOverlay'
import type { CanvasAnnotation } from './CanvasOverlay'
import SelectionCountLayer from './SelectionCountLayer'
import {
  createPresentationLayer,
  inkStrokeAlpha,
  strokePathD,
  trailAlpha,
  INK_FADE_START_MS,
  INK_MIN_POINT_PX,
  LASER_CORE_RADIUS,
  LASER_TRAIL_MS,
  LASER_TRAIL_POINTS,
  MAX_INK_STROKES,
  type InkStroke,
  type PresentationLayer,
  type PresentationTool,
} from './presentationTools'
import { getPresentationColors } from '../theme'
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

let pendingFullScreenHandoff: string | number | null = null

// Every mounted viewer's root element — the toolbar keyboard shortcuts use
// it to decide which of several viewers (e.g. collection panes) owns a key.
const mountedViewerElements = new Set<HTMLElement>()

// OSD starts asynchronous tile-source work during construction but does not
// cancel every continuation when it is destroyed. React Strict Mode's
// development-only effect replay can therefore let a discarded viewer create a
// TiledImage after its drawer has been destroyed, producing a false assertion.
// Delay construction until after that replay; production and test mounts stay
// synchronous.
const deferViewerInitializationForStrictMode =
  import.meta.env.DEV && import.meta.env.MODE !== 'test'

const isViewportAtHome = (viewer: OpenSeadragon.Viewer) => {
  const { viewport } = viewer
  const homeZoom = viewport.getHomeZoom()
  const homeBounds = viewport.getHomeBounds()
  if (!Number.isFinite(homeZoom) || homeZoom <= 0 || homeBounds.width <= 0) return false

  const homeCenter = homeBounds.getCenter()
  const center = viewport.getCenter(false)
  const rotation = ((viewport.getRotation(false) % 360) + 360) % 360
  const rotationDistance = Math.min(rotation, 360 - rotation)
  const centerTolerance = homeBounds.width * 1e-3
  return (
    Math.abs(viewport.getZoom(false) - homeZoom) <= homeZoom * 1e-3 &&
    Math.abs(center.x - homeCenter.x) <= centerTolerance &&
    Math.abs(center.y - homeCenter.y) <= centerTolerance &&
    rotationDistance <= 1e-3 &&
    !viewport.getFlip()
  )
}

interface ImageViewerProps {
  tileSources: OpenSeadragon.TileSourceOptions | string
  /** Id of the image being viewed; emitted as a structured telemetry field. */
  imageId?: number
  /** Id of the image's category; emitted as a structured telemetry field. */
  categoryId?: number
  fullScreenHandoffKey?: string | number
  height?: ResponsiveStyleValue<string | number>
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
  /** Persist the exact canvas annotation snapshot and return success. */
  onSaveCanvasAnnotations?: (annotations: CanvasAnnotation[]) => Promise<boolean>
  /** Whether the current canvas edit draft has unsaved changes. */
  canvasDraftDirty?: boolean
  /** Notified when canvas edit mode changes (so parent can disable conflicting UI) */
  onCanvasEditModeChange?: (active: boolean) => void
  /** Notified when the viewer re-fetches an image record with fresh tile URLs. */
  onTileSourceRenewed?: (image: ApiImage) => void
  /** Surface unrecoverable viewer errors through the app's existing error UI. */
  onError?: (message: string) => void
  /**
   * Receives the OpenSeadragon instance once mounted (and `null` before
   * destroy) so parents like the synchronized collection viewer can attach
   * raw `viewport-change` handlers and drive the viewport imperatively.
   */
  onViewerReady?: (viewer: OpenSeadragon.Viewer | null) => void
  /** Extra UI portaled into the OSD container (`viewer.container`) so it stays visible in OSD full-page mode. */
  viewportOverlay?: ReactNode
  /**
   * UI portaled into a top-right OSD control so it fades with the toolbar
   * (OSD `autoFade`) and also survives full-page mode.
   */
  viewportControl?: ReactNode
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
  fullScreenHandoffKey,
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
  onSaveCanvasAnnotations,
  canvasDraftDirty = false,
  onCanvasEditModeChange,
  onTileSourceRenewed,
  onError,
  onViewerReady,
  viewportOverlay,
  viewportControl,
}: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const theme = useTheme()
  const [canvasEditMode, setCanvasEditMode] = useState(false)
  const [viewerInstance, setViewerInstance] = useState<OpenSeadragon.Viewer | null>(null)
  // Object counting (epic #1661): drawn selections with stable keys.
  const [countSelections, setCountSelections] = useState<
    { key: number; index: number; rect: { x: number; y: number; width: number; height: number } }[]
  >([])
  const [clearedToken, setClearedToken] = useState(0)
  const [presentationLayer, setPresentationLayer] = useState<PresentationLayer | null>(null)
  const [selectionDrawing, setSelectionDrawing] = useState(false)
  const [controlWrapper, setControlWrapper] = useState<HTMLDivElement | null>(null)
  const [viewerMountReady, setViewerMountReady] = useState(!deferViewerInitializationForStrictMode)
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
  const tileSourcesRef = useRef(tileSources)
  const fullScreenHandoffKeyRef = useRef(fullScreenHandoffKey)
  // Which image the open tile sources belong to — lets the prop-change
  // reopen below tell a same-image refresh (re-tokenized URLs, e.g. a
  // save-response refetch) from a different image arriving mid-life (#1567).
  const openSourcesImageIdRef = useRef(imageId)
  const renewalTimerRef = useRef<number | null>(null)
  const renewalInFlightRef = useRef(false)
  const renewedTileSourceKeysRef = useRef(new Set<string>())
  const renewalFailureSurfacedRef = useRef(false)
  const renewalAttemptsRef = useRef(0)
  const renewalGenerationRef = useRef(0)
  const pendingRenewalViewportRef = useRef<ViewportState | null>(null)
  const homeViewportAtLastSettledStateRef = useRef<boolean | null>(null)
  const onTileSourceRenewedRef = useRef(onTileSourceRenewed)
  const onErrorRef = useRef(onError)
  const onViewerReadyRef = useRef(onViewerReady)
  const onCanvasEditModeChangeRef = useRef(onCanvasEditModeChange)
  const getCurrentTileSources = useEffectEvent(() => tileSources)
  const resetRenewalState = useCallback(() => {
    renewalGenerationRef.current += 1
    renewalInFlightRef.current = false
    pendingRenewalViewportRef.current = null
    renewedTileSourceKeysRef.current.clear()
    renewalFailureSurfacedRef.current = false
    renewalAttemptsRef.current = 0
    if (renewalTimerRef.current != null) {
      window.clearTimeout(renewalTimerRef.current)
      renewalTimerRef.current = null
    }
  }, [])
  useEffect(() => {
    const canClaimFullScreenHandoff =
      fullScreenHandoffKey != null && pendingFullScreenHandoff === fullScreenHandoffKey
    if (viewerMountReady || canClaimFullScreenHandoff) return
    const timer = window.setTimeout(() => setViewerMountReady(true), 0)
    return () => window.clearTimeout(timer)
  }, [fullScreenHandoffKey, viewerMountReady])

  useEffect(() => {
    imageIdRef.current = imageId
    resetRenewalState()
    return resetRenewalState
  }, [imageId, resetRenewalState])
  useEffect(() => {
    categoryIdRef.current = categoryId
  }, [categoryId])
  useEffect(() => {
    fullScreenHandoffKeyRef.current = fullScreenHandoffKey
  }, [fullScreenHandoffKey])
  useEffect(() => {
    onTileSourceRenewedRef.current = onTileSourceRenewed
  }, [onTileSourceRenewed])
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])
  useEffect(() => {
    onViewerReadyRef.current = onViewerReady
  }, [onViewerReady])
  useEffect(() => {
    onCanvasEditModeChangeRef.current = onCanvasEditModeChange
  }, [onCanvasEditModeChange])
  // Keep the presentation overlay on the active palette (#1876).
  useEffect(() => {
    presentationLayer?.setColors(getPresentationColors(theme.palette.mode))
  }, [presentationLayer, theme.palette.mode])
  const getCurrentPresentationColors = useEffectEvent(() =>
    getPresentationColors(theme.palette.mode),
  )
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
  // Single arbiter for viewer.setMouseNavEnabled — selection, canvas edit and
  // the ink tool all disable navigation, so raw set(true) calls can stomp an
  // armed mode (epic #1876).
  const syncMouseNavRef = useRef<(() => void) | null>(null)
  // Arms a presentation tool queued while a dirty canvas draft blocked it;
  // invoked when edit mode exits (epic #1876).
  const notifyCanvasEditExitedRef = useRef<(() => void) | null>(null)
  const canvasCancelRef = useRef<(() => Promise<void>) | null>(null)
  const registerCanvasCancel = useCallback((handler: (() => Promise<void>) | null) => {
    canvasCancelRef.current = handler
  }, [])
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

  const tileSourceKey = useCallback((source: OpenSeadragon.TileSourceOptions | string) => {
    if (typeof source === 'string') return source
    try {
      return JSON.stringify(source)
    } catch {
      return String(source)
    }
  }, [])

  const currentViewportState = useCallback((): ViewportState | null => {
    const viewer = viewerRef.current
    if (!viewer?.viewport) return null
    const center = viewer.viewport.getCenter()
    return {
      zoom: viewer.viewport.getZoom(),
      x: center.x,
      y: center.y,
      rotation: viewer.viewport.getRotation(),
    }
  }, [])

  const surfaceRenewalFailure = useCallback((err?: unknown) => {
    if (renewalFailureSurfacedRef.current) return
    renewalFailureSurfacedRef.current = true
    const message = userMessage(
      err,
      'Image tiles could not be refreshed. You may no longer have access to this image.',
    )
    onErrorRef.current?.(message)
    emitFrontendError({
      action: 'image_viewer_tile_token_renewal',
      error: 'image_viewer',
      errorCode: 'image_viewer_tile_token_renewal_failed',
      imageId: imageIdRef.current,
      categoryId: categoryIdRef.current,
    })
  }, [])

  const restorePendingRenewalViewport = useCallback(() => {
    const viewer = viewerRef.current
    const viewportToRestore = pendingRenewalViewportRef.current
    pendingRenewalViewportRef.current = null
    if (!viewer?.viewport || !viewportToRestore) return
    viewer.viewport.zoomTo(viewportToRestore.zoom, undefined, true)
    viewer.viewport.panTo(new OpenSeadragon.Point(viewportToRestore.x, viewportToRestore.y), true)
    if (viewportToRestore.rotation) {
      viewer.viewport.setRotation(viewportToRestore.rotation, true)
    }
    homeViewportAtLastSettledStateRef.current = isViewportAtHome(viewer)
  }, [])

  const runTileSourceRenewal = useCallback(async () => {
    const imageIdForRenewal = imageIdRef.current
    const viewer = viewerRef.current
    if (!imageIdForRenewal || !viewer) return
    const renewalGeneration = renewalGenerationRef.current

    const oldKey = tileSourceKey(tileSourcesRef.current)
    if (renewalAttemptsRef.current >= 2 || renewedTileSourceKeysRef.current.has(oldKey)) {
      surfaceRenewalFailure()
      return
    }
    renewedTileSourceKeysRef.current.add(oldKey)
    renewalAttemptsRef.current += 1
    renewalInFlightRef.current = true

    try {
      pendingRenewalViewportRef.current = currentViewportState()
      const fresh = await renewImageRecord(imageIdForRenewal)
      if (
        imageIdRef.current !== imageIdForRenewal ||
        renewalGenerationRef.current !== renewalGeneration
      ) {
        return
      }
      onTileSourceRenewedRef.current?.(fresh)
      if (!fresh.tile_sources) {
        surfaceRenewalFailure()
        return
      }
      tileSourcesRef.current = fresh.tile_sources
      viewer.addOnceHandler('open', restorePendingRenewalViewport)
      const previousPreserveOverlays = viewer.preserveOverlays
      viewer.preserveOverlays = true
      try {
        viewer.open(fresh.tile_sources as unknown as OpenSeadragon.TileSourceSpecifier)
      } finally {
        viewer.preserveOverlays = previousPreserveOverlays
      }
      renewalFailureSurfacedRef.current = false
    } catch (err) {
      if (
        imageIdRef.current === imageIdForRenewal &&
        renewalGenerationRef.current === renewalGeneration
      ) {
        surfaceRenewalFailure(err)
      }
    } finally {
      if (
        imageIdRef.current === imageIdForRenewal &&
        renewalGenerationRef.current === renewalGeneration
      ) {
        renewalInFlightRef.current = false
      }
    }
  }, [currentViewportState, restorePendingRenewalViewport, surfaceRenewalFailure, tileSourceKey])

  const scheduleTileSourceRenewal = useCallback(() => {
    if (!imageIdRef.current || renewalInFlightRef.current || renewalTimerRef.current != null) return
    renewalTimerRef.current = window.setTimeout(() => {
      renewalTimerRef.current = null
      void runTileSourceRenewal()
    }, 100)
  }, [runTileSourceRenewal])

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
    homeViewportAtLastSettledStateRef.current = null
    const handoffKey = fullScreenHandoffKeyRef.current
    const canClaimFullScreenHandoff = handoffKey != null && pendingFullScreenHandoff === handoffKey
    if ((!viewerMountReady && !canClaimFullScreenHandoff) || !containerRef.current) return

    const initialTileSources = getCurrentTileSources()
    tileSourcesRef.current = initialTileSources
    viewStartTimeRef.current = performance.now()
    emitEvent({
      event: 'image.view.started',
      action: 'view',
      image_id: imageIdRef.current,
      category_id: categoryIdRef.current,
    })

    const viewerOptions: OpenSeadragon.Options = {
      element: containerRef.current,
      tileSources: initialTileSources,
      // Some catalogued DZI pyramids are hosted on a different origin. Their
      // tile servers permit anonymous CORS, which WebGL requires before it can
      // upload tile images as textures.
      crossOriginPolicy: 'Anonymous',
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
      // Scroll zooms; a plain click does not (user testing found click-to-zoom
      // unused, and it would fire on every laser-pointer/ink click — #1877).
      gestureSettingsMouse: { scrollToZoom: true, clickToZoom: false },
      // Rotation controls
      showRotationControl: true,
      gestureSettingsTouch: { pinchRotate: true },
      // Position controls at bottom-left
      navigationControlAnchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
      // The minimap does not need WebGL; canvas avoids a second context
      // (and its create/destroy warnings) per viewer.
      navigatorDrawer: 'canvas',
    }
    try {
      viewerRef.current = OpenSeadragon(viewerOptions)
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
    const initialViewerWidth = viewer.element.style.width
    const initialViewerHeight = viewer.element.style.height
    let pendingHomeResize: boolean | null = null
    const claimedHandoff = handoffKey != null && pendingFullScreenHandoff === handoffKey
    if (claimedHandoff) pendingFullScreenHandoff = null
    let handleFullscreenChange: (() => void) | null = null
    if (claimedHandoff && document.fullscreenElement) {
      viewer.setFullPage(true)
      viewer.element.style.width = '100%'
      viewer.element.style.height = '100%'
      handleFullscreenChange = () => {
        if (document.fullscreenElement || !viewer.isFullPage()) return
        viewer.setFullPage(false)
        viewer.element.style.width = initialViewerWidth
        viewer.element.style.height = initialViewerHeight
      }
      document.addEventListener('fullscreenchange', handleFullscreenChange)
    }

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

    // Track all label pairs so we can reposition them on zoom/pan. Each pair
    // gets a stable `key` so the object-counting UI can address it (the key
    // is per-draw, never persisted, and resets with the viewer).
    let nextSelectionKey = 1
    const labelPairs: Array<{
      key: number
      rect: OpenSeadragon.Rect
      widthLabel: HTMLDivElement
      heightLabel: HTMLDivElement
    }> = []

    const syncCountSelections = () => {
      setCountSelections(
        labelPairs.map((p, i) => ({
          key: p.key,
          index: i + 1,
          rect: { x: p.rect.x, y: p.rect.y, width: p.rect.width, height: p.rect.height },
        })),
      )
    }

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
      labelPairs.push({ key: nextSelectionKey++, rect, widthLabel: wl, heightLabel: hl })
      updateMeasurementLabels(rect, wl, hl)
      syncCountSelections()
    }

    // --- Toolbar buttons ---
    const prefix = '/openseadragon-svg-icons/'
    const suffixes = ['rest', 'grouphover', 'hover', 'pressed']
    const setButtonIcons = (button: OpenSeadragon.Button, base: string) => {
      button.element.querySelectorAll('img').forEach((img, i) => {
        if (i < suffixes.length) {
          img.src = prefix + base + '_' + suffixes[i] + '.svg'
        }
      })
    }

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
        syncCountSelections()
        setClearedToken((t) => t + 1)
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
      clearWrapper.style.display = disabled ? 'none' : 'inline-block'
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
      onClick: () => toggleSelectionMode(),
    })
    selectionButton.element.style.lineHeight = '0'
    viewer.addControl(selectionButton.element, {
      anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
    })

    // --- Presentation pointer tools (epic #1876): laser pointer + ephemeral
    // ink, armed only in OSD full-page mode. Ink is never persisted.
    const presentationUi = createPresentationLayer(getCurrentPresentationColors())
    setPresentationLayer(presentationUi)
    viewer.canvas.appendChild(presentationUi.svg)

    let presentationTool: PresentationTool | null = null
    // A tool queued while a dirty canvas draft blocked arming (a discard
    // prompt can end in "Keep editing", which leaves edit mode active).
    let pendingPresentationTool: PresentationTool | null = null
    const inkStrokes: InkStroke[] = []
    let inkDrawing: InkStroke | null = null
    let inkLastPx: OpenSeadragon.Point | null = null
    const trailPoints: { x: number; y: number; t: number }[] = []
    let presentationRaf: number | null = null
    // One-shot wake so opaque strokes don't keep the RAF loop alive.
    let inkWakeTimer: number | null = null

    const syncMouseNav = () => {
      viewer.setMouseNavEnabled(
        !(selectionModeRef.current || canvasEditModeRef.current || presentationTool === 'ink'),
      )
    }
    syncMouseNavRef.current = syncMouseNav

    const projectToCanvas = (p: { x: number; y: number }) =>
      viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(p.x, p.y), true)

    const reprojectInk = () => {
      for (const stroke of inkStrokes) {
        stroke.element.setAttribute('d', strokePathD(stroke.points.map(projectToCanvas)))
      }
    }

    const clearInk = () => {
      inkDrawing = null
      inkLastPx = null
      for (const stroke of inkStrokes) stroke.element.remove()
      inkStrokes.length = 0
    }

    const presentationTick = () => {
      presentationRaf = null
      const now = performance.now()
      while (trailPoints.length > 0 && now - trailPoints[0].t > LASER_TRAIL_MS) {
        trailPoints.shift()
      }
      presentationUi.trailDots.forEach((dot, i) => {
        const point = trailPoints[trailPoints.length - 1 - i]
        if (!point) {
          dot.setAttribute('opacity', '0')
          return
        }
        dot.setAttribute('cx', point.x.toFixed(1))
        dot.setAttribute('cy', point.y.toFixed(1))
        dot.setAttribute('r', Math.max(0.5, LASER_CORE_RADIUS - i * 0.3).toFixed(1))
        dot.setAttribute('opacity', (trailAlpha(now - point.t) * 0.7).toFixed(2))
      })
      let inkFading = false
      let inkWakeAt = Number.POSITIVE_INFINITY
      for (let i = inkStrokes.length - 1; i >= 0; i -= 1) {
        const stroke = inkStrokes[i]
        if (stroke.finishedAt == null) continue
        const alpha = inkStrokeAlpha(now - stroke.finishedAt)
        if (alpha <= 0) {
          stroke.element.remove()
          inkStrokes.splice(i, 1)
        } else {
          stroke.element.setAttribute('opacity', alpha.toFixed(2))
          if (alpha < 1) inkFading = true
          else inkWakeAt = Math.min(inkWakeAt, stroke.finishedAt + INK_FADE_START_MS)
        }
      }
      if (trailPoints.length > 0 || inkFading) {
        presentationRaf = window.requestAnimationFrame(presentationTick)
      } else if (inkWakeAt !== Number.POSITIVE_INFINITY) {
        // Opaque strokes look identical every frame — wake once when the
        // earliest one reaches its fade start instead of spinning on RAF.
        if (inkWakeTimer != null) window.clearTimeout(inkWakeTimer)
        inkWakeTimer = window.setTimeout(
          () => {
            inkWakeTimer = null
            ensurePresentationTicker()
          },
          Math.max(0, inkWakeAt - now),
        )
      }
    }
    const ensurePresentationTicker = () => {
      if (presentationRaf == null) {
        presentationRaf = window.requestAnimationFrame(presentationTick)
      }
    }

    const startInkStroke = (position: OpenSeadragon.Point) => {
      const vp = viewer.viewport.pointFromPixel(position)
      const stroke: InkStroke = {
        points: [{ x: vp.x, y: vp.y }],
        finishedAt: null,
        element: presentationUi.createStrokeElement(),
      }
      inkStrokes.push(stroke)
      if (inkStrokes.length > MAX_INK_STROKES) {
        inkStrokes.shift()?.element.remove()
      }
      inkDrawing = stroke
      inkLastPx = position
      stroke.element.setAttribute('d', strokePathD([{ x: position.x, y: position.y }]))
      ensurePresentationTicker()
    }

    const appendInkPoint = (position: OpenSeadragon.Point) => {
      if (!inkDrawing || !inkLastPx) return
      const dx = position.x - inkLastPx.x
      const dy = position.y - inkLastPx.y
      if (dx * dx + dy * dy < INK_MIN_POINT_PX * INK_MIN_POINT_PX) return
      inkLastPx = position
      const vp = viewer.viewport.pointFromPixel(position)
      inkDrawing.points.push({ x: vp.x, y: vp.y })
      // Append the new segment only — reprojecting the whole polyline per
      // sample would make long strokes quadratic.
      const px = projectToCanvas({ x: vp.x, y: vp.y })
      const d = inkDrawing.element.getAttribute('d') ?? ''
      inkDrawing.element.setAttribute('d', `${d} L${px.x.toFixed(1)} ${px.y.toFixed(1)}`)
    }

    const finishInkStroke = () => {
      if (!inkDrawing) return
      // A lone point needs a degenerate segment so the round caps render a dot.
      if (inkDrawing.points.length === 1) {
        inkDrawing.points.push({ ...inkDrawing.points[0] })
        reprojectInk()
      }
      inkDrawing.finishedAt = performance.now()
      inkDrawing = null
      inkLastPx = null
      ensurePresentationTicker()
    }

    const laserMoved = (position: OpenSeadragon.Point) => {
      presentationUi.setLaserVisible(true)
      presentationUi.setLaserPosition(position.x, position.y)
      trailPoints.push({ x: position.x, y: position.y, t: performance.now() })
      if (trailPoints.length > LASER_TRAIL_POINTS) trailPoints.shift()
      ensurePresentationTicker()
    }

    const setPresentationTool = (tool: PresentationTool | null) => {
      if (tool === presentationTool) return
      // A canvas draft gates arming: its cancel flow may open a discard
      // prompt, and "Keep editing" leaves edit mode active — a pointer tool
      // must never arm over the Fabric canvas. The queued tool arms via
      // notifyCanvasEditExited when edit mode actually exits.
      if (tool != null && canvasEditModeRef.current && canvasCancelRef.current) {
        pendingPresentationTool = tool
        void canvasCancelRef.current()
        return
      }
      const leaving = presentationTool
      presentationTool = tool
      if (leaving === 'laser') {
        presentationUi.setLaserVisible(false)
        trailPoints.length = 0
      }
      if (leaving === 'ink') finishInkStroke()
      viewer.canvas.style.cursor = ''
      if (tool != null) {
        if (selectionModeRef.current) {
          selectionModeRef.current = false
          setSelectionDrawing(false)
          setButtonIcons(selectionButton, 'selection')
        }
        emitToolbarAction(tool === 'laser' ? 'laser_pointer_on' : 'ink_on')
      } else if (leaving != null) {
        emitToolbarAction(leaving === 'laser' ? 'laser_pointer_off' : 'ink_off')
      }
      if (tool === 'laser') {
        // The dot stays hidden until the first pointermove — no stale (0,0).
        presentationUi.setLaserVisible(false)
        viewer.canvas.style.cursor = 'none'
      } else if (tool === 'ink') {
        viewer.canvas.style.cursor = 'crosshair'
      }
      syncMouseNav()
      setButtonIcons(laserButton, tool === 'laser' ? 'laser_pointer_active' : 'laser_pointer')
      setButtonIcons(inkButton, tool === 'ink' ? 'ink_active' : 'ink')
    }

    const toggleSelectionMode = () => {
      selectionModeRef.current = !selectionModeRef.current
      emitToolbarAction(selectionModeRef.current ? 'selection_mode_on' : 'selection_mode_off')
      if (selectionModeRef.current) setPresentationTool(null)
      syncMouseNav()
      setButtonIcons(selectionButton, selectionModeRef.current ? 'selection_active' : 'selection')
    }
    const toggleLaser = () => setPresentationTool(presentationTool === 'laser' ? null : 'laser')
    const toggleInk = () => setPresentationTool(presentationTool === 'ink' ? null : 'ink')

    const laserButton = new OpenSeadragon.Button({
      tooltip: 'Laser pointer',
      srcRest: prefix + 'laser_pointer_rest.svg',
      srcGroup: prefix + 'laser_pointer_grouphover.svg',
      srcHover: prefix + 'laser_pointer_hover.svg',
      srcDown: prefix + 'laser_pointer_pressed.svg',
      onClick: () => toggleLaser(),
    })
    laserButton.element.style.lineHeight = '0'
    const laserWrapper = document.createElement('div')
    laserWrapper.style.display = 'none'
    laserWrapper.appendChild(laserButton.element)

    const inkButton = new OpenSeadragon.Button({
      tooltip: 'Freehand ink',
      srcRest: prefix + 'ink_rest.svg',
      srcGroup: prefix + 'ink_grouphover.svg',
      srcHover: prefix + 'ink_hover.svg',
      srcDown: prefix + 'ink_pressed.svg',
      onClick: () => toggleInk(),
    })
    inkButton.element.style.lineHeight = '0'
    const inkWrapper = document.createElement('div')
    inkWrapper.style.display = 'none'
    inkWrapper.appendChild(inkButton.element)

    // Toolbar keyboard shortcuts — H: home, B: selection box, L: laser,
    // I: ink. Chosen to avoid OSD's own keys (WASD/arrows pan, F flips,
    // R rotates, 0 homes, J/K page). Laser/ink mirror their buttons and
    // only respond in full-page. Ignored while typing, inside dialogs, or
    // when the pointer/focus belongs to a different viewer on the page.
    const handleToolbarKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('[role="dialog"]') != null)
      ) {
        return
      }
      if (target instanceof Node && !viewer.element.contains(target)) {
        // Focus inside a different mounted viewer (e.g. a collection pane)
        // wins over merely hovering this one; a keypress outside every
        // viewer goes to whichever viewer is hovered.
        const insideOtherViewer = Array.from(mountedViewerElements).some(
          (el) => el !== viewer.element && el.contains(target),
        )
        if (insideOtherViewer || !viewer.container.matches(':hover')) return
      }
      switch (event.key.toLowerCase()) {
        case 'h':
          viewer.viewport.goHome()
          break
        case 'b':
          toggleSelectionMode()
          break
        case 'l':
          if (viewer.isFullPage()) toggleLaser()
          break
        case 'i':
          if (viewer.isFullPage()) toggleInk()
          break
        default:
          return
      }
      event.preventDefault()
    }
    document.addEventListener('keydown', handleToolbarKey)
    mountedViewerElements.add(viewer.element)

    // Full-page entry arms the laser; exit disarms and clears all ink.
    // Auto-arming is skipped while canvas edit mode is active — annotation
    // editing works in full-page too, so entering must not tear it down.
    const applyFullPagePresentation = (fullPage: boolean) => {
      laserWrapper.style.display = fullPage ? 'inline-block' : 'none'
      inkWrapper.style.display = fullPage ? 'inline-block' : 'none'
      if (fullPage) {
        // Editing continues into full-page, so the entry auto-arm becomes a
        // queued arm — the laser turns on when edit mode exits.
        if (canvasEditModeRef.current) pendingPresentationTool = 'laser'
        else setPresentationTool('laser')
      } else {
        pendingPresentationTool = null
        setPresentationTool(null)
        clearInk()
      }
    }

    // When canvas edit mode exits, arm the tool a presenter queued behind a
    // dirty-draft discard prompt — but only while still in full-page, since
    // the buttons are hidden otherwise.
    notifyCanvasEditExitedRef.current = () => {
      const pending = pendingPresentationTool
      pendingPresentationTool = null
      if (pending != null && viewer.isFullPage()) setPresentationTool(pending)
    }

    // User testing found the +/- and rotation buttons useless while
    // presenting; hide them in full-screen so the dock stays decluttered.
    // They stay in normal view (#1877).
    const setNavControlsHidden = (hidden: boolean) => {
      for (const button of [
        viewer.zoomInButton,
        viewer.zoomOutButton,
        viewer.rotateLeftButton,
        viewer.rotateRightButton,
      ]) {
        // Restore 'inline-block' — ControlDock.addControl sets it inline; a
        // blank string would collapse the buttons to display:block stacking.
        if (button?.element) {
          button.element.style.display = hidden ? 'none' : 'inline-block'
        }
      }
    }

    // --- Mouse tracker for drawing selection rectangles ---
    let currentRect: OpenSeadragon.Rect | null = null

    const selectionTracker = new OpenSeadragon.MouseTracker({
      element: viewer.element,
      // CanvasOverlay portals its UI (edit toolbar, link annotations, fabric
      // canvas) into viewer.container, inside this tracker's element. Without
      // this guard the tracker would capture every such press to
      // viewer.element — retargeting pointerup/click away from the real target
      // — and preventDefault the pointerdown, which suppresses focus and
      // breaks the toolbar's arrow-key nudge. preventGesture skips both.
      preProcessEventHandler: (event: OpenSeadragon.PreProcessMouseTrackerEvent) => {
        const target = event.originalEvent?.target
        if (target instanceof Element && target.closest('[data-hriv-canvas-ui]')) {
          event.preventGesture = true
          return
        }
        // A press on the OSD control dock or navigator must not start a rect
        // or ink stroke — but check only gesture START: once OSD captures the
        // pointer, every move/up retargets to viewer.element (outside
        // viewer.canvas), and blocking those would cancel the drag (#1881).
        if (
          event.eventType === 'pointerdown' &&
          target instanceof Element &&
          !viewer.canvas.contains(target)
        ) {
          event.preventGesture = true
        }
      },
      pressHandler: (event: OpenSeadragon.MouseTrackerEvent) => {
        if (presentationTool === 'ink') {
          if (event.position) startInkStroke(event.position)
          return
        }
        if (!selectionModeRef.current || !event.position) return
        setSelectionDrawing(true)
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
      moveHandler: (event: OpenSeadragon.MouseTrackerEvent) => {
        if (presentationTool !== 'laser' || !event.position) return
        laserMoved(event.position)
      },
      leaveHandler: () => {
        presentationUi.setLaserVisible(false)
        trailPoints.length = 0
      },
      dragHandler: (event: OpenSeadragon.MouseTrackerEvent) => {
        if (inkDrawing) {
          if (event.position) appendInkPoint(event.position)
          return
        }
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
        if (inkDrawing) {
          finishInkStroke()
          return
        }
        if (!dragRef.current) return
        // Store the final rect and labels for repositioning on zoom/pan
        if (currentRect && currentRect.width > 0 && currentRect.height > 0) {
          labelPairs.push({
            key: nextSelectionKey++,
            rect: currentRect,
            widthLabel: dragRef.current.widthLabel,
            heightLabel: dragRef.current.heightLabel,
          })
          syncCountSelections()
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
        setSelectionDrawing(false)
        syncMouseNav()
        setButtonIcons(selectionButton, 'selection')
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
    // Ink strokes are image-anchored: reproject viewport points on every
    // viewport/frame change so they track the underlying structures.
    for (const eventName of [
      'animation',
      'animation-finish',
      'resize',
      'viewport-change',
      'open',
    ] as const) {
      viewer.addHandler(eventName, reprojectInk)
    }

    // --- Lock overlay toolbar button (visible to admin/instructor) ---
    let lockButton: OpenSeadragon.Button | null = null
    let lockWrapper: HTMLDivElement | null = null
    const updateLockIcon = () => {
      if (!lockButton) return
      const locked = overlaysLockedRef.current
      const empty = overlaysRef.current.length === 0
      const state = locked ? 'lock_closed' : 'lock_open'
      setButtonIcons(lockButton, state)
      // The closed-lock icon fills red; no extra outline is needed.
      lockButton.element.style.outline = 'none'
      // Disable when not locked and no rectangles exist
      const disabled = !locked && empty
      if (lockWrapper) lockWrapper.style.display = disabled ? 'none' : 'inline-block'
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

    // Add clear button to toolbar (created above, before selection tracker).
    // updateClearButtonState must run AFTER addControl: OSD's ControlDock
    // sets element.style.display = 'inline-block' on every added control,
    // which would undo the initial hidden state. Nothing else writes the
    // element's display later (setControlsEnabled/setVisible only touch the
    // OSD-created wrapper), so the reorder alone keeps it hidden.
    viewer.addControl(clearWrapper, {
      anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
    })
    updateClearButtonState()

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
          if (!entering && canvasCancelRef.current) {
            // Exit through the overlay's cancel flow so unsaved changes are discarded
            void canvasCancelRef.current()
            return
          }
          canvasEditModeRef.current = entering
          setCanvasEditMode(entering)
          if (entering) setPresentationTool(null)
          syncMouseNav()
          onCanvasEditModeChangeRef.current?.(entering)
          setButtonIcons(canvasEditButton, entering ? 'canvas_edit_active' : 'canvas_edit')
        },
      })
      canvasEditButton.element.style.lineHeight = '0'
      viewer.addControl(canvasEditButton.element, {
        anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
      })

      // Allow external code (e.g. CanvasOverlay "Done" button) to update the button state
      updateCanvasEditUiRef.current = (active: boolean) => {
        setButtonIcons(canvasEditButton, active ? 'canvas_edit_active' : 'canvas_edit')
      }
    }

    // Presentation tools dock last so the selection-adjacent controls (lock,
    // clear) sit directly next to the selection button; laser/ink are hidden
    // outside full-page anyway.
    viewer.addControl(laserWrapper, {
      anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
    })
    viewer.addControl(inkWrapper, {
      anchor: OpenSeadragon.ControlAnchor.BOTTOM_LEFT,
    })

    // Keep the bottom-left toolbar above the canvas edit overlay (zIndex 15/20)
    // so its buttons stay visible and clickable while in canvas edit mode.
    let toolbarAnchor: HTMLElement | null = selectionButton.element
    while (toolbarAnchor && toolbarAnchor.parentElement !== viewer.container) {
      toolbarAnchor = toolbarAnchor.parentElement
    }
    if (toolbarAnchor) toolbarAnchor.style.zIndex = '25'

    // --- Top-right viewport control (e.g. the "Image details" trigger) ---
    // Anchored as an OSD control so autoFade fades it with the toolbar;
    // keyboard focus keeps it (and the controls) visible.
    const topRightControl = document.createElement('div')
    topRightControl.style.display = 'inline-block'
    topRightControl.style.lineHeight = '0'
    const keepControlsEnabled = () => viewer.setControlsEnabled(true)
    // Don't start auto-hide when focus moves within the control, or while
    // the pointer still hovers the viewer — OSD's own leave handler resumes it.
    const releaseControls = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && topRightControl.contains(e.relatedTarget)) return
      if (viewer.container.matches(':hover')) return
      viewer.setControlsEnabled(false)
    }
    topRightControl.addEventListener('focusin', keepControlsEnabled)
    topRightControl.addEventListener('focusout', releaseControls)
    viewer.addControl(topRightControl, {
      anchor: OpenSeadragon.ControlAnchor.TOP_RIGHT,
    })
    let topRightAnchor: HTMLElement | null = topRightControl
    while (topRightAnchor && topRightAnchor.parentElement !== viewer.container) {
      topRightAnchor = topRightAnchor.parentElement
    }
    if (topRightAnchor) topRightAnchor.style.zIndex = '26'
    setControlWrapper(topRightControl)

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

    // OSD wraps each control in an inline-block wrapper that sits on a text
    // baseline; the line-box strut leaves a few px of dead space under the
    // bottom-anchored chrome. Bottom-align every element in the bottom docks so
    // the toolbar and navigator sit flush with the bottom edge of the frame.
    let navigatorAnchor: HTMLElement | null = viewer.navigator?.element ?? null
    while (navigatorAnchor && navigatorAnchor.parentElement !== viewer.container) {
      navigatorAnchor = navigatorAnchor.parentElement
    }
    for (const dock of [toolbarAnchor, navigatorAnchor]) {
      dock?.querySelectorAll<HTMLElement>('*').forEach((el) => {
        el.style.verticalAlign = 'bottom'
      })
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
    onViewerReadyRef.current?.(viewer)

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
      const viewportToRestore = pendingRenewalViewportRef.current ?? initialViewport
      pendingRenewalViewportRef.current = null
      if (viewportToRestore) {
        viewer.viewport.zoomTo(viewportToRestore.zoom, undefined, true)
        viewer.viewport.panTo(
          new OpenSeadragon.Point(viewportToRestore.x, viewportToRestore.y),
          true,
        )
        if (viewportToRestore.rotation) {
          viewer.viewport.setRotation(viewportToRestore.rotation, true)
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
      homeViewportAtLastSettledStateRef.current = isViewportAtHome(viewer)
    })

    viewer.addHandler('open-failed', (event) => {
      if (imageIdRef.current && isTileTokenAuthorizationFailure(event)) {
        scheduleTileSourceRenewal()
        return
      }
      const duration = viewStartTimeRef.current
        ? Math.round(performance.now() - viewStartTimeRef.current)
        : undefined
      const errorMessage = typeof event?.message === 'string' ? event.message : undefined
      emitEvent({
        event: 'image.view.failed',
        action: 'view',
        outcome: 'failure',
        duration_ms: duration,
        image_id: imageIdRef.current,
        category_id: categoryIdRef.current,
        error_message: errorMessage,
      })
      emitFrontendError({
        action: 'image_viewer_open',
        error: 'image_viewer',
        errorCode: 'image_viewer_open_failed',
        message: errorMessage,
        imageId: imageIdRef.current,
        categoryId: categoryIdRef.current,
      })
      // Non-auth open failures (deleted image, dead tile host) used to only
      // emit telemetry — surface them so hosts can react (the sequence
      // viewer skips the broken member; the image view shows a snackbar).
      onErrorRef.current?.(
        'This image could not be loaded. It may have been removed or you may not have access to it.',
      )
    })

    viewer.addHandler('tile-load-failed', (event) => {
      if (isTileTokenAuthorizationFailure(event, true)) scheduleTileSourceRenewal()
    })
    viewer.addHandler('add-item-failed', (event) => {
      if (isTileTokenAuthorizationFailure(event)) scheduleTileSourceRenewal()
    })

    // Reset rotation to 0 when the home button is clicked
    viewer.addHandler('home', () => {
      emitToolbarAction('home')
      viewer.viewport.setRotation(0)
    })
    // Swap the fullscreen button between outward and inward arrows.
    const syncFullPageIcon = () => {
      const fullPageButton = viewer.fullPageButton
      if (!fullPageButton) return
      const fullPage = viewer.isFullPage()
      setButtonIcons(fullPageButton, fullPage ? 'exitfullpage' : 'fullpage')
      fullPageButton.element.title = fullPage ? 'Exit full screen' : 'Full screen'
    }
    viewer.addHandler('full-page', (event) => {
      // Fires on both enter and exit; count only entering full screen.
      if (event.fullPage) emitToolbarAction('full_screen')
      syncFullPageIcon()
      setNavControlsHidden(event.fullPage)
      applyFullPagePresentation(event.fullPage)
    })
    // Run once now: a setFullPage(true) from the fullscreen handoff path can
    // fire 'full-page' before this handler is registered.
    syncFullPageIcon()
    setNavControlsHidden(viewer.isFullPage())
    applyFullPagePresentation(viewer.isFullPage())
    viewer.addHandler('resize', () => {
      pendingHomeResize = homeViewportAtLastSettledStateRef.current
    })
    viewer.addHandler('viewport-change', () => {
      const refitHome = pendingHomeResize
      pendingHomeResize = null
      if (refitHome) {
        viewer.viewport.fitBounds(viewer.viewport.getHomeBounds(), true)
        emitViewport()
      }
      homeViewportAtLastSettledStateRef.current = isViewportAtHome(viewer)
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
      const { rotationDelta, suppressZoom } = pinchRotationTracker.update(
        points[0].lastPos,
        points[1].lastPos,
        points[0].currentPos,
        points[1].currentPos,
        event.lastDistance,
        event.distance,
        timestamp,
      )
      event.preventDefaultZoomAction = suppressZoom
      if (rotationDelta === 0) return
      const pivot = viewer.viewport.pointFromPixel(event.center, true)
      viewer.viewport.rotateTo(viewer.viewport.getRotation(true) + rotationDelta, pivot, true)
    })

    viewer.addHandler('animation-finish', () => {
      if (pendingHomeResize == null) {
        homeViewportAtLastSettledStateRef.current = isViewportAtHome(viewer)
      }
      emitViewport()
    })

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
      setCountSelections([])
      setSelectionDrawing(false)
      canvasEditModeRef.current = false
      setCanvasEditMode(false)
      setViewerInstance(null)
      presentationTool = null
      pendingPresentationTool = null
      if (presentationRaf != null) {
        window.cancelAnimationFrame(presentationRaf)
        presentationRaf = null
      }
      if (inkWakeTimer != null) {
        window.clearTimeout(inkWakeTimer)
        inkWakeTimer = null
      }
      clearInk()
      trailPoints.length = 0
      presentationUi.svg.remove()
      setPresentationLayer(null)
      viewer.canvas.style.cursor = ''
      syncMouseNavRef.current = null
      notifyCanvasEditExitedRef.current = null
      if (renewalTimerRef.current != null) {
        window.clearTimeout(renewalTimerRef.current)
        renewalTimerRef.current = null
      }
      selectionTracker.destroy()
      document.removeEventListener('keydown', handleToolbarKey)
      mountedViewerElements.delete(viewer.element)
      topRightControl.removeEventListener('focusin', keepControlsEnabled)
      topRightControl.removeEventListener('focusout', releaseControls)
      const registeredControl = viewer.controls?.find((c) => c.element === topRightControl)
      if (registeredControl) viewer.removeControl(registeredControl)
      setControlWrapper(null)
      onViewerReadyRef.current?.(null)
      if (handleFullscreenChange) {
        document.removeEventListener('fullscreenchange', handleFullscreenChange)
      }
      const cleanupHandoffKey = fullScreenHandoffKeyRef.current
      if (viewer.isFullPage()) {
        viewer.setFullPage(false)
        if (document.fullscreenElement) {
          if (cleanupHandoffKey == null) {
            void document.exitFullscreen().catch(() => {})
          } else {
            pendingFullScreenHandoff = cleanupHandoffKey
            window.setTimeout(() => {
              if (pendingFullScreenHandoff !== cleanupHandoffKey) return
              pendingFullScreenHandoff = null
              if (document.fullscreenElement) {
                void document.exitFullscreen().catch(() => {})
              }
            }, 0)
          }
        }
      }
      viewer.destroy()
      viewerRef.current = null
    }
  }, [
    imageId,
    initialViewport,
    initialOverlays,
    emitViewport,
    updateMeasurementLabels,
    emitToolbarAction,
    scheduleTileSourceRenewal,
    viewerMountReady,
  ])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || tileSourceKey(tileSourcesRef.current) === tileSourceKey(tileSources)) return

    // A same-image refresh re-opens the pyramid — keep the live viewport
    // and overlays across the reopen (same trick as the token-renewal
    // path) so a save/refetch can't reset the user's position (#1567).
    const sameImage = openSourcesImageIdRef.current === imageId
    openSourcesImageIdRef.current = imageId
    if (sameImage) {
      pendingRenewalViewportRef.current = currentViewportState()
      viewer.addOnceHandler('open', restorePendingRenewalViewport)
    }
    tileSourcesRef.current = tileSources
    const previousPreserveOverlays = viewer.preserveOverlays
    viewer.preserveOverlays = sameImage
    try {
      viewer.open(tileSources as unknown as OpenSeadragon.TileSourceSpecifier)
    } finally {
      viewer.preserveOverlays = previousPreserveOverlays
    }
  }, [tileSourceKey, tileSources, imageId, currentViewportState, restorePendingRenewalViewport])

  // Reactively update lock/clear button UI when overlaysLocked prop changes
  useEffect(() => {
    updateLockUiRef.current?.()
  }, [overlaysLocked])

  // Handle canvas edit mode toggle from the CanvasOverlay (e.g. "Done" button)
  const handleCanvasEditModeChange = useCallback((mode: boolean) => {
    canvasEditModeRef.current = mode
    setCanvasEditMode(mode)
    syncMouseNavRef.current?.()
    updateCanvasEditUiRef.current?.(mode)
    onCanvasEditModeChangeRef.current?.(mode)
    // Arm a presentation tool that waited on this exit (#1876).
    if (!mode) notifyCanvasEditExitedRef.current?.()
  }, [])

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
          onSaveAnnotations={onSaveCanvasAnnotations}
          isDirty={canvasDraftDirty}
          registerCancelHandler={registerCanvasCancel}
        />
      )}
      {/* Like CanvasOverlay, portal into viewer.container so the overlay
          survives OSD full-page reparenting; positioned children anchor to
          the position:relative container. */}
      {viewerInstance && viewportOverlay
        ? createPortal(viewportOverlay, viewerInstance.container)
        : null}
      {/* Object counting UI (epic #1661): also portaled into the OSD
          container so buttons/dialogs survive full-page mode. Hidden in
          canvas edit mode and while a rectangle is being drawn — mounting
          it unconditionally would cancel in-flight jobs via the hook's
          unmount cleanup. */}
      {viewerInstance && imageId != null
        ? createPortal(
            <SelectionCountLayer
              viewer={viewerInstance}
              imageId={imageId}
              selections={countSelections}
              clearedToken={clearedToken}
              hidden={canvasEditMode || selectionDrawing}
            />,
            viewerInstance.container,
          )
        : null}
      {controlWrapper && viewportControl ? createPortal(viewportControl, controlWrapper) : null}
    </Box>
  )
}
