/**
 * detectionOutlines (#1872): category->RGBA tint (edge vs fill alpha) and
 * the mask's level-0 -> element-rect blit.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  decodeDetectionOutline,
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

describe('decodeDetectionOutline', () => {
  // The category PNG the backend would return for a 3×2 mask: a selected
  // cell on the left, a rejected one on the right. jsdom cannot decode
  // PNGs, so the Image loader is stubbed to a 3×2 element and getImageData
  // returns that PNG's decoded pixels.
  const pngPixels = rgbaFromCategories([
    [2, 0, 1],
    [2, 0, 1],
  ])
  const pngB64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  function stubImageDecode() {
    class FakeImage {
      naturalWidth = 3
      naturalHeight = 2
      onload: (() => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      set src(v: string) {
        expect(v).toBe(`data:image/png;base64,${pngB64}`)
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', FakeImage)
    const putImageData = vi.fn()
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () =>
        ({
          drawImage: vi.fn(),
          getImageData: () => ({ data: pngPixels }),
          createImageData: (w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
            width: w,
            height: h,
          }),
          putImageData,
        }) as unknown as CanvasRenderingContext2D,
    ) as never
    return putImageData
  }

  it('decodes the base64 PNG and stores the tinted categories', async () => {
    const putImageData = stubImageDecode()
    const overlay = await decodeDetectionOutline(pngB64, 0.5)
    expect(overlay).not.toBeNull()
    expect(overlay?.workScale).toBe(0.5)
    expect(overlay?.canvas.width).toBe(3)
    expect(overlay?.canvas.height).toBe(2)
    const painted = putImageData.mock.calls[0][0] as ImageData
    expect(painted.width).toBe(3)
    expect([...painted.data.slice(0, 4)]).toEqual([...OUTLINE_SELECTED_RGB, 240])
    // (2,0) rejected edge; (1,0) background stays transparent.
    expect([...painted.data.slice(8, 12)]).toEqual([...OUTLINE_REJECTED_RGB, 240])
    expect([...painted.data.slice(4, 8)]).toEqual([0, 0, 0, 0])
  })

  it('resolves null when the decoded image is empty', async () => {
    class EmptyImage {
      naturalWidth = 0
      naturalHeight = 0
      onload: (() => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      set src(_v: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', EmptyImage)
    expect(await decodeDetectionOutline(pngB64, 1)).toBeNull()
  })
})
