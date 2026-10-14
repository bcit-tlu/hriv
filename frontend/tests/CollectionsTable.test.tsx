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

/** The controlled sort/paging props the page's data hook supplies (#1631). */
const defaultPaging = {
  sortKey: 'updated' as const,
  sortDir: 'desc' as const,
  onSortChange: vi.fn(),
  page: 0,
  rowsPerPage: 25,
  total: 0,
  onPageChange: vi.fn(),
  onRowsPerPageChange: vi.fn(),
}

function renderTable(
  collections: CollectionSummary[],
  onOpen = vi.fn(),
  paging: Partial<typeof defaultPaging> = {},
) {
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
      {...defaultPaging}
      {...paging}
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

  it('renders the name as plain text and opens the collection on row click', () => {
    const onOpen = vi.fn()
    renderTable([row({ id: 5, name: 'Skull comparison' })], onOpen)
    // Plain text like the Manage Images Name cell — no centred button text on wrap.
    expect(screen.queryByRole('button', { name: 'Skull comparison' })).toBeNull()
    fireEvent.click(screen.getByText('Skull comparison'))
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

  it('renders rows in the order given — sorting is server-side (#1631)', () => {
    renderTable([
      row({ id: 1, name: 'Old', updatedAt: '2026-01-01T00:00:00Z' }),
      row({ id: 2, name: 'New', updatedAt: '2026-01-10T00:00:00Z' }),
      row({ id: 3, name: 'Mid', updatedAt: '2026-01-05T00:00:00Z' }),
    ])
    const names = () => screen.getAllByTestId(/collections-table-row-/).map((r) => r.dataset.testid)
    // No client-side sort: the server-picked page order is the render order.
    expect(names()).toEqual([
      'collections-table-row-1',
      'collections-table-row-2',
      'collections-table-row-3',
    ])
  })

  it('reports controlled sort changes: same key flips, new key opens on its default', () => {
    const onSortChange = vi.fn()
    renderTable([row({ id: 1 })], vi.fn(), {
      sortKey: 'name',
      sortDir: 'asc',
      onSortChange,
    })
    // Clicking the active key flips its direction.
    fireEvent.click(screen.getByText('Name'))
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'desc')
    // IDs/counts/timestamps open descending, text columns ascending.
    fireEvent.click(screen.getByText('Updated'))
    expect(onSortChange).toHaveBeenLastCalledWith('updated', 'desc')
    fireEvent.click(screen.getByText('Type'))
    expect(onSortChange).toHaveBeenLastCalledWith('type', 'asc')
  })

  it('renders every supplied row — the server slices pages (#1631)', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({ id: i + 1, name: `C${i + 1}` }))
    renderTable(rows, vi.fn(), { rowsPerPage: 5, total: 12 })
    expect(screen.getAllByTestId(/collections-table-row-/)).toHaveLength(7)
    // The footer counts the server total, not the rendered rows.
    expect(screen.getByText(/of 12/)).toBeInTheDocument()
  })

  it('forwards page and rows-per-page changes to the parent (#1631)', () => {
    const onPageChange = vi.fn()
    const onRowsPerPageChange = vi.fn()
    renderTable([row({ id: 1 })], vi.fn(), {
      page: 0,
      rowsPerPage: 5,
      total: 30,
      onPageChange,
      onRowsPerPageChange,
    })
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(onPageChange).toHaveBeenCalledWith(1)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /rows per page/i }))
    fireEvent.click(screen.getByRole('option', { name: '10' }))
    expect(onRowsPerPageChange).toHaveBeenCalledWith(10)
  })

  it('renders only the requested columns, in order', () => {
    const { container } = render(
      <CollectionsTable
        collections={[row({ id: 1 })]}
        categoryPaths={buildCategoryPaths([])}
        currentUser={USER}
        onOpenCollection={vi.fn()}
        {...defaultPaging}
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
        {...defaultPaging}
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

  it('requests ID descending on first click (#1631)', () => {
    const onSortChange = vi.fn()
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
        {...defaultPaging}
        onSortChange={onSortChange}
        columns={['id', 'name']}
      />,
    )
    fireEvent.click(screen.getByText('ID'))
    expect(onSortChange).toHaveBeenCalledWith('id', 'desc')
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
          {...defaultPaging}
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
          {...defaultPaging}
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
          {...defaultPaging}
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
          {...defaultPaging}
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
          {...defaultPaging}
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
          {...defaultPaging}
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
          {...defaultPaging}
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
          {...defaultPaging}
          columns={['name']}
        />,
      )
      expect(screen.queryByRole('checkbox')).toBeNull()
    })

    it('keeps Programs and Groups headers unsortable (#1631)', () => {
      const onSortChange = vi.fn()
      const { container } = render(
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
          {...defaultPaging}
          onSortChange={onSortChange}
          programs={[
            { id: 5, name: 'Anatomy', oidc_group: null, created_at: '', updated_at: '' },
            { id: 9, name: 'Zoology', oidc_group: null, created_at: '', updated_at: '' },
          ]}
          columns={['name', 'programs', 'groups']}
        />,
      )
      // Neither column has a server-side sort key — plain header cells.
      for (const label of ['Programs', 'Groups']) {
        const th = [...container.querySelectorAll('th')].find((el) => el.textContent === label)!
        expect(th.querySelector('.MuiTableSortLabel-root')).toBeNull()
      }
      fireEvent.click(screen.getByText('Programs'))
      fireEvent.click(screen.getByText('Groups'))
      expect(onSortChange).not.toHaveBeenCalled()
      // Row order stays as supplied.
      expect(screen.getAllByTestId(/collections-table-row-/).map((r) => r.dataset.testid)).toEqual([
        'collections-table-row-1',
        'collections-table-row-2',
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
          {...defaultPaging}
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
