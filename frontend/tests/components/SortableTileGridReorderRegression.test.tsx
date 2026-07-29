/**
 * Production-scale reorder regression scaffolding (epic #975, sub-issue #976).
 *
 * Uses the deterministic fixture in `../helpers/reorderFixture` to prove the
 * grid handles production-scale scopes and that every accepted drop is
 * reported to the tile-ordering coordinator (which owns persistence,
 * queueing, and coalescing — see `tests/tileOrdering.test.ts` for the
 * persistence-level guarantees these scenarios originally documented).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import SortableTileGrid from '../../src/components/SortableTileGrid'
import type { SortableTileGridProps } from '../../src/components/SortableTileGrid'
import {
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

import type { TileOrderItemRef } from '../../src/api'

function makeTileOrdering() {
  let generation = 0
  return {
    displayOrder: null as TileOrderItemRef[] | null,
    reportOrder: vi.fn(),
    claimGeneration: vi.fn(() => ++generation),
  }
}

function renderGrid(overrides: Partial<SortableTileGridProps> = {}) {
  const defaults: SortableTileGridProps = {
    tileOrdering: makeTileOrdering(),
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

  it('reports 20 consecutive reorders to the coordinator exactly', async () => {
    const images = Array.from({ length: 21 }, (_, i) =>
      makeImage({ id: IMAGE_ID_BASE + i, name: `RF-Seq-${i}`, sortOrder: i }),
    )
    const tileOrdering = makeTileOrdering()
    renderGrid({ currentImages: images, tileOrdering })

    for (let drop = 0; drop < 20; drop++) {
      // Move the tile currently last to the front, once per iteration.
      const lastId = IMAGE_ID_BASE + 20 - drop
      await dropImage(lastId, IMAGE_ID_BASE, 20, 0)
    }

    expect(tileOrdering.reportOrder).toHaveBeenCalledTimes(20)
  })

  it('never discards a drop made while an earlier save may be in flight', async () => {
    // Historical regression: the legacy fallback path silently dropped a
    // second accepted drag while the first save was in flight. The
    // coordinator-only grid reports every accepted drop unconditionally.
    const images = [
      makeImage({ id: 1, name: 'A', sortOrder: 0 }),
      makeImage({ id: 2, name: 'B', sortOrder: 1 }),
      makeImage({ id: 3, name: 'C', sortOrder: 2 }),
    ]
    const tileOrdering = makeTileOrdering()
    renderGrid({ currentImages: images, tileOrdering })

    await dropImage(3, 1, 2, 0)
    await dropImage(2, 3, 2, 0)

    expect(tileOrdering.reportOrder).toHaveBeenCalledTimes(2)
  })
})
