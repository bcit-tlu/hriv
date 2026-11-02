/**
 * Canvas drawing for the object-count outlines layer (epic #1661, #1668).
 * Level-0 -> element-pixel transform, per-selection clip quadrilateral,
 * one ``Path2D`` per group (white halo then group colour, constant
 * screen-px width). Extracted from the component file so fast refresh
 * keeps working and the transform is unit-testable.
 *
 * Flip: ``imageToViewerElementCoordinates`` does not apply
 * ``viewport.getFlip()`` (element pixels flip around the container
 * centre). This mirrors x manually when flipped — covered by tests.
 */

import OpenSeadragon from 'openseadragon'

import type { ApiCountObject, ApiCountSelection } from './api'
import { countGroupColor } from './countPalette'

export interface CountOutlinesSelection {
  /** Level-0 selection rect (the clip region). */
  selection: ApiCountSelection
  objects: ApiCountObject[]
}

export function drawCountOutlines(
  ctx: CanvasRenderingContext2D,
  viewer: OpenSeadragon.Viewer,
  items: CountOutlinesSelection[],
): void {
  const container = viewer.canvas
  const w = container.clientWidth
  const h = container.clientHeight
  const flipped = viewer.viewport.getFlip()

  const toElement = (x: number, y: number) => {
    const p = viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(x, y))
    return flipped ? { x: w - p.x, y: p.y } : { x: p.x, y: p.y }
  }

  for (const item of items) {
    const { selection, objects } = item
    if (objects.length === 0) continue

    // Transform the 4 selection corners; skip if entirely off-screen.
    const corners = [
      toElement(selection.x, selection.y),
      toElement(selection.x + selection.width, selection.y),
      toElement(selection.x + selection.width, selection.y + selection.height),
      toElement(selection.x, selection.y + selection.height),
    ]
    const minX = Math.min(...corners.map((c) => c.x))
    const maxX = Math.max(...corners.map((c) => c.x))
    const minY = Math.min(...corners.map((c) => c.y))
    const maxY = Math.max(...corners.map((c) => c.y))
    if (maxX < 0 || minX > w || maxY < 0 || minY > h) continue

    ctx.save()
    ctx.beginPath()
    ctx.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < 4; i += 1) ctx.lineTo(corners[i].x, corners[i].y)
    ctx.closePath()
    ctx.clip()

    // One Path2D per group — polygons are mapped per vertex, so rotation
    // and flip work.
    const byGroup = new Map<number, Path2D>()
    for (const obj of objects) {
      const path = new Path2D()
      obj.polygon.forEach(([x, y], i) => {
        const p = toElement(x, y)
        if (i === 0) path.moveTo(p.x, p.y)
        else path.lineTo(p.x, p.y)
      })
      path.closePath()
      const existing = byGroup.get(obj.group)
      if (existing) existing.addPath(path)
      else byGroup.set(obj.group, path)
    }
    for (const [group, path] of byGroup) {
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 4
      ctx.stroke(path)
      ctx.strokeStyle = countGroupColor(group)
      ctx.lineWidth = 2
      ctx.stroke(path)
    }
    ctx.restore()
  }
}
