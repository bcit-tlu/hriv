/**
 * Tests for CollectionManageDialog (#1566) — the member-management surface
 * behind the collection page's Manage button.
 *
 * Since #1567 the dialog stages every membership edit locally: reorder,
 * remove, and search additions mutate a draft list only; Done commits the
 * staged ids through `onSaveMembers` exactly once. These tests assert the
 * staged contract — nothing persists mid-edit, and Done carries the full
 * final list (order + removals + additions).
 *
 * `DragDropProvider` is wrapped (not mocked) to capture `onDragStart` /
 * `onDragEnd`, so the real @dnd-kit `move()` semantics run against synthetic
 * operations that carry the projected-index fields the helper commits on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Collection } from '../../src/types'
import { makeCollection, makeImage } from '../helpers/fixtures'
import CollectionManageDialog, {
  type CollectionManageDialogProps,
  type StageAddImages,
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
    onSaveMembers: vi.fn().mockResolvedValue(undefined),
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

/** Tile order as rendered — the draft's visible state. */
const draftOrder = () =>
  screen
    .getAllByTestId(/^manage-tile-\d+$/)
    .map((el) => Number(el.getAttribute('data-testid')!.replace('manage-tile-', '')))

beforeEach(() => {
  capturedOnDragEnd = undefined
  capturedOnDragStart = undefined
  vi.restoreAllMocks()
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

  it('keeps the remove badge inside the sortable node but outside the activator (#1567)', () => {
    // The drag transform applies to the sortable element — the badge must be
    // its descendant so it rides along, and outside the activator (which the
    // lib marks role=button) so nested-interactive stays clean and the badge
    // can never initiate a drag.
    renderDialog()
    const tile = screen.getByTestId('manage-tile-100')
    const removeBtn = within(tile).getByRole('button', {
      name: 'Remove Slice 1 from collection',
    })
    expect(tile).toContainElement(removeBtn)
    // The lib applies role=button to the activator asynchronously — the
    // synchronous marker is our aria-label on the handle element.
    const activator = tile.querySelector('[aria-label="Drag to reorder Slice 1"]')
    expect(activator).not.toBeNull()
    expect(activator).not.toContainElement(removeBtn)
  })

  it('keeps the activator synchronously focusable for keyboard reorder (#1567)', () => {
    // Regression: the handle-split must not drop the explicit
    // tabIndex/role — without them the tile face can never receive focus,
    // so Space/Enter never reach the KeyboardSensor.
    renderDialog()
    const activator = screen.getByRole('button', { name: 'Drag to reorder Slice 1' })
    expect(activator).toHaveAttribute('tabindex', '0')
  })

  it('selects multiple members and removes them in one staged commit (#1567)', () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByTestId('collection-manage-select-toggle'))
    // Faces switch to checkbox semantics; the per-tile ✕ is replaced by a
    // selection indicator.
    const face = screen.getByRole('checkbox', { name: 'Select Slice 1' })
    expect(face).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.queryByRole('button', { name: 'Remove Slice 1 from collection' }),
    ).not.toBeInTheDocument()

    fireEvent.click(face)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Slice 3' }))
    expect(screen.getByTestId('collection-manage-remove-selected')).toHaveTextContent('Remove (2)')

    fireEvent.click(screen.getByTestId('collection-manage-remove-selected'))
    expect(screen.queryByTestId('manage-tile-100')).not.toBeInTheDocument()
    expect(screen.queryByTestId('manage-tile-102')).not.toBeInTheDocument()
    expect(screen.getByTestId('manage-tile-101')).toBeInTheDocument()
    // Staged only — nothing persists until Done.
    expect(props.onSaveMembers).not.toHaveBeenCalled()
  })

  it('toggles selection from the keyboard while select mode is on (#1567)', () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('collection-manage-select-toggle'))
    const face = screen.getByRole('checkbox', { name: 'Select Slice 2' })
    face.focus()
    fireEvent.keyDown(face, { key: ' ' })
    expect(face).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(face, { key: 'Enter' })
    expect(face).toHaveAttribute('aria-checked', 'false')
  })

  it('leaving select mode restores the drag affordances and clears the set (#1567)', () => {
    renderDialog()
    fireEvent.click(screen.getByTestId('collection-manage-select-toggle'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Slice 1' }))
    fireEvent.click(screen.getByTestId('collection-manage-select-toggle'))
    // Drag semantics and the per-tile remove control are back.
    expect(screen.getByRole('button', { name: 'Drag to reorder Slice 1' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Slice 1 from collection' }),
    ).toBeInTheDocument()
    // Re-entering starts from a clean set — the bulk-remove button is
    // disabled while nothing is picked.
    fireEvent.click(screen.getByTestId('collection-manage-select-toggle'))
    expect(screen.getByRole('checkbox', { name: 'Select Slice 1' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByTestId('collection-manage-remove-selected')).toBeDisabled()
  })

  it('hides the Select toggle when the collection has no members (#1567)', () => {
    renderDialog({ collection: manageCollection({ images: [], memberCount: 0 }) })
    expect(screen.queryByTestId('collection-manage-select-toggle')).not.toBeInTheDocument()
  })

  it('hands its staging channel to onAddImages from the + affordance', () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(props.onAddImages).toHaveBeenCalled()
    const stageAdd = props.onAddImages.mock.calls[0][0] as StageAddImages
    expect(typeof stageAdd).toBe('function')
  })

  it('omits the + affordance when no onAddImages is wired', () => {
    renderDialog({ onAddImages: undefined })
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
  })

  it('staged search picks appear in the draft without persisting', () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const stageAdd = props.onAddImages.mock.calls[0][0] as StageAddImages
    let result: ReturnType<StageAddImages>
    act(() => {
      result = stageAdd([makeImage({ id: 200, name: 'Picked' })])
    })
    expect(result!.status).toBe('added')
    expect(screen.getByTestId('manage-tile-200')).toBeInTheDocument()
    // Nothing persists until Done.
    expect(props.onSaveMembers).not.toHaveBeenCalled()
  })

  it('reports already/full outcomes for staged picks', () => {
    const { props, unmount } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const stageAdd = props.onAddImages.mock.calls[0][0] as StageAddImages
    act(() => {
      // Every pick already a member → 'already'.
      expect(stageAdd([makeImage({ id: 100 })]).status).toBe('already')
    })
    unmount()
    // A synchronized collection at capacity reports 'full' (max 4).
    const sync = manageCollection({
      type: 'synchronized',
      images: [1, 2, 3, 4].map((id) => makeImage({ id, name: `Img ${id}` })),
    })
    const full = renderDialog({ collection: sync })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const stageFull = full.props.onAddImages.mock.calls[0][0] as StageAddImages
    act(() => {
      expect(stageFull([makeImage({ id: 300 })]).status).toBe('full')
    })
  })

  it('counts hidden restricted members toward the synchronized cap (#1567)', () => {
    // Student co-owner sees 3 of 4 members (one restricted away): staging a
    // fourth visible pick must still report 'full' — the server keeps the
    // hidden member and would 422 on commit.
    const sync = manageCollection({
      type: 'synchronized',
      memberCount: 4,
      images: [1, 2, 3].map((id) => makeImage({ id, name: `Img ${id}` })),
    })
    const { props } = renderDialog({ collection: sync })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const stageAdd = props.onAddImages.mock.calls[0][0] as StageAddImages
    act(() => {
      expect(stageAdd([makeImage({ id: 300 })]).status).toBe('full')
    })
  })

  it('Done merges membership changes that landed while the dialog was open (#1567)', async () => {
    const onSaveMembers = vi.fn().mockResolvedValue(undefined)
    const collection = manageCollection()
    const { props, rerender } = renderDialog({ onSaveMembers, collection })
    // Stage a removal — the draft diverges from the baseline.
    fireEvent.click(screen.getByRole('button', { name: 'Remove Slice 2 from collection' }))
    // A queued Browse add lands mid-edit: the live record gains image 103.
    rerender(
      <CollectionManageDialog
        {...props}
        collection={manageCollection({
          images: [...collection.images, makeImage({ id: 103, name: 'Slice 4', sortOrder: 3 })],
        })}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await vi.waitFor(() => expect(onSaveMembers).toHaveBeenCalled())
    // The commit keeps the staged removal AND the externally added member —
    // a stale-draft whole-replace would have silently deleted image 103.
    expect(onSaveMembers).toHaveBeenCalledWith([100, 102, 103])
  })

  it('a membership change landing mid-open does not dirty an untouched draft (#1567)', async () => {
    const collection = manageCollection()
    const { props, rerender } = renderDialog({ collection })
    rerender(
      <CollectionManageDialog
        {...props}
        collection={manageCollection({
          images: [...collection.images, makeImage({ id: 103, name: 'Slice 4', sortOrder: 3 })],
        })}
      />,
    )
    // No staged edits → Done still closes clean without a whole-replace PUT.
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(props.onSaveMembers).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalled()
  })

  it('corner-control removal stages locally — tile leaves, nothing persists', () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Slice 2 from collection' }))
    expect(screen.queryByTestId('manage-tile-101')).not.toBeInTheDocument()
    expect(draftOrder()).toEqual([100, 102])
    expect(props.onSaveMembers).not.toHaveBeenCalled()
  })

  it('renders no trash drop zone — removal uses the corner control or Select mode', () => {
    renderDialog()
    expect(screen.queryByTestId('collection-manage-trash')).not.toBeInTheDocument()
  })

  it('stages a drag reorder without persisting', () => {
    const { props } = renderDialog()
    act(() => {
      capturedOnDragEnd!({
        operation: {
          source: sortableDrag('cmi-100', 2, 0),
          target: sortableDrag('cmi-102', 2, 2),
          canceled: false,
        },
      })
    })
    expect(draftOrder()).toEqual([101, 102, 100])
    expect(props.onSaveMembers).not.toHaveBeenCalled()
  })

  it('a drop with no member target leaves the draft untouched', () => {
    const { props } = renderDialog()
    act(() => {
      capturedOnDragEnd!({
        operation: {
          source: sortableDrag('cmi-101', 1, 1),
          target: null,
          canceled: false,
        },
      })
    })
    expect(draftOrder()).toEqual([100, 101, 102])
    expect(props.onSaveMembers).not.toHaveBeenCalled()
  })

  it('Done commits the full staged list once — reorder + removal + additions', async () => {
    const { props } = renderDialog()
    // Stage: reorder (100 → end) + remove 102 + add 200.
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const stageAdd = props.onAddImages.mock.calls[0][0] as StageAddImages
    act(() => {
      stageAdd([makeImage({ id: 200, name: 'Picked' })])
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Slice 3 from collection' }))
    act(() => {
      capturedOnDragEnd!({
        operation: {
          source: sortableDrag('cmi-100', 2, 0),
          target: sortableDrag('cmi-200', 2, 2),
          canceled: false,
        },
      })
    })
    expect(draftOrder()).toEqual([101, 200, 100])

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(props.onSaveMembers).toHaveBeenCalledTimes(1)
    expect(props.onSaveMembers).toHaveBeenCalledWith([101, 200, 100])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('Done with a clean draft closes without saving', async () => {
    const { props } = renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(props.onSaveMembers).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalled()
  })

  it('a failed Done keeps the dialog open with the draft intact', async () => {
    const onSaveMembers = vi.fn().mockRejectedValue(new Error('stale version'))
    const { props } = renderDialog({ onSaveMembers })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Slice 2 from collection' }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await vi.waitFor(() =>
      expect(props.onError).toHaveBeenCalledWith('Failed to save the collection members.'),
    )
    expect(props.onClose).not.toHaveBeenCalled()
    // Draft still holds the staged removal — a retry commits the same list.
    expect(screen.queryByTestId('manage-tile-101')).not.toBeInTheDocument()
    onSaveMembers.mockResolvedValue(undefined)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onSaveMembers).toHaveBeenLastCalledWith([100, 102])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('Esc/backdrop discard a dirty draft only after confirmation', async () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Slice 2 from collection' }))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(confirmSpy).toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    // Confirm → discard: the parent closes, nothing was persisted.
    confirmSpy.mockReturnValue(true)
    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onSaveMembers).not.toHaveBeenCalled()
  })

  it('Esc closes a clean draft with no confirmation', async () => {
    const { props } = renderDialog()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalled()
  })

  it('ignores a canceled drag and a drop that changes nothing', () => {
    renderDialog()
    act(() => {
      capturedOnDragEnd!({
        operation: { source: sortableDrag('cmi-100', 0, 0), target: null, canceled: true },
      })
    })
    act(() => {
      capturedOnDragEnd!({
        operation: {
          source: sortableDrag('cmi-100', 0, 0),
          target: sortableDrag('cmi-100', 0, 0),
          canceled: false,
        },
      })
    })
    expect(draftOrder()).toEqual([100, 101, 102])
  })

  it('reseeds the draft on the next open after a discard', () => {
    const props: CollectionManageDialogProps = {
      open: true,
      onClose: vi.fn(),
      collection: manageCollection(),
      onSaveMembers: vi.fn().mockResolvedValue(undefined),
      onAddImages: vi.fn(),
      onImageRenewed: vi.fn(),
      onError: vi.fn(),
    }
    const { rerender } = render(<CollectionManageDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Slice 2 from collection' }))
    expect(draftOrder()).toEqual([100, 102])
    // Close (discard) and reopen — the draft reseeds from the collection.
    rerender(<CollectionManageDialog {...props} open={false} />)
    rerender(<CollectionManageDialog {...props} open={true} />)
    expect(draftOrder()).toEqual([100, 101, 102])
  })

  it('shows the empty state and restricted-member note', () => {
    renderDialog({ collection: manageCollection({ images: [] }) })
    expect(screen.getByTestId('manage-empty')).toBeInTheDocument()
    renderDialog({ collection: manageCollection({ images: [], memberCount: 2 }) })
    expect(screen.getByText(/2 restricted images not shown/)).toBeInTheDocument()
  })
})
