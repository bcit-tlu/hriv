/**
 * Coordinator-mode grid tests (epic #975, issue #979).
 *
 * With the `tileOrdering` prop, `SortableTileGrid` applies every accepted
 * drag locally and reports the new order to the coordinator — it never calls
 * the legacy persistence APIs and never discards a drop, even when a save is
 * in flight (the coordinator owns queueing/coalescing).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, screen } from '@testing-library/react'
import SortableTileGrid from '../../src/components/SortableTileGrid'
import type { SortableTileGridProps } from '../../src/components/SortableTileGrid'
import { makeGalleryImageScope } from '../helpers/reorderFixture'

vi.mock('../../src/observability', () => ({
  emitEvent: vi.fn(),
}))

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

describe('SortableTileGrid coordinator mode', () => {
  const images = makeGalleryImageScope().slice(0, 5)

  beforeEach(() => {
    capturedOnDragEnd = undefined
    vi.mocked(reorderCategories).mockReset().mockResolvedValue()
    vi.mocked(reorderImages).mockReset().mockResolvedValue()
  })

  it('reports the new order to the coordinator instead of persisting directly', async () => {
    const tileOrdering = makeTileOrdering()
    renderGrid({ currentImages: images, tileOrdering })

    await dropImage(images[0].id, images[3].id, 0, 3)

    expect(tileOrdering.reportOrder).toHaveBeenCalledTimes(1)
    const [order, generation] = tileOrdering.reportOrder.mock.calls[0]
    expect(order).toEqual([
      { type: 'image', id: images[1].id },
      { type: 'image', id: images[2].id },
      { type: 'image', id: images[3].id },
      { type: 'image', id: images[0].id },
      { type: 'image', id: images[4].id },
    ])
    expect(generation).toBe(1)
    expect(reorderImages).not.toHaveBeenCalled()
    expect(reorderCategories).not.toHaveBeenCalled()
  })

  it('never discards consecutive drops (no in-flight guard in coordinator mode)', async () => {
    const tileOrdering = makeTileOrdering()
    renderGrid({ currentImages: images, tileOrdering })

    await dropImage(images[0].id, images[3].id, 0, 3)
    await dropImage(images[4].id, images[1].id, 4, 1)

    expect(tileOrdering.reportOrder).toHaveBeenCalledTimes(2)
    expect(reorderImages).not.toHaveBeenCalled()
  })

  it('renders items in the coordinator display order on mount', () => {
    const tileOrdering = makeTileOrdering()
    tileOrdering.displayOrder = [
      { type: 'image', id: images[2].id },
      { type: 'image', id: images[0].id },
      { type: 'image', id: images[1].id },
      { type: 'image', id: images[3].id },
      { type: 'image', id: images[4].id },
    ]
    renderGrid({ currentImages: images.slice(0, 5), tileOrdering })

    const grid = screen.getByRole('region', { name: 'Sortable tile grid' })
    const names = Array.from(grid.querySelectorAll('img')).map((el) => el.getAttribute('alt'))
    expect(names[0]).toBe(images[2].name)
    expect(names[1]).toBe(images[0].name)
  })

  it('claims a fresh generation per mount so stale callbacks are detectable', () => {
    const tileOrdering = makeTileOrdering()
    const { unmount } = renderGrid({ currentImages: images, tileOrdering })
    unmount()
    renderGrid({ currentImages: images, tileOrdering })

    expect(tileOrdering.claimGeneration).toHaveBeenCalledTimes(2)
  })
})
