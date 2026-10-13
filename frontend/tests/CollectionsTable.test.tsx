import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CollectionsTable from '../src/components/CollectionsTable'
import { buildCategoryPaths } from '../src/components/CategoryBreadcrumb'
import { makeCategory, makeCollectionSummary } from './helpers/fixtures'
import type { CollectionSummary, User } from '../src/types'

const USER: User = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'instructor',
  active: true,
  program_ids: [],
  program_names: [],
  group_ids: [],
  group_names: [],
}

function row(n: Partial<CollectionSummary>): CollectionSummary {
  return makeCollectionSummary(n)
}

function renderTable(collections: CollectionSummary[], onOpen = vi.fn()) {
  const utils = render(
    <CollectionsTable
      collections={collections}
      categoryPaths={buildCategoryPaths([
        makeCategory({
          id: 1,
          label: 'Italian',
          children: [makeCategory({ id: 2, label: 'Gothic', parentId: 1 })],
        }),
      ])}
      currentUser={USER}
      onOpenCollection={onOpen}
    />,
  )
  return { ...utils, onOpen }
}

describe('CollectionsTable', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders name/type/category/owner/updated columns', () => {
    renderTable([
      row({ id: 1, name: 'Skull comparison', categoryId: 2, updatedAt: '2026-01-02T00:00:00Z' }),
      row({ id: 2, name: 'Pelvis set', categoryId: null }),
    ])
    expect(screen.getByText('Skull comparison')).toBeInTheDocument()
    expect(screen.getByText('Pelvis set')).toBeInTheDocument()
    // Category breadcrumb segments as links, '—' when categoryId is null.
    expect(screen.getByRole('button', { name: 'Italian' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gothic' })).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('opens the collection from the name link and from row click', () => {
    const onOpen = vi.fn()
    renderTable([row({ id: 5, name: 'Skull comparison' })], onOpen)
    fireEvent.click(screen.getByRole('button', { name: 'Skull comparison' }))
    expect(onOpen).toHaveBeenCalledWith(5)
    onOpen.mockClear()
    fireEvent.click(screen.getByTestId('collections-table-row-5'))
    expect(onOpen).toHaveBeenCalledWith(5)
  })

  it('shows the "You" chip when the current user owns the collection', () => {
    renderTable([
      row({ id: 1, name: 'Mine', owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }] }),
      row({ id: 2, name: 'Theirs', owners: [{ kind: 'user', userId: 9, name: 'Grace' }] }),
    ])
    const mine = screen.getByTestId('collections-table-row-1')
    const theirs = screen.getByTestId('collections-table-row-2')
    expect(within(mine).getByTestId('collections-table-you-chip')).toBeInTheDocument()
    expect(within(theirs).queryByTestId('collections-table-you-chip')).not.toBeInTheDocument()
  })

  it('sorts by Updated descending by default and toggles on header click', () => {
    renderTable([
      row({ id: 1, name: 'Old', updatedAt: '2026-01-01T00:00:00Z' }),
      row({ id: 2, name: 'New', updatedAt: '2026-01-10T00:00:00Z' }),
      row({ id: 3, name: 'Mid', updatedAt: '2026-01-05T00:00:00Z' }),
    ])
    const names = () => screen.getAllByTestId(/collections-table-row-/).map((r) => r.dataset.testid)
    expect(names()).toEqual([
      'collections-table-row-2',
      'collections-table-row-3',
      'collections-table-row-1',
    ])

    // Name header click sorts ascending.
    fireEvent.click(screen.getByText('Name'))
    expect(names()).toEqual([
      'collections-table-row-3',
      'collections-table-row-2',
      'collections-table-row-1',
    ])
    // Second click flips to descending.
    fireEvent.click(screen.getByText('Name'))
    expect(names()).toEqual([
      'collections-table-row-1',
      'collections-table-row-2',
      'collections-table-row-3',
    ])
  })

  it('paginates with the rows-per-page preference', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 7 }))
    localStorage.setItem('hrivpref:rows-per-page:collections:user:7', '5')
    const rows = Array.from({ length: 7 }, (_, i) => row({ id: i + 1, name: `C${i + 1}` }))
    renderTable(rows)
    expect(screen.getAllByTestId(/collections-table-row-/)).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getAllByTestId(/collections-table-row-/)).toHaveLength(2)
  })

  it('clamps the page when filters shrink the list (#1636 review)', () => {
    localStorage.setItem('hriv_user', JSON.stringify({ id: 7 }))
    localStorage.setItem('hrivpref:rows-per-page:collections:user:7', '5')
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => row({ id: i + 1, name: `C${i + 1}` }))
    const ui = (collections: CollectionSummary[]) => (
      <CollectionsTable
        collections={collections}
        categoryPaths={buildCategoryPaths([])}
        currentUser={USER}
        onOpenCollection={vi.fn()}
      />
    )
    const { rerender } = render(ui(rows(7)))
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getAllByTestId(/collections-table-row-/)).toHaveLength(2)

    // The shared filter shrinks the list while on page 2 — the stale page
    // must not leave the table empty.
    rerender(ui(rows(3)))
    expect(screen.getAllByTestId(/collections-table-row-/)).toHaveLength(3)
  })

  it('renders only the requested columns, in order', () => {
    const { container } = render(
      <CollectionsTable
        collections={[row({ id: 1 })]}
        categoryPaths={buildCategoryPaths([])}
        currentUser={USER}
        onOpenCollection={vi.fn()}
        columns={['name', 'id']}
      />,
    )
    const headers = container.querySelectorAll('th')
    expect([...headers].map((h) => h.textContent)).toEqual(['Name', 'ID'])
    // No cover/type/owner cells either.
    expect(screen.queryByText('Type')).not.toBeInTheDocument()
  })

  it('renders the scope chip, description, programs/groups and created columns', () => {
    render(
      <CollectionsTable
        collections={[
          row({
            id: 1,
            name: 'Scoped',
            visibility: 'restricted',
            programIds: [3],
            groupIds: [4],
            description: 'A long description',
            createdAt: '2026-01-01T00:00:00Z',
          }),
        ]}
        categoryPaths={buildCategoryPaths([])}
        currentUser={USER}
        onOpenCollection={vi.fn()}
        columns={['name', 'scope', 'description', 'programs', 'groups', 'created']}
        programs={[
          {
            id: 3,
            name: 'Radiography',
            oidc_group: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]}
        groups={[
          {
            id: 4,
            name: 'Cohort A',
            description: null,
            createdByUserId: null,
            memberIds: [],
            instructorIds: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ]}
      />,
    )
    // The scope pill still labels a scoped restricted collection (the table
    // renders no program/group chips beside it).
    expect(screen.getByTestId('collection-visibility-chip')).toHaveTextContent('Restricted')
    expect(screen.getByText('A long description')).toBeInTheDocument()
    expect(screen.getByText('Radiography')).toBeInTheDocument()
    expect(screen.getByText('Cohort A')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
  })

  it('sorts by ID descending on first click', () => {
    render(
      <CollectionsTable
        collections={[
          row({ id: 1, name: 'A' }),
          row({ id: 9, name: 'B' }),
          row({ id: 5, name: 'C' }),
        ]}
        categoryPaths={buildCategoryPaths([])}
        currentUser={USER}
        onOpenCollection={vi.fn()}
        columns={['id', 'name']}
      />,
    )
    const names = () => screen.getAllByTestId(/collections-table-row-/).map((r) => r.dataset.testid)
    fireEvent.click(screen.getByText('ID'))
    expect(names()).toEqual([
      'collections-table-row-9',
      'collections-table-row-5',
      'collections-table-row-1',
    ])
    fireEvent.click(screen.getByText('ID'))
    expect(names()).toEqual([
      'collections-table-row-1',
      'collections-table-row-5',
      'collections-table-row-9',
    ])
  })

  describe('merged Manage features', () => {
    const CATS = buildCategoryPaths([
      makeCategory({ id: 10, label: 'Anatomy', status: 'hidden' }),
      makeCategory({ id: 11, label: 'Histology' }),
    ])
    const ADMIN: User = { ...USER, id: 1, role: 'admin' }
    const STAFF: User = { ...USER, id: 4, role: 'staff' }
    const perms = (over: Partial<CollectionSummary['permissions']> = {}) => ({
      canEdit: false,
      canDelete: false,
      canChangeScope: false,
      canTransfer: false,
      canHide: false,
      ...over,
    })

    it('dims own-hidden rows with the eye-off marker and category-hidden rows without it', () => {
      render(
        <CollectionsTable
          collections={[
            row({ id: 1, name: 'Own hidden', hidden: true, categoryId: 11 }),
            row({ id: 2, name: 'Cat hidden', categoryId: 10 }),
            row({ id: 3, name: 'Plain', categoryId: 11 }),
          ]}
          categoryPaths={CATS}
          currentUser={ADMIN}
          onOpenCollection={vi.fn()}
          columns={['name', 'type', 'category']}
        />,
      )
      const own = screen.getByTestId('collections-table-row-1')
      expect(own.querySelector('td[data-dimmed]')).not.toBeNull()
      expect(within(own).getByRole('img', { name: 'Visibility: Hidden' })).toBeInTheDocument()
      const cat = screen.getByTestId('collections-table-row-2')
      expect(cat.querySelector('td[data-dimmed]')).not.toBeNull()
      expect(within(cat).queryByRole('img', { name: 'Visibility: Hidden' })).toBeNull()
      expect(
        screen.getByTestId('collections-table-row-3').querySelector('td[data-dimmed]'),
      ).toBeNull()
    })

    it('toggles hidden through the Visibility switch, locked by category or canHide', async () => {
      const onToggleHidden = vi.fn().mockResolvedValue(undefined)
      render(
        <CollectionsTable
          collections={[
            row({ id: 1, name: 'Hideable', categoryId: 11, permissions: perms({ canHide: true }) }),
            row({
              id: 2,
              name: 'Cat hidden',
              categoryId: 10,
              permissions: perms({ canHide: true }),
            }),
            row({ id: 3, name: 'No perm', categoryId: 11, permissions: perms() }),
          ]}
          categoryPaths={CATS}
          currentUser={ADMIN}
          onOpenCollection={vi.fn()}
          onToggleHidden={onToggleHidden}
          columns={['name', 'visibility']}
        />,
      )
      expect(screen.getByRole('switch', { name: 'Visibility for Cat hidden' })).toBeDisabled()
      expect(screen.getByRole('switch', { name: 'Visibility for No perm' })).toBeDisabled()
      fireEvent.click(screen.getByRole('switch', { name: 'Visibility for Hideable' }))
      await waitFor(() =>
        expect(onToggleHidden).toHaveBeenCalledWith(expect.objectContaining({ id: 1 })),
      )
    })

    it('reports a failed toggle through onError', async () => {
      const onError = vi.fn()
      render(
        <CollectionsTable
          collections={[row({ id: 1, name: 'Hideable', permissions: perms({ canHide: true }) })]}
          categoryPaths={CATS}
          currentUser={ADMIN}
          onOpenCollection={vi.fn()}
          onToggleHidden={vi.fn().mockRejectedValue(new Error('nope'))}
          onError={onError}
          columns={['name', 'visibility']}
        />,
      )
      fireEvent.click(screen.getByRole('switch', { name: 'Visibility for Hideable' }))
      await waitFor(() => expect(onError).toHaveBeenCalled())
    })

    it('gates row-menu Edit and Manage owners on permissions; row click opens', () => {
      const onEdit = vi.fn()
      const onManageOwners = vi.fn()
      const onOpen = vi.fn()
      const { rerender } = render(
        <CollectionsTable
          collections={[
            row({ id: 1, name: 'Owned', permissions: perms({ canEdit: true, canTransfer: true }) }),
            row({ id: 2, name: 'Read only', permissions: perms() }),
          ]}
          categoryPaths={CATS}
          currentUser={STAFF}
          onOpenCollection={onOpen}
          onEdit={onEdit}
          onManageOwners={onManageOwners}
          columns={['name']}
        />,
      )
      fireEvent.click(screen.getByTestId('collections-table-row-2'))
      expect(onOpen).toHaveBeenCalledWith(2)
      expect(onEdit).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Actions for Read only' }))
      expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: 'Manage owners' })).toBeNull()
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

      fireEvent.click(screen.getByRole('button', { name: 'Actions for Owned' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Manage owners' }))
      expect(onManageOwners).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))

      // Curators can categorize any row, so Edit shows even without canEdit.
      rerender(
        <CollectionsTable
          collections={[row({ id: 2, name: 'Read only', permissions: perms() })]}
          categoryPaths={CATS}
          currentUser={USER}
          onOpenCollection={onOpen}
          onEdit={onEdit}
          columns={['name']}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Actions for Read only' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    })

    it('limits non-curator selection to deletable rows and selects the page', () => {
      const onSelectedChange = vi.fn()
      render(
        <CollectionsTable
          collections={[
            row({ id: 1, name: 'Mine', permissions: perms({ canDelete: true }) }),
            row({ id: 2, name: 'Theirs', permissions: perms() }),
          ]}
          categoryPaths={CATS}
          currentUser={STAFF}
          onOpenCollection={vi.fn()}
          selected={new Set()}
          onSelectedChange={onSelectedChange}
          columns={['name']}
        />,
      )
      expect(screen.getByRole('checkbox', { name: 'Select Mine' })).toBeEnabled()
      expect(screen.getByRole('checkbox', { name: 'Select Theirs' })).toBeDisabled()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all collections on this page' }))
      expect(onSelectedChange).toHaveBeenCalledWith(new Set([1]))
    })

    it('shows no selection column when nothing is selectable or selection is unwired', () => {
      const { rerender } = render(
        <CollectionsTable
          collections={[row({ id: 2, name: 'Theirs', permissions: perms() })]}
          categoryPaths={CATS}
          currentUser={STAFF}
          onOpenCollection={vi.fn()}
          onSelectedChange={vi.fn()}
          columns={['name']}
        />,
      )
      expect(screen.queryByRole('checkbox')).toBeNull()
      rerender(
        <CollectionsTable
          collections={[row({ id: 2, name: 'Theirs', permissions: perms() })]}
          categoryPaths={CATS}
          currentUser={ADMIN}
          onOpenCollection={vi.fn()}
          columns={['name']}
        />,
      )
      expect(screen.queryByRole('checkbox')).toBeNull()
    })

    it('sorts Programs by the displayed own + inherited scope', () => {
      render(
        <CollectionsTable
          collections={[
            row({ id: 1, name: 'Zed own', visibility: 'restricted', programIds: [9] }),
            row({ id: 2, name: 'Inherited only', categoryId: 12 }),
          ]}
          categoryPaths={buildCategoryPaths([
            makeCategory({ id: 12, label: 'Rad', programIds: [5] }),
          ])}
          currentUser={ADMIN}
          onOpenCollection={vi.fn()}
          programs={[
            { id: 5, name: 'Anatomy', oidc_group: null, created_at: '', updated_at: '' },
            { id: 9, name: 'Zoology', oidc_group: null, created_at: '', updated_at: '' },
          ]}
          columns={['name', 'programs']}
        />,
      )
      fireEvent.click(screen.getByText('Programs'))
      expect(screen.getAllByTestId(/collections-table-row-/).map((r) => r.dataset.testid)).toEqual([
        'collections-table-row-2',
        'collections-table-row-1',
      ])
    })

    it('renders own scope chips and inherited category chips', () => {
      render(
        <CollectionsTable
          collections={[
            row({
              id: 1,
              name: 'Scoped',
              visibility: 'restricted',
              programIds: [3],
              categoryId: 12,
            }),
          ]}
          categoryPaths={buildCategoryPaths([
            makeCategory({ id: 12, label: 'Rad', programIds: [5] }),
          ])}
          currentUser={ADMIN}
          onOpenCollection={vi.fn()}
          columns={['name', 'programs']}
        />,
      )
      expect(screen.getAllByTestId('program-chip').map((c) => c.textContent)).toEqual([
        'Program 3',
        'Program 5',
      ])
    })
  })
})
