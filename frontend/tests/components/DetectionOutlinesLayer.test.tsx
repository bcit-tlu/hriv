/**
 * DetectionOutlinesLayer (#1872): canvas mounted in viewer.canvas with
 * pointer-events none, rAF redraws on viewport events, immediate redraw on
 * overlay changes, removal + listener/rAF cleanup on unmount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

import DetectionOutlinesLayer from '../../src/components/DetectionOutlinesLayer'
import type { DetectionOverlay } from '../../src/detectionOutlines'

function ctx2d() {
  return {
    canvas: null,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  }
}

function viewer() {
  const canvasEl = document.createElement('div')
  Object.defineProperties(canvasEl, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  })
  document.body.appendChild(canvasEl)
  const handlers = new Map<string, (() => void)[]>()
  const v = {
    canvas: canvasEl,
    viewport: {
      imageToViewerElementCoordinates: (p: { x: number; y: number }) => p,
    },
    addHandler: (e: string, fn: () => void) => {
      handlers.set(e, [...(handlers.get(e) ?? []), fn])
    },
    removeHandler: (e: string, fn: () => void) => {
      handlers.set(
        e,
        (handlers.get(e) ?? []).filter((f) => f !== fn),
      )
    },
    fire: (e: string) => (handlers.get(e) ?? []).forEach((f) => f()),
    __handlers: handlers,
  }
  return v
}

const OVERLAY: DetectionOverlay = {
  canvas: Object.assign(document.createElement('canvas'), { width: 8, height: 5 }),
  workScale: 0.1,
}

async function nextFrame() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r))
  })
}

describe('DetectionOutlinesLayer', () => {
  let ctxs: ReturnType<typeof ctx2d>[]
  // Real canvases return the same 2d context every call — cache per canvas
  // so call counts survive across redraws.
  const byCanvas = new WeakMap<HTMLCanvasElement, ReturnType<typeof ctx2d>>()

  beforeEach(() => {
    vi.restoreAllMocks()
    ctxs = []
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      let c = byCanvas.get(this)
      if (!c) {
        c = ctx2d()
        c.canvas = this
        byCanvas.set(this, c)
        ctxs.push(c)
      }
      return c as unknown as CanvasRenderingContext2D
    }) as never
    document.body.innerHTML = ''
  })

  const draws = () => ctxs.reduce((n, c) => n + c.drawImage.mock.calls.length, 0)

  const originalGetContext = HTMLCanvasElement.prototype.getContext

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext
  })

  it('mounts a pointer-events-none, aria-hidden canvas into viewer.canvas', async () => {
    const v = viewer()
    render(<DetectionOutlinesLayer viewer={v} overlay={null} />)
    await nextFrame()
    const cv = v.canvas.querySelector('canvas')
    expect(cv).not.toBeNull()
    const el = cv as HTMLElement
    expect(el.style.pointerEvents).toBe('none')
    expect(el.getAttribute('aria-hidden')).toBe('true')
  })

  it('redraws on viewport events and unregisters handlers on unmount', async () => {
    const v = viewer()
    const { unmount } = render(<DetectionOutlinesLayer viewer={v} overlay={OVERLAY} />)
    await nextFrame()
    expect(draws()).toBeGreaterThan(0)
    const before = draws()

    act(() => v.fire('viewport-change'))
    await nextFrame()
    expect(draws()).toBeGreaterThan(before)

    unmount()
    expect(v.canvas.querySelector('canvas')).toBeNull()
    // Every subscribed event handler must be unregistered.
    for (const fns of v.__handlers.values()) expect(fns).toHaveLength(0)
  })

  it('redraws immediately when the overlay mask changes', async () => {
    const v = viewer()
    const { rerender } = render(<DetectionOutlinesLayer viewer={v} overlay={null} />)
    await nextFrame()
    expect(draws()).toBe(0)

    rerender(<DetectionOutlinesLayer viewer={v} overlay={OVERLAY} />)
    await nextFrame()
    expect(ctxs[0]?.drawImage).toHaveBeenCalledWith(OVERLAY.canvas, 0, 0, 80, 50)
  })

  it('cancels a pending frame on unmount without a stale redraw', async () => {
    const v = viewer()
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { unmount } = render(<DetectionOutlinesLayer viewer={v} overlay={OVERLAY} />)
    act(() => v.fire('resize'))
    unmount()
    expect(cancel).toHaveBeenCalled()
    await nextFrame()
    // No canvas remains to draw into.
    expect(v.canvas.querySelector('canvas')).toBeNull()
  })
})
