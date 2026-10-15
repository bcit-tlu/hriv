import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { zoomIdentity } from 'd3-zoom'
import CollectionsGraph from '../src/collectionsGraph/CollectionsGraph'
import {
  GraphRenderer,
  labelPx,
  paletteFrom,
  type GraphPalette,
} from '../src/collectionsGraph/renderer'
import { buildGraphModel } from '../src/collectionsGraph/buildModel'
import { getThemePalette } from '../src/theme'
import type { ApiCollectionsGraph } from '../src/api'
import type { GraphNode } from '../src/collectionsGraph/types'

// jsdom canvas: a 2D context that swallows every call.
const ctxStub = new Proxy({} as CanvasRenderingContext2D, {
  get(_t, prop) {
    if (prop === 'measureText') return () => ({ width: 10 })
    return () => undefined
  },
})

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const PAYLOAD: ApiCollectionsGraph = {
  order: 1,
  collections: [
    { id: 1, name: 'A', type: 'sequence', image_count: 4, hidden: false, category_id: null },
    { id: 2, name: 'B', type: 'synchronized', image_count: 2, hidden: false, category_id: null },
  ],
  images: [],
  categories: [],
}

const model = () => buildGraphModel(PAYLOAD, new Set([1, 2]), false)

function renderGraph(m = model(), onOpenCollection = vi.fn(), onOpenImage = vi.fn()) {
  const utils = render(
    <CollectionsGraph
      model={m}
      onOpenCollection={onOpenCollection}
      onOpenImage={onOpenImage}
      simulate={false}
    />,
  )
  return { ...utils, onOpenCollection, onOpenImage, model: m }
}

const frame = () => screen.getByTestId('collections-graph')
const canvas = () => screen.getByTestId('collections-graph-canvas')

