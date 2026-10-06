/**
 * Tests for SynchronizedCollectionViewer (#1417).
 *
 * ImageViewer is mocked at the component boundary: it records props per
 * imageId and hands back a fake OSD viewer through `onViewerReady`, so the
 * sync bridge can be exercised end-to-end — 'open' arms the captured offset
 * and 'viewport-change' drives the follower with immediate writes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { useEffect } from 'react'

import type { Collection, ImageItem } from '../../src/types'
import { makeCollection, makeImage } from '../helpers/fixtures'
import SynchronizedCollectionViewer, {
  type SynchronizedCollectionViewerProps,
} from '../../src/components/SynchronizedCollectionViewer'

// ── Fake OSD viewers ────────────────────────────────────────────────────

interface FakePos {
  zoom: number
  x: number
  y: number
  rotation: number
}

interface FakeViewport {
  getZoom: ReturnType<typeof vi.fn>
  getCenter: ReturnType<typeof vi.fn>
  getRotation: ReturnType<typeof vi.fn>
  goHome: ReturnType<typeof vi.fn>
  zoomTo: ReturnType<typeof vi.fn>
  panTo: ReturnType<typeof vi.fn>
  setRotation: ReturnType<typeof vi.fn>
}

interface FakeViewer {
  viewport: FakeViewport | null
  addHandler: (name: string, fn: (e?: unknown) => void) => void
  addOnceHandler: (name: string, fn: (e?: unknown) => void) => void
  removeHandler: (name: string, fn: (e?: unknown) => void) => void
  fire: (name: string) => void
  open: () => void
}

function makeFakeViewer(pos: FakePos): { viewer: FakeViewer; state: FakePos } {
  const handlers = new Map<string, ((e?: unknown) => void)[]>()
  const once = new Map<string, ((e?: unknown) => void)[]>()
  const state = { ...pos }
  const viewer: FakeViewer = {
    viewport: null,
    addHandler: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    addOnceHandler: (name, fn) => once.set(name, [...(once.get(name) ?? []), fn]),
    removeHandler: (name, fn) => {
      handlers.set(
        name,
        (handlers.get(name) ?? []).filter((h) => h !== fn),
      )
      once.set(
        name,
        (once.get(name) ?? []).filter((h) => h !== fn),
      )
    },
    fire: (name) => {
      for (const h of handlers.get(name) ?? []) h()
      const pending = once.get(name) ?? []
      once.set(name, [])
      for (const h of pending) h()
    },
    open: () => {
      viewer.viewport = viewport
      viewer.fire('open')
    },
  }
  const viewport: FakeViewport = {
    getZoom: vi.fn(() => state.zoom),
    getCenter: vi.fn(() => ({ x: state.x, y: state.y })),
    getRotation: vi.fn(() => state.rotation),
    // Real OSD goHome preserves rotation — the component clears it separately.
    goHome: vi.fn(() => {
      state.zoom = 1
      state.x = 0.5
      state.y = 0.5
      viewer.fire('viewport-change')
    }),
    zoomTo: vi.fn((z: number) => {
      state.zoom = z
      viewer.fire('viewport-change')
    }),
    panTo: vi.fn((p: { x: number; y: number }) => {
      state.x = p.x
      state.y = p.y
      viewer.fire('viewport-change')
    }),
    setRotation: vi.fn((r: number) => {
      state.rotation = r
      viewer.fire('viewport-change')
    }),
  }
  return { viewer, state }
}

// ── ImageViewer mock — records props, reports the fake via onViewerReady ──

const mockState = vi.hoisted(() => ({
  lastProps: new Map<number, Record<string, unknown>>(),
  fakes: new Map<number, FakeViewer>(),
  mounts: new Map<number, number>(),
}))

vi.mock('../../src/components/ImageViewer', () => ({
  default: (props: Record<string, unknown>) => {
    const imageId = props.imageId as number
    mockState.lastProps.set(imageId, props)
    useEffect(() => {
      // Mirror ImageViewer's mount-effect deps: a changed identity would
      // destroy and recreate the real OSD viewer, so a remount here swaps in
      // a fresh fake at its saved viewport — surfaced via `fakes` so tests
      // detect the lost navigation instead of just prop churn.
      const mounts = mockState.mounts.get(imageId) ?? 0
      mockState.mounts.set(imageId, mounts + 1)
      let fake = mounts === 0 ? mockState.fakes.get(imageId) : undefined
      if (!fake) {
        const saved = props.initialViewport as
          { zoom: number; x: number; y: number; rotation?: number } | undefined
        fake = makeFakeViewer(
          saved
            ? { zoom: saved.zoom, x: saved.x, y: saved.y, rotation: saved.rotation ?? 0 }
            : { zoom: 1, x: 0.5, y: 0.5, rotation: 0 },
        ).viewer
        mockState.fakes.set(imageId, fake)
      }
      ;(props.onViewerReady as ((v: unknown) => void) | undefined)?.(fake)
      return () => {
        ;(props.onViewerReady as ((v: unknown) => void) | undefined)?.(null)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imageId, props.initialOverlays, props.initialViewport])
    return <div data-testid="image-viewer" data-image-id={String(imageId)} />
  },
}))

// ── Fixtures ────────────────────────────────────────────────────────────

function images(count: number): ImageItem[] {
  return Array.from({ length: count }, (_, i) =>
    makeImage({ id: 100 + i, name: `Slice ${i + 1}`, sortOrder: i }),
  )
}

function syncCollection(overrides: Partial<Collection> = {}): Collection {
  return makeCollection({
    type: 'synchronized',
    images: images(2),
    ...overrides,
  })
}

function renderViewer(overrides: Partial<SynchronizedCollectionViewerProps> = {}) {
  const props: SynchronizedCollectionViewerProps = {
    collection: syncCollection(),
    onSaveViewport: vi.fn().mockResolvedValue(undefined),
    onOpenImage: vi.fn(),
    onImageRenewed: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
  return { ...render(<SynchronizedCollectionViewer {...props} />), props }
}

/** Wire fakes for the first pair and complete the open + offset-arm cycle. */
function openPair(
  posA: FakePos = { zoom: 1, x: 0.5, y: 0.5, rotation: 0 },
  posB: FakePos = { zoom: 1, x: 0.5, y: 0.5, rotation: 0 },
  ids: [number, number] = [100, 101],
) {
  const a = makeFakeViewer(posA)
  const b = makeFakeViewer(posB)
  mockState.fakes.set(ids[0], a.viewer)
  mockState.fakes.set(ids[1], b.viewer)
  return { a, b }
}

