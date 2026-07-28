/**
 * Production-scale reorder regression scaffolding (epic #975, sub-issue #976).
 *
 * Uses the deterministic fixture in `../helpers/reorderFixture` plus deferred
 * (latency-injected) persistence mocks to reproduce the failure modes the
 * rest of the epic will fix. Tests that document currently-broken behaviour
 * are declared with `it.fails(...)`: they assert the DESIRED behaviour, so
 * they pass CI only while the bug exists and flip to failures once it is
 * fixed — forcing the marker's removal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import SortableTileGrid from '../../src/components/SortableTileGrid'
import type { SortableTileGridProps } from '../../src/components/SortableTileGrid'
import {
  createDeferred,
  makeFlatCategoryScope,
  makeGalleryImageScope,
  makeMixedRootScope,
  IMAGE_ID_BASE,
} from '../helpers/reorderFixture'
import { makeImage } from '../helpers/fixtures'

type SortableMeta = {
  index?: number
  initialIndex?: number
  group?: string
}
type DragEndHandler = (event: {
  operation: {
    source: ({ id: string | number } & SortableMeta) | null
    target: ({ id: string | number } & SortableMeta) | null
    canceled: boolean
  }
}) => void | Promise<void>

function sortableSource(id: string, index: number, initialIndex = index) {
  return { id, index, initialIndex, group: 'tiles' }
}

let capturedOnDragEnd: DragEndHandler | undefined

vi.mock('@dnd-kit/react', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/react')>('@dnd-kit/react')
  return {
    ...actual,
    DragDropProvider: (props: Record<string, unknown>) => {
      capturedOnDragEnd = props.onDragEnd as DragEndHandler | undefined
      const ActualProvider = actual.DragDropProvider as React.ComponentType<Record<string, unknown>>
      return <ActualProvider {...props} />
    },
  }
})

import * as apiModule from '../../src/api'

vi.mock('../../src/api', async () => {
  const actual = await vi.importActual<typeof apiModule>('../../src/api')
  return {
    ...actual,
    reorderCategories: vi.fn(() => Promise.resolve()),
    reorderImages: vi.fn(() => Promise.resolve()),
  }
})

import { reorderCategories, reorderImages } from '../../src/api'

function renderGrid(overrides: Partial<SortableTileGridProps> = {}) {
  const defaults: SortableTileGridProps = {
    allCategories: [],
    currentCategories: [],
    currentImages: [],
    uncategorizedImages: [],
    path: [],
    canEditContent: true,
    fileDragActive: false,
    programs: [],
    onCategoryClick: vi.fn(),
    onImageClick: vi.fn(),
    onFilesDrop: vi.fn(),
    onDropImageOnCategory: vi.fn(),
    onReorderComplete: vi.fn(),
    onReorderError: vi.fn(),
  }
  const props = { ...defaults, ...overrides }
  return { ...render(<SortableTileGrid {...props} />), props }
}

/** Drop the image tile currently at `fromIndex` onto position `toIndex`. */
async function dropImage(fromId: number, toId: number, fromIndex: number, toIndex: number) {
  await act(async () => {
    await capturedOnDragEnd!({
      operation: {
        source: sortableSource(`img-${fromId}`, toIndex, fromIndex),
        target: { id: `img-${toId}` },
        canceled: false,
      },
    })
  })
}

describe('production-scale fixture rendering', () => {
  beforeEach(() => {
    capturedOnDragEnd = undefined
    vi.mocked(reorderCategories).mockReset().mockResolvedValue()
    vi.mocked(reorderImages).mockReset().mockResolvedValue()
  })

  it('renders the 80-category / 600-image fixture scope', () => {
    const { categories, uncategorizedImages } = makeMixedRootScope()
    const view = renderGrid({
      currentCategories: [...categories, ...makeFlatCategoryScope()],
      currentImages: makeGalleryImageScope(),
      uncategorizedImages,
    })

    expect(view.container.querySelectorAll('h6').length).toBeGreaterThanOrEqual(695)
    expect(view.getByText('RF-Flat-Cat-001')).toBeInTheDocument()
    expect(view.getByText('RF-Flat-Cat-080')).toBeInTheDocument()
    expect(view.getByText('RF-Gallery-Img-001')).toBeInTheDocument()
    expect(view.getByText('RF-Gallery-Img-600')).toBeInTheDocument()
  })

  it('persists 20 consecutive awaited reorders exactly (fast persistence)', async () => {
    const images = Array.from({ length: 21 }, (_, i) =>
      makeImage({ id: IMAGE_ID_BASE + i, name: `RF-Seq-${i}`, sortOrder: i }),
    )
    renderGrid({ currentImages: images })

    for (let drop = 0; drop < 20; drop++) {
      // Move the tile currently last to the front, once per iteration.
      const lastId = IMAGE_ID_BASE + 20 - drop
      await dropImage(lastId, IMAGE_ID_BASE, 20, 0)
    }

    expect(reorderImages).toHaveBeenCalledTimes(20)
  })
})

