/** Shared types, constants and helpers used by ImageViewer and its tests. */

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

/** Format a measurement value with appropriate precision */
export function formatMeasurement(
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

/** Micrometres per CSS pixel at the browser-standard 96 DPI baseline. */
export const CSS_PIXEL_UM = 25400 / 96

/** Known physical units and their micrometre equivalents. */
const UNIT_TO_UM: Record<string, number> = {
  um: 1,
  µm: 1,
  mm: 1000,
  cm: 10000,
  m: 1_000_000,
  in: 25400,
}

/**
 * Convert a measurement unit string to its equivalent in micrometres.
 * Returns `undefined` for unrecognised units.
 */
export function unitToMicrons(unit: string): number | undefined {
  // Normalise the Greek small letter mu (U+03BC) to the micro sign (U+00B5)
  // so pasted values like "μm" match the "µm" alias — microscope software and
  // scientific sources commonly emit the Greek mu.
  const normalized = unit.toLowerCase().replace(/\u03bc/g, '\u00b5')
  return UNIT_TO_UM[normalized]
}

/**
 * Compute the effective magnification factor for display.
 *
 * When a {@link MeasurementConfig} with a valid scale is available the
 * magnification is derived from the real-world specimen size and the
 * physical screen pixel size.  The physical pixel size is estimated by
 * dividing the CSS-pixel baseline (96 DPI) by `devicePixelRatio`,
 * which accounts for OS display scaling and HiDPI/Retina screens.
 *
 * Returns `undefined` when a meaningful magnification cannot be
 * computed (no scale, unknown unit, etc.).
 *
 * @param imageZoom - OSD image-zoom ratio (1.0 = one image pixel per
 *   screen pixel), obtained via `viewport.viewportToImageZoom()`.
 * @param config - Optional measurement configuration for the image.
 * @param dpr - `window.devicePixelRatio` (defaults to 1).
 */
export function computeMagnification(
  imageZoom: number,
  config: MeasurementConfig | undefined,
  dpr = 1,
): number | undefined {
  if (config?.scale && config.scale > 0 && config.unit) {
    const um = unitToMicrons(config.unit)
    if (um !== undefined) {
      const imagePixelUm = um / config.scale
      const physicalPixelUm = CSS_PIXEL_UM / (dpr > 0 ? dpr : 1)
      return (physicalPixelUm / imagePixelUm) * imageZoom
    }
  }
  return undefined
}

/** Damping factor applied to the pinch-rotate gesture on touch devices. */
export const PINCH_ROTATE_SENSITIVITY = 0.4

/** Minimum accumulated rotation needed to activate pinch-rotate. */
export const PINCH_ROTATE_ACTIVATION_DEGREES = 10

/** Maximum gap between pinch events before starting a new gesture. */
export const PINCH_GESTURE_GAP_MS = 150

/** Separation ratio that activates pinch zoom arbitration. */
export const PINCH_ZOOM_ACTIVATION_RATIO = 1.25

/** A 2D point in CSS-pixel space (subset of OpenSeadragon.Point). */
interface Point2D {
  x: number
  y: number
}

/**
 * Compute the raw viewport rotation delta (in degrees) for a pinch-rotate
 * gesture, given the current and previous positions of the two contact points.
 *
 * Mirrors OpenSeadragon's internal pinch-rotate angle math: the signed change
 * in the angle of the line between the two fingers.
 */
export function pinchRotationDeltaDegrees(
  p0Last: Point2D,
  p1Last: Point2D,
  p0Current: Point2D,
  p1Current: Point2D,
): number {
  const angleCurrent = Math.atan2(p0Current.y - p1Current.y, p0Current.x - p1Current.x)
  const angleLast = Math.atan2(p0Last.y - p1Last.y, p0Last.x - p1Last.x)
  return (angleCurrent - angleLast) * (180 / Math.PI)
}

interface PinchRotationTrackerOptions {
  sensitivity?: number
  activationDegrees?: number
  gapMs?: number
  zoomActivationRatio?: number
}

/**
 * Create a tracker that arbitrates pinch rotation and zoom per gesture.
 *
 * The tracker treats a long gap between events as the boundary between
 * gestures because OpenSeadragon does not expose pinch-start/end events.
 */
export function createPinchRotationTracker({
  sensitivity = PINCH_ROTATE_SENSITIVITY,
  activationDegrees = PINCH_ROTATE_ACTIVATION_DEGREES,
  gapMs = PINCH_GESTURE_GAP_MS,
  zoomActivationRatio = PINCH_ZOOM_ACTIVATION_RATIO,
}: PinchRotationTrackerOptions = {}) {
  let accumulatedDegrees = 0
  let mode: 'undecided' | 'rotate' | 'zoom' = 'undecided'
  let startDistance: number | undefined
  let lastTimestamp: number | undefined
  const zoomActivationLnRatio = Math.log(zoomActivationRatio)

  return {
    update(
      p0Last: Point2D,
      p1Last: Point2D,
      p0Current: Point2D,
      p1Current: Point2D,
      lastDistance: number | undefined,
      distance: number | undefined,
      timestampMs: number,
    ): { rotationDelta: number; suppressZoom: boolean } {
      if (lastTimestamp !== undefined && timestampMs - lastTimestamp > gapMs) {
        accumulatedDegrees = 0
        mode = 'undecided'
        startDistance = undefined
      }
      lastTimestamp = timestampMs

      if (startDistance === undefined) startDistance = lastDistance
      if (
        startDistance === undefined ||
        distance === undefined ||
        startDistance <= 0 ||
        distance <= 0 ||
        !Number.isFinite(startDistance) ||
        !Number.isFinite(distance)
      ) {
        return { rotationDelta: 0, suppressZoom: false }
      }

      const rawDelta = pinchRotationDeltaDegrees(p0Last, p1Last, p0Current, p1Current)
      if (mode === 'undecided') {
        accumulatedDegrees += rawDelta
        const rotationProgress = Math.abs(accumulatedDegrees) / activationDegrees
        const zoomProgress = Math.abs(Math.log(distance / startDistance)) / zoomActivationLnRatio
        if (rotationProgress < 1 && zoomProgress < 1) {
          return { rotationDelta: 0, suppressZoom: false }
        }
        mode = rotationProgress > zoomProgress ? 'rotate' : 'zoom'
      }

      return mode === 'rotate'
        ? { rotationDelta: rawDelta * sensitivity, suppressZoom: true }
        : { rotationDelta: 0, suppressZoom: false }
    },
  }
}

/** Create a styled label element for measurement display */
export function createMeasurementLabel(): HTMLDivElement {
  const label = document.createElement('div')
  label.style.position = 'absolute'
  label.style.color = '#ff0000'
  label.style.fontSize = '12px'
  label.style.fontFamily = 'monospace'
  label.style.fontWeight = '600'
  label.style.whiteSpace = 'nowrap'
  label.style.pointerEvents = 'none'
  label.style.textShadow = '-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff'
  label.style.zIndex = '10'
  label.style.display = 'none'
  return label
}
