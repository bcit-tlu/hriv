/**
 * drawCountOutlines (#1668): level-0 -> element transform, clip to the
 * selection quadrilateral, flip mirroring, per-group Path2D strokes.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { drawCountOutlines } from '../../src/countOutlines'

// jsdom has no Path2D — stub a minimal recording stand-in.
beforeAll(() => {
  vi.stubGlobal(
    'Path2D',
    class {
      commands: [string, number, number][] = []
      moveTo(x: number, y: number) {
        this.commands.push(['moveTo', x, y])
      }
      lineTo(x: number, y: number) {
        this.commands.push(['lineTo', x, y])
      }
      closePath() {
        this.commands.push(['closePath', 0, 0])
      }
      addPath(other: { commands: [string, number, number][] }) {
        this.commands.push(...other.commands)
      }
    },
  )
})

function fakeViewer({ flip = false, scale = 1 } = {}) {
  return {
    canvas: { clientWidth: 800, clientHeight: 600 },
    viewport: {
      getFlip: () => flip,
      imageToViewerElementCoordinates: ({ x, y }: { x: number; y: number }) => ({
        x: x * scale + 100,
        y: y * scale + 50,
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function fakeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const SEL = { x: 10, y: 20, width: 100, height: 50 }
const OBJECTS = [
  {
    group: 0,
    centroid: [20, 30] as [number, number],
    polygon: [
      [10, 20],
      [30, 20],
      [30, 40],
      [10, 40],
    ] as [number, number][],
  },
]

describe('drawCountOutlines', () => {
  it('clips to the 4 transformed selection corners', () => {
    const ctx = fakeCtx()
    const viewer = fakeViewer()
    drawCountOutlines(ctx, viewer, [{ selection: SEL, objects: OBJECTS }])
    expect(ctx.clip).toHaveBeenCalledTimes(1)
    // Corners: (10,20)->(110,70), (110,20)->(210,70), (110,70)->(210,120), (10,70)->(110,120)
    expect(ctx.moveTo).toHaveBeenCalledWith(110, 70)
    expect(ctx.lineTo).toHaveBeenCalledWith(210, 70)
    expect(ctx.lineTo).toHaveBeenCalledWith(210, 120)
    expect(ctx.lineTo).toHaveBeenCalledWith(110, 120)
    expect(ctx.restore).toHaveBeenCalledTimes(1)
  })

  it('strokes a white halo then the group colour per group', () => {
    const ctx = fakeCtx()
    const viewer = fakeViewer()
    drawCountOutlines(ctx, viewer, [{ selection: SEL, objects: OBJECTS }])
    const strokes = ctx.stroke.mock.calls
    expect(strokes.length).toBe(2) // halo + colour for the single group
    const styles: string[] = []
    const widths: number[] = []
    ctx.stroke = vi.fn(function (this: unknown) {
      styles.push((this as { strokeStyle: string }).strokeStyle)
      widths.push((this as { lineWidth: number }).lineWidth)
    })
    drawCountOutlines(ctx, viewer, [{ selection: SEL, objects: OBJECTS }])
    expect(styles[0]).toBe('rgba(255,255,255,0.6)')
    expect(widths[0]).toBe(4)
    expect(styles[1]).toBe('#0072B2') // group 0 -> palette[0]
    expect(widths[1]).toBe(2)
  })

  it('mirrors x when the viewport is flipped', () => {
    const ctx = fakeCtx()
    const viewer = fakeViewer({ flip: true })
    drawCountOutlines(ctx, viewer, [{ selection: SEL, objects: OBJECTS }])
    // x' = 800 - (x + 100). Corner (10,20): 690,70 ; (110,20): 590,70 ...
    expect(ctx.moveTo).toHaveBeenCalledWith(690, 70)
    expect(ctx.lineTo).toHaveBeenCalledWith(590, 70)
    expect(ctx.lineTo).toHaveBeenCalledWith(590, 120)
    expect(ctx.lineTo).toHaveBeenCalledWith(690, 120)
  })

  it('skips selections fully off-screen', () => {
    const ctx = fakeCtx()
    const viewer = fakeViewer()
    const offscreen = { x: -5000, y: -5000, width: 10, height: 10 }
    drawCountOutlines(ctx, viewer, [{ selection: offscreen, objects: OBJECTS }])
    expect(ctx.clip).not.toHaveBeenCalled()
  })

  it('skips items with no objects', () => {
    const ctx = fakeCtx()
    const viewer = fakeViewer()
    drawCountOutlines(ctx, viewer, [{ selection: SEL, objects: [] }])
    expect(ctx.clip).not.toHaveBeenCalled()
  })
})