describe('reorder persistence regressions (epic #975 — currently failing)', () => {
  beforeEach(() => {
    capturedOnDragEnd = undefined
    vi.mocked(reorderCategories).mockReset().mockResolvedValue()
    vi.mocked(reorderImages).mockReset().mockResolvedValue()
  })

  it.fails('persists a second drop made while the first save is still in flight', async () => {
    // Scenario 1: reorder one item, immediately reorder another while
    // persistence is delayed. Today `reorderInFlightRef` silently discards
    // the second accepted drop (SortableTileGrid.handleDragEnd early return).
    const firstSave = createDeferred()
    vi.mocked(reorderImages)
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementation(() => Promise.resolve())

    const images = [
      makeImage({ id: 1, name: 'A', sortOrder: 0 }),
      makeImage({ id: 2, name: 'B', sortOrder: 1 }),
      makeImage({ id: 3, name: 'C', sortOrder: 2 }),
    ]
    renderGrid({ currentImages: images })

    // First drop: C to the front — persistence held open by the deferred.
    let firstDrop: Promise<void> | void
    act(() => {
      firstDrop = capturedOnDragEnd!({
        operation: {
          source: sortableSource('img-3', 0, 2),
          target: { id: 'img-1' },
          canceled: false,
        },
      })
    })

    // Second drop while the first save is in flight: B to the front.
    await dropImage(2, 3, 2, 0)

    firstSave.resolve()
    await act(async () => {
      await firstDrop
    })

    // No accepted drop may be silently discarded: both must persist.
    expect(reorderImages).toHaveBeenCalledTimes(2)
  })

  it.fails('does not let a stale refresh response overwrite the newer saved order', async () => {
    // Scenario 7/8: a background refresh (or slow category-tree read) that
    // started BEFORE the reorder resolves last and carries the old order.
    // Today the post-save rebuild applies those stale props, visually
    // reverting a successfully persisted reorder.
    const staleImages = [
      makeImage({ id: 1, name: 'A', sortOrder: 0 }),
      makeImage({ id: 2, name: 'B', sortOrder: 1 }),
    ]

    const view = renderGrid({
      currentImages: staleImages,
      onReorderComplete: async () => {
        // The refresh completes but delivers the PRE-reorder ordering.
        view.rerender(
          <SortableTileGrid
            {...view.props}
            currentImages={staleImages}
            onReorderComplete={view.props.onReorderComplete}
          />,
        )
        await Promise.resolve()
      },
    })

    await dropImage(2, 1, 1, 0)

    // The save succeeded (server order is B, A); an older read must not
    // overwrite the newer client state.
    const labels = Array.from(view.container.querySelectorAll('h6')).map(
      (node) => node.textContent ?? '',
    )
    expect(labels.slice(0, 2)).toEqual(['B', 'A'])
  })

  it.fails('propagates independent category/image persistence outcomes atomically', async () => {
    // Scenario 5/6: category persistence delayed independently from image
    // persistence, with one half failing. The two-request flow commits the
    // successful half — a partial persistence the epic's atomic contract
    // (#978) must make impossible. Desired: no half-committed order, so the
    // surviving call set must be empty or complete.
    const catSave = createDeferred()
    vi.mocked(reorderCategories).mockImplementationOnce(() => catSave.promise)
    vi.mocked(reorderImages).mockRejectedValueOnce(new Error('image half failed'))

    const { categories } = makeMixedRootScope()
    const onReorderError = vi.fn()
    renderGrid({
      currentCategories: categories.slice(0, 2),
      currentImages: [
        makeImage({ id: 1, name: 'A', sortOrder: 2 }),
        makeImage({ id: 2, name: 'B', sortOrder: 3 }),
      ],
      onReorderError,
    })

    let drop: Promise<void> | void
    act(() => {
      drop = capturedOnDragEnd!({
        operation: {
          source: sortableSource('img-2', 0, 3),
          target: { id: `cat-${categories[0].id}` },
          canceled: false,
        },
      })
    })

    // Image half already failed; category half now succeeds after a delay.
    catSave.resolve()
    await act(async () => {
      await drop
    })

    // Atomicity: if any half fails, the other half must not have been
    // committed. Today reorderCategories was invoked and resolved
    // successfully, so the categories persisted while the images did not.
    expect(onReorderError).toHaveBeenCalled()
    expect(reorderCategories).not.toHaveBeenCalled()
  })
})
