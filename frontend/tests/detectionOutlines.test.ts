/**
 * detectionOutlines (#1872): category->RGBA tint (edge vs fill alpha) and
 * the mask's level-0 -> element-rect blit.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  drawDetectionOutline,
  tintOutlineMask,
  OUTLINE_REJECTED_RGB,
  OUTLINE_SELECTED_RGB,
} from '../src/detectionOutlines'

/** RGBA pixels for a tiny 4×3 category mask (single channel replicated). */
function rgbaFromCategories(rows: number[][]): Uint8ClampedArray {
  const h = rows.length
  const w = rows[0].length
  const data = new Uint8ClampedArray(w * h * 4)
  rows.forEach((row, y) =>
    row.forEach((v, x) => {
      const o = (y * w + x) * 4
      data[o] = data[o + 1] = data[o + 2] = v
      data[o + 3] = 255
    }),
  )
  return data
}

function fakeViewer({ scale = 1, offsetX = 100, offsetY = 50 } = {}) {
  return {
    canvas: { clientWidth: 800, clientHeight: 600 },
    viewport: {
      imageToViewerElementCoordinates: ({ x, y }: { x: number; y: number }) => ({
        x: x * scale + offsetX,
        y: y * scale + offsetY,
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function fakeCtx() {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function rgbaAt(out: Uint8ClampedArray, w: number, x: number, y: number) {
  const o = (y * w + x) * 4
  return [out[o], out[o + 1], out[o + 2], out[o + 3]]
}

describe('tintOutlineMask', () => {
  it('tints selected components green, rejected vermillion, none transparent', () => {
    const data = rgbaFromCategories([
      [0, 0, 0, 0],
      [0, 2, 0, 1],
      [0, 0, 0, 0],
    ])
    const out = tintOutlineMask(data, 4, 3)
    expect(rgbaAt(out, 4, 1, 1)).toEqual([...OUTLINE_SELECTED_RGB, 240])
    expect(rgbaAt(out, 4, 3, 1)).toEqual([...OUTLINE_REJECTED_RGB, 240])
    expect(rgbaAt(out, 4, 0, 0)).toEqual([0, 0, 0, 0])
  })

  it('uses the faint fill alpha inside a component and the edge alpha on its boundary', () => {
    const data = rgbaFromCategories([
      [0, 0, 0, 0, 0],
      [0, 2, 2, 2, 0],
      [0, 2, 2, 2, 0],
      [0, 2, 2, 2, 0],
      [0, 0, 0, 0, 0],
    ])
    const out = tintOutlineMask(data, 5, 5)
    expect(rgbaAt(out, 5, 2, 2)[3]).toBe(48) // interior
    expect(rgbaAt(out, 5, 1, 1)[3]).toBe(240) // corner edge
    expect(rgbaAt(out, 5, 2, 1)[3]).toBe(240) // side edge
  })

  it('treats a neighbour of a different category as an edge', () => {
    const data = rgbaFromCategories([[2, 1]])
    const out = tintOutlineMask(data, 2, 1)
    expect(rgbaAt(out, 2, 0, 0)).toEqual([...OUTLINE_SELECTED_RGB, 240])
    expect(rgbaAt(out, 2, 1, 0)).toEqual([...OUTLINE_REJECTED_RGB, 240])
  })
})

describe('drawDetectionOutline', () => {
  const overlay = {
    // 8×5 mask at work_scale 0.1 -> spans level-0 (0,0)-(80,50).
    canvas: { width: 8, height: 5 },
    workScale: 0.1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  it('blits the mask into the transformed image rect', () => {
    const ctx = fakeCtx()
    drawDetectionOutline(ctx, fakeViewer({ scale: 2 }), overlay)
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600)
    // (0,0)->(100,50); (80,50)->(260,150): rect 100,50 160×100.
    expect(ctx.drawImage).toHaveBeenCalledWith(overlay.canvas, 100, 50, 160, 100)
  })

  it('clears but skips the blit when the image is fully off-screen', () => {
    const ctx = fakeCtx()
    drawDetectionOutline(ctx, fakeViewer({ offsetX: -5000 }), overlay)
    expect(ctx.clearRect).toHaveBeenCalledOnce()
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('clears the layer when the overlay is cleared', () => {
    const ctx = fakeCtx()
    drawDetectionOutline(ctx, fakeViewer(), null)
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600)
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })
})
