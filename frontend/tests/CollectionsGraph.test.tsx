import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { zoomIdentity } from 'd3-zoom'
import CollectionsGraph from '../src/collectionsGraph/CollectionsGraph'
import { GraphRenderer, type GraphPalette } from '../src/collectionsGraph/renderer'
import { buildGraphModel } from '../src/collectionsGraph/buildModel'
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
