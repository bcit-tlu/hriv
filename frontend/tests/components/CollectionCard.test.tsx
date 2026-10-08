import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import CollectionCard, {
  CollectionTypeChip,
  CollectionTypeIcon,
  CollectionVisibilityChip,
} from '../../src/components/CollectionCard'
import { makeCollectionSummary } from '../helpers/fixtures'

describe('CollectionCard', () => {
  it('renders name, image count, type icon and visibility chip', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({ imageCount: 1, type: 'sequence' })}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('Skull comparison')).toBeInTheDocument()
    expect(screen.getByText('1 image')).toBeInTheDocument()
    // The type pill overlay is gone (#1567): the bare type icon sits left of
    // the title like the category tile's folder glyph, labelled via the
    // role="img" convention. Owner names never render in tile metadata.
    const titleRow = screen.getByText('Skull comparison').parentElement as HTMLElement
    expect(within(titleRow).getByRole('img', { name: 'Sequence' })).toBeInTheDocument()
    expect(screen.queryByTestId('collection-type-chip')).not.toBeInTheDocument()
    expect(screen.queryByText(/Ada Lovelace/)).not.toBeInTheDocument()
    expect(screen.getByTestId('collection-visibility-chip')).toHaveTextContent('Private')
    expect(screen.getByRole('img', { name: 'Skull comparison' })).toHaveAttribute(
      'src',
      '/thumbs/skull.jpg?token=abc',
    )
  })

  it('uses a 4:3 thumbnail and subtitle1 title in compact density', () => {
    render(
      <CollectionCard collection={makeCollectionSummary()} onOpen={vi.fn()} density="compact" />,
    )

    expect(screen.getByRole('img', { name: 'Skull comparison' })).toHaveStyle({
      width: '100%',
      aspectRatio: '4 / 3',
      height: 'auto',
    })
    expect(screen.getByRole('heading', { name: 'Skull comparison' })).toHaveClass(
      'MuiTypography-subtitle1',
    )
  })

  it('renders no owner reference — program or user — on the tile (#1567)', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({
          visibility: 'private',
          programIds: [],
          groupIds: [],
          owners: [
            { kind: 'user', userId: 2, name: 'Ada Lovelace' },
            { kind: 'program', programId: 3, name: 'Dentistry' },
          ],
        })}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.queryByText(/Ada Lovelace/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Dentistry/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('collection-owner-program-chip')).not.toBeInTheDocument()
  })

  it('pluralises the image count and falls back to a placeholder cover', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({ imageCount: 3, coverThumb: null, owners: [] })}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('3 images')).toBeInTheDocument()
    // No cover image — the only exposed graphic is the title-row type icon.
    expect(screen.queryByRole('img', { name: 'Skull comparison' })).not.toBeInTheDocument()
  })

  it('opens the collection when the card body is clicked', () => {
    const onOpen = vi.fn()
    const collection = makeCollectionSummary()
    render(<CollectionCard collection={collection} onOpen={onOpen} />)
    fireEvent.click(screen.getByTestId('collection-card-action-area'))
    expect(onOpen).toHaveBeenCalledWith(collection)
  })

  it('shows edit only when the API grants the permission', () => {
    const onEdit = vi.fn()
    const collection = makeCollectionSummary({
      permissions: { canEdit: true, canDelete: false, canTransfer: false, canHide: false },
    })
    const onOpen = vi.fn()
    render(<CollectionCard collection={collection} onOpen={onOpen} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Skull comparison' }))
    expect(onEdit).toHaveBeenCalledWith(collection)
    // The pencil sits inside the card's click target — it must not also
    // navigate to the collection (#1567).
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('hides the edit action when the permission is not granted', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({
          permissions: { canEdit: false, canDelete: false, canTransfer: false, canHide: false },
        })}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
  })

  it('hides actions when no handlers are supplied even if permitted', () => {
    render(<CollectionCard collection={makeCollectionSummary()} onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    // Delete lives only inside the edit dialog (#1554), never on the card.
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
  })

  it('never renders an owners affordance — transfer lives on the detail view and manage table', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({
          name: 'Mine',
          permissions: { canEdit: false, canDelete: false, canTransfer: true, canHide: false },
        })}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /^Manage owners/ })).not.toBeInTheDocument()
  })

  it('shows a move affordance whenever onMove is supplied (#1529 — role-gated, not permission-gated)', () => {
    const onMove = vi.fn()
    const collection = makeCollectionSummary({
      name: 'Shared',
      // Move must appear even when the viewer cannot edit the collection:
      // filing is curatorial (any admin/instructor), unlike edit/delete.
      permissions: { canEdit: false, canDelete: false, canTransfer: false, canHide: false },
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

  it('signals the cover picker on overlay click (CategoryTile convention)', () => {
    const onPickCoverImage = vi.fn()
    const collection = makeCollectionSummary({
      permissions: { canEdit: true, canDelete: false, canTransfer: false, canHide: false },
    })
    const onOpen = vi.fn()
    render(
      <CollectionCard
        collection={collection}
        onOpen={onOpen}
        onPickCoverImage={onPickCoverImage}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Set Skull comparison cover image' }))
    expect(onPickCoverImage).toHaveBeenCalledWith(collection)
    // The overlay button must not also navigate into the collection.
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('gates the cover picker on canEdit like the edit pencil', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({
          permissions: { canEdit: false, canDelete: false, canTransfer: false, canHide: false },
        })}
        onOpen={vi.fn()}
        onPickCoverImage={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /Set .* cover image/ })).not.toBeInTheDocument()
    // And it stays off without a handler even when permitted.
    render(<CollectionCard collection={makeCollectionSummary()} onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Set .* cover image/ })).not.toBeInTheDocument()
  })

  it('does not open the collection when an action button is clicked', () => {
    const onOpen = vi.fn()
    const onMove = vi.fn()
    render(<CollectionCard collection={makeCollectionSummary()} onOpen={onOpen} onMove={onMove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move Skull comparison to a category' }))
    expect(onMove).toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('keeps the type icon beside the title with curatorial actions pinned top-right (#1567)', () => {
    const collection = makeCollectionSummary({
      permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: true },
    })
    render(<CollectionCard collection={collection} onOpen={vi.fn()} onMove={vi.fn()} />)
    // The top-left type/owner overlay is gone — the title row carries the
    // type glyph (before the name), actions stay in the top-right overlay.
    expect(screen.queryByTestId('collection-type-overlay')).not.toBeInTheDocument()
    const right = screen.getByTestId('collection-actions-overlay')
    expect(within(right).getByRole('button', { name: /Move .* to a category/ })).toBeInTheDocument()
    const titleRow = screen.getByText('Skull comparison').parentElement as HTMLElement
    const icon = within(titleRow).getByRole('img', { name: 'Synchronized' })
    const title = screen.getByText('Skull comparison')
    expect(icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows a hidden indicator and desaturated treatment on hidden collections (#1559)', () => {
    render(<CollectionCard collection={makeCollectionSummary({ hidden: true })} onOpen={vi.fn()} />)
    expect(screen.getByRole('img', { name: 'Visibility: Hidden' })).toBeInTheDocument()
  })

  it('omits the hidden indicator on visible collections', () => {
    render(<CollectionCard collection={makeCollectionSummary()} onOpen={vi.fn()} />)
    expect(screen.queryByRole('img', { name: 'Visibility: Hidden' })).not.toBeInTheDocument()
  })

  it('desaturates a category-hidden collection without a marker icon', () => {
    render(<CollectionCard collection={makeCollectionSummary()} onOpen={vi.fn()} categoryHidden />)
    // Desaturation alone conveys the inherited state — the eye-off marker
    // is reserved for the collection's own hidden flag (ImageTile rule).
    expect(screen.getByTestId('collection-card-action-area')).toHaveStyle({
      filter: 'grayscale(100%)',
    })
    expect(screen.queryByRole('img', { name: 'Hidden by category' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Visibility: Hidden' })).not.toBeInTheDocument()
  })

  it('keeps the own-hidden marker when the collection is also category-hidden', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({ hidden: true })}
        onOpen={vi.fn()}
        categoryHidden
      />,
    )
    expect(screen.getByRole('img', { name: 'Visibility: Hidden' })).toBeInTheDocument()
  })

  it('renders own restriction chips solid and inherited scope dimmed (#1567)', () => {
    const programs = [
      { id: 1, name: 'Radiography' },
      { id: 2, name: 'Dental' },
    ]
    const groups = [
      { id: 5, name: 'Cohort A' },
      { id: 6, name: 'Cohort B' },
    ]
    render(
      <CollectionCard
        collection={makeCollectionSummary({
          visibility: 'restricted',
          programIds: [1],
          groupIds: [5],
        })}
        onOpen={vi.fn()}
        programs={programs}
        groups={groups}
        inheritedProgramIds={[2]}
        inheritedGroupIds={[6]}
      />,
    )
    const chips = screen.getAllByTestId('program-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['Radiography', 'Dental'])
    // Inherited scope renders at the shared 0.6 opacity (#1567).
    expect(chips[1]).toHaveStyle({ opacity: 0.6 })
    const groupChips = screen.getAllByTestId('group-chip')
    expect(groupChips.map((c) => c.textContent)).toEqual(['Cohort A', 'Cohort B'])
    expect(groupChips[1]).toHaveStyle({ opacity: 0.6 })
  })

  it('renders no restriction chips for non-restricted or unrestricted-scope collections', () => {
    render(
      <CollectionCard
        collection={makeCollectionSummary({ visibility: 'public', programIds: [1] })}
        onOpen={vi.fn()}
        programs={[{ id: 1, name: 'Radiography' }]}
      />,
    )
    expect(screen.queryByTestId('program-chip')).not.toBeInTheDocument()
  })

  it('falls back to id labels when lookups are unavailable (#1567)', () => {
    // Students/staff never load the groups list — the chips must still render
    // (the detail header's `Group {id}` fallback convention) rather than
    // silently dropping the restriction.
    render(
      <CollectionCard
        collection={makeCollectionSummary({
          visibility: 'restricted',
          programIds: [7],
          groupIds: [9],
        })}
        onOpen={vi.fn()}
        programs={[]}
        groups={[]}
      />,
    )
    expect(screen.getByTestId('program-chip')).toHaveTextContent('Program 7')
    expect(screen.getByTestId('group-chip')).toHaveTextContent('Group 9')
  })
})

describe('CollectionVisibilityChip', () => {
  it.each([
    ['private', 'Private'],
    ['public', 'Public'],
  ] as const)('labels %s as %s', (visibility, label) => {
    render(<CollectionVisibilityChip visibility={visibility} />)
    expect(screen.getByTestId('collection-visibility-chip')).toHaveTextContent(label)
  })

  it('renders no pill for restricted when scope chips carry it (#1567)', () => {
    const { container } = render(<CollectionVisibilityChip visibility="restricted" hasScopeChips />)
    expect(container).toBeEmptyDOMElement()
  })

  it('still labels an unscoped restricted collection (#1567)', () => {
    // A restricted collection with no program/group ids has no scope chips
    // to carry the restriction — the pill must not leave it label-less.
    render(<CollectionVisibilityChip visibility="restricted" />)
    expect(screen.getByTestId('collection-visibility-chip')).toHaveTextContent('Restricted')
  })

  it.each(['private', 'public'] as const)(
    'sizes the %s icon at the 14px convention (#1567)',
    (v) => {
      render(<CollectionVisibilityChip visibility={v} />)
      // `.MuiChip-icon` owns the icon size — the chip-level sx sets it to the
      // 14px lock convention used beside category titles.
      const icon = screen.getByTestId('collection-visibility-chip').querySelector('.MuiChip-icon')
      expect(icon).not.toBeNull()
      expect(getComputedStyle(icon as Element).fontSize).toBe('14px')
    },
  )
})

describe('CollectionTypeChip / CollectionTypeIcon', () => {
  it.each(['sequence', 'synchronized'] as const)('labels the %s chip and icon', (type) => {
    const label = type === 'sequence' ? 'Sequence' : 'Synchronized'
    render(
      <>
        <CollectionTypeChip type={type} />
        <CollectionTypeIcon type={type} />
      </>,
    )
    const chip = screen.getByTestId('collection-type-chip')
    expect(chip).toHaveTextContent(label)
    // The shared pill is the red primary outline with its icon.
    expect(chip).toHaveClass('MuiChip-outlined')
    expect(chip.querySelector('.MuiChip-icon')).not.toBeNull()
    // The standalone glyph uses the role="img" informational convention —
    // the chip's own icon stays decorative (the label text names it).
    expect(screen.getByRole('img', { name: label })).toBeInTheDocument()
    expect(chip.querySelector('[role="img"]')).toBeNull()
  })

  it('merges an sx override onto the chip', () => {
    render(<CollectionTypeChip type="sequence" sx={{ opacity: 0.5 }} />)
    expect(screen.getByTestId('collection-type-chip')).toHaveStyle({ opacity: '0.5' })
  })
})