describe('CollectionsGraph', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctxStub as unknown as CanvasRenderingContext2D,
    )
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 600,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('fits once on mount and does not refit when a rebuilt model keeps the same node spine', async () => {
    const { rerender } = renderGraph()
    await waitFor(() => expect(frame()).toHaveAttribute('data-fit-count', '1'))

    // sharedOnly rebuild: new model object, same hub+collection ids — the
    // transform must carry over without a refit.
    const m2 = buildGraphModel(PAYLOAD, new Set([1, 2]), true)
    rerender(
      <CollectionsGraph
        model={m2}
        onOpenCollection={vi.fn()}
        onOpenImage={vi.fn()}
        simulate={false}
      />,
    )
    await waitFor(() => expect(frame()).toHaveAttribute('data-fit-count', '1'))
  })

  it('keeps the transform (no refit) even when the node spine changes', async () => {
    const { rerender } = renderGraph()
    await waitFor(() => expect(frame()).toHaveAttribute('data-fit-count', '1'))

    const p3 = {
      ...PAYLOAD,
      collections: [...PAYLOAD.collections, { ...PAYLOAD.collections[0], id: 3, name: 'C' }],
    }
    rerender(
      <CollectionsGraph
        model={buildGraphModel(p3, new Set([1, 2, 3]), false)}
        onOpenCollection={vi.fn()}
        onOpenImage={vi.fn()}
        simulate={false}
      />,
    )
    // New nodes re-settle via preTick but the viewport transform is kept.
    await waitFor(() => expect(frame()).toHaveAttribute('data-fit-count', '1'))
  })

  it('page legend is always open and names the hub at 1st order, omitting higher-order rows', () => {
    renderGraph()
    // No expand toggle — the legend renders fully (#1656).
    expect(screen.queryByRole('button', { name: /legend/i })).toBeNull()
    expect(screen.getByText('Node size reflects image count')).toBeInTheDocument()
    expect(screen.getByText('Collections hub (centre)')).toBeInTheDocument()
    expect(screen.getByText('Sequence collection')).toBeInTheDocument()
    expect(screen.getByText('Synchronized collection')).toBeInTheDocument()
    expect(screen.queryByText('Image')).not.toBeInTheDocument()
    expect(screen.queryByText('Shared image (in 2+ collections)')).not.toBeInTheDocument()
    expect(screen.queryByText('Category')).not.toBeInTheDocument()
  })

  it('shows the pan/zoom hint below the canvas (not inside the wrapper)', () => {
    renderGraph()
    const hint = screen.getByTestId('graph-hint')
    expect(hint).toHaveTextContent('Scroll or pinch to zoom, and drag to pan.')
    expect(screen.getByTestId('collections-graph')).toContainElement(hint)
    expect(screen.getByTestId('collections-graph-canvas').parentElement).not.toContainElement(hint)
  })

  it('page legend gains image and category rows at higher orders', () => {
    const p3: ApiCollectionsGraph = {
      order: 3,
      collections: PAYLOAD.collections,
      images: [{ id: 10, name: 'img', collection_ids: [1, 2], category_id: 7 }],
      categories: [{ id: 7, label: 'Bones', path: 'Bones', image_count: 1 }],
    }
    render(
      <CollectionsGraph
        model={buildGraphModel(p3, new Set([1, 2]), false)}
        onOpenCollection={vi.fn()}
        onOpenImage={vi.fn()}
        simulate={false}
      />,
    )
    expect(screen.getByText('Image')).toBeInTheDocument()
    expect(screen.getByText('Shared image (in 2+ collections)')).toBeInTheDocument()
    expect(screen.getByText('Category')).toBeInTheDocument()
  })

  it('refits on rebuild when fitOnRebuild is set (the dialog graph)', async () => {
    const { rerender } = render(
      <CollectionsGraph
        model={model()}
        onOpenCollection={vi.fn()}
        onOpenImage={vi.fn()}
        simulate={false}
        fitOnRebuild
      />,
    )
    await waitFor(() => expect(frame()).toHaveAttribute('data-fit-count', '1'))

    rerender(
      <CollectionsGraph
        model={buildGraphModel(PAYLOAD, new Set([1, 2]), true)}
        onOpenCollection={vi.fn()}
        onOpenImage={vi.fn()}
        simulate={false}
        fitOnRebuild
      />,
    )
    await waitFor(() => expect(frame()).toHaveAttribute('data-fit-count', '2'))
  })

  it('does not refit on rebuild without fitOnRebuild (the page graph)', async () => {
    const { rerender } = renderGraph()
    await waitFor(() => expect(frame()).toHaveAttribute('data-fit-count', '1'))

    rerender(
      <CollectionsGraph
        model={buildGraphModel(PAYLOAD, new Set([1, 2]), true)}
        onOpenCollection={vi.fn()}
        onOpenImage={vi.fn()}
        simulate={false}
      />,
    )
    await waitFor(() => expect(frame()).toHaveAttribute('data-fit-count', '1'))
  })

  it('renders the Fit graph button', () => {
    renderGraph()
    expect(screen.getByRole('button', { name: 'Fit graph' })).toBeInTheDocument()
  })

  it('opens a collection when the click lands on its node', () => {
    const { onOpenCollection, model: m } = renderGraph()
    const collNode = m.nodes.find((n) => n.kind === 'collection' && n.id === 1)!
    vi.spyOn(GraphRenderer.prototype, 'findNode').mockReturnValue(collNode)

    fireEvent.click(canvas())
    expect(onOpenCollection).toHaveBeenCalledWith(1)
  })

  it('opens an image via onOpenImage and ignores hub clicks', () => {
    const p2: ApiCollectionsGraph = {
      order: 2,
      collections: PAYLOAD.collections,
      images: [{ id: 10, name: 'img', collection_ids: [1, 2], category_id: null }],
      categories: [],
    }
    const m = buildGraphModel(p2, new Set([1, 2]), false)
    const onOpenCollection = vi.fn()
    const onOpenImage = vi.fn()
    render(
      <CollectionsGraph
        model={m}
        onOpenCollection={onOpenCollection}
        onOpenImage={onOpenImage}
        simulate={false}
      />,
    )
    const findSpy = vi.spyOn(GraphRenderer.prototype, 'findNode')
    findSpy.mockReturnValue(m.nodes.find((n) => n.kind === 'image')!)
    fireEvent.click(canvas())
    expect(onOpenImage).toHaveBeenCalledWith(10)

    onOpenCollection.mockClear()
    onOpenImage.mockClear()
    findSpy.mockReturnValue(m.nodes[0]) // the hub — ignored
    fireEvent.click(canvas())
    expect(onOpenCollection).not.toHaveBeenCalled()
    expect(onOpenImage).not.toHaveBeenCalled()
  })

  it('does nothing when the click lands on empty space', () => {
    const { onOpenCollection, onOpenImage } = renderGraph()
    vi.spyOn(GraphRenderer.prototype, 'findNode').mockReturnValue(null)
    fireEvent.click(canvas())
    expect(onOpenCollection).not.toHaveBeenCalled()
    expect(onOpenImage).not.toHaveBeenCalled()
  })

  it('shows its own empty state when only the hub remains', () => {
    const empty = buildGraphModel({ ...PAYLOAD, collections: [] }, new Set(), false)
    render(
      <CollectionsGraph
        model={empty}
        onOpenCollection={vi.fn()}
        onOpenImage={vi.fn()}
        simulate={false}
      />,
    )
    expect(screen.getByText('No collections match the current filters.')).toBeInTheDocument()
    expect(screen.queryByTestId('graph-legend')).not.toBeInTheDocument()
    expect(screen.queryByTestId('graph-hint')).not.toBeInTheDocument()
  })
})

