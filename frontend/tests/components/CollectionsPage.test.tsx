import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../src/authContextValue'
import type { AuthContextValue } from '../../src/authContextValue'
import CollectionsPage from '../../src/components/CollectionsPage'
import type { CollectionsPageProps } from '../../src/components/CollectionsPage'
import { ApiError } from '../../src/api'
import { DEFAULT_COLLECTION_FILTERS } from '../../src/useCollectionsData'
import type { User } from '../../src/types'
import { makeCollection, makeCollectionSummary, makeImage } from '../helpers/fixtures'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return { ...actual, fetchCollection: vi.fn(), fetchImage: vi.fn() }
})

const ADMIN: User = {
  id: 1,
  name: 'Admin',
  email: 'admin@example.com',
  role: 'admin',
  active: true,
  program_ids: [],
  program_names: [],
  group_ids: [],
  group_names: [],
}

const STUDENT: User = { ...ADMIN, id: 2, name: 'Student', role: 'student' }

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

function makeProps(overrides: Partial<CollectionsPageProps> = {}): CollectionsPageProps {
  return {
    currentUser: ADMIN,
    programs: [],
    groups: [],
    collections: [],
    loading: false,
    error: null,
    filters: DEFAULT_COLLECTION_FILTERS,
    onFiltersChange: vi.fn(),
    ownerOptions: [],
    selectedCollectionId: null,
    detail: null,
    detailLoading: false,
    detailError: null,
    onOpenCollection: vi.fn(),
    onCloseCollection: vi.fn(),
    onOpenImage: vi.fn(),
    loadCollection: vi.fn().mockResolvedValue(makeCollection()),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderPage(overrides: Partial<CollectionsPageProps> = {}) {
  const props = makeProps(overrides)
  const utils = render(
    <AuthContext.Provider value={makeAuth(props.currentUser ?? ADMIN)}>
      <CollectionsPage {...props} />
    </AuthContext.Provider>,
  )
  return { ...utils, props }
}

describe('CollectionsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('list states', () => {
    it('shows a spinner while loading an empty list', () => {
      renderPage({ loading: true })
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.queryByTestId('collections-empty')).not.toBeInTheDocument()
    })

    it('shows the load error as a plain notification', () => {
      renderPage({ error: 'Failed to load collections.' })
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to load collections.')
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    })

    it('shows the create hint when there are no collections and no filters', () => {
      renderPage()
      expect(screen.getByTestId('collections-empty')).toHaveTextContent('No collections yet')
      expect(screen.getByTestId('collections-empty')).toHaveTextContent(
        /Create a collection to group images/,
      )
    })

    it('opens the create dialog from the empty-state link', async () => {
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: 'Create a collection' }))
      expect(await screen.findByText('New Collection')).toBeInTheDocument()
    })

    it('shows the filter hint when filters exclude everything', () => {
      renderPage({ filters: { ...DEFAULT_COLLECTION_FILTERS, mine: true } })
      expect(screen.getByText('No collections match the current filters.')).toBeInTheDocument()
    })

    it('renders a card per collection and opens one on click', () => {
      const onOpenCollection = vi.fn()
      renderPage({
        collections: [
          makeCollectionSummary({ id: 1, name: 'First' }),
          makeCollectionSummary({ id: 2, name: 'Second' }),
        ],
        onOpenCollection,
      })
      const cards = screen.getAllByTestId('collection-card')
      expect(cards).toHaveLength(2)
      fireEvent.click(within(cards[1]).getByTestId('collection-card-action-area'))
      expect(onOpenCollection).toHaveBeenCalledWith(2)
    })
  })

  describe('filters', () => {
    it('changes the type filter', () => {
      const onFiltersChange = vi.fn()
      renderPage({ onFiltersChange })
      fireEvent.click(screen.getByRole('button', { name: 'Synchronized' }))
      expect(onFiltersChange).toHaveBeenCalledWith({
        ...DEFAULT_COLLECTION_FILTERS,
        type: 'synchronized',
      })
    })

    it('toggles Mine and resets the owner facet', () => {
      const onFiltersChange = vi.fn()
      renderPage({
        onFiltersChange,
        filters: { ...DEFAULT_COLLECTION_FILTERS, owner: { kind: 'user', userId: 5, name: 'X' } },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Mine' }))
      expect(onFiltersChange).toHaveBeenCalledWith({
        ...DEFAULT_COLLECTION_FILTERS,
        mine: true,
        owner: 'any',
      })
    })

    it('lists owner options and selects one', async () => {
      const user = userEvent.setup()
      const onFiltersChange = vi.fn()
      const owner = { kind: 'user' as const, userId: 5, name: 'Ada Lovelace' }
      renderPage({
        onFiltersChange,
        ownerOptions: [owner, { kind: 'program', programId: 3, name: 'Radiography' }],
      })
      await user.click(screen.getByLabelText('Owner'))
      const listbox = await screen.findByRole('listbox')
      expect(within(listbox).getByText('Anyone')).toBeInTheDocument()
      expect(within(listbox).getByText('Radiography (program)')).toBeInTheDocument()
      await user.click(within(listbox).getByText('Ada Lovelace'))
      expect(onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_COLLECTION_FILTERS, owner })
    })

    it('offers the orphaned owner filter only to admins', async () => {
      const user = userEvent.setup()
      const { unmount } = renderPage()
      await user.click(screen.getByLabelText('Owner'))
      expect(
        within(await screen.findByRole('listbox')).getByText('No owner (orphaned)'),
      ).toBeInTheDocument()
      await user.keyboard('{Escape}')
      unmount()

      renderPage({ currentUser: STUDENT })
      await user.click(screen.getByLabelText('Owner'))
      expect(
        within(await screen.findByRole('listbox')).queryByText('No owner (orphaned)'),
      ).not.toBeInTheDocument()
    })

    it('disables the owner select while Mine is active', () => {
      renderPage({ filters: { ...DEFAULT_COLLECTION_FILTERS, mine: true } })
      expect(screen.getByLabelText('Owner')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('create / edit', () => {
    it('opens the create dialog and forwards the values to onCreate', async () => {
      const user = userEvent.setup()
      const onCreate = vi.fn().mockResolvedValue(undefined)
      renderPage({ onCreate })
      await user.click(screen.getByRole('button', { name: 'New collection' }))
      expect(await screen.findByText('New Collection')).toBeInTheDocument()
      await user.type(screen.getByLabelText('Collection name'), 'Skulls')
      await user.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
      expect(onCreate.mock.calls[0][0]).toMatchObject({ name: 'Skulls', type: 'sequence' })
      await waitFor(() => expect(screen.queryByText('New Collection')).not.toBeInTheDocument())
    })

    it('loads the full record before editing from a card and calls onUpdate with the version', async () => {
      const user = userEvent.setup()
      const full = makeCollection({ id: 1, name: 'Full record', version: 6 })
      const loadCollection = vi.fn().mockResolvedValue(full)
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      renderPage({
        collections: [makeCollectionSummary({ id: 1, name: 'Summary' })],
        loadCollection,
        onUpdate,
      })
      await user.click(screen.getByRole('button', { name: 'Edit Summary' }))
      expect(loadCollection).toHaveBeenCalledWith(1)
      expect(await screen.findByText('Edit Collection')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Full record')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
      expect(onUpdate.mock.calls[0][0]).toBe(1)
      expect(onUpdate.mock.calls[0][2]).toBe(6)
    })

    it('surfaces an error when the full record cannot be loaded for editing', async () => {
      const user = userEvent.setup()
      renderPage({
        collections: [makeCollectionSummary({ id: 1, name: 'Summary' })],
        loadCollection: vi.fn().mockRejectedValue(new ApiError(403, 'Forbidden')),
      })
      await user.click(screen.getByRole('button', { name: 'Edit Summary' }))
      expect(await screen.findByText('Forbidden')).toBeInTheDocument()
      expect(screen.queryByText('Edit Collection')).not.toBeInTheDocument()
    })
  })

  describe('delete', () => {
    it('confirms before deleting and closes the dialog on success', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn().mockResolvedValue(undefined)
      renderPage({
        collections: [makeCollectionSummary({ id: 4, name: 'Doomed' })],
        onDelete,
      })
      await user.click(screen.getByRole('button', { name: 'Delete Doomed' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Delete Collection')).toBeInTheDocument()
      expect(within(dialog).getByText('Doomed')).toBeInTheDocument()
      expect(onDelete).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(onDelete).toHaveBeenCalledWith(4))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('cancels without deleting', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      renderPage({ collections: [makeCollectionSummary({ id: 4, name: 'Kept' })], onDelete })
      await user.click(screen.getByRole('button', { name: 'Delete Kept' }))
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(onDelete).not.toHaveBeenCalled()
    })

    it('keeps the dialog open and shows the API message when deletion fails', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn().mockRejectedValue(new ApiError(403, 'Not yours'))
      renderPage({ collections: [makeCollectionSummary({ id: 4, name: 'Locked' })], onDelete })
      await user.click(screen.getByRole('button', { name: 'Delete Locked' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
      expect(await within(dialog).findByText('Not yours')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('closes the detail view after deleting the open collection', async () => {
      const user = userEvent.setup()
      const onCloseCollection = vi.fn()
      const detail = makeCollection({ id: 9, name: 'Open one' })
      renderPage({ selectedCollectionId: 9, detail, onCloseCollection })
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(onCloseCollection).toHaveBeenCalled())
    })
  })

  describe('detail placeholder', () => {
    it('shows a spinner while the detail loads', () => {
      renderPage({ selectedCollectionId: 9, detailLoading: true })
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.queryByText('Collections')).not.toBeInTheDocument()
    })

    it('shows the not-found error with a way back to the list', () => {
      const onCloseCollection = vi.fn()
      renderPage({
        selectedCollectionId: 9,
        detailError: 'This collection could not be found.',
        onCloseCollection,
      })
      expect(screen.getByTestId('collection-detail-error')).toHaveTextContent(
        'This collection could not be found.',
      )
      fireEvent.click(screen.getByRole('button', { name: 'All collections' }))
      expect(onCloseCollection).toHaveBeenCalled()
    })

    it.each(['synchronized', 'sequence'] as const)(
      'lists ordered members with Open image links for a %s collection',
      (type) => {
        const onOpenImage = vi.fn()
        const images = [
          makeImage({ id: 21, name: 'Frontal' }),
          makeImage({ id: 22, name: 'Lateral' }),
        ]
        const detail = makeCollection({ id: 9, type, images, description: 'Two views' })
        renderPage({ selectedCollectionId: 9, detail, onOpenImage })

        expect(screen.getByTestId('collection-detail')).toBeInTheDocument()
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Skull comparison')
        expect(screen.getByText('Two views')).toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent(`The ${type} viewer is coming soon`)
        expect(screen.getByText('1. Frontal')).toBeInTheDocument()
        expect(screen.getByText('2. Lateral')).toBeInTheDocument()

        const links = screen.getAllByRole('link', { name: 'Open image' })
        expect(links.map((l) => l.getAttribute('href'))).toEqual(['?image=21', '?image=22'])
        fireEvent.click(links[1])
        expect(onOpenImage).toHaveBeenCalledWith(images[1])
      },
    )

    it('explains when a collection has no images yet', () => {
      renderPage({ selectedCollectionId: 9, detail: makeCollection({ id: 9, images: [] }) })
      expect(screen.getByText('This collection has no images yet.')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Open image' })).not.toBeInTheDocument()
    })

    it('navigates back to the list', () => {
      const onCloseCollection = vi.fn()
      renderPage({ selectedCollectionId: 9, detail: makeCollection({ id: 9 }), onCloseCollection })
      fireEvent.click(screen.getByRole('button', { name: 'All collections' }))
      expect(onCloseCollection).toHaveBeenCalled()
    })

    it('gates the detail Edit/Delete buttons on API permissions', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          permissions: { canEdit: false, canDelete: false, canTransfer: false },
        }),
      })
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    })

    it('edits the open collection without refetching it', async () => {
      const user = userEvent.setup()
      const loadCollection = vi.fn()
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9, name: 'Open one' }),
        loadCollection,
      })
      await user.click(screen.getByRole('button', { name: 'Edit' }))
      expect(await screen.findByText('Edit Collection')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Open one')).toBeInTheDocument()
      expect(loadCollection).not.toHaveBeenCalled()
    })
  })
})
