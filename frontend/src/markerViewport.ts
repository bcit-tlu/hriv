import OpenSeadragon from 'openseadragon'
import type { MarkerView } from './types'

export function adjustMarkerPixelForFlip(
  viewer: OpenSeadragon.Viewer,
  pixel: OpenSeadragon.Point,
): OpenSeadragon.Point {
  return viewer.viewport.getFlip()
    ? new OpenSeadragon.Point(viewer.canvas.clientWidth - pixel.x, pixel.y)
    : pixel
}

export function navigateToView(
  viewer: OpenSeadragon.Viewer,
  view: { x: number; y: number; zoom: number; rotation?: number },
) {
  viewer.viewport.setRotation(view.rotation ?? 0, false)
  viewer.viewport.zoomTo(view.zoom, undefined, false)
  viewer.viewport.panTo(new OpenSeadragon.Point(view.x, view.y), false)
}

export function navigateToMarker(viewer: OpenSeadragon.Viewer, item: MarkerView) {
  navigateToView(viewer, item)
}