/** Wire fakes for N panes (#1561) — keyed by image id, at given positions. */
function openMany(positions: Record<number, FakePos>) {
  const out = new Map<number, { viewer: FakeViewer; state: FakePos }>()
  for (const [id, pos] of Object.entries(positions)) {
    const fake = makeFakeViewer(pos)
    mockState.fakes.set(Number(id), fake.viewer)
    out.set(Number(id), fake)
  }
  return out
}

function openAll(fakes: Map<number, { viewer: FakeViewer; state: FakePos }>) {
  act(() => {
    for (const fake of fakes.values()) fake.viewer.open()
  })
}

beforeEach(() => {
  mockState.lastProps.clear()
  mockState.fakes.clear()
  mockState.mounts.clear()
})

const realMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = realMatchMedia
})

function stubMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: '(orientation: portrait)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  return mql
}

describe('SynchronizedCollectionViewer', () => {
  it('renders the first two members side by side with read-only viewer props', () => {
    const meta = {
      canvas_annotations: [{ type: 'rect', id: 'a1' }],
      locked_overlays: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
      measurement_scale: 500,
      measurement_unit: 'mm',
    }
    const collection = syncCollection({
      images: [makeImage({ id: 100, metadataExtra: meta }), makeImage({ id: 101 })],
    })
    renderViewer({ collection })
    const viewers = screen.getAllByTestId('image-viewer')
    expect(viewers.map((v) => v.getAttribute('data-image-id'))).toEqual(['100', '101'])
    const propsA = mockState.lastProps.get(100)!
    expect(propsA.canEditContent).toBe(false)
    expect(propsA.canvasAnnotations).toEqual(meta.canvas_annotations)
    expect(propsA.initialOverlays).toEqual(meta.locked_overlays)
    expect(propsA.overlaysLocked).toBe(true)
    expect(propsA.measurement).toEqual({ scale: 500, unit: 'mm' })
    expect(propsA.onCanvasAnnotationsChange).toBeUndefined()
    expect(propsA.onLockOverlays).toBeUndefined()
  })

  it('mirrors pan/zoom/rotation from viewer A to B without write-back', () => {
    openPair()
    renderViewer()
    act(() => {
      mockState.fakes.get(100)!.open()
      mockState.fakes.get(101)!.open()
    })
    const fakeA = mockState.fakes.get(100)!
    const fakeB = mockState.fakes.get(101)!
    act(() => {
      fakeA.viewport!.panTo({ x: 0.7, y: 0.4 })
    })
    // B followed with the same displacement (identity offset from arm).
    expect(fakeB.viewport!.panTo).toHaveBeenCalledWith({ x: 0.7, y: 0.4 }, true)
    expect(fakeB.viewport!.zoomTo).toHaveBeenCalledWith(1, undefined, true)
    expect(fakeB.viewport!.setRotation).toHaveBeenCalledWith(0, true)
    // B's own viewport-change events were guarded — nothing wrote back to A.
    expect(fakeA.viewport!.zoomTo).not.toHaveBeenCalled()
    expect(fakeA.viewport!.setRotation).not.toHaveBeenCalled()
    expect(fakeA.viewport!.panTo).toHaveBeenCalledTimes(1)
  })

  it('preserves the saved offset while mirroring either direction', () => {
    const collection = syncCollection({
      viewportState: {
        '100': { zoom: 1, x: 0.4, y: 0.4, rotation: 0 },
        '101': { zoom: 2, x: 0.6, y: 0.5, rotation: 45 },
      },
    })
    const { a, b } = openPair(
      { zoom: 1, x: 0.4, y: 0.4, rotation: 0 },
      { zoom: 2, x: 0.6, y: 0.5, rotation: 45 },
    )
    renderViewer({ collection })
    act(() => {
      a.viewer.open()
      b.viewer.open()
    })
    // Pan A by (+0.1, +0.05): B keeps its +0.2/+0.1 displacement, ×2 zoom, +45°.
    act(() => {
      a.viewer.viewport!.panTo({ x: 0.5, y: 0.45 })
    })
    expect(b.state.x).toBeCloseTo(0.7)
    expect(b.state.y).toBeCloseTo(0.55)
    expect(b.state.zoom).toBe(2)
    expect(b.state.rotation).toBe(45)
    // The follower write is immediate (no spring animation).
    expect(b.viewer.viewport!.panTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: expect.closeTo(0.7), y: expect.closeTo(0.55) }),
      true,
    )
    // B as leader applies the inverse transform to A.
    act(() => {
      b.viewer.viewport!.panTo({ x: 0.9, y: 0.6 })
      b.viewer.viewport!.zoomTo(4)
    })
    expect(a.state.x).toBeCloseTo(0.7)
    expect(a.state.y).toBeCloseTo(0.5)
    expect(a.state.zoom).toBe(2)
    expect(a.state.rotation).toBe(0)
  })

  it('mirrors a leader move onto every follower pane (#1561)', () => {
    const fakes = openMany({
      100: { zoom: 1, x: 0.5, y: 0.5, rotation: 0 },
      101: { zoom: 1, x: 0.5, y: 0.5, rotation: 0 },
      102: { zoom: 1, x: 0.5, y: 0.5, rotation: 0 },
      103: { zoom: 1, x: 0.5, y: 0.5, rotation: 0 },
    })
    renderViewer({ collection: syncCollection({ images: images(4) }) })
    openAll(fakes)
    const a = fakes.get(100)!
    const c = fakes.get(102)!
    act(() => {
      a.viewer.viewport!.panTo({ x: 0.7, y: 0.4 })
    })
    // Identity baselines → every follower lands on the leader's new centre.
    for (const id of [101, 102, 103]) {
      expect(fakes.get(id)!.state.x).toBeCloseTo(0.7)
      expect(fakes.get(id)!.state.y).toBeCloseTo(0.4)
    }
    // A follower can lead too — everyone else tracks the same displacement.
    act(() => {
      c.viewer.viewport!.panTo({ x: 0.9, y: 0.9 })
    })
    for (const id of [100, 101, 103]) {
      expect(fakes.get(id)!.state.x).toBeCloseTo(0.9)
      expect(fakes.get(id)!.state.y).toBeCloseTo(0.9)
    }
  })

  it('keeps every pane relative offset while mirroring (#1561)', () => {
    const collection = syncCollection({
      images: images(3),
      viewportState: {
        '100': { zoom: 1, x: 0.4, y: 0.4, rotation: 0 },
        '101': { zoom: 2, x: 0.6, y: 0.5, rotation: 45 },
        '102': { zoom: 3, x: 0.8, y: 0.6, rotation: 90 },
      },
    })
    const fakes = openMany({
      100: { zoom: 1, x: 0.4, y: 0.4, rotation: 0 },
      101: { zoom: 2, x: 0.6, y: 0.5, rotation: 45 },
      102: { zoom: 3, x: 0.8, y: 0.6, rotation: 90 },
    })
    renderViewer({ collection })
    openAll(fakes)
    // Leader pans (+0.1, +0.05): each follower keeps its own displacement.
    act(() => {
      fakes.get(100)!.viewer.viewport!.panTo({ x: 0.5, y: 0.45 })
    })
    expect(fakes.get(101)!.state.x).toBeCloseTo(0.7)
    expect(fakes.get(101)!.state.y).toBeCloseTo(0.55)
    expect(fakes.get(102)!.state.x).toBeCloseTo(0.9)
    expect(fakes.get(102)!.state.y).toBeCloseTo(0.65)
    // Zoom ratios and rotation deltas against the leader hold per pane.
    expect(fakes.get(101)!.state.zoom).toBe(2)
    expect(fakes.get(102)!.state.zoom).toBe(3)
    expect(fakes.get(101)!.state.rotation).toBe(45)
    expect(fakes.get(102)!.state.rotation).toBe(90)
  })

  it('passes the saved viewport to each pane as initialViewport', () => {
    const collection = syncCollection({
      viewportState: { '100': { zoom: 3, x: 0.2, y: 0.3, rotation: 90 } },
    })
    renderViewer({ collection })
    expect(mockState.lastProps.get(100)!.initialViewport).toEqual({
      zoom: 3,
      x: 0.2,
      y: 0.3,
      rotation: 90,
    })
    expect(mockState.lastProps.get(101)!.initialViewport).toBeUndefined()
  })

  it('saves both viewports keyed by image id', async () => {
    openPair({ zoom: 2, x: 0.3, y: 0.4, rotation: 10 }, { zoom: 4, x: 0.6, y: 0.7, rotation: 350 })
    const { props } = renderViewer()
    act(() => {
      mockState.fakes.get(100)!.open()
      mockState.fakes.get(101)!.open()
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('synchronized-save'))
    })
    await vi.waitFor(() =>
      expect(props.onSaveViewport).toHaveBeenCalledWith({
        '100': { zoom: 2, x: 0.3, y: 0.4, rotation: 10 },
        '101': { zoom: 4, x: 0.6, y: 0.7, rotation: 350 },
      }),
    )
  })

  it('saves every pane viewport keyed by image id (#1561)', async () => {
    const fakes = openMany({
      100: { zoom: 2, x: 0.3, y: 0.4, rotation: 10 },
      101: { zoom: 4, x: 0.6, y: 0.7, rotation: 350 },
      102: { zoom: 1.5, x: 0.2, y: 0.3, rotation: 5 },
      103: { zoom: 8, x: 0.9, y: 0.1, rotation: 270 },
    })
    const { props } = renderViewer({ collection: syncCollection({ images: images(4) }) })
    openAll(fakes)
    await act(async () => {
      fireEvent.click(screen.getByTestId('synchronized-save'))
    })
    await vi.waitFor(() =>
      expect(props.onSaveViewport).toHaveBeenCalledWith({
        '100': { zoom: 2, x: 0.3, y: 0.4, rotation: 10 },
        '101': { zoom: 4, x: 0.6, y: 0.7, rotation: 350 },
        '102': { zoom: 1.5, x: 0.2, y: 0.3, rotation: 5 },
        '103': { zoom: 8, x: 0.9, y: 0.1, rotation: 270 },
      }),
    )
  })

  it('reports a save failure through onError', async () => {
    openPair()
    const onSaveViewport = vi.fn().mockRejectedValue(new Error('stale'))
    const { props } = renderViewer({ onSaveViewport })
    act(() => {
      mockState.fakes.get(100)!.open()
      mockState.fakes.get(101)!.open()
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('synchronized-save'))
    })
    await vi.waitFor(() =>
      expect(props.onError).toHaveBeenCalledWith('Failed to save the collection view.'),
    )
  })

  it('reset reapplies the saved view and re-arms the offset', () => {
    const collection = syncCollection({
      viewportState: {
        '100': { zoom: 1, x: 0.4, y: 0.4, rotation: 0 },
        '101': { zoom: 2, x: 0.6, y: 0.5, rotation: 45 },
      },
    })
    openPair({ zoom: 1, x: 0.4, y: 0.4, rotation: 0 }, { zoom: 2, x: 0.6, y: 0.5, rotation: 45 })
    renderViewer({ collection })
    const fakeA = mockState.fakes.get(100)!
    const fakeB = mockState.fakes.get(101)!
    act(() => {
      fakeA.open()
      fakeB.open()
    })
    act(() => {
      fakeA.viewport!.panTo({ x: 0.9, y: 0.9 })
    })
    fireEvent.click(screen.getByTestId('synchronized-reset'))
    expect(fakeA.viewport!.panTo).toHaveBeenLastCalledWith({ x: 0.4, y: 0.4 }, true)
    expect(fakeB.viewport!.panTo).toHaveBeenLastCalledWith({ x: 0.6, y: 0.5 }, true)
    expect(fakeB.viewport!.setRotation).toHaveBeenLastCalledWith(45, true)
    // Reset writes were guarded — B never wrote back into A's reset.
    expect(fakeA.viewport!.zoomTo).toHaveBeenLastCalledWith(1, undefined, true)
  })

  it('reset reapplies saved positions to every pane (#1561)', () => {
    const collection = syncCollection({
      images: images(4),
      viewportState: {
        '100': { zoom: 1, x: 0.4, y: 0.4, rotation: 0 },
        '101': { zoom: 2, x: 0.6, y: 0.5, rotation: 45 },
        '102': { zoom: 3, x: 0.7, y: 0.6, rotation: 90 },
        '103': { zoom: 4, x: 0.8, y: 0.7, rotation: 180 },
      },
    })
    const fakes = openMany({
      100: { zoom: 1, x: 0.4, y: 0.4, rotation: 0 },
      101: { zoom: 2, x: 0.6, y: 0.5, rotation: 45 },
      102: { zoom: 3, x: 0.7, y: 0.6, rotation: 90 },
      103: { zoom: 4, x: 0.8, y: 0.7, rotation: 180 },
    })
    renderViewer({ collection })
    openAll(fakes)
    act(() => {
      fakes.get(100)!.viewer.viewport!.panTo({ x: 0.9, y: 0.9 })
    })
    fireEvent.click(screen.getByTestId('synchronized-reset'))
    expect(fakes.get(100)!.viewer.viewport!.panTo).toHaveBeenLastCalledWith(
      { x: 0.4, y: 0.4 },
      true,
    )
    expect(fakes.get(102)!.viewer.viewport!.panTo).toHaveBeenLastCalledWith(
      { x: 0.7, y: 0.6 },
      true,
    )
    expect(fakes.get(103)!.viewer.viewport!.panTo).toHaveBeenLastCalledWith(
      { x: 0.8, y: 0.7 },
      true,
    )
    expect(fakes.get(103)!.viewer.viewport!.setRotation).toHaveBeenLastCalledWith(180, true)
  })

  it('reset without a saved view returns both viewers home', () => {
    openPair({ zoom: 5, x: 0.8, y: 0.9, rotation: 30 }, { zoom: 3, x: 0.2, y: 0.2, rotation: 60 })
    renderViewer()
    const fakeA = mockState.fakes.get(100)!
    act(() => {
      fakeA.open()
      mockState.fakes.get(101)!.open()
    })
    fireEvent.click(screen.getByTestId('synchronized-reset'))
    expect(fakeA.viewport!.goHome).toHaveBeenCalledWith(true)
    expect(mockState.fakes.get(101)!.viewport!.goHome).toHaveBeenCalledWith(true)
    // goHome preserves rotation, so Reset must clear it explicitly.
    expect(fakeA.viewport!.setRotation).toHaveBeenLastCalledWith(0, true)
    expect(mockState.fakes.get(101)!.viewport!.setRotation).toHaveBeenLastCalledWith(0, true)
  })

  it('the Link views toggle pauses mirroring and re-arms on re-enable', () => {
    openPair()
    renderViewer()
    const fakeA = mockState.fakes.get(100)!
    const fakeB = mockState.fakes.get(101)!
    act(() => {
      fakeA.open()
      fakeB.open()
    })
    fireEvent.click(screen.getByTestId('synchronized-sync-toggle'))
    fakeB.viewport!.panTo.mockClear()
    act(() => {
      fakeA.viewport!.panTo({ x: 0.9, y: 0.9 })
    })
    expect(fakeB.viewport!.panTo).not.toHaveBeenCalled()
    // Re-linking captures the new relative alignment instead of snapping B:
    // A sits at (0.9, 0.9) and B at (0.5, 0.5), so B keeps the −0.4 offset.
    fireEvent.click(screen.getByTestId('synchronized-sync-toggle'))
    fakeB.viewport!.panTo.mockClear()
    act(() => {
      fakeA.viewport!.panTo({ x: 0.8, y: 0.9 })
    })
    expect(fakeB.viewport!.panTo).toHaveBeenCalledWith({ x: 0.4, y: 0.5 }, true)
  })

  it('shows the portrait hint without unmounting the viewers', () => {
    stubMatchMedia(true)
    openPair()
    renderViewer()
    expect(screen.getByTestId('synchronized-portrait-hint')).toBeInTheDocument()
    expect(screen.getAllByTestId('image-viewer')).toHaveLength(2)
  })

  it('hides the hint in landscape', () => {
    stubMatchMedia(false)
    renderViewer()
    expect(screen.queryByTestId('synchronized-portrait-hint')).not.toBeInTheDocument()
  })

  it('renders up to four members as a 2×2 grid (#1561)', () => {
    renderViewer({ collection: syncCollection({ images: images(4) }) })
    const viewers = screen.getAllByTestId('image-viewer')
    expect(viewers.map((v) => v.getAttribute('data-image-id'))).toEqual([
      '100',
      '101',
      '102',
      '103',
    ])
    // Every pane gets the shorter grid height and the read-only prop set.
    for (const v of viewers) {
      const props = mockState.lastProps.get(Number(v.getAttribute('data-image-id')))!
      expect(props.height).toBe('34vh')
      expect(props.canEditContent).toBe(false)
    }
    // No "Showing N of M" note when every member fits a pane.
    expect(screen.queryByText(/^Showing \d+ of \d+$/)).not.toBeInTheDocument()
  })

  it('keeps two members in the side-by-side layout', () => {
    renderViewer({ collection: syncCollection({ images: images(2) }) })
    const propsA = mockState.lastProps.get(100)!
    const propsB = mockState.lastProps.get(101)!
    expect(propsA.height).toBe('55vh')
    expect(propsB.height).toBe('55vh')
  })

  it('notes when the member count exceeds the pane cap', () => {
    // SYNCHRONIZED_COLLECTION_MAX_IMAGES is 4, but the viewer defends the
    // layout if a larger list ever arrives.
    renderViewer({ collection: syncCollection({ images: images(5) }) })
    expect(screen.getAllByTestId('image-viewer')).toHaveLength(4)
    expect(screen.getByText('Showing 4 of 5')).toBeInTheDocument()
  })

  it('falls back to a member list when fewer than two images are visible', () => {
    const collection = syncCollection({ images: images(1) })
    const { props } = renderViewer({ collection })
    expect(screen.getByTestId('synchronized-viewer-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('image-viewer')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Open image' }))
    expect(props.onOpenImage).toHaveBeenCalledWith(collection.images[0])
  })

  it('shows the fallback without a list for an empty collection', () => {
    renderViewer({ collection: syncCollection({ images: [] }) })
    expect(screen.getByTestId('synchronized-viewer-fallback')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open image' })).not.toBeInTheDocument()
  })

  it('says all images are restricted when members exist but none are visible (#1529)', () => {
    renderViewer({ collection: syncCollection({ images: [], memberCount: 4 }) })
    expect(screen.getByTestId('synchronized-viewer-fallback')).toHaveTextContent(
      'All images in this collection are currently restricted.',
    )
    expect(screen.queryByRole('link', { name: 'Open image' })).not.toBeInTheDocument()
  })

  it('slides the pair up when a member fails and falls back under two', () => {
    const collection = syncCollection({ images: images(3) })
    const { props } = renderViewer({ collection })
    act(() => {
      ;(mockState.lastProps.get(100)!.onError as (m: string) => void)('tiles expired')
    })
    expect(props.onError).toHaveBeenCalledWith('tiles expired')
    const viewers = screen.getAllByTestId('image-viewer')
    expect(viewers.map((v) => v.getAttribute('data-image-id'))).toEqual(['101', '102'])
    act(() => {
      ;(mockState.lastProps.get(101)!.onError as (m: string) => void)('gone')
    })
    act(() => {
      ;(mockState.lastProps.get(102)!.onError as (m: string) => void)('gone')
    })
    expect(screen.getByTestId('synchronized-viewer-fallback')).toBeInTheDocument()
  })

  it('hides Save view from non-editors but keeps Reset view', () => {
    const collection = syncCollection({
      permissions: { canEdit: false, canDelete: false, canTransfer: false, canHide: false },
    })
    renderViewer({ collection })
    expect(screen.queryByTestId('synchronized-save')).not.toBeInTheDocument()
    expect(screen.getByTestId('synchronized-reset')).toBeInTheDocument()
  })

  it('forwards tile-source renewals to onImageRenewed', () => {
    const { props } = renderViewer()
    const fresh = { id: 100 } as never
    act(() => {
      ;(mockState.lastProps.get(100)!.onTileSourceRenewed as (i: unknown) => void)(fresh)
    })
    expect(props.onImageRenewed).toHaveBeenCalledWith(fresh)
  })

  it('keeps the replacement pair linked and saveable after the first member fails', async () => {
    const meta101 = { locked_overlays: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }] }
    const collection = syncCollection({
      images: [
        makeImage({ id: 100, name: 'Slice 1', sortOrder: 0 }),
        makeImage({ id: 101, name: 'Slice 2', sortOrder: 1, metadataExtra: meta101 }),
        makeImage({ id: 102, name: 'Slice 3', sortOrder: 2 }),
      ],
    })
    const { b } = openPair()
    const c = makeFakeViewer({ zoom: 1, x: 0.5, y: 0.5, rotation: 0 })
    mockState.fakes.set(102, c.viewer)
    const { props } = renderViewer({ collection })
    act(() => {
      mockState.fakes.get(100)!.open()
      b.viewer.open()
    })
    act(() => {
      b.viewer.viewport!.panTo({ x: 0.8, y: 0.8 })
    })
    const overlaysBefore = mockState.lastProps.get(101)!.initialOverlays
    // First member's tiles fail: the pair slides to (101, 102) without
    // remounting the surviving viewer.
    act(() => {
      ;(mockState.lastProps.get(100)!.onError as (m: string) => void)('tiles expired')
    })
    expect(
      screen.getAllByTestId('image-viewer').map((v) => v.getAttribute('data-image-id')),
    ).toEqual(['101', '102'])
    // The surviving pane keeps its unsaved navigation and a stable
    // initialOverlays identity — either would remount the viewer otherwise.
    expect(b.state.x).toBeCloseTo(0.8)
    expect(mockState.lastProps.get(101)!.initialOverlays).toBe(overlaysBefore)
    act(() => {
      c.viewer.open()
    })
    // Mirroring works in both directions on the new pair. The offset armed
    // when 102 opened as b(0.8) - c(0.5) = -0.3, so it is kept on both writes.
    act(() => {
      b.viewer.viewport!.panTo({ x: 0.7, y: 0.7 })
    })
    expect(c.state.x).toBeCloseTo(0.4)
    expect(c.state.y).toBeCloseTo(0.4)
    act(() => {
      c.viewer.viewport!.panTo({ x: 0.3, y: 0.3 })
    })
    expect(b.state.x).toBeCloseTo(0.6)
    expect(b.state.y).toBeCloseTo(0.6)
    // Save view persists the replacement pair's viewports.
    await act(async () => {
      fireEvent.click(screen.getByTestId('synchronized-save'))
    })
    await vi.waitFor(() =>
      expect(props.onSaveViewport).toHaveBeenCalledWith({
        '101': { zoom: 1, x: expect.closeTo(0.6), y: expect.closeTo(0.6), rotation: 0 },
        '102': { zoom: 1, x: 0.3, y: 0.3, rotation: 0 },
      }),
    )
  })

  it('keeps viewer prop identities stable across unrelated collection updates', () => {
    const meta = { locked_overlays: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }] }
    const collection = syncCollection({
      images: [makeImage({ id: 100, metadataExtra: meta }), makeImage({ id: 101 })],
      viewportState: { '100': { zoom: 2, x: 0.4, y: 0.4, rotation: 10 } },
    })
    const { props, rerender } = renderViewer({ collection })
    const before = mockState.lastProps.get(100)!
    // A save response replaces the collection object with equal content —
    // a remount here would discard unsaved navigation.
    rerender(
      <SynchronizedCollectionViewer
        {...props}
        collection={{ ...collection, version: collection.version + 1 }}
      />,
    )
    const after = mockState.lastProps.get(100)!
    expect(after.initialOverlays).toBe(before.initialOverlays)
    expect(after.initialViewport).toBe(before.initialViewport)
    expect(after.canvasAnnotations).toBe(before.canvasAnnotations)
  })

  it('does not mint new mount-only props when unrelated metadata changes', () => {
    const meta = {
      locked_overlays: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
      canvas_annotations: [{ id: 'a1', shapes: [] }],
    }
    const collection = syncCollection({
      images: [makeImage({ id: 100, metadataExtra: meta }), makeImage({ id: 101 })],
    })
    const { props, rerender } = renderViewer({ collection })
    const before = mockState.lastProps.get(100)!
    // A refresh that changes only canvas_annotations must not replace the
    // overlay array — a new identity would remount the viewer and discard
    // unsaved navigation.
    const edited = syncCollection({
      images: [
        makeImage({
          id: 100,
          metadataExtra: { ...meta, canvas_annotations: [{ id: 'a2', shapes: [] }] },
        }),
        makeImage({ id: 101 }),
      ],
    })
    rerender(<SynchronizedCollectionViewer {...props} collection={edited} />)
    const after = mockState.lastProps.get(100)!
    expect(after.initialOverlays).toBe(before.initialOverlays)
    expect(after.initialViewport).toBe(before.initialViewport)
    expect(after.canvasAnnotations).not.toBe(before.canvasAnnotations)
  })

  it('ignores malformed saved viewport entries', () => {
    const collection = syncCollection({
      viewportState: {
        '100': { zoom: 0, x: 0.5, y: 0.5 },
        '101': { zoom: 2, x: 'nope', y: 0.5 },
      },
    })
    renderViewer({ collection })
    expect(mockState.lastProps.get(100)!.initialViewport).toBeUndefined()
    expect(mockState.lastProps.get(101)!.initialViewport).toBeUndefined()
  })

  it('ignores viewport changes before both viewers have opened', () => {
    openPair()
    renderViewer()
    const fakeA = mockState.fakes.get(100)!
    const fakeB = mockState.fakes.get(101)!
    // A moves before either open: no viewports exist yet, nothing applies.
    act(() => {
      fakeA.open()
      fakeA.viewport!.panTo({ x: 0.9, y: 0.9 })
    })
    expect(fakeB.viewport).toBeNull()
  })
})