describe('GraphRenderer.findNode', () => {
  const fakeCanvas = {
    getContext: () => ctxStub,
    clientWidth: 800,
    clientHeight: 600,
  } as unknown as HTMLCanvasElement
  // findNode only reads the model; palette fields are unused there.
  const palette = {} as GraphPalette

  const node = (
    id: number,
    x: number,
    y: number,
    r: number,
    kind: GraphNode['kind'] = 'collection',
  ): GraphNode => ({
    i: id,
    kind,
    id,
    label: `c${id}`,
    r,
    x,
    y,
    vx: 0,
    vy: 0,
  })

  function rendererFor(nodes: GraphNode[]) {
    return new GraphRenderer(
      fakeCanvas,
      {
        nodes,
        edges: [],
        stats: {
          collections: 0,
          images: 0,
          shared: 0,
          categories: 0,
          unconnectedCategories: 0,
          order: 1,
        },
      },
      palette,
    )
  }

  // findNode takes container px; convert a graph point through the
  // transform the way d3-zoom does.
  const px = (t: ReturnType<typeof zoomIdentity.scale>, gx: number, gy: number) =>
    t.apply([gx, gy]) as [number, number]

  it('hits a node within the fixed 12px screen tolerance', () => {
    const r = rendererFor([node(1, 0, 0, 10)])
    const t = zoomIdentity.scale(4)
    // Drawn radius is r/sqrt(k) = 5 units, pad 12/k = 3 → allowance 8.
    expect(r.findNode(...px(t, 4, 0), t)?.id).toBe(1)
    expect(r.findNode(...px(t, 9, 0), t)).toBeNull()
  })

  it('rejects clicks beyond the drawn radius plus 12px at high zoom', () => {
    const r = rendererFor([node(1, 0, 0, 6)])
    const t = zoomIdentity.scale(24)
    // Allowance: 6/sqrt(24) + 12/24 ≈ 1.72 units; the old sqrt(k) radius
    // accepted clicks several units out.
    expect(r.findNode(...px(t, 0.5, 0), t)?.id).toBe(1)
    expect(r.findNode(...px(t, 2, 0), t)).toBeNull()
  })

  it('rejects a small node found via the max-radius search but outside its own tolerance', () => {
    // A large node elsewhere raises the quadtree search radius; the small
    // image still must not answer for clicks past its own padding.
    const r = rendererFor([node(1, 100, 0, 14), node(2, 5, 0, 2, 'image')])
    const t = zoomIdentity.scale(10)
    // Image allowance: 2/sqrt(10) + 12/10 ≈ 1.83; click 2.1 units away.
    expect(r.findNode(...px(t, 2.9, 0), t)).toBeNull()
    expect(r.findNode(...px(t, 4.2, 0), t)?.id).toBe(2)
  })
})

