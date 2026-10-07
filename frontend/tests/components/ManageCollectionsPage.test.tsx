import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchCollections: vi.fn(),
    fetchCollection: vi.fn(),
    createCollection: vi.fn(),
    updateCollection: vi.fn(),
    deleteCollection: vi.fn(),
    replaceCollectionOwners: vi.fn(),
    transferCollection: vi.fn(),
  }
})

import {
  fetchCollections,
  fetchCollection,
  updateCollection,
  deleteCollection,
} from '../../src/api'
import { AuthContext } from '../../src/authContextValue'
import type { AuthContextValue } from '../../src/authContextValue'
import type { User } from '../../src/types'
import ManageCollectionsPage from '../../src/components/ManageCollectionsPage'
import type { ManageCollectionsPageProps } from '../../src/components/ManageCollectionsPage'
import { makeApiCollection, makeApiCollectionSummary, makeCategory } from '../helpers/fixtures'
import { resetCategoryTreeExpansionPreferencesForTests } from '../../src/useCategoryTreeExpansionPreferences'

const ADMIN: User = {
  id: 1,
  name: 'Admin',
  email: 'admin@example.ca',
  role: 'admin',
  active: true,
  program_ids: [],
  program_names: [],
  group_ids: [],
  group_names: [],
} as unknown as User

const STAFF: User = { ...ADMIN, id: 4, name: 'Staff', role: 'staff' } as unknown as User
const STUDENT: User = { ...ADMIN, id: 5, name: 'Student', role: 'student' } as unknown as User
const INSTRUCTOR: User = {
  ...ADMIN,
  id: 6,
  name: 'Instructor',
  role: 'instructor',
} as unknown as User

function makeAuth(user: User): AuthContextValue {
  return {
    currentUser: user,
    users: [],
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    addUser: vi.fn(),
    deleteUser: vi.fn(),
    refreshUsers: vi.fn(),
    canManageUsers: user.role === 'admin',
    canEditContent: user.role === 'admin' || user.role === 'instructor',
    canViewPeople: user.role !== 'student',
    oidcError: null,
    clearOidcError: vi.fn(),
  } as unknown as AuthContextValue
}

const CATEGORIES = [
  makeCategory({ id: 10, label: 'Anatomy' }),
  makeCategory({ id: 11, label: 'Histology' }),
]

