import OpenSeadragon from 'openseadragon'
import type { InuksukView } from './types'

export function adjustInuksukPixelForFlip(
  viewer: OpenSeadragon.Viewer,
  pixel: OpenSeadragon.Point,
): OpenSeadragon.Point {
  return viewer.viewport.getFlip()
    ? new OpenSeadragon.Point(viewer.canvas.clientWidth - pixel.x, pixel.y)
    : pixel
}

export function navigateToInuksuk(viewer: OpenSeadragon.Viewer, item: InuksukView) {
  const point = new OpenSeadragon.Point(item.x, item.y)
  viewer.viewport.setRotation(item.rotation, false)
  viewer.viewport.zoomTo(item.zoom, undefined, false)
  viewer.viewport.panTo(point, false)
}
