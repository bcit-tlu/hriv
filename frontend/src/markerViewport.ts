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

export function navigateToMarker(viewer: OpenSeadragon.Viewer, item: MarkerView) {
  const point = new OpenSeadragon.Point(item.x, item.y)
  viewer.viewport.setRotation(item.rotation, false)
  viewer.viewport.zoomTo(item.zoom, undefined, false)
  viewer.viewport.panTo(point, false)
}
