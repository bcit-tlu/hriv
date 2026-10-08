import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    bottomOffset: 0,
    ...overrides,
  }
  return { ...render(<MyCollectionsDrawer {...props} />), props }
}

describe('MyCollectionsDrawer', () => {
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

  it('yields focus to a MUI modal layered above the temporary sheet', () => {
    renderDrawer({ open: true })

    // Dialogs/menus opened from the sheet portal outside the trap's subtree —
    // while one is open the trap must defer or the modal's inputs go dead.
    const modal = document.createElement('div')
    modal.className = 'MuiModal-root'
    const field = document.createElement('input')
    modal.appendChild(field)
    document.body.appendChild(modal)
    try {
      field.focus()
      expect(document.activeElement).toBe(field)
    } finally {
      document.body.removeChild(modal)
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
