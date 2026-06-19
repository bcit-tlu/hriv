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
  return UNIT_TO_UM[unit.toLowerCase()]
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
