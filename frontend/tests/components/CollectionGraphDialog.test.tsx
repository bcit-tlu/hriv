import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CollectionGraphDialog from '../../src/components/CollectionGraphDialog'
import { GraphRenderer } from '../../src/collectionsGraph/renderer'
import type { GraphModel, GraphNode } from '../../src/collectionsGraph/types'
import { ApiError, type ApiCollectionGraph } from '../../src/api'

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

function collNode(id: number, name = `Collection ${id}`) {
  return {
    id,
    name,
    type: 'sequence' as const,
    image_count: 4,
    hidden: false,
    category_id: null,
  }
}

const PAYLOAD1: ApiCollectionGraph = {
  order: 1,
  collection: collNode(1, 'Skull atlas'),
  images: [
    { id: 10, name: 'Skull atlas Image 1', collection_ids: [1], category_id: null },
    { id: 11, name: 'Skull atlas Image 2', collection_ids: [1], category_id: null },
  ],
  related_collections: [],
  categories: [],
}

const PAYLOAD2: ApiCollectionGraph = {
  order: 2,
  collection: collNode(1, 'Skull atlas'),
  images: [
    { id: 10, name: 'Skull atlas Image 1', collection_ids: [1, 5], category_id: null },
    { id: 11, name: 'Skull atlas Image 2', collection_ids: [1], category_id: null },
  ],
  related_collections: [collNode(5, 'Pelvis set')],
  categories: [],
}

const PAYLOAD5: ApiCollectionGraph = {
  order: 2,
  collection: collNode(5, 'Pelvis set'),
  images: [{ id: 10, name: 'Pelvis set Image 1', collection_ids: [5, 1], category_id: null }],
  related_collections: [collNode(1, 'Skull atlas')],
  categories: [],
}

type FetchGraph = (id: number, order: 1 | 2 | 3) => Promise<ApiCollectionGraph>

function renderDialog(
  fetchGraph: FetchGraph = vi.fn().mockResolvedValue(PAYLOAD1),
  overrides: Partial<Parameters<typeof CollectionGraphDialog>[0]> = {},
) {
  const props = {
    open: true,
    collectionId: 1,
    collectionName: 'Skull atlas',
    categoryPaths: new Map(),
    onClose: vi.fn(),
    onOpenImage: vi.fn(),
    onOpenCollection: vi.fn(),
    fetchGraph,
    simulate: false,
    ...overrides,
  }
  return { ...render(<CollectionGraphDialog {...props} />), props }
}

/**
 * Point `findNode` at the model node matching `pred` — the spy runs inside
 * the real renderer so `this.model` is the live model.
 */
function spyFind(pred: (n: GraphNode) => boolean) {
  return vi.spyOn(GraphRenderer.prototype, 'findNode').mockImplementation(function (
    this: GraphRenderer,
  ) {
    const model = (this as unknown as { model: GraphModel }).model
    return model.nodes.find(pred) ?? null
  })
}