describe('GraphRenderer hub label placement', () => {
  // draw() paints through every palette field — use the real palette.
  const palette = paletteFrom('light', getThemePalette('light'))
  // Recording ctx: captures fillText args plus the textAlign/font in effect.
  function recordingCtx() {
    const drawn: { lbl: string; x: number; y: number; align: string; font: string }[] = []
    const state: { textAlign: string; font: string } = { textAlign: 'left', font: '' }
    const ctx = new Proxy(state, {
      get(t, prop) {
        if (prop === 'measureText') return () => ({ width: 100 })
        if (prop === 'fillText')
          return (lbl: string, x: number, y: number) =>
            drawn.push({ lbl, x, y, align: t.textAlign, font: t.font })
        if (prop in t) return t[prop as keyof typeof t]
        return () => undefined
      },
      set(t, prop, v) {
        ;(t as Record<string | symbol, unknown>)[prop] = v
        return true
      },
    })
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn }
  }

  const hubModel = (x: number) => ({
    nodes: [
      {
        i: 0,
        kind: 'hub' as const,
        id: Number.NaN,
        label: 'A very long collection name',
        r: 4,
        x,
        y: 300,
      },
    ],
    edges: [],
    stats: {
      collections: 0,
      images: 0,
      shared: 0,
      categories: 0,
      unconnectedCategories: 0,
      order: 1,
    },
  })

  const drawState = {
    transform: zoomIdentity,
    hover: null,
    selected: null,
    selectedId: null,
    searchDim: new Set(),
    searchMatch: new Set(),
    searchActive: false,
  }

  it('draws the oversized hub label on the left when only that side has room', () => {
    const { ctx, drawn } = recordingCtx()
    const canvas = {
      getContext: () => ctx,
      clientWidth: 800,
      clientHeight: 600,
    } as unknown as HTMLCanvasElement
    const r = new GraphRenderer(canvas, hubModel(790), palette)
    r.draw(drawState)

    // sr = 4 at k=1 → x = 790 - 4 - 3 = 783, right-aligned text.
    const hub = drawn.find((d) => d.lbl === 'A very long collection name')!
    expect(hub.align).toBe('right')
    expect(hub.x).toBe(783)
    // baseline = sy + hfs/3 = 300 + 14/3
    expect(hub.y).toBe(300 + 14 / 3)
  })

  it('keeps the label on the right when it fits there', () => {
    const { ctx, drawn } = recordingCtx()
    const canvas = {
      getContext: () => ctx,
      clientWidth: 800,
      clientHeight: 600,
    } as unknown as HTMLCanvasElement
    const r = new GraphRenderer(canvas, hubModel(400), palette)
    r.draw(drawState)

    const hub = drawn.find((d) => d.lbl === 'A very long collection name')!
    expect(hub.align).toBe('left')
    expect(hub.x).toBe(400 + 4 + 3)
  })
})

describe('labelPx', () => {
  it('scales by √k between the 12px floor and the 32px cap', () => {
    expect(labelPx(12, 1)).toBe(12)
    expect(labelPx(12, 0.25)).toBe(12) // floor
    expect(labelPx(12, 4)).toBe(24)
    expect(labelPx(12, 24)).toBe(26) // cap
    expect(labelPx(12, 0.1)).toBe(12)
  })
})

describe('GraphRenderer label zoom scaling', () => {
  const palette = paletteFrom('light', getThemePalette('light'))

  function recordingCtx() {
    const drawn: { lbl: string; font: string }[] = []
    const state: { font: string } = { font: '' }
    const ctx = new Proxy(state, {
      get(t, prop) {
        if (prop === 'measureText') return () => ({ width: 10 })
        if (prop === 'fillText') return (lbl: string) => drawn.push({ lbl, font: t.font })
        if (prop in t) return t[prop as keyof typeof t]
        return () => undefined
      },
      set(t, prop, v) {
        ;(t as Record<string | symbol, unknown>)[prop] = v
        return true
      },
    })
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn }
  }

  const model = {
    nodes: [
      { i: 0, kind: 'hub' as const, id: Number.NaN, label: 'Hub', r: 4, x: 0, y: 0 },
      { i: 1, kind: 'collection' as const, id: 2, label: 'Coll 2', r: 6, x: 50, y: 50 },
    ],
    edges: [],
    stats: {
      collections: 1,
      images: 0,
      shared: 0,
      categories: 0,
      unconnectedCategories: 0,
      order: 1,
    },
  }

  function drawFont(t: ReturnType<typeof zoomIdentity.scale>): string {
    const { ctx, drawn } = recordingCtx()
    const canvas = {
      getContext: () => ctx,
      clientWidth: 800,
      clientHeight: 600,
    } as unknown as HTMLCanvasElement
    const r = new GraphRenderer(canvas, model, palette)
    r.setLabelThresholds({ collection: 0 })
    r.draw({
      transform: t,
      hover: null,
      selected: null,
      selectedId: null,
      searchDim: new Set(),
      searchMatch: new Set(),
      searchActive: false,
    })
    return drawn.find((d) => d.lbl === 'Coll 2')!.font
  }

  it('grows the collection label font with √k', () => {
    expect(drawFont(zoomIdentity)).toBe('12px Roboto,Arial')
    expect(drawFont(zoomIdentity.scale(4))).toBe('24px Roboto,Arial')
  })
})

