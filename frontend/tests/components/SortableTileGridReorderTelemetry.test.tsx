/**
 * Reorder operation correlation tests (epic #975, sub-issue #977).
 *
 * Verifies that every reorder lifecycle transition in `SortableTileGrid`
 * carries one client-generated operation ID: the same ID must appear on the
 * diagnostic events AND be passed to the persistence API calls (which forward
 * it as the `X-Reorder-Operation-Id` header).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import SortableTileGrid from '../../src/components/SortableTileGrid'
import type { SortableTileGridProps } from '../../src/components/SortableTileGrid'
import { subscribeReorderDiagnostics } from '../../src/reorderDiagnostics'
import type { ReorderDiagnosticEvent } from '../../src/reorderDiagnostics'
import { createDeferred, makeGalleryImageScope } from '../helpers/reorderFixture'

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

describe('reorder operation correlation', () => {
  const images = makeGalleryImageScope().slice(0, 8)
  let events: ReorderDiagnosticEvent[]
  let unsubscribe: () => void

  beforeEach(() => {
    capturedOnDragEnd = undefined
    vi.mocked(reorderCategories).mockReset().mockResolvedValue()
    vi.mocked(reorderImages).mockReset().mockResolvedValue()
    events = []
    unsubscribe?.()
    unsubscribe = subscribeReorderDiagnostics((e) => events.push(e))
  })

  it('emits submitted and committed with one operation ID, passed to the API call', async () => {
    renderGrid({ currentImages: images })
    await dropImage(images[0].id, images[3].id, 0, 3)

    const states = events.map((e) => e.state)
    expect(states).toEqual(['submitted', 'committed'])
    const operationId = events[0].operationId
    expect(events[1].operationId).toBe(operationId)
    expect(events[0].itemType).toBe('image')
    expect(events[0].fromIndex).toBe(0)
    expect(events[0].toIndex).toBe(3)
    expect(events[0].imageCount).toBe(images.length)
    expect(events[1].durationMs).toBeGreaterThanOrEqual(0)

    expect(reorderImages).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reorderImages).mock.calls[0][1]).toBe(operationId)
  })

  it('emits ignored (with its own operation ID) for a drop during an in-flight save', async () => {
    const gate = createDeferred<void>()
    vi.mocked(reorderImages).mockImplementation(() => gate.promise)

    renderGrid({ currentImages: images })

    const firstDrop = dropImage(images[0].id, images[3].id, 0, 3)
    await dropImage(images[5].id, images[1].id, 5, 1)

    const ignored = events.find((e) => e.state === 'ignored')
    expect(ignored).toBeDefined()
    expect(ignored!.itemType).toBe('image')
    expect(ignored!.queueDepth).toBe(1)
    expect(ignored!.operationId).not.toBe(events[0].operationId)

    gate.resolve()
    await firstDrop
    expect(events.map((e) => e.state)).toEqual(['submitted', 'ignored', 'committed'])
  })

  it('emits failed with the same operation ID when persistence rejects', async () => {
    vi.mocked(reorderImages).mockRejectedValue(new Error('boom'))

    renderGrid({ currentImages: images })
    await dropImage(images[0].id, images[3].id, 0, 3)

    expect(events.map((e) => e.state)).toEqual(['submitted', 'failed'])
    expect(events[1].operationId).toBe(events[0].operationId)
    expect(events[1].errorCode).toBe('api_network_error')
  })

  it('emits abandoned when the grid unmounts during an active save', async () => {
    const gate = createDeferred<void>()
    vi.mocked(reorderImages).mockImplementation(() => gate.promise)

    const view = renderGrid({ currentImages: images })
    const drop = dropImage(images[0].id, images[3].id, 0, 3)

    view.unmount()

    const abandoned = events.find((e) => e.state === 'abandoned')
    expect(abandoned).toBeDefined()
    expect(abandoned!.operationId).toBe(events[0].operationId)

    gate.resolve()
    await drop
  })
})
