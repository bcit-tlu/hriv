/**
 * Tests for CollectionManageDialog (#1566) — the member-management surface
 * behind the collection page's Manage button.
 *
 * `DragDropProvider` is wrapped (not mocked) to capture `onDragStart` /
 * `onDragEnd`, so the real @dnd-kit `move()` semantics run against synthetic
 * operations that carry the projected-index fields the helper commits on —
 * the same harness SequenceCollectionViewer's old reorder tests used.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'

import type { Collection } from '../../src/types'
import { makeCollection, makeImage } from '../helpers/fixtures'
import CollectionManageDialog, {
  type CollectionManageDialogProps,
} from '../../src/components/CollectionManageDialog'

// ── DragDropProvider wrapper — captures the handlers for direct calls ────
type SortableMeta = { index?: number; initialIndex?: number; group?: string }
type DragOperation = {
  source: ({ id: string | number } & SortableMeta) | null
  target: ({ id: string | number } & SortableMeta) | null
  canceled: boolean
}
type DragHandler = (event: { operation: DragOperation }) => void | Promise<void>

let capturedOnDragEnd: DragHandler | undefined
let capturedOnDragStart: DragHandler | undefined

vi.mock('@dnd-kit/react', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/react')>('@dnd-kit/react')
  return {
    ...actual,
    DragDropProvider: (props: Record<string, unknown>) => {
      capturedOnDragEnd = props.onDragEnd as DragHandler | undefined
      capturedOnDragStart = props.onDragStart as DragHandler | undefined
      const ActualProvider = actual.DragDropProvider as React.ComponentType<Record<string, unknown>>
      return <ActualProvider {...props} />
    },
  }
})

function manageCollection(overrides: Partial<Collection> = {}): Collection {
  return makeCollection({
    type: 'sequence',
    images: [
      makeImage({ id: 100, name: 'Slice 1', sortOrder: 0 }),
      makeImage({ id: 101, name: 'Slice 2', sortOrder: 1 }),
      makeImage({ id: 102, name: 'Slice 3', sortOrder: 2 }),
    ],
    ...overrides,
  })
}

function renderDialog(overrides: Partial<CollectionManageDialogProps> = {}) {
  const props: CollectionManageDialogProps = {
    open: true,
    onClose: vi.fn(),
    collection: manageCollection(),
    onReorder: vi.fn().mockResolvedValue(undefined),
    onRemoveImages: vi.fn().mockResolvedValue(undefined),
    onAddImages: vi.fn(),
    onImageRenewed: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
  return { ...render(<CollectionManageDialog {...props} />), props }
}

const sortableDrag = (sourceId: string, index: number, initialIndex: number) => ({
  id: sourceId,
  index,
  initialIndex,
  group: 'manage',
})

beforeEach(() => {
  capturedOnDragEnd = undefined
  capturedOnDragStart = undefined
})

describe('CollectionManageDialog', () => {
  it('renders every member as a filmstrip-size tile with its caption', () => {
    renderDialog()
    for (const id of [100, 101, 102]) {
      expect(screen.getByTestId(`manage-tile-${id}`)).toBeInTheDocument()
    }
    expect(screen.getByText('Slice 2')).toBeInTheDocument()
    // Thumbs match the filmstrip's 72×72 box. alt="" keeps the tile's
    // aria-label + caption from double-announcing the name (redundant-alt).
    const tile = screen.getByTestId('manage-tile-100')
    const thumb = tile.querySelector('img')
    expect(thumb).toHaveStyle({ width: '72px', height: '72px' })
    expect(thumb).toHaveAttribute('alt', '')
  })

  it('invokes onAddImages from the + affordance', () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Add images to collection' }))
    expect(props.onAddImages).toHaveBeenCalled()
  })

  it('omits the + affordance when no onAddImages is wired', () => {
    renderDialog({ onAddImages: undefined })
    expect(
      screen.queryByRole('button', { name: 'Add images to collection' }),
    ).not.toBeInTheDocument()
  })

  it('removes a member via its corner control', async () => {
    const { props } = renderDialog()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Slice 2 from collection' }))
    })
    expect(props.onRemoveImages).toHaveBeenCalledWith([101])
  })

  it('reports a removal failure through onError', async () => {
    const onRemoveImages = vi.fn().mockRejectedValue(new Error('stale version'))
    const { props } = renderDialog({ onRemoveImages })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Slice 1 from collection' }))
    })
    expect(props.onError).toHaveBeenCalledWith('Unable to remove the image from the collection.')
  })

  it('keeps the trash zone inert until a member tile is picked up', () => {
    renderDialog()
    const trash = screen.getByTestId('collection-manage-trash')
    expect(trash).toHaveAttribute('aria-hidden', 'true')
    act(() => {
      capturedOnDragStart!({
        operation: { source: sortableDrag('cmi-100', 0, 0), target: null, canceled: false },
      })
    })
    expect(trash).toHaveAttribute('aria-hidden', 'false')
  })

  it('persists a drag reorder through onReorder', () => {
    const { props } = renderDialog()
    // Drag the first tile onto the third: move() commits source.index.
    act(() => {
      capturedOnDragEnd!({
        operation: {
          source: sortableDrag('cmi-100', 2, 0),
          target: sortableDrag('cmi-102', 2, 2),
          canceled: false,
        },
      })
    })
    expect(props.onReorder).toHaveBeenCalledWith([101, 102, 100])
  })

  it('dropping a tile on the trash removes it instead of reordering', async () => {
    const { props } = renderDialog()
    await act(async () => {
      capturedOnDragEnd!({
        operation: {
          source: sortableDrag('cmi-101', 1, 1),
          target: { id: 'collection-manage-trash' },
          canceled: false,
        },
      })
    })
    expect(props.onRemoveImages).toHaveBeenCalledWith([101])
    expect(props.onReorder).not.toHaveBeenCalled()
  })

  it('reports a reorder failure through onError', async () => {
    const onReorder = vi.fn().mockRejectedValue(new Error('stale version'))
    const { props } = renderDialog({ onReorder })
    act(() => {
      capturedOnDragEnd!({
        operation: {
          source: sortableDrag('cmi-100', 2, 0),
          target: sortableDrag('cmi-102', 2, 2),
          canceled: false,
        },
      })
    })
    await vi.waitFor(() =>
      expect(props.onError).toHaveBeenCalledWith('Failed to reorder collection images.'),
    )
  })

  it('ignores a canceled drag and a drop that changes nothing', () => {
    const { props } = renderDialog()
    act(() => {
      capturedOnDragEnd!({
        operation: { source: sortableDrag('cmi-100', 0, 0), target: null, canceled: true },
      })
    })
    // Dropping the tile back onto itself leaves the order unchanged.
    act(() => {
      capturedOnDragEnd!({
        operation: {
          source: sortableDrag('cmi-100', 0, 0),
          target: sortableDrag('cmi-100', 0, 0),
          canceled: false,
        },
      })
    })
    expect(props.onReorder).not.toHaveBeenCalled()
    expect(props.onRemoveImages).not.toHaveBeenCalled()
  })

  it('shows the empty state and restricted-member note', () => {
    renderDialog({ collection: manageCollection({ images: [] }) })
    expect(screen.getByTestId('manage-empty')).toBeInTheDocument()
    renderDialog({ collection: manageCollection({ images: [], memberCount: 2 }) })
    expect(screen.getByText(/2 restricted images not shown/)).toBeInTheDocument()
  })
})