describe('CollectionGraphDialog', () => {
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

  it('loads the collection graph and shows title + breadcrumb', async () => {
    const fetchGraph = vi.fn<FetchGraph>().mockResolvedValue(PAYLOAD1)
    renderDialog(fetchGraph)
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 1))
    expect(screen.getByText('Skull atlas — graph')).toBeInTheDocument()
    expect(screen.getByTestId('collection-graph-crumbs')).toHaveTextContent('Skull atlas')
    expect(await screen.findByTestId('collections-graph')).toBeInTheDocument()
  })

  it('refetches when the order toggle changes', async () => {
    const fetchGraph = vi
      .fn<FetchGraph>()
      .mockResolvedValueOnce(PAYLOAD1)
      .mockResolvedValue(PAYLOAD2)
    renderDialog(fetchGraph)
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 1))

    fireEvent.click(await screen.findByRole('button', { name: '2nd order' }))
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 2))
    fireEvent.click(await screen.findByRole('button', { name: '3rd order' }))
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 3))
  })

  it('collection-variant legend is order-aware', async () => {
    const fetchGraph = vi
      .fn<FetchGraph>()
      .mockResolvedValueOnce(PAYLOAD1)
      .mockResolvedValue(PAYLOAD2)
    renderDialog(fetchGraph)
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 1))

    expect(await screen.findByText('This collection (centre)')).toBeInTheDocument()
    expect(screen.getByText('Node size reflects image count')).toBeInTheDocument()
    expect(screen.getByTestId('graph-hint')).toHaveTextContent(
      'Scroll or pinch to zoom, and drag to pan.',
    )
    // Member images are the spokes at every order, so the image rows show
    // even at 1st; related-collection rows wait for 2nd.
    expect(screen.getByText('Image')).toBeInTheDocument()
    expect(screen.getByText('Shared image (in 2+ collections)')).toBeInTheDocument()
    expect(screen.queryByText('Related sequence collection')).toBeNull()
    expect(screen.queryByText('Related synchronized collection')).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: '2nd order' }))
    await screen.findByText(/1 related collection/)
    expect(await screen.findByText('Related sequence collection')).toBeInTheDocument()
    expect(screen.getByText('Related synchronized collection')).toBeInTheDocument()
  })

  it('refits the graph when the order toggle rebuilds the model', async () => {
    const fetchGraph = vi
      .fn<FetchGraph>()
      .mockResolvedValueOnce(PAYLOAD1)
      .mockResolvedValue(PAYLOAD2)
    renderDialog(fetchGraph)
    const frame = await screen.findByTestId('collections-graph')
    await waitFor(() => expect(frame).toHaveAttribute('data-fit-count', '1'))

    fireEvent.click(await screen.findByRole('button', { name: '2nd order' }))
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 2))
    // fitOnRebuild: the rebuilt model refits instead of keeping the old
    // transform (the hub could drift off-canvas otherwise).
    await waitFor(() => expect(frame).toHaveAttribute('data-fit-count', '2'))
  })

  async function toPelvisPerspective(fetchGraph: FetchGraph) {
    renderDialog(fetchGraph)
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 1))
    fireEvent.click(await screen.findByRole('button', { name: '2nd order' }))
    // Wait for the rebuilt order-2 model (stats caption) — the fetch
    // resolving alone does not mean React re-rendered the canvas.
    await screen.findByText(/1 related collection/)
    spyFind((n) => n.kind === 'collection' && n.id === 5)
    // Retry: the caption can render a tick before the canvas's click
    // listener is wired to the rebuilt model (CI is slower than jsdom).
    await waitFor(() => {
      fireEvent.click(screen.getByTestId('collections-graph-canvas'))
      expect(fetchGraph).toHaveBeenCalledWith(5, 2)
    })
  }

  it('pushes a related collection onto the stack and refetches', async () => {
    const fetchGraph = vi
      .fn<FetchGraph>()
      .mockImplementation((id, order) =>
        Promise.resolve(order === 2 ? (id === 1 ? PAYLOAD2 : PAYLOAD5) : PAYLOAD1),
      )
    await toPelvisPerspective(fetchGraph)

    expect(await screen.findByText('Pelvis set — graph')).toBeInTheDocument()
    const crumbs = screen.getByTestId('collection-graph-crumbs')
    expect(crumbs).toHaveTextContent('Skull atlas')
    expect(crumbs).toHaveTextContent('Pelvis set')
  })

  it('drops the stale model while a perspective fetch is in flight', async () => {
    let resolvePelvis: (p: ApiCollectionGraph) => void = () => {}
    const pelvis = new Promise<ApiCollectionGraph>((res) => {
      resolvePelvis = res
    })
    const fetchGraph = vi.fn<FetchGraph>().mockImplementation((id, order) => {
      if (id === 5) return pelvis
      return Promise.resolve(order === 2 ? PAYLOAD2 : PAYLOAD1)
    })
    renderDialog(fetchGraph)
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 1))
    fireEvent.click(await screen.findByRole('button', { name: '2nd order' }))
    await screen.findByText(/1 related collection/)
    spyFind((n) => n.kind === 'collection' && n.id === 5)
    await waitFor(() => {
      fireEvent.click(screen.getByTestId('collections-graph-canvas'))
      expect(fetchGraph).toHaveBeenCalledWith(5, 2)
    })
    // The perspective crumb/title update synchronously, but the old hub's
    // model must not remain mounted under the new key while fetching.
    expect(screen.getByText('Pelvis set — graph')).toBeInTheDocument()
    expect(screen.queryByTestId('collections-graph')).not.toBeInTheDocument()

    resolvePelvis(PAYLOAD5)
    expect(await screen.findByTestId('collections-graph')).toBeInTheDocument()
    // New model's hub is the new perspective (id 5): stats from PAYLOAD5.
    await screen.findByText('1 image · 1 shared · 1 related collection')
  })

  it('pops the stack via the breadcrumb', async () => {
    const fetchGraph = vi
      .fn<FetchGraph>()
      .mockImplementation((id, order) =>
        Promise.resolve(order === 2 ? (id === 1 ? PAYLOAD2 : PAYLOAD5) : PAYLOAD1),
      )
    await toPelvisPerspective(fetchGraph)
    fetchGraph.mockClear()

    // First crumb ("Skull atlas") is a link back; the last crumb is text.
    fireEvent.click(screen.getByRole('button', { name: 'Skull atlas' }))
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 2))
    expect(await screen.findByText('Skull atlas — graph')).toBeInTheDocument()
    expect(screen.getByTestId('collection-graph-crumbs')).not.toHaveTextContent('Pelvis set')
  })

  it('image click closes the dialog and opens the image via the page handler', async () => {
    const fetchGraph = vi.fn<FetchGraph>().mockResolvedValue(PAYLOAD1)
    const { props } = renderDialog(fetchGraph)
    await waitFor(() => expect(fetchGraph).toHaveBeenCalled())

    spyFind((n) => n.kind === 'image' && n.id === 10)
    await waitFor(() => {
      fireEvent.click(screen.getByTestId('collections-graph-canvas'))
      expect(props.onOpenImage).toHaveBeenCalledWith(10)
    })

    expect(props.onClose).toHaveBeenCalled()
  })

  it('404 shows "no longer available" with a Back action when navigated', async () => {
    const fetchGraph = vi.fn<FetchGraph>().mockImplementation((id, order) => {
      if (id === 5) return Promise.reject(new ApiError(404, 'Collection not found'))
      return Promise.resolve(order === 2 ? PAYLOAD2 : PAYLOAD1)
    })
    await toPelvisPerspective(fetchGraph)

    expect(await screen.findByText('This collection is no longer available.')).toBeInTheDocument()
    // A 404 perspective must not offer "Open collection" (#1638 review).
    expect(screen.queryByTestId('collection-graph-open-collection')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 2))
    expect(await screen.findByText('Skull atlas — graph')).toBeInTheDocument()
  })

  it('"Open collection" closes the dialog and calls onOpenCollection', async () => {
    const fetchGraph = vi
      .fn<FetchGraph>()
      .mockImplementation((id, order) =>
        Promise.resolve(order === 2 ? (id === 1 ? PAYLOAD2 : PAYLOAD5) : PAYLOAD1),
      )
    const { props } = renderDialog(fetchGraph)
    await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith(1, 1))
    fireEvent.click(await screen.findByRole('button', { name: '2nd order' }))
    await screen.findByText(/1 related collection/)
    spyFind((n) => n.kind === 'collection' && n.id === 5)
    await waitFor(() => {
      fireEvent.click(screen.getByTestId('collections-graph-canvas'))
      expect(fetchGraph).toHaveBeenCalledWith(5, 2)
    })

    fireEvent.click(await screen.findByTestId('collection-graph-open-collection'))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onOpenCollection).toHaveBeenCalledWith(5)
  })
})
