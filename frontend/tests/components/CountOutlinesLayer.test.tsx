/**
 * CountOutlinesLayer (#1668): canvas mounted in viewer.canvas with
 * pointer-events none, rAF redraws on items/viewport changes, removal on
 * unmount.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

vi.stubGlobal(
  'Path2D',
  class {
    moveTo = vi.fn()
    lineTo = vi.fn()
    closePath = vi.fn()
  },
)

import CountOutlinesLayer from '../../src/components/CountOutlinesLayer'

function ctx2d() {
  return {
    canvas: null,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    lineWidth: 1,
    strokeStyle: '',
  }
}

function viewer() {
  const container = document.createElement('div')
  const canvasEl = document.createElement('div')
  container.appendChild(canvasEl)
  const handlers = new Map<string, (() => void)[]>()
  const v = {
    container,
    canvas: canvasEl,
    viewport: {
      imageToViewerElementCoordinates: (p: { x: number; y: number }) => p,
      getFlip: () => false,
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

const ITEM = {
  selection: { x: 0, y: 0, width: 100, height: 100 },
  objects: [
    {
      group: 0,
      centroid: [50, 50] as [number, number],
      polygon: [
        [10, 10],
        [90, 10],
        [90, 90],
      ] as [number, number][],
    },
  ],
}

describe('CountOutlinesLayer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      const c = ctx2d()
      c.canvas = this
      return c as unknown as CanvasRenderingContext2D
    }) as never
  })

  it('mounts a pointer-events-none canvas into viewer.canvas', () => {
    const v = viewer()
    render(<CountOutlinesLayer viewer={v as never} items={[ITEM]} />)
    const cv = v.canvas.querySelector('canvas')
    expect(cv).not.toBeNull()
    expect((cv as HTMLElement).style.pointerEvents).toBe('none')
  })

  it('redraws when items change and on viewport events; removed on unmount', async () => {
    const v = viewer()
    let draws = 0
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      const c = ctx2d()
      c.canvas = this
      const orig = c.stroke
      c.stroke = vi.fn((...a: unknown[]) => {
        draws += 1
        return orig(...a)
      }) as never
      return c as unknown as CanvasRenderingContext2D
    }) as never
    const { rerender, unmount } = render(<CountOutlinesLayer viewer={v as never} items={[ITEM]} />)
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
    })
    expect(draws).toBeGreaterThan(0)
    const before = draws
    // Viewport event -> another scheduled redraw.
    act(() => v.fire('viewport-change'))
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
    })
    expect(draws).toBeGreaterThan(before)
    // items change -> redraw again.
    const b2 = draws
    rerender(<CountOutlinesLayer viewer={v as never} items={[ITEM, ITEM]} />)
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
    })
    expect(draws).toBeGreaterThan(b2)
    unmount()
    expect(v.canvas.querySelector('canvas')).toBeNull()
  })
})
