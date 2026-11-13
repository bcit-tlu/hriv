/**
 * Canvas drawing for the tuning dialog's detection outline overlay (#1872).
 *
 * The preview endpoint's `include=outline` response is a labelled PNG in
 * work-image space: 0 = not a component, 1 = counted but outside the
 * dominant size window (rejected), 2 = selected. This module decodes it
 * once per preview into a tinted RGBA bitmap — strong edge colour plus a
 * faint interior fill so the overlay stays legible at thumbnail zoom —
 * and `drawDetectionOutline` blits it over the image each frame, mirroring
 * `countOutlines.ts`'s level-0 -> element-pixel transform.
 */

import OpenSeadragon from 'openseadragon'

// Okabe–Ito, same palette family as the count outlines: bluish green for
// the cells that count, vermillion for the ones the detector rejected.
export const OUTLINE_SELECTED_RGB = [0, 158, 115] as const // #009E73
export const OUTLINE_REJECTED_RGB = [213, 94, 0] as const // #D55E00
const FILL_ALPHA = 48 // ~0.19 — fill hints, the edge carries the outline
const EDGE_ALPHA = 240 // ~0.94

export interface DetectionOverlay {
  /** Pre-tinted RGBA canvas in work-image pixel space. */
  canvas: HTMLCanvasElement
  /** work-image px per source px — mask px ÷ workScale = level-0 px. */
  workScale: number
}

/** The viewer surface the overlay needs — a subset of OpenSeadragon.Viewer
 * that story/test fakes can satisfy without a real tile source. */
export interface OutlineViewerSurface {
  canvas: { clientWidth: number; clientHeight: number }
  viewport: {
    imageToViewerElementCoordinates(p: { x: number; y: number }): { x: number; y: number }
  }
}

/**
 * Map the decoded category pixels to an RGBA image: edge pixels (next to a
 * different category) get the strong class colour; interiors get a faint
 * fill of it. Pure pixel math — unit-testable without a real canvas.
 */
export function tintOutlineMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(data.length)
  const category = (x: number, y: number) =>
    x < 0 || x >= width || y < 0 || y >= height ? 0 : data[(y * width + x) * 4]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = category(x, y)
      if (v !== 1 && v !== 2) continue
      const edge =
        category(x - 1, y) !== v ||
        category(x + 1, y) !== v ||
        category(x, y - 1) !== v ||
        category(x, y + 1) !== v
      const rgb = v === 2 ? OUTLINE_SELECTED_RGB : OUTLINE_REJECTED_RGB
      const o = (y * width + x) * 4
      out[o] = rgb[0]
      out[o + 1] = rgb[1]
      out[o + 2] = rgb[2]
      out[o + 3] = edge ? EDGE_ALPHA : FILL_ALPHA
    }
  }
  return out
}

/** Decode the base64 category PNG and tint it into an overlay bitmap. */
export async function decodeDetectionOutline(
  b64: string,
  workScale: number,
): Promise<DetectionOverlay | null> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Could not decode detection outlines.'))
    el.src = `data:image/png;base64,${b64}`
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null
  ctx.drawImage(img, 0, 0)
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const tinted = ctx.createImageData(canvas.width, canvas.height)
  tinted.data.set(tintOutlineMask(src.data, canvas.width, canvas.height))
  ctx.putImageData(tinted, 0, 0)
  return { canvas, workScale }
}

/**
 * Blit the tinted mask over the slide: the mask's extent in level-0
 * coordinates is `[0, maskPx / workScale]` — the whole image field.
 */
export function drawDetectionOutline(
  ctx: CanvasRenderingContext2D,
  viewer: OutlineViewerSurface,
  overlay: DetectionOverlay | null,
): void {
  const w = viewer.canvas.clientWidth
  const h = viewer.canvas.clientHeight
  ctx.clearRect(0, 0, w, h)
  if (overlay == null) return
  const tl = viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0))
  const br = viewer.viewport.imageToViewerElementCoordinates(
    new OpenSeadragon.Point(
      overlay.canvas.width / overlay.workScale,
      overlay.canvas.height / overlay.workScale,
    ),
  )
  const dx = Math.min(tl.x, br.x)
  const dy = Math.min(tl.y, br.y)
  const dw = Math.abs(br.x - tl.x)
  const dh = Math.abs(br.y - tl.y)
  if (dw === 0 || dh === 0 || dx > w || dy > h || dx + dw < 0 || dy + dh < 0) return
  ctx.drawImage(overlay.canvas, dx, dy, dw, dh)
}