describe('GraphRenderer shared-image ring', () => {
  const palette = paletteFrom('light', getThemePalette('light'))

  // Recording ctx: captures each arc() with the strokeStyle/lineWidth in
  // effect — both are set before beginPath, so the arc-time values are the
  // stroke-time values for the batch.
  function recordingCtx() {
    const arcs: { x: number; y: number; r: number; strokeStyle: string; lineWidth: number }[] = []
    const state: { strokeStyle: string; lineWidth: number } = {
      strokeStyle: '',
      lineWidth: 1,
    }
    const ctx = new Proxy(state, {
      get(t, prop) {
        if (prop === 'measureText') return () => ({ width: 10 })
        if (prop === 'arc')
          return (x: number, y: number, r: number) =>
            arcs.push({ x, y, r, strokeStyle: t.strokeStyle, lineWidth: t.lineWidth })
        if (prop in t) return t[prop as keyof typeof t]
        return () => undefined
      },
      set(t, prop, v) {
        ;(t as Record<string | symbol, unknown>)[prop] = v
        return true
      },
    })
    return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs }
  }

  const SHARED = { x: 30, y: 30 }
  const PLAIN = { x: -30, y: -30 }
  const model = {
    nodes: [
      { i: 0, kind: 'hub' as const, id: Number.NaN, label: 'Hub', r: 4, x: 0, y: 0 },
      { i: 1, kind: 'collection' as const, id: 2, label: 'Coll 2', r: 6, x: 50, y: 50 },
      {
        i: 2,
        kind: 'image' as const,
        id: 10,
        label: 'shared',
        r: 4,
        x: SHARED.x,
        y: SHARED.y,
        shared: true,
        imageCollectionIds: [2, 3],
      },
      {
        i: 3,
        kind: 'image' as const,
        id: 11,
        label: 'plain',
        r: 4,
        x: PLAIN.x,
        y: PLAIN.y,
        shared: false,
        imageCollectionIds: [2],
      },
    ],
    edges: [],
    stats: {
      collections: 1,
      images: 2,
      shared: 1,
      categories: 0,
      unconnectedCategories: 0,
      order: 1,
    },
  }

  function drawArcs(t: ReturnType<typeof zoomIdentity.scale>) {
    const { ctx, arcs } = recordingCtx()
    const canvas = {
      getContext: () => ctx,
      clientWidth: 800,
      clientHeight: 600,
    } as unknown as HTMLCanvasElement
    const r = new GraphRenderer(canvas, model, palette)
    r.draw({
      transform: t,
      hover: null,
      selected: null,
      selectedId: null,
      searchDim: new Set(),
      searchMatch: new Set(),
      searchActive: false,
    })
    return arcs.filter((a) => a.strokeStyle === palette.imageSharedStroke)
  }

  it.each([1, 4])('draws an inset ring only under the shared image at k=%i', (k) => {
    const ringArcs = drawArcs(zoomIdentity.scale(k))
    const lw = 8 / 6 / Math.sqrt(k)

    // (a) shared image: inset ring, outer edge coincides with the fill edge.
    const shared = ringArcs.filter((a) => a.x === SHARED.x && a.y === SHARED.y)
    expect(shared).toHaveLength(1)
    expect(shared[0].r).toBeCloseTo(4 / Math.sqrt(k) - lw / 2, 5)
    expect(shared[0].r + shared[0].lineWidth / 2).toBeCloseTo(4 / Math.sqrt(k), 5)
    expect(shared[0].lineWidth).toBeCloseTo(lw, 5)

    // (b) plain image: no arc under the shared-stroke style at all.
    expect(ringArcs.filter((a) => a.x === PLAIN.x && a.y === PLAIN.y)).toHaveLength(0)
  })
})
