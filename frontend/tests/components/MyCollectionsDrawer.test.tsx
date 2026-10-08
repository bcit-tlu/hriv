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
    ...overrides,
  }
  return { ...render(<MyCollectionsDrawer {...props} />), props }
}

describe('MyCollectionsDrawer', () => {
  it('does not render the Fab when there are no collections', () => {
    renderDrawer({ collections: [] })

    expect(screen.queryByRole('button', { name: 'My collections' })).not.toBeInTheDocument()
  })

  it('opens from the Fab', () => {
    const { props } = renderDrawer()

    fireEvent.click(screen.getByRole('button', { name: 'My collections' }))

    expect(props.onOpenChange).toHaveBeenCalledWith(true)
  })

  it('does not render the Fab while open', () => {
    renderDrawer({ open: true })

    expect(screen.queryByRole('button', { name: 'My collections' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'My collections' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAccessibleName('My collections')
    expect(screen.getByRole('heading', { level: 3, name: 'Sequence overview' })).toBeInTheDocument()
  })

  it('collapses from the header button', () => {
    const { props } = renderDrawer({ open: true })

    fireEvent.click(screen.getByRole('button', { name: 'Collapse My collections' }))

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes an unpinned drawer on Escape', async () => {
    const { props } = renderDrawer({ open: true })

    fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' })

    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
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
  })

  it('renders no backdrop while pinned', () => {
    renderDrawer({ open: true, pinned: true })

    expect(document.querySelector('.MuiBackdrop-root')).not.toBeInTheDocument()
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
