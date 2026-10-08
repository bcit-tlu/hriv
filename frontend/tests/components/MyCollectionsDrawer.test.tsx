import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import userEvent from '@testing-library/user-event'
import { COLLECTIONS_AT_CAP_TOOLTIP } from '../../src/collectionUtils'
import MyCollectionsDrawer, {
  type MyCollectionsDrawerProps,
} from '../../src/components/MyCollectionsDrawer'
import { makeCollectionSummary } from '../helpers/fixtures'

function renderDrawer(overrides: Partial<MyCollectionsDrawerProps> = {}) {
  const props: MyCollectionsDrawerProps = {
    collections: [makeCollectionSummary({ id: 1, name: 'Sequence overview' })],
    categories: [],
    programs: [],
    groups: [],
    open: false,
    pinned: false,
    onOpenChange: vi.fn(),
    onPinnedChange: vi.fn(),
    onOpen: vi.fn(),
    onSeeAll: vi.fn(),
    onNewCollection: vi.fn(),
    ...overrides,
  }
  return { ...render(<MyCollectionsDrawer {...props} />), props }
}

describe('MyCollectionsDrawer', () => {
  it('renders the trigger as a filled, clickable button while unpinned', () => {
    const { props } = renderDrawer({ open: true })

    const trigger = screen.getByRole('button', { name: 'My collections' })
    expect(trigger).toHaveClass('MuiButton-contained')
    expect(trigger).not.toHaveAttribute('aria-disabled')
    fireEvent.click(trigger)
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders the trigger as an outlined, non-clickable title while pinned', () => {
    const { props } = renderDrawer({ open: true, pinned: true })

    const trigger = screen.getByRole('button', { name: 'My collections' })
    expect(trigger).toHaveClass('MuiButton-outlined')
    expect(trigger).toHaveAttribute('aria-disabled', 'true')
    expect(trigger).toHaveStyle({ pointerEvents: 'none' })
    fireEvent.click(trigger)
    expect(props.onOpenChange).not.toHaveBeenCalled()
  })

  it('does not render the button when there are no collections', () => {
    renderDrawer({ collections: [] })

    expect(screen.queryByRole('button', { name: 'My collections' })).not.toBeInTheDocument()
  })

  it('opens from the button', () => {
    const { props } = renderDrawer()

    fireEvent.click(screen.getByRole('button', { name: 'My collections' }))

    expect(props.onOpenChange).toHaveBeenCalledWith(true)
  })

  it('keeps the button mounted while open and uses it as the sheet title', () => {
    renderDrawer({ open: true })

    const button = screen.getByRole('button', { name: 'My collections' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('My collections')
    // The sheet has no separate heading — the trigger button doubles as it.
    expect(
      screen.queryByRole('heading', { level: 2, name: 'My collections' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Sequence overview' })).toBeInTheDocument()
  })

  it('collapses by pressing the title button again', () => {
    const { props } = renderDrawer({ open: true })

    fireEvent.click(screen.getByRole('button', { name: 'My collections' }))

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes an unpinned drawer on Escape', async () => {
    const { props } = renderDrawer({ open: true })

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
  })

  it('does not close a pinned drawer on Escape', () => {
    const { props } = renderDrawer({ open: true, pinned: true })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(props.onOpenChange).not.toHaveBeenCalled()
  })

  it('toggles pinning and reflects the pressed state', () => {
    const { props, rerender } = renderDrawer({ open: true })

    const pin = screen.getByRole('button', { name: 'Pin My collections' })
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pin)
    expect(props.onPinnedChange).toHaveBeenCalledWith(true)

    rerender(<MyCollectionsDrawer {...props} pinned />)
    expect(screen.getByRole('button', { name: 'Unpin My collections' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The sheet stays in the document — no close on unpin/pin transitions.
    expect(screen.getByRole('region', { name: 'My collections' })).toBeInTheDocument()
  })

  it('renders no backdrop while pinned, and one while temporary', () => {
    const { props, rerender } = renderDrawer({ open: true, pinned: true })

    expect(screen.queryByTestId('my-collections-backdrop')).not.toBeInTheDocument()

    rerender(<MyCollectionsDrawer {...props} pinned={false} />)
    expect(screen.getByTestId('my-collections-backdrop')).toBeInTheDocument()
  })

  it('locks document scrolling while the temporary sheet is open', () => {
    const root = document.documentElement
    const { props, rerender } = renderDrawer({ open: true })

    expect(root.style.overflow).toBe('hidden')

    rerender(<MyCollectionsDrawer {...props} open={false} />)
    expect(root.style.overflow).toBe('')
    expect(root.style.paddingRight).toBe('')
  })

  it('releases the document scroll lock when the sheet pins', () => {
    const root = document.documentElement
    const { props, rerender } = renderDrawer({ open: true })

    expect(root.style.overflow).toBe('hidden')

    // Pinning hands the sheet back to page furniture — the page must scroll.
    rerender(<MyCollectionsDrawer {...props} pinned />)
    expect(root.style.overflow).toBe('')
  })

  it('never locks document scrolling while pinned', () => {
    renderDrawer({ open: true, pinned: true })

    expect(document.documentElement.style.overflow).toBe('')
  })

  it('caps the card row against the dock chrome so the header stays on-screen', () => {
    renderDrawer({ open: true })

    // jsdom reports zero-height layout, so the fallback 140px chrome applies;
    // in a real browser the header and footer heights are measured live so
    // wrapped lines shrink the card row instead of pushing controls off-screen.
    // jsdom's 768px viewport resolves min(50vh, calc(100vh - 140px)) = 384px.
    const cardRow = screen.getByTestId('my-collections-card-row')
    expect(getComputedStyle(cardRow).maxHeight).toBe('384px')
  })

  it('pulls outside focus back into the temporary sheet', () => {
    renderDrawer({ open: true })

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      outside.focus()
      expect(document.activeElement).not.toBe(outside)
    } finally {
      document.body.removeChild(outside)
    }
  })

  const appendModal = (trapping: boolean) => {
    // A real MUI modal's FocusTrap sentinels flip tabIndex with `open` —
    // 0 while the modal traps, -1 once it starts exiting.
    const modal = document.createElement('div')
    modal.className = 'MuiModal-root'
    const sentinel = document.createElement('div')
    sentinel.dataset.testid = 'sentinelStart'
    sentinel.tabIndex = trapping ? 0 : -1
    const field = document.createElement('input')
    modal.append(sentinel, field)
    document.body.appendChild(modal)
    return { modal, field }
  }

  it('yields focus to a MUI modal layered above the temporary sheet', () => {
    renderDrawer({ open: true })

    // Dialogs/menus opened from the sheet portal outside the trap's subtree —
    // while one is open the trap must defer or the modal's inputs go dead.
    const { modal, field } = appendModal(true)
    try {
      field.focus()
      expect(document.activeElement).toBe(field)
    } finally {
      modal.remove()
    }
  })

  it('keeps trapping while a MUI modal above it exits', () => {
    renderDrawer({ open: true })

    // An exiting modal leaves its root mounted but its own trap inactive —
    // the drawer must re-engage immediately, not wait for the unmount.
    const { modal } = appendModal(false)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      outside.focus()
      expect(document.activeElement).not.toBe(outside)
    } finally {
      outside.remove()
      modal.remove()
    }
  })

  it('hands focus to a real Dialog and takes enforcement back when it closes', () => {
    renderDrawer({ open: true })

    const dialog = render(
      <Dialog open>
        <DialogTitle>Pick a cover</DialogTitle>
        <input aria-label="dialog field" />
      </Dialog>,
    )
    const field = screen.getByLabelText('dialog field')
    field.focus()
    expect(document.activeElement).toBe(field)

    // Closing flips the dialog's own trap off while its root is still
    // mounted for the exit transition — outside focus must snap back to the
    // sheet instead of escaping to the page.
    dialog.rerender(
      <Dialog open={false}>
        <DialogTitle>Pick a cover</DialogTitle>
        <input aria-label="dialog field" />
      </Dialog>,
    )
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      outside.focus()
      expect(document.activeElement).not.toBe(outside)
    } finally {
      outside.remove()
      dialog.unmount()
    }
  })

  it('renders title-only tiles with no image-count metadata', () => {
    renderDrawer({
      open: true,
      collections: [makeCollectionSummary({ name: 'Quiet spine study', imageCount: 4 })],
    })

    expect(screen.getByRole('heading', { level: 3, name: 'Quiet spine study' })).toBeInTheDocument()
    expect(screen.queryByText(/images/)).not.toBeInTheDocument()
  })

  it('disables New collection with the cap tooltip', async () => {
    const user = userEvent.setup()
    renderDrawer({ open: true, newCollectionDisabled: true })

    const button = screen.getByRole('button', { name: 'New collection' })
    expect(button).toBeDisabled()
    await user.hover(button.parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(COLLECTIONS_AT_CAP_TOOLTIP)
  })

  it('opens a card and navigates to See all', () => {
    const collection = makeCollectionSummary({ id: 7, name: 'Filed sequence' })
    const { props } = renderDrawer({ collections: [collection], open: true })

    fireEvent.click(screen.getByTestId('collection-card-action-area'))
    expect(props.onOpen).toHaveBeenCalledWith(collection)

    fireEvent.click(screen.getByRole('button', { name: 'See all' }))
    expect(props.onSeeAll).toHaveBeenCalledOnce()
  })

  it('forwards edit and cover-picker actions for editable collections', () => {
    const collection = makeCollectionSummary({ id: 7, name: 'Editable collection' })
    const onEdit = vi.fn()
    const onPickCoverImage = vi.fn()
    renderDrawer({ collections: [collection], open: true, onEdit, onPickCoverImage })

    fireEvent.click(screen.getByRole('button', { name: 'Edit Editable collection' }))
    expect(onEdit).toHaveBeenCalledWith(collection)

    fireEvent.click(screen.getByRole('button', { name: 'Set Editable collection cover image' }))
    expect(onPickCoverImage).toHaveBeenCalledWith(collection)
  })
})
