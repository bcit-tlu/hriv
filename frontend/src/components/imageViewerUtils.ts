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
  label.style.textShadow =
    '-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff'
  label.style.zIndex = '10'
  label.style.display = 'none'
  return label
}
