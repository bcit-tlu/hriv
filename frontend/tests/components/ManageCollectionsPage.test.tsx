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
    bulkUpdateCollections: vi.fn(),
    bulkDeleteCollections: vi.fn(),
  }
})

import {
  fetchCollections,
  fetchCollection,
  updateCollection,
  deleteCollection,
  bulkUpdateCollections,
  bulkDeleteCollections,
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
    // Restricted with no program/group ids keeps its pill — the scope chips
    // only carry the label when they exist (#1567).
    expect(within(root).getByText('Restricted')).toBeInTheDocument()
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
    // The eye-off marker belongs to the collection's own hidden flag.
    expect(within(row).getByRole('img', { name: 'Visibility: Hidden' })).toBeInTheDocument()
    const other = screen.getByTestId('manage-collection-row-2')
    expect(other.querySelector('td[data-dimmed]')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Visibility for Locked' })).toBeDisabled()
  })

  it('dims a collection hidden by its category and disables its switch', async () => {
    // Mirrors the Manage Images table's category-hidden rows: dimmed cells
    // and a locked Visibility switch — even though the collection's own
    // `hidden` flag is false and the caller may hide it (can_hide: true
    // isolates the category cause). No marker icon: that glyph is reserved
    // for the collection's own hidden flag.
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 1,
        name: 'Under hidden cat',
        hidden: false,
        category_id: 10,
        permissions: {
          can_edit: true,
          can_delete: true,
          can_change_scope: true,
          can_transfer: false,
          can_hide: true,
        },
      }),
      makeApiCollectionSummary({
        id: 2,
        name: 'Plain',
        hidden: false,
        category_id: 11,
      }),
    ])
    renderPage({
      categories: [
        makeCategory({ id: 10, label: 'Anatomy', status: 'hidden' }),
        makeCategory({ id: 11, label: 'Histology' }),
      ],
    })
    const row = await screen.findByTestId('manage-collection-row-1')
    expect(row.querySelector('td[data-dimmed]')).not.toBeNull()
    expect(within(row).queryByRole('img', { name: 'Hidden by category' })).toBeNull()
    expect(within(row).queryByRole('img', { name: 'Visibility: Hidden' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Visibility for Under hidden cat' })).toBeDisabled()
    const plain = screen.getByTestId('manage-collection-row-2')
    expect(plain.querySelector('td[data-dimmed]')).toBeNull()
  })

  it('disables the bulk visibility switch when the selection is category-hidden', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({
        id: 1,
        name: 'Under hidden cat',
        hidden: false,
        category_id: 10,
        permissions: {
          can_edit: true,
          can_delete: true,
          can_change_scope: true,
          can_transfer: false,
          can_hide: true,
        },
      }),
    ])
    renderPage({
      categories: [makeCategory({ id: 10, label: 'Anatomy', status: 'hidden' })],
      currentUser: ADMIN,
    })
    await screen.findByTestId('manage-collection-row-1')
    await user.click(screen.getByRole('checkbox', { name: 'Select Under hidden cat' }))
    await user.click(screen.getByRole('button', { name: 'Bulk Edit (1 selected)' }))
    const bulkDialog = await screen.findByRole('dialog')
    expect(within(bulkDialog).getByRole('switch', { name: /hidden by category/i })).toBeDisabled()
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

  it('renders headers and row cells in the persisted column order (#1577)', async () => {
    localStorage.setItem(
      'hrivpref:table-column-order:manage-collections:user:anonymous',
      JSON.stringify([
        'updated_at',
        'name',
        'cover',
        'id',
        'type',
        'scope',
        'owners',
        'images',
        'programs',
        'groups',
        'category',
        'visibility',
        'created_at',
      ]),
    )
    vi.mocked(fetchCollections).mockResolvedValue([
      makeApiCollectionSummary({ id: 1, name: 'Ordered' }),
    ])
    renderPage()
    const row = await screen.findByTestId('manage-collection-row-1')

    const table = screen.getByTestId('manage-collections-table')
    const headerNames = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent ?? '')
    expect(headerNames.indexOf('Modified')).toBeLessThan(headerNames.indexOf('Name'))

    // Cells stay aligned under their headers — the trailing Actions column
    // occupies the same slot in both arrays.
    const cellTexts = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent ?? '')
    expect(cellTexts.indexOf('Ordered')).toBe(headerNames.indexOf('Name'))
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

  describe('bulk edit (#1578)', () => {
    it('renders a selection column for curators and opens the bulk dialog', async () => {
      const user = userEvent.setup()
      vi.mocked(fetchCollections).mockResolvedValue([
        makeApiCollectionSummary({ id: 1, name: 'Mine' }),
        makeApiCollectionSummary({ id: 2, name: 'Theirs' }),
      ])
      renderPage()
      await screen.findByTestId('manage-collection-row-2')

      // Curators may select any row — nothing is disabled.
      expect(
        screen.getByRole('checkbox', { name: 'Select all collections on this page' }),
      ).toBeInTheDocument()
      for (const name of ['Select Mine', 'Select Theirs']) {
        expect(screen.getByRole('checkbox', { name })).toBeEnabled()
      }

      await user.click(screen.getByRole('checkbox', { name: 'Select Mine' }))
      const bulkBtn = await screen.findByRole('button', { name: 'Bulk Edit (1 selected)' })
      await user.click(bulkBtn)
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/Editing 1 selected collection/)).toBeInTheDocument()
      // Curator fields are present: category picker + visibility switch.
      expect(within(dialog).getByRole('combobox')).toBeInTheDocument()
      expect(
        within(dialog).getByRole('switch', { name: /visible to students/i }),
      ).toBeInTheDocument()
    })

    it('bulk-saves a refile and hidden toggle, then clears the selection', async () => {
      const user = userEvent.setup()
      const onCategoriesChanged = vi.fn()
      vi.mocked(fetchCollections).mockResolvedValue([
        makeApiCollectionSummary({ id: 1, name: 'Mine', category_id: 10 }),
      ])
      vi.mocked(bulkUpdateCollections).mockResolvedValue([
        makeApiCollectionSummary({ id: 1, name: 'Mine', category_id: 11, hidden: true }),
      ])
      renderPage({ onCategoriesChanged })
      await screen.findByTestId('manage-collection-row-1')

      await user.click(screen.getByRole('checkbox', { name: 'Select Mine' }))
      await user.click(screen.getByRole('button', { name: 'Bulk Edit (1 selected)' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('combobox'))
      const listbox = await screen.findByRole('listbox')
      await user.click(within(listbox).getByRole('option', { name: /^Histology/ }))
      await user.click(within(dialog).getByRole('switch', { name: /visible to students/i }))
      await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

      await waitFor(() =>
        expect(bulkUpdateCollections).toHaveBeenCalledWith({
          collection_ids: [1],
          category_id: 11,
          hidden: true,
        }),
      )
      await waitFor(() => expect(fetchCollections).toHaveBeenCalledTimes(2))
      expect(onCategoriesChanged).toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /Bulk Edit \(/ })).not.toBeInTheDocument()
    })

    it('bulk-deletes through the two-step confirm', async () => {
      const user = userEvent.setup()
      vi.mocked(fetchCollections).mockResolvedValue([
        makeApiCollectionSummary({ id: 1, name: 'One' }),
        makeApiCollectionSummary({ id: 2, name: 'Two' }),
      ])
      vi.mocked(bulkDeleteCollections).mockResolvedValue(undefined)
      renderPage()
      await screen.findByTestId('manage-collection-row-2')

      // Page-scoped select-all picks up every selectable row in view.
      await user.click(
        screen.getByRole('checkbox', { name: 'Select all collections on this page' }),
      )
      await user.click(screen.getByRole('button', { name: 'Bulk Edit (2 selected)' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(
        within(dialog).getByRole('button', { name: 'Delete 2 Selected Collections' }),
      )
      expect(bulkDeleteCollections).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Delete 2 Collections' }))
      await waitFor(() =>
        expect(bulkDeleteCollections).toHaveBeenCalledWith({ collection_ids: [1, 2] }),
      )
      await waitFor(() => expect(fetchCollections).toHaveBeenCalledTimes(2))
    })

    it('shows no selection column when nothing on the page is actionable', async () => {
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
      renderPage({ currentUser: STAFF })
      await screen.findByTestId('manage-collection-row-1')
      expect(screen.queryByRole('checkbox', { name: /^Select/ })).not.toBeInTheDocument()
    })

    it('limits staff selection to rows they could delete singly', async () => {
      const user = userEvent.setup()
      const readOnly = {
        can_edit: false,
        can_delete: false,
        can_change_scope: false,
        can_transfer: false,
        can_hide: false,
      }
      const deletable = {
        can_edit: true,
        can_delete: true,
        can_change_scope: true,
        can_transfer: false,
        can_hide: false,
      }
      vi.mocked(fetchCollections).mockResolvedValue([
        makeApiCollectionSummary({ id: 1, name: 'Mine', permissions: deletable }),
        makeApiCollectionSummary({ id: 2, name: 'Theirs', permissions: readOnly }),
      ])
      renderPage({ currentUser: STAFF })
      await screen.findByTestId('manage-collection-row-2')

      expect(screen.getByRole('checkbox', { name: 'Select Mine' })).toBeEnabled()
      expect(screen.getByRole('checkbox', { name: 'Select Theirs' })).toBeDisabled()

      // Staff aren't curators — the dialog is delete-only for them.
      await user.click(screen.getByRole('checkbox', { name: 'Select Mine' }))
      await user.click(screen.getByRole('button', { name: 'Bulk Edit (1 selected)' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
      expect(within(dialog).queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
      expect(
        within(dialog).getByRole('button', { name: 'Delete 1 Selected Collection' }),
      ).toBeEnabled()
    })

    it('disables delete in the dialog when a selected row is not deletable', async () => {
      const user = userEvent.setup()
      const readOnly = {
        can_edit: false,
        can_delete: false,
        can_change_scope: false,
        can_transfer: false,
        can_hide: false,
      }
      vi.mocked(fetchCollections).mockResolvedValue([
        makeApiCollectionSummary({ id: 1, name: 'Mine' }),
        makeApiCollectionSummary({ id: 2, name: 'Theirs', permissions: readOnly }),
      ])
      // Instructors can refile/hide any row but only delete what passes
      // can_delete_collection — selecting a foreign row locks delete.
      renderPage({ currentUser: INSTRUCTOR })
      await screen.findByTestId('manage-collection-row-2')

      await user.click(
        screen.getByRole('checkbox', { name: 'Select all collections on this page' }),
      )
      await user.click(screen.getByRole('button', { name: 'Bulk Edit (2 selected)' }))
      const dialog = await screen.findByRole('dialog')
      expect(
        within(dialog).getByRole('button', { name: 'Delete 2 Selected Collections' }),
      ).toBeDisabled()
      // Curatorial save stays available.
      expect(within(dialog).getByRole('button', { name: 'Save Changes' })).toBeEnabled()
    })

    it('drops a singly-deleted collection from the bulk selection', async () => {
      const user = userEvent.setup()
      const row1 = makeApiCollectionSummary({ id: 1, name: 'Doomed' })
      const row2 = makeApiCollectionSummary({ id: 2, name: 'Survivor' })
      // After the single delete, the refetch no longer returns row 1 —
      // its id must leave `selected` or the next bulk call would 404.
      vi.mocked(fetchCollections).mockResolvedValueOnce([row1, row2]).mockResolvedValue([row2])
      vi.mocked(fetchCollection).mockResolvedValue(makeApiCollection({ id: 1, name: 'Doomed' }))
      vi.mocked(deleteCollection).mockResolvedValue(undefined)
      vi.mocked(bulkUpdateCollections).mockResolvedValue([])
      renderPage()
      await screen.findByTestId('manage-collection-row-2')

      await user.click(
        screen.getByRole('checkbox', { name: 'Select all collections on this page' }),
      )
      await user.click(await screen.findByText('Doomed'))
      const editDialog = await screen.findByRole('dialog')
      await user.click(within(editDialog).getByRole('button', { name: 'Delete Collection' }))
      await user.click(
        within(editDialog).getByRole('button', { name: 'Confirm Delete Collection' }),
      )
      await waitFor(() => expect(deleteCollection).toHaveBeenCalledWith(1))
      await waitFor(() => expect(fetchCollections).toHaveBeenCalledTimes(2))

      const bulkBtn = await screen.findByRole('button', {
        name: 'Bulk Edit (1 selected)',
      })
      await user.click(bulkBtn)
      const bulkDialog = await screen.findByRole('dialog')
      await user.click(within(bulkDialog).getByRole('switch', { name: /visible to students/i }))
      await user.click(within(bulkDialog).getByRole('button', { name: 'Save Changes' }))
      await waitFor(() =>
        expect(bulkUpdateCollections).toHaveBeenCalledWith({
          collection_ids: [2],
          hidden: true,
        }),
      )
    })
  })
})
