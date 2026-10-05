import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CollectionCard, { CollectionVisibilityChip } from '../../src/components/CollectionCard'
import { makeCollectionSummary } from '../helpers/fixtures'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return { ...actual, fetchCollection: vi.fn() }
})

describe('CollectionCard', () => {
  it('renders name, image count, owner, type chip and visibility chip', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({ imageCount: 1, type: 'sequence' })}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('Skull comparison')).toBeInTheDocument()
    expect(screen.getByText('1 image · Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByTestId('collection-type-chip')).toHaveTextContent('Sequence')
    expect(screen.getByTestId('collection-visibility-chip')).toHaveTextContent('Private')
    expect(screen.getByRole('img', { name: 'Skull comparison' })).toHaveAttribute(
      'src',
      '/thumbs/skull.jpg?token=abc',
    )
  })

  it('pluralises the image count and falls back to a placeholder cover', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({ imageCount: 3, coverThumb: null, owner: null })}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('3 images · No owner')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('opens the collection when the card body is clicked', () => {
    const onOpen = vi.fn()
    const collection = makeCollectionSummary()
    render(<CollectionCard collection={collection} onOpen={onOpen} />)
    fireEvent.click(screen.getByTestId('collection-card-action-area'))
    expect(onOpen).toHaveBeenCalledWith(collection)
  })

  it('shows edit/delete only when the API grants the permission', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const collection = makeCollectionSummary({
      permissions: { canEdit: true, canDelete: false, canTransfer: false },
    })
    render(
      <CollectionCard
        collection={collection}
        onOpen={vi.fn()}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Skull comparison' }))
    expect(onEdit).toHaveBeenCalledWith(collection)
    expect(
      screen.queryByRole('button', { name: 'Delete Skull comparison' }),
    ).not.toBeInTheDocument()
  })

  it('hides both actions when neither permission is granted', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({
          permissions: { canEdit: false, canDelete: false, canTransfer: false },
        })}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
  })

  it('hides actions when no handlers are supplied even if permitted', () => {
    render(<CollectionCard collection={makeCollectionSummary()} onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
  })

  it('shows a transfer affordance only when canTransfer grants it', () => {
    const onTransfer = vi.fn()
    const collection = makeCollectionSummary({
      name: 'Mine',
      permissions: { canEdit: false, canDelete: false, canTransfer: true },
    })
    const { unmount } = render(
      <CollectionCard collection={collection} onOpen={vi.fn()} onTransfer={onTransfer} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Transfer Mine' }))
    expect(onTransfer).toHaveBeenCalledWith(collection)
    unmount()

    render(
      <CollectionCard
        collection={makeCollectionSummary({
          name: 'Shared',
          permissions: { canEdit: true, canDelete: true, canTransfer: false },
        })}
        onOpen={vi.fn()}
        onTransfer={onTransfer}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Transfer Shared' })).not.toBeInTheDocument()
  })

  it('shows a move affordance whenever onMove is supplied (#1529 — role-gated, not permission-gated)', () => {
    const onMove = vi.fn()
    const collection = makeCollectionSummary({
      name: 'Shared',
      // Move must appear even when the viewer cannot edit the collection:
      // filing is curatorial (any admin/instructor), unlike edit/delete.
      permissions: { canEdit: false, canDelete: false, canTransfer: false },
    })
    render(<CollectionCard collection={collection} onOpen={vi.fn()} onMove={onMove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move Shared to a category' }))
    expect(onMove).toHaveBeenCalledWith(collection)
  })

  it('hides the move affordance when onMove is not supplied', () => {
    render(<CollectionCard collection={makeCollectionSummary({ name: 'Mine' })} onOpen={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: 'Move Mine to a category' }),
    ).not.toBeInTheDocument()
  })

  it('does not open the collection when an action button is clicked', () => {
    const onOpen = vi.fn()
    const onDelete = vi.fn()
    render(
      <CollectionCard collection={makeCollectionSummary()} onOpen={onOpen} onDelete={onDelete} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete Skull comparison' }))
    expect(onDelete).toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('CollectionVisibilityChip', () => {
  it.each([
    ['private', 'Private'],
    ['public', 'Public'],
    ['restricted', 'Restricted'],
  ] as const)('labels %s as %s', (visibility, label) => {
    render(<CollectionVisibilityChip visibility={visibility} />)
    expect(screen.getByTestId('collection-visibility-chip')).toHaveTextContent(label)
  })
})
