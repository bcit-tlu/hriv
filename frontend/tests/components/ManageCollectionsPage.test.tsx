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

import { fetchCollections, fetchCollection, deleteCollection } from '../../src/api'
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
        image_count: 2,
        category_id: 10,
      }),
      makeApiCollectionSummary({
        id: 2,
        name: 'Epithelium tour',
        type: 'sequence',
        visibility: 'restricted',
        image_count: 9,
        category_id: null,
      }),
    ])
    renderPage()
    const row = await screen.findByTestId('manage-collection-row-1')
    expect(within(row).getByText('Skull comparison')).toBeInTheDocument()
    expect(within(row).getByText('Synchronized')).toBeInTheDocument()
    expect(within(row).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(row).getByText('Anatomy')).toBeInTheDocument()
    const root = screen.getByTestId('manage-collection-row-2')
    expect(within(root).getByText('Restricted')).toBeInTheDocument()
    expect(within(root).getByText('9')).toBeInTheDocument()
    expect(within(root).getByText('—')).toBeInTheDocument()
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
        },
      }),
    ])
    renderPage({ onOpenCollection })
    await user.click(await screen.findByText('Theirs'))
    expect(onOpenCollection).toHaveBeenCalledWith(1)
    expect(fetchCollection).not.toHaveBeenCalled()
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
        },
      }),
    ])
    const onMoveCollection = vi.fn()
    renderPage({ onMoveCollection })
    const row = await screen.findByTestId('manage-collection-row-1')
    expect(within(row).getByRole('button', { name: 'Edit Full' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Manage owners of Full' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Move Full to a category' })).toBeInTheDocument()

    const readonly = screen.getByTestId('manage-collection-row-2')
    expect(within(readonly).queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(
      within(readonly).queryByRole('button', { name: /^Manage owners/ }),
    ).not.toBeInTheDocument()
    // Move is role-gated (admin/instructor filing), not permission-gated (#1529).
    expect(
      within(readonly).getByRole('button', { name: 'Move Read only to a category' }),
    ).toBeInTheDocument()
  })

  it('hides the move action for staff even with the handler supplied', async () => {
    vi.mocked(fetchCollections).mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
    renderPage({ currentUser: STAFF, onMoveCollection: vi.fn() })
    const row = await screen.findByTestId('manage-collection-row-1')
    expect(within(row).queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument()
  })

  it('hides the move action for students', async () => {
    vi.mocked(fetchCollections).mockResolvedValue([makeApiCollectionSummary({ id: 1 })])
    renderPage({ currentUser: STUDENT, onMoveCollection: vi.fn() })
    const row = await screen.findByTestId('manage-collection-row-1')
    expect(within(row).queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument()
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
        },
      }),
    ])
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Manage owners of Ownable' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Owners' })).toBeInTheDocument()
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