function makeProps(
  overrides: Partial<ManageCollectionsPageProps> = {},
): ManageCollectionsPageProps {
  return {
    categories: CATEGORIES,
    programs: [],
    groups: [],
    currentUser: ADMIN,
    onOpenCollection: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
}

function renderPage(overrides: Partial<ManageCollectionsPageProps> = {}) {
  const props = makeProps(overrides)
  const utils = render(
    <AuthContext.Provider value={makeAuth(props.currentUser ?? ADMIN)}>
      <ManageCollectionsPage {...props} />
    </AuthContext.Provider>,
  )
  return { ...utils, props }
}

/** Seeds the per-user column map to show every column — the tests never
 *  write `hriv_user`, so the scope resolves to `anonymous` (#1567). */
function showAllColumns() {
  localStorage.setItem(
    'hrivpref:table-columns:manage-collections:user:anonymous',
    JSON.stringify({
      cover: true,
      id: true,
      name: true,
      type: true,
      scope: true,
      owners: true,
      images: true,
      programs: true,
      groups: true,
      category: true,
      visibility: true,
      created_at: true,
      updated_at: true,
    }),
  )
}

describe('ManageCollectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    resetCategoryTreeExpansionPreferencesForTests()
    vi.mocked(fetchCollections).mockResolvedValue([])
    vi.mocked(fetchCollection).mockResolvedValue(makeApiCollection())
  })

  it('fetches every visible collection without API filters', async () => {
    renderPage()
    await waitFor(() => expect(fetchCollections).toHaveBeenCalledWith({}))
    expect(await screen.findByTestId('manage-collections-table')).toBeInTheDocument()
  })

  it('renders rows with type, visibility, owners, image count, and category', async () => {
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 1,
        name: 'Skull comparison',
        type: 'synchronized',
        visibility: 'public',
        hidden: false,
        image_count: 2,
        category_id: 10,
      }),
      makeApiCollectionSummary({
        id: 2,
        name: 'Epithelium tour',
        type: 'sequence',
        visibility: 'restricted',
        hidden: false,
        image_count: 9,
        category_id: null,
      }),
    ])
    // Owners, scope, image count, and Programs are opt-in columns — the
    // default set mirrors the Manage Images table's lean six (#1567).
    showAllColumns()
    renderPage()
    const row = await screen.findByTestId('manage-collection-row-1')
    expect(within(row).getByText('Skull comparison')).toBeInTheDocument()
    expect(within(row).getByText('Synchronized')).toBeInTheDocument()
    expect(within(row).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(row).getByText('Anatomy')).toBeInTheDocument()
    const root = screen.getByTestId('manage-collection-row-2')
    // Restricted visibility renders no pill — program/group chips carry the
    // restriction (#1567); this unscoped row's cells stay '—'.
    expect(within(root).queryByText('Restricted')).not.toBeInTheDocument()
    expect(within(root).getByText('9')).toBeInTheDocument()
    // Unrestricted + unfiled row: Programs, Groups, and Category all '—'.
    expect(within(root).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows the empty state when nothing matches and the API error on failure', async () => {
    renderPage()
    expect(await screen.findByText('No collections yet.')).toBeInTheDocument()

    vi.mocked(fetchCollections).mockRejectedValue(new Error('nope'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load collections.')
  })

  it('filters rows by the name facet', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Skull comparison' }),
      makeApiCollectionSummary({ id: 2, name: 'Epithelium tour' }),
    ])
    renderPage()
    await screen.findByTestId('manage-collection-row-2')

    // 'Name' also matches the column sort header — scope to the filter bar.
    const filterBar = screen.getByLabelText('Filter by')
    await user.click(within(filterBar).getByRole('button', { name: 'Name' }))
    await user.type(screen.getByLabelText('Filter collections by name'), 'epith')
    await waitFor(() => {
      expect(screen.queryByTestId('manage-collection-row-1')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('manage-collection-row-2')).toBeInTheDocument()
  })

  it('filters rows by the type facet', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Sync one', type: 'synchronized' }),
      makeApiCollectionSummary({ id: 2, name: 'Seq one', type: 'sequence' }),
    ])
    renderPage()
    await screen.findByTestId('manage-collection-row-2')

    const filterBar = screen.getByLabelText('Filter by')
    await user.click(within(filterBar).getByRole('button', { name: 'Type' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Sequence' }))
    await waitFor(() => {
      expect(screen.queryByTestId('manage-collection-row-1')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('manage-collection-row-2')).toBeInTheDocument()
  })

  it('filters rows by ancestor categories like the Images table', async () => {
    const user = userEvent.setup()
    const nested = [
      makeCategory({
        id: 10,
        label: 'Anatomy',
        children: [makeCategory({ id: 20, label: 'Skeletal', parentId: 10 })],
      }),
      makeCategory({ id: 11, label: 'Histology' }),
    ]
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Nested', category_id: 20 }),
      makeApiCollectionSummary({ id: 2, name: 'Other', category_id: 11 }),
    ])
    renderPage({ categories: nested })
    await screen.findByTestId('manage-collection-row-2')

    const filterBar = screen.getByLabelText('Filter by')
    await user.click(within(filterBar).getByRole('button', { name: 'Category' }))
    // Selecting the parent matches collections filed under its descendants.
    await user.click(screen.getAllByRole('menuitemcheckbox', { name: /Anatomy/ })[0])
    await waitFor(() => {
      expect(screen.queryByTestId('manage-collection-row-2')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('manage-collection-row-1')).toBeInTheDocument()
  })

  it('sorts rows when a column header is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Beta' }),
      makeApiCollectionSummary({ id: 2, name: 'Alpha' }),
    ])
    renderPage()
    await screen.findByTestId('manage-collection-row-2')

    const table = screen.getByTestId('manage-collections-table')
    await user.click(within(table).getByRole('button', { name: 'Name' }))
    const rows = screen
      .getAllByTestId(/^manage-collection-row-/)
      .map((r) => r.getAttribute('data-testid'))
    expect(rows).toEqual(['manage-collection-row-2', 'manage-collection-row-1'])
  })

  it('opens the edit dialog on row click for editable rows', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Mine' }),
    ])
    vi.mocked(fetchCollection).mockResolvedValue(makeApiCollection({ id: 1, name: 'Mine' }))
    renderPage()
    await user.click(await screen.findByText('Mine'))
    await waitFor(() => expect(fetchCollection).toHaveBeenCalledWith(1))
    expect(await screen.findByText('Edit Collection')).toBeInTheDocument()
  })

  it('opens the collection view on row click for read-only rows', async () => {
    const user = userEvent.setup()
    const onOpenCollection = vi.fn()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 1,
        name: 'Theirs',
        permissions: {
          can_edit: false,
          can_delete: false,
          can_change_scope: false,
          can_transfer: false,
          can_hide: false,
        },
      }),
    ])
    // Staff can't file, so a read-only row is truly read-only for them.
    renderPage({ onOpenCollection, currentUser: STAFF })
    await user.click(await screen.findByText('Theirs'))
    expect(onOpenCollection).toHaveBeenCalledWith(1)
    expect(fetchCollection).not.toHaveBeenCalled()
  })

  it('opens the filing-mode edit dialog for curators on rows they cannot edit (#1567)', async () => {
    const user = userEvent.setup()
    const onOpenCollection = vi.fn()
    const readOnly = {
      can_edit: false,
      can_delete: false,
      can_change_scope: false,
      can_transfer: false,
      can_hide: false,
    }
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Theirs', permissions: readOnly }),
    ])
    vi.mocked(fetchCollection).mockResolvedValue(
      makeApiCollection({ id: 1, name: 'Theirs', category_id: 10, permissions: readOnly }),
    )
    // Instructors can't edit this row but hold filing authority — the
    // category picker inside the edit dialog is their filing path.
    renderPage({ onOpenCollection, currentUser: INSTRUCTOR })
    await user.click(await screen.findByText('Theirs'))

    await waitFor(() => expect(fetchCollection).toHaveBeenCalledWith(1))
    expect(onOpenCollection).not.toHaveBeenCalled()
    expect(await screen.findByText('File Collection')).toBeInTheDocument()
    expect(screen.getByLabelText('Collection name')).toBeDisabled()
  })

  it('gates row actions on permissions and handlers', async () => {
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 1,
        name: 'Full',
        permissions: {
          can_edit: true,
          can_delete: true,
          can_change_scope: true,
          can_transfer: true,
          can_hide: false,
        },
      }),
      makeApiCollectionSummary({
        id: 2,
        name: 'Read only',
        permissions: {
          can_edit: false,
          can_delete: false,
          can_change_scope: false,
          can_transfer: false,
          can_hide: false,
        },
      }),
    ])
    renderPage()
    const user = userEvent.setup()
    const row = await screen.findByTestId('manage-collection-row-1')
    // One kebab per row — the menu carries the contextual items (#1567).
    await user.click(within(row).getByRole('button', { name: 'Actions for Full' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'View' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Manage owners' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    const readonly = screen.getByTestId('manage-collection-row-2')
    // Read-only rows still show Edit for the admin — the dialog opens in
    // filing-only mode (category picker active, metadata disabled) #1567.
    await user.click(within(readonly).getByRole('button', { name: 'Actions for Read only' }))
    const readOnlyMenu = await screen.findByRole('menu')
    expect(within(readOnlyMenu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(
      within(readOnlyMenu).queryByRole('menuitem', { name: /^Manage owners/ }),
    ).not.toBeInTheDocument()
  })

  it('shows no row actions on read-only collections for non-filing roles (#1567)', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 2,
        name: 'Read only',
        permissions: {
          can_edit: false,
          can_delete: false,
          can_change_scope: false,
          can_transfer: false,
          can_hide: false,
        },
      }),
    ])
    renderPage({ currentUser: STAFF })
    const row = await screen.findByTestId('manage-collection-row-2')
    await user.click(within(row).getByRole('button', { name: 'Actions for Read only' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'View' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /^Manage owners/ })).not.toBeInTheDocument()
  })

  // Filing moved into the Edit dialog's category picker (#1566) — the row
  // menu has no Move affordance for anyone.
  it('has no row Move action for any role (#1566)', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
    for (const currentUser of [undefined, STAFF, STUDENT]) {
      const { unmount } = renderPage(currentUser ? { currentUser } : {})
      const row = await screen.findByTestId('manage-collection-row-1')
      await user.click(within(row).getByRole('button', { name: /^Actions for/ }))
      const menu = await screen.findByRole('menu')
      expect(within(menu).queryByRole('menuitem', { name: /^Move/ })).not.toBeInTheDocument()
      unmount()
    }
  })

  it('opens the owners dialog from the row action', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 1,
        name: 'Ownable',
        permissions: {
          can_edit: true,
          can_delete: true,
          can_change_scope: true,
          can_transfer: true,
          can_hide: false,
        },
      }),
    ])
    renderPage()
    const row = await screen.findByTestId('manage-collection-row-1')
    await user.click(within(row).getByRole('button', { name: 'Actions for Ownable' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Manage owners' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Owners' })).toBeInTheDocument()
  })

  it('navigates to the collection when the thumbnail is clicked (#1567)', async () => {
    const user = userEvent.setup()
    const onOpenCollection = vi.fn()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Nav me', cover_thumb: 't.png' }),
    ])
    renderPage({ onOpenCollection })
    const thumb = (await screen.findByAltText('Nav me')).closest('td')!
    await user.click(thumb)
    expect(onOpenCollection).toHaveBeenCalledWith(1)
    expect(fetchCollection).not.toHaveBeenCalled()
  })

  it('toggles hidden via the row Visibility switch and refetches (#1567)', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 1,
        name: 'Switchable',
        hidden: false,
        version: 7,
        permissions: {
          can_edit: true,
          can_delete: true,
          can_change_scope: true,
          can_transfer: true,
          can_hide: true,
        },
      }),
    ])
    vi.mocked(updateCollection).mockResolvedValue(makeApiCollection({ id: 1, hidden: true }))
    renderPage()
    const toggle = await screen.findByRole('switch', { name: 'Visibility for Switchable' })
    await user.click(toggle)
    await waitFor(() =>
      expect(updateCollection).toHaveBeenCalledWith(1, { hidden: true, version: 7 }),
    )
    await waitFor(() => expect(fetchCollections).toHaveBeenCalledTimes(2))
  })

  it('disables the Visibility switch without canHide and greys hidden rows (#1567)', async () => {
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 1,
        name: 'Hidden one',
        hidden: true,
        permissions: {
          can_edit: true,
          can_delete: true,
          can_change_scope: true,
          can_transfer: true,
          can_hide: true,
        },
      }),
      makeApiCollectionSummary({
        id: 2,
        name: 'Locked',
        hidden: false,
        permissions: {
          can_edit: false,
          can_delete: false,
          can_change_scope: false,
          can_transfer: false,
          can_hide: false,
        },
      }),
    ])
    renderPage()
    const row = await screen.findByTestId('manage-collection-row-1')
    expect(row.querySelector('td[data-dimmed]')).not.toBeNull()
    const other = screen.getByTestId('manage-collection-row-2')
    expect(other.querySelector('td[data-dimmed]')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Visibility for Locked' })).toBeDisabled()
  })

  it('renders Programs, Groups, and Created columns with scope chips (#1567)', async () => {
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 1,
        name: 'Scoped',
        visibility: 'restricted',
        program_ids: [3],
        group_ids: [8],
        category_id: 11,
        created_at: '2026-01-05T12:00:00Z',
      }),
    ])
    showAllColumns()
    renderPage({
      programs: [
        {
          id: 3,
          name: 'Dentistry',
          oidc_group: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      groups: [
        {
          id: 8,
          name: 'Cohort A',
          description: null,
          createdByUserId: null,
          memberIds: [],
          instructorIds: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    })
    const row = await screen.findByTestId('manage-collection-row-1')
    expect(within(row).getByTestId('program-chip')).toHaveTextContent('Dentistry')
    expect(within(row).getByTestId('group-chip')).toHaveTextContent('Cohort A')
    const created = new Date('2026-01-05T12:00:00Z').toLocaleDateString()
    expect(within(row).getByText(created)).toBeInTheDocument()
  })

  it('dims a program chip inherited from the filed category (#1567)', async () => {
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 1,
        name: 'Inherited',
        visibility: 'public',
        category_id: 11,
      }),
    ])
    showAllColumns()
    renderPage({
      categories: [makeCategory({ id: 11, label: 'Histology', programIds: [3] })],
      programs: [
        {
          id: 3,
          name: 'Dentistry',
          oidc_group: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    })
    const row = await screen.findByTestId('manage-collection-row-1')
    const chip = await within(row).findByTestId('program-chip')
    expect(chip).toHaveTextContent('Dentistry')
    // Inherited chips carry the dimmed convention (0.6 opacity).
    expect(chip).toHaveStyle({ opacity: 0.6 })
  })

  it('hides and persists columns through Choose Columns (#1567)', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Persisted' }),
    ])
    const first = renderPage()
    await screen.findByTestId('manage-collection-row-1')
    await user.click(screen.getByRole('button', { name: 'Choose columns' }))
    const dialog = await screen.findByRole('dialog')
    // 'Type' is a default-visible column; opt-in columns (Owners, Programs,
    // …) exercise the opposite direction.
    await user.click(within(dialog).getByRole('checkbox', { name: 'Type' }))
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    const table = screen.getByTestId('manage-collections-table')
    expect(within(table).queryByText('Type')).not.toBeInTheDocument()

    // A second mount reads the persisted preference — same mechanism as
    // ManagePage's `manage-images` table key.
    first.unmount()
    renderPage()
    await screen.findByTestId('manage-collection-row-1')
    expect(within(screen.getByTestId('manage-collections-table')).queryByText('Type')).toBeNull()
  })

  it('deletes through the edit dialog and refetches', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Doomed' }),
    ])
    vi.mocked(fetchCollection).mockResolvedValue(makeApiCollection({ id: 1, name: 'Doomed' }))
    vi.mocked(deleteCollection).mockResolvedValue(undefined)
    renderPage()
    await user.click(await screen.findByText('Doomed'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete Collection' }))
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Delete Collection' }))
    await waitFor(() => expect(deleteCollection).toHaveBeenCalledWith(1))
    await waitFor(() => expect(fetchCollections).toHaveBeenCalledTimes(2))
  })

  it('refetches when the category tree changes (external move/undo)', async () => {
    vi.mocked(fetchCollections).mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
    const { rerender, props } = renderPage()
    await screen.findByTestId('manage-collection-row-1')
    expect(fetchCollections).toHaveBeenCalledTimes(1)
    rerender(
      <AuthContext.Provider value={makeAuth(ADMIN)}>
        <ManageCollectionsPage
          {...props}
          categories={[...CATEGORIES, makeCategory({ id: 12, label: 'New' })]}
        />
      </AuthContext.Provider>,
    )
    await waitFor(() => expect(fetchCollections).toHaveBeenCalledTimes(2))
  })

  it('navigates to a category in Browse from the category breadcrumb', async () => {
    const user = userEvent.setup()
    const onNavigateCategory = vi.fn()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, category_id: 11 }),
    ])
    renderPage({ onNavigateCategory })
    await user.click(await screen.findByRole('button', { name: 'Histology' }))
    expect(onNavigateCategory).toHaveBeenCalledWith([CATEGORIES[1]])
  })
})
