import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../src/authContextValue'
import type { AuthContextValue } from '../../src/authContextValue'
import CollectionsPage from '../../src/components/CollectionsPage'
import type { CollectionsPageProps } from '../../src/components/CollectionsPage'
import { ApiError } from '../../src/api'
import { DEFAULT_COLLECTION_FILTERS } from '../../src/useCollectionsData'
import type { User } from '../../src/types'
import { makeCategory, makeCollection, makeCollectionSummary, makeImage } from '../helpers/fixtures'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchCollection: vi.fn(),
    fetchImage: vi.fn(),
    fetchUsersPaged: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  }
})

// Sequence and synchronized details mount the real OpenSeadragon viewer,
// which jsdom cannot run; stub both components and record their props so
// page wiring is assertable.
const sequenceViewerProps: { current: Record<string, unknown> | null } = { current: null }
vi.mock('../../src/components/SequenceCollectionViewer', () => ({
  default: (props: Record<string, unknown>) => {
    sequenceViewerProps.current = props
    return <div data-testid="sequence-collection-viewer" />
  },
}))
const synchronizedViewerProps: { current: Record<string, unknown> | null } = { current: null }
vi.mock('../../src/components/SynchronizedCollectionViewer', () => ({
  default: (props: Record<string, unknown>) => {
    synchronizedViewerProps.current = props
    return <div data-testid="synchronized-collection-viewer" />
  },
}))

// The Manage dialog is stubbed the same way — its own test file covers the
// grid/DnD behaviour; here we only need the page wiring (#1566).
const manageDialogProps: { current: Record<string, unknown> | null } = { current: null }
vi.mock('../../src/components/CollectionManageDialog', () => ({
  default: (props: Record<string, unknown>) => {
    manageDialogProps.current = props
    return props.open ? <div data-testid="collection-manage" /> : null
  },
}))

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
const INSTRUCTOR: User = { ...ADMIN, id: 3, name: 'Instructor', role: 'instructor' }
const STAFF: User = { ...ADMIN, id: 4, name: 'Staff', role: 'staff' }

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
    collectionPageType: 'sequence',
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
    selectedCollectionItemId: null,
    onSelectCollectionItem: vi.fn(),
    onReorderImages: vi.fn().mockResolvedValue(undefined),
    onCollectionImageRenewed: vi.fn(),
    onViewerError: vi.fn(),
    onSaveViewport: vi.fn().mockResolvedValue(undefined),
    loadCollection: vi.fn().mockResolvedValue(makeCollection()),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(makeCollection()),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onSaveOwners: vi.fn().mockResolvedValue(undefined),
    onTransfer: vi.fn().mockResolvedValue(undefined),
    categories: [],
    onNavigateCategory: vi.fn(),
    onToggleHidden: vi.fn().mockResolvedValue(undefined),
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
  beforeEach(() => {
    vi.clearAllMocks()
    sequenceViewerProps.current = null
    synchronizedViewerProps.current = null
    manageDialogProps.current = null
  })

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

    it('desaturates a list card filed under a hidden category', () => {
      renderPage({
        collections: [makeCollectionSummary({ id: 1, categoryId: 11 })],
        categories: [
          makeCategory({
            id: 10,
            label: 'Italian',
            status: 'hidden',
            children: [makeCategory({ id: 11, label: 'Gothic', parentId: 10 })],
          }),
        ],
      })
      expect(screen.getByTestId('collection-card-action-area')).toHaveStyle({
        filter: 'grayscale(100%)',
      })
      expect(screen.getByRole('img', { name: 'Hidden by category' })).toBeInTheDocument()
    })
  })

  describe('filters', () => {
    it('renders the type page heading and has no in-page type toggle (#1554)', () => {
      const { unmount } = renderPage({ collectionPageType: 'sequence' })
      expect(screen.getByRole('heading', { name: 'Sequence collections' })).toBeInTheDocument()
      // Type is the page (nav sub-menu), not a filter — the toggle is gone.
      expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
      unmount()
      renderPage({ collectionPageType: 'synchronized' })
      expect(screen.getByRole('heading', { name: 'Synchronized collections' })).toBeInTheDocument()
    })

    it('toggles My collections and resets the owner facet', () => {
      const onFiltersChange = vi.fn()
      renderPage({
        onFiltersChange,
        filters: { ...DEFAULT_COLLECTION_FILTERS, owner: { kind: 'user', userId: 5, name: 'X' } },
      })
      fireEvent.click(screen.getByRole('button', { name: 'My collections' }))
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

      renderPage({ currentUser: INSTRUCTOR })
      await user.click(screen.getByLabelText('Owner'))
      expect(
        within(await screen.findByRole('listbox')).queryByText('No owner (orphaned)'),
      ).not.toBeInTheDocument()
    })

    it('shows the owner select to admin, instructor and staff but never to students', () => {
      for (const currentUser of [ADMIN, INSTRUCTOR, STAFF]) {
        const { unmount } = renderPage({ currentUser })
        expect(screen.getByLabelText('Owner')).toBeInTheDocument()
        unmount()
      }
      renderPage({ currentUser: STUDENT })
      expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'My collections' })).toBeInTheDocument()
    })

    it('disables the owner select while My collections is active', () => {
      renderPage({ filters: { ...DEFAULT_COLLECTION_FILTERS, mine: true } })
      expect(screen.getByLabelText('Owner')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('create / edit', () => {
    it('shows New collection for staff (staff create with student parity)', () => {
      renderPage({ currentUser: STAFF })
      expect(screen.getByRole('button', { name: 'New collection' })).toBeInTheDocument()
    })

    it('offers staff the empty-state create affordance too', async () => {
      const user = userEvent.setup()
      const onCreate = vi.fn().mockResolvedValue(undefined)
      renderPage({ currentUser: STAFF, collections: [], onCreate })
      const link = await screen.findByRole('button', { name: 'Create a collection' })
      await user.click(link)
      expect(await screen.findByText('New Collection')).toBeInTheDocument()
    })

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
      const nameField = screen.getByDisplayValue('Full record')
      await user.clear(nameField)
      await user.type(nameField, 'Renamed record')
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

    it('opens the most recently clicked collection when an earlier edit load finishes last', async () => {
      const user = userEvent.setup()
      const resolvers = new Map<number, (value: ReturnType<typeof makeCollection>) => void>()
      const loadCollection = vi.fn(
        (id: number) =>
          new Promise<ReturnType<typeof makeCollection>>((resolve) => {
            resolvers.set(id, resolve)
          }),
      )
      renderPage({
        collections: [
          makeCollectionSummary({ id: 1, name: 'First' }),
          makeCollectionSummary({ id: 2, name: 'Second' }),
        ],
        loadCollection,
      })
      await user.click(screen.getByRole('button', { name: 'Edit First' }))
      await user.click(screen.getByRole('button', { name: 'Edit Second' }))
      expect(loadCollection).toHaveBeenCalledTimes(2)

      await act(async () => {
        resolvers.get(2)!(makeCollection({ id: 2, name: 'Second full' }))
      })
      expect(await screen.findByText('Edit Collection')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Second full')).toBeInTheDocument()

      await act(async () => {
        resolvers.get(1)!(makeCollection({ id: 1, name: 'First full' }))
      })
      expect(screen.getByDisplayValue('Second full')).toBeInTheDocument()
      expect(screen.queryByDisplayValue('First full')).not.toBeInTheDocument()
    })

    it('keeps the create form when an earlier edit load finishes after New collection', async () => {
      const user = userEvent.setup()
      let resolveLoad!: (value: ReturnType<typeof makeCollection>) => void
      const loadCollection = vi.fn(
        () =>
          new Promise<ReturnType<typeof makeCollection>>((resolve) => {
            resolveLoad = resolve
          }),
      )
      renderPage({
        collections: [makeCollectionSummary({ id: 1, name: 'First' })],
        loadCollection,
      })
      await user.click(screen.getByRole('button', { name: 'Edit First' }))
      await user.click(screen.getByRole('button', { name: 'New collection' }))
      expect(await screen.findByText('New Collection')).toBeInTheDocument()

      await act(async () => {
        resolveLoad(makeCollection({ id: 1, name: 'First full' }))
      })
      expect(screen.getByText('New Collection')).toBeInTheDocument()
      expect(screen.queryByText('Edit Collection')).not.toBeInTheDocument()
      expect(screen.queryByDisplayValue('First full')).not.toBeInTheDocument()
    })
  })

  // Delete lives only inside the edit dialog (#1554) — same click-to-confirm
  // pattern as EditImageModal; there is no card or detail-header delete.
  describe('delete (in the edit dialog)', () => {
    it('confirms before deleting and closes the dialog on success', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn().mockResolvedValue(undefined)
      const editing = makeCollection({ id: 4, name: 'Doomed' })
      renderPage({
        collections: [makeCollectionSummary({ id: 4, name: 'Doomed' })],
        loadCollection: vi.fn().mockResolvedValue(editing),
        onDelete,
      })
      await user.click(screen.getByRole('button', { name: 'Edit Doomed' }))
      const dialog = await screen.findByRole('dialog')
      const deleteButton = within(dialog).getByRole('button', { name: 'Delete Collection' })
      expect(onDelete).not.toHaveBeenCalled()
      await user.click(deleteButton)
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Delete Collection' }))
      await waitFor(() => expect(onDelete).toHaveBeenCalledWith(4))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('arms the delete button without deleting on the first click', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      renderPage({
        collections: [makeCollectionSummary({ id: 4, name: 'Kept' })],
        loadCollection: vi.fn().mockResolvedValue(makeCollection({ id: 4, name: 'Kept' })),
        onDelete,
      })
      await user.click(screen.getByRole('button', { name: 'Edit Kept' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete Collection' }))
      expect(
        within(dialog).getByRole('button', { name: 'Confirm Delete Collection' }),
      ).toBeInTheDocument()
      expect(onDelete).not.toHaveBeenCalled()
    })

    it('keeps the dialog open and shows the API message when deletion fails', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn().mockRejectedValue(new ApiError(403, 'Not yours'))
      renderPage({
        collections: [makeCollectionSummary({ id: 4, name: 'Locked' })],
        loadCollection: vi.fn().mockResolvedValue(makeCollection({ id: 4, name: 'Locked' })),
        onDelete,
      })
      await user.click(screen.getByRole('button', { name: 'Edit Locked' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete Collection' }))
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Delete Collection' }))
      expect(await within(dialog).findByText('Not yours')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('closes the detail view after deleting the open collection', async () => {
      const user = userEvent.setup()
      const onCloseCollection = vi.fn()
      const onDelete = vi.fn().mockResolvedValue(undefined)
      const detail = makeCollection({ id: 9, name: 'Open one' })
      renderPage({ selectedCollectionId: 9, detail, onCloseCollection, onDelete })
      await user.click(screen.getByRole('button', { name: 'Edit collection' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete Collection' }))
      await user.click(within(dialog).getByRole('button', { name: 'Confirm Delete Collection' }))
      await waitFor(() => expect(onDelete).toHaveBeenCalledWith(9))
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
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      expect(onCloseCollection).toHaveBeenCalled()
    })

    it('mounts the synchronized viewer with the header and wired callbacks (#1417)', () => {
      const onOpenImage = vi.fn()
      const onSaveViewport = vi.fn().mockResolvedValue(undefined)
      const onCollectionImageRenewed = vi.fn()
      const onViewerError = vi.fn()
      const images = [
        makeImage({ id: 21, name: 'Frontal' }),
        makeImage({ id: 22, name: 'Lateral' }),
      ]
      const detail = makeCollection({
        id: 9,
        type: 'synchronized',
        images,
        description: 'Two views',
      })
      renderPage({
        selectedCollectionId: 9,
        detail,
        onOpenImage,
        onSaveViewport,
        onCollectionImageRenewed,
        onViewerError,
      })

      expect(screen.getByTestId('collection-detail')).toBeInTheDocument()
      // No <h1> — the collection name is the breadcrumb's trailing item,
      // followed by the image count like the image/category header (#1564).
      const crumb = screen.getByTestId('collection-breadcrumb')
      expect(within(crumb).getByText('Skull comparison')).toBeInTheDocument()
      expect(within(crumb).getByText('(2 images)')).toBeInTheDocument()
      expect(screen.getByText('Two views')).toBeInTheDocument()
      expect(screen.getByTestId('synchronized-collection-viewer')).toBeInTheDocument()

      const props = synchronizedViewerProps.current!
      expect(props.collection).toBe(detail)
      void (props.onSaveViewport as (s: Record<string, unknown>) => Promise<unknown>)({
        '21': { zoom: 1, x: 0.5, y: 0.5, rotation: 0 },
      })
      expect(onSaveViewport).toHaveBeenCalledWith(9, {
        '21': { zoom: 1, x: 0.5, y: 0.5, rotation: 0 },
      })
      ;(props.onOpenImage as (img: unknown) => void)(images[0])
      expect(onOpenImage).toHaveBeenCalledWith(images[0])
      ;(props.onImageRenewed as (img: unknown) => void)({ id: 21 })
      expect(onCollectionImageRenewed).toHaveBeenCalledWith(9, { id: 21 })
      ;(props.onError as (m: string) => void)('boom')
      expect(onViewerError).toHaveBeenCalledWith('boom')
    })

    it('mounts the sequence viewer with the header and wired callbacks (#1416)', () => {
      const onOpenImage = vi.fn()
      const onSelectCollectionItem = vi.fn()
      const onReorderImages = vi.fn().mockResolvedValue(undefined)
      const onCollectionImageRenewed = vi.fn()
      const onViewerError = vi.fn()
      const images = [
        makeImage({ id: 21, name: 'Frontal' }),
        makeImage({ id: 22, name: 'Lateral' }),
      ]
      const detail = makeCollection({ id: 9, type: 'sequence', images, description: 'Two views' })
      renderPage({
        selectedCollectionId: 9,
        detail,
        onOpenImage,
        selectedCollectionItemId: 22,
        onSelectCollectionItem,
        onReorderImages,
        onCollectionImageRenewed,
        onViewerError,
      })

      expect(screen.getByTestId('collection-detail')).toBeInTheDocument()
      const crumb = screen.getByTestId('collection-breadcrumb')
      expect(within(crumb).getByText('Skull comparison')).toBeInTheDocument()
      expect(within(crumb).getByText('(2 images)')).toBeInTheDocument()
      expect(screen.getByText('Two views')).toBeInTheDocument()
      expect(screen.getByTestId('sequence-collection-viewer')).toBeInTheDocument()
      // The member list / coming-soon alert only remain for synchronized.
      expect(screen.queryByText('1. Frontal')).not.toBeInTheDocument()

      const props = sequenceViewerProps.current!
      expect(props.collection).toBe(detail)
      expect(props.itemId).toBe(22)
      ;(props.onSelectItem as (id: number) => void)(21)
      expect(onSelectCollectionItem).toHaveBeenCalledWith(21)
      ;(props.onOpenImage as (img: unknown) => void)(images[0])
      expect(onOpenImage).toHaveBeenCalledWith(images[0])
      // Reorder moved off the viewer into the Manage dialog (#1566).
      expect(props.onReorder).toBeUndefined()
      // Hidden collections pass the filmstrip desaturation flag through.
      expect(props.hidden).toBe(false)
      ;(props.onImageRenewed as (img: unknown) => void)({ id: 21 })
      expect(onCollectionImageRenewed).toHaveBeenCalledWith(9, { id: 21 })
      ;(props.onError as (m: string) => void)('boom')
      expect(onViewerError).toHaveBeenCalledWith('boom')
    })

    it('still mounts the viewer when a synchronized collection has no images', () => {
      renderPage({ selectedCollectionId: 9, detail: makeCollection({ id: 9, images: [] }) })
      // The empty-state fallback itself is covered by the viewer's own tests.
      expect(screen.getByTestId('synchronized-collection-viewer')).toBeInTheDocument()
    })

    it('navigates to the Browse root from the breadcrumb Home link (#1559)', () => {
      const onNavigateCategory = vi.fn()
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9 }),
        onNavigateCategory,
      })
      fireEvent.click(screen.getByRole('button', { name: 'Home' }))
      expect(onNavigateCategory).toHaveBeenCalledWith([])
    })

    it('gates the detail Edit button on API permissions', () => {
      // Staff can't file, so a read-only collection gives them no Edit (#1567:
      // admins/instructors do see it — the picker is their filing path).
      renderPage({
        currentUser: STAFF,
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          permissions: { canEdit: false, canDelete: false, canTransfer: false, canHide: false },
        }),
      })
      expect(screen.queryByRole('button', { name: 'Edit collection' })).not.toBeInTheDocument()
      // Delete lives only inside the edit dialog (#1554), never on the header.
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
      await user.click(screen.getByRole('button', { name: 'Edit collection' }))
      expect(await screen.findByText('Edit Collection')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Open one')).toBeInTheDocument()
      expect(loadCollection).not.toHaveBeenCalled()
    })
  })

  describe('ownership and transfer (#1419)', () => {
    it('shows a Managed by program hint for program-owned collections', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          owners: [{ kind: 'program', programId: 1, name: 'Radiography' }],
        }),
      })
      expect(screen.getByText(/Managed by program Radiography/)).toBeInTheDocument()
    })

    it('shows Managed by for user-owned collections too, with the transfer icon (#1567)', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          owners: [
            { kind: 'user', userId: 7, name: 'Ada Lovelace' },
            { kind: 'user', userId: 8, name: 'Grace Hopper' },
          ],
          permissions: {
            canEdit: true,
            canDelete: true,
            canChangeScope: true,
            canTransfer: true,
            canHide: true,
          },
        }),
      })
      expect(screen.getByText('Managed by Ada Lovelace, Grace Hopper')).toBeInTheDocument()
      // The owners affordance is the transfer-horizontal glyph, not a pencil.
      const ownersBtn = screen.getByRole('button', { name: 'Manage owners' })
      expect(within(ownersBtn).getByTestId('SwapHorizIcon')).toBeInTheDocument()
    })

    it('shows program and group restriction chips on a restricted detail', () => {
      renderPage({
        selectedCollectionId: 9,
        programs: [{ id: 1, name: 'Radiography' }],
        groups: [
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
        ],
        detail: makeCollection({
          id: 9,
          visibility: 'restricted',
          hidden: false,
          programIds: [1, 99],
          groupIds: [4],
        }),
      })
      const chips = screen.getAllByTestId('detail-program-chip')
      expect(chips.map((c) => c.textContent)).toEqual(['Radiography', 'Program 99'])
      expect(screen.getByTestId('detail-group-chip')).toHaveTextContent('Cohort A')
      // Chips sit on the breadcrumb row to the left of the action buttons —
      // the View Images header convention (#1567).
      const manage = screen.getByRole('button', { name: 'Manage Images' })
      expect(
        chips[0].compareDocumentPosition(manage) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it("renders the filed category's restriction scope as dimmed inherited chips (#1567)", () => {
      renderPage({
        selectedCollectionId: 9,
        categories: [makeCategory({ id: 5, label: 'Histology', programIds: [2], groupIds: [6] })],
        programs: [
          { id: 1, name: 'Radiography' },
          { id: 2, name: 'Dental' },
        ],
        groups: [
          {
            id: 6,
            name: 'Cohort B',
            description: null,
            createdByUserId: null,
            memberIds: [],
            instructorIds: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        detail: makeCollection({
          id: 9,
          visibility: 'restricted',
          programIds: [1],
          groupIds: [],
          categoryId: 5,
        }),
      })
      const programs = screen.getAllByTestId('detail-program-chip')
      expect(programs.map((c) => c.textContent)).toEqual(['Radiography', 'Dental'])
      expect(programs[1]).toHaveStyle({ opacity: 0.6 })
      expect(programs[0]).not.toHaveStyle({ opacity: 0.6 })
      const groups = screen.getAllByTestId('detail-group-chip')
      expect(groups.map((c) => c.textContent)).toEqual(['Cohort B'])
      expect(groups[0]).toHaveStyle({ opacity: 0.6 })
    })

    it('gates the detail owners pencil on canTransfer (#1567)', async () => {
      const user = userEvent.setup()
      const onTransfer = vi.fn().mockResolvedValue(undefined)
      const { unmount } = renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          permissions: { canEdit: true, canDelete: true, canTransfer: false, canHide: false },
        }),
        onTransfer,
      })
      expect(screen.queryByRole('button', { name: 'Manage owners' })).not.toBeInTheDocument()
      unmount()

      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: false },
        }),
        onTransfer,
      })
      // The pencil sits beside the owner name and opens the same Owners dialog.
      await user.click(screen.getByRole('button', { name: 'Manage owners' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading', { name: 'Owners' })).toBeInTheDocument()
      // Nothing changed → confirm stays disabled; the affordance itself is what is gated here.
      expect(within(dialog).getByTestId('owners-confirm')).toBeDisabled()
    })

    it('shows a card owners affordance only when canTransfer', async () => {
      const user = userEvent.setup()
      renderPage({
        collections: [
          makeCollectionSummary({
            id: 3,
            name: 'Ownable',
            permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: false },
          }),
          makeCollectionSummary({
            id: 4,
            name: 'Shared',
            permissions: { canEdit: true, canDelete: true, canTransfer: false, canHide: false },
          }),
        ],
      })
      expect(screen.getByRole('button', { name: 'Manage owners of Ownable' })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Manage owners of Shared' }),
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Manage owners of Ownable' }))
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(
        within(screen.getByRole('dialog')).getByRole('heading', { name: 'Owners' }),
      ).toBeInTheDocument()
    })

    it('lets an admin reassign an orphaned collection from the card grid', async () => {
      const user = userEvent.setup()
      const onTransfer = vi.fn().mockResolvedValue(undefined)
      renderPage({
        currentUser: ADMIN,
        programs: [{ id: 2, name: 'Ultrasound' }],
        collections: [
          makeCollectionSummary({
            id: 5,
            name: 'Orphaned set',
            owners: [],
            permissions: { canEdit: false, canDelete: true, canTransfer: true, canHide: false },
          }),
        ],
        onTransfer,
      })
      // Tiles no longer render owner text (#1567) — an orphaned collection
      // is identified by the owners affordance and the dialog's copy.
      const transferBtn = screen.getByRole('button', { name: 'Manage owners of Orphaned set' })
      await user.click(transferBtn)
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/This collection is orphaned/)).toBeInTheDocument()
      await user.click(within(dialog).getByLabelText('Owning program'))
      await user.click(within(await screen.findByRole('listbox')).getByText('Ultrasound'))
      await user.click(within(dialog).getByTestId('owners-confirm'))
      await waitFor(() => expect(onTransfer).toHaveBeenCalledWith(5, 2))
    })
  })

  describe('browse integration (#1529)', () => {
    it('renders the filed category path in the detail breadcrumb (#1559)', () => {
      const onNavigateCategory = vi.fn()
      const hematology = makeCategory({ id: 10, label: 'Hematology' })
      const mlsc = makeCategory({ id: 20, label: 'MLSC-3200' })
      const lab3 = makeCategory({ id: 30, label: 'Lab 3' })
      mlsc.children = [lab3]
      hematology.children = [mlsc]
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9, categoryId: 30 }),
        categories: [hematology],
        onNavigateCategory,
      })

      const crumb = screen.getByTestId('collection-breadcrumb')
      expect(within(crumb).getByRole('button', { name: 'Home' })).toBeInTheDocument()
      for (const label of ['Hematology', 'MLSC-3200', 'Lab 3']) {
        expect(within(crumb).getByRole('button', { name: label })).toBeInTheDocument()
      }
      // The collection itself is terminal text, not a link.
      expect(within(crumb).getByText('Skull comparison')).toBeInTheDocument()

      fireEvent.click(within(crumb).getByRole('button', { name: 'MLSC-3200' }))
      expect(onNavigateCategory).toHaveBeenCalledWith([hematology, mlsc])
    })

    it('renders just Home for a root-filed collection', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9, categoryId: null }),
        categories: [makeCategory({ id: 10, label: 'Hematology' })],
      })
      const crumb = screen.getByTestId('collection-breadcrumb')
      expect(within(crumb).getByRole('button', { name: 'Home' })).toBeInTheDocument()
      expect(within(crumb).queryByRole('button', { name: 'Hematology' })).not.toBeInTheDocument()
    })

    it('has no Move button on the detail header — filing moved into Edit (#1566)', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9, name: 'Filed one' }),
        onMoveCollection: vi.fn(),
      })
      expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument()
    })

    it('offers Move on list cards for instructors and calls onMoveCollection', async () => {
      const user = userEvent.setup()
      const onMoveCollection = vi.fn()
      const collection = makeCollectionSummary({ id: 7, name: 'Lab 2' })
      renderPage({ currentUser: INSTRUCTOR, collections: [collection], onMoveCollection })
      await user.click(screen.getByRole('button', { name: 'Move Lab 2 to a category' }))
      expect(onMoveCollection).toHaveBeenCalledWith(collection)
    })

    it('omits the card Move affordance when onMoveCollection is not provided', () => {
      renderPage({ collections: [makeCollectionSummary({ id: 7, name: 'Lab 2' })] })
      expect(
        screen.queryByRole('button', { name: 'Move Lab 2 to a category' }),
      ).not.toBeInTheDocument()
    })

    it('shows the all-restricted notice when members exist but none are visible', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9, images: [], memberCount: 3 }),
      })
      expect(screen.getByTestId('collection-all-restricted')).toHaveTextContent(
        'All images in this collection are currently restricted.',
      )
    })

    it('omits the all-restricted notice for a truly empty collection', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9, images: [], memberCount: 0 }),
      })
      expect(screen.queryByTestId('collection-all-restricted')).not.toBeInTheDocument()
    })
  })

  describe('detail header actions (#1559)', () => {
    it('renders Manage in the actions and Edit as a breadcrumb pencil (#1567)', async () => {
      const user = userEvent.setup()
      const detail = makeCollection({ id: 9, type: 'sequence' })
      renderPage({ selectedCollectionId: 9, detail })
      await user.click(screen.getByRole('button', { name: 'Manage Images' }))
      expect(screen.getByTestId('collection-manage')).toBeInTheDocument()

      // The right-side Edit button is gone (#1567) — the pencil sits inside
      // the final breadcrumb item, like the Edit Category pattern, and opens
      // the Edit Collection dialog.
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
      const breadcrumb = screen.getByTestId('collection-breadcrumb')
      const pencil = within(breadcrumb).getByRole('button', { name: 'Edit collection' })
      await user.click(pencil)
      expect(await screen.findByText('Edit Collection')).toBeInTheDocument()

      // Synchronized collections get the same surface.
      renderPage({
        selectedCollectionId: 10,
        detail: makeCollection({ id: 10, type: 'synchronized' }),
      })
      expect(screen.getAllByRole('button', { name: 'Manage Images' }).length).toBeGreaterThan(0)
    })

    it('wires the Manage dialog through the shared mutation handlers (#1566/#1567)', async () => {
      const user = userEvent.setup()
      const onReorderImages = vi.fn().mockResolvedValue(undefined)
      const onRequestCollectionImageSearch = vi.fn()
      const detail = makeCollection({ id: 9, type: 'sequence' })
      renderPage({
        selectedCollectionId: 9,
        detail,
        onReorderImages,
        onRequestCollectionImageSearch,
      })
      await user.click(screen.getByRole('button', { name: 'Manage Images' }))
      const props = manageDialogProps.current!
      expect(props.collection).toBe(detail)
      // Done commits the staged draft through the whole-replace handler.
      void (props.onSaveMembers as (ids: number[]) => Promise<unknown>)([22, 21])
      expect(onReorderImages).toHaveBeenCalledWith(9, [22, 21])
      // The + affordance hands search the dialog's staging channel.
      const stageAdd = vi.fn()
      ;(props.onAddImages as (stage: unknown) => void)(stageAdd)
      expect(onRequestCollectionImageSearch).toHaveBeenCalledWith(detail, stageAdd)
    })

    it('omits Manage for non-editors', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          type: 'sequence',
          permissions: { canEdit: false, canDelete: false, canTransfer: false, canHide: false },
        }),
      })
      expect(screen.queryByRole('button', { name: 'Manage Images' })).not.toBeInTheDocument()
    })

    it('keeps the actions on the breadcrumb row and the pills above the description (#1564)', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9, visibility: 'public', description: 'Two views' }),
      })
      const crumb = screen.getByTestId('collection-breadcrumb')
      const manage = screen.getByRole('button', { name: 'Manage Images' })
      // Breadcrumb precedes the action buttons in the shared top row…
      expect(crumb.compareDocumentPosition(manage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const typeChip = screen.getByText('Synchronized')
      const visChip = screen.getByTestId('collection-visibility-chip')
      const description = screen.getByText('Two views')
      // …and the pills row sits between them: type, then visibility, then
      // the description below.
      expect(
        typeChip.compareDocumentPosition(visChip) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(
        visChip.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(
        manage.compareDocumentPosition(typeChip) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('desaturates a hidden collection without a Hidden chip (#1566/#1567)', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          type: 'sequence',
          hidden: true,
          permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: true },
        }),
      })
      // Hidden state reads through the greyscale alone — no chip (#1567).
      expect(screen.queryByTestId('collection-hidden-chip')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Show collection' })).toBeInTheDocument()
      // The action buttons greyscale like the hidden image view's controls.
      expect(screen.getByRole('button', { name: 'Manage Images' })).toHaveStyle({
        filter: 'grayscale(100%)',
      })
      expect(screen.getByRole('button', { name: 'Edit collection' })).toHaveStyle({
        filter: 'grayscale(100%)',
      })
      // …and the flag reaches the viewer so the filmstrip desaturates too.
      expect(sequenceViewerProps.current?.hidden).toBe(true)
    })

    it('locks the hide control and desaturates when the filed category is hidden', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          type: 'sequence',
          categoryId: 11,
          permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: true },
        }),
        categories: [
          makeCategory({
            id: 10,
            label: 'Italian',
            status: 'hidden',
            children: [makeCategory({ id: 11, label: 'Gothic', parentId: 10 })],
          }),
        ],
      })
      // Category-hidden wins over the collection's own flag — the locked
      // "Hidden by Category" state the image view and edit dialog share.
      const toggle = screen.getByTestId('collection-hide-toggle')
      expect(toggle).toBeDisabled()
      expect(toggle).toHaveTextContent('Hidden by Category')
      expect(screen.queryByRole('button', { name: 'Hide collection' })).not.toBeInTheDocument()
      // Header controls desaturate like an own-hidden collection (#1567).
      expect(screen.getByRole('button', { name: 'Manage Images' })).toHaveStyle({
        filter: 'grayscale(100%)',
      })
      expect(screen.getByRole('button', { name: 'Edit collection' })).toHaveStyle({
        filter: 'grayscale(100%)',
      })
      // …and the flag reaches the viewer so the filmstrip desaturates too.
      expect(sequenceViewerProps.current?.hidden).toBe(true)
    })

    it('keeps the locked category state when the collection is also hidden directly', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          type: 'sequence',
          hidden: true,
          categoryId: 10,
          permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: true },
        }),
        categories: [makeCategory({ id: 10, label: 'Italian', status: 'hidden' })],
      })
      const toggle = screen.getByTestId('collection-hide-toggle')
      expect(toggle).toBeDisabled()
      expect(toggle).toHaveTextContent('Hidden by Category')
    })

    it('gates the hide/show link on canHide', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: false },
        }),
      })
      expect(screen.queryByRole('button', { name: 'Hide collection' })).not.toBeInTheDocument()
    })

    it('calls onToggleHidden with the open collection', async () => {
      const user = userEvent.setup()
      const onToggleHidden = vi.fn().mockResolvedValue(undefined)
      const detail = makeCollection({
        id: 9,
        permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: true },
      })
      renderPage({ selectedCollectionId: 9, detail, onToggleHidden })
      await user.click(screen.getByRole('button', { name: 'Hide collection' }))
      await waitFor(() => expect(onToggleHidden).toHaveBeenCalledWith(detail))
    })

    it('surfaces a hide/show failure through onViewerError', async () => {
      const user = userEvent.setup()
      const onToggleHidden = vi.fn().mockRejectedValue(new Error('conflict'))
      const onViewerError = vi.fn()
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: true },
        }),
        onToggleHidden,
        onViewerError,
      })
      await user.click(screen.getByRole('button', { name: 'Hide collection' }))
      await waitFor(() =>
        expect(onViewerError).toHaveBeenCalledWith('Failed to update the collection.'),
      )
    })

    it('turns a category change in the edit dialog into a move (#1566)', async () => {
      const user = userEvent.setup()
      const onUpdate = vi
        .fn()
        .mockResolvedValue(makeCollection({ id: 9, name: 'Lab 2', categoryId: 10 }))
      const onMoveCollectionToCategory = vi.fn().mockResolvedValue(undefined)
      const detail = makeCollection({
        id: 9,
        name: 'Lab 2',
        categoryId: 10,
        permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: true },
      })
      renderPage({
        selectedCollectionId: 9,
        detail,
        categories: [
          makeCategory({ id: 10, label: 'Histology' }),
          makeCategory({ id: 20, label: 'Epithelium', parentId: 10 }),
        ],
        onUpdate,
        onMoveCollectionToCategory,
      })
      await user.click(screen.getByRole('button', { name: 'Edit collection' }))
      await user.click(await screen.findByRole('combobox', { name: 'Category' }))
      await user.click(await screen.findByRole('option', { name: /Epithelium/ }))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onMoveCollectionToCategory).toHaveBeenCalled())
      const [movedCollection, targetId] = onMoveCollectionToCategory.mock.calls[0]
      expect(movedCollection.id).toBe(9)
      expect(targetId).toBe(20)
    })

    it('keeps the editor open when the category move fails (#1567)', async () => {
      const user = userEvent.setup()
      // The move op resolves with the caught API error on failure; the page
      // rethrows it so the dialog keeps the real message.
      const onMoveCollectionToCategory = vi
        .fn()
        .mockResolvedValue(new ApiError(403, 'Move denied by server'))
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          categoryId: 10,
          permissions: { canEdit: true, canDelete: true, canTransfer: true, canHide: true },
        }),
        categories: [
          makeCategory({ id: 10, label: 'Histology' }),
          makeCategory({ id: 20, label: 'Epithelium', parentId: 10 }),
        ],
        onMoveCollectionToCategory,
      })
      await user.click(screen.getByRole('button', { name: 'Edit collection' }))
      await user.click(await screen.findByRole('combobox', { name: 'Category' }))
      await user.click(await screen.findByRole('option', { name: /Epithelium/ }))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      // The dialog stays open with the server's message — a closed dialog
      // would read as a successful save even though the move op's snackbar
      // said otherwise.
      expect(await screen.findByText('Move denied by server')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('lets a filing-only curator refile a collection they cannot edit (#1567)', async () => {
      const user = userEvent.setup()
      const onUpdate = vi.fn()
      const onMoveCollectionToCategory = vi.fn().mockResolvedValue(true)
      const loadCollection = vi
        .fn()
        .mockResolvedValue(makeCollection({ id: 9, categoryId: 20, version: 5 }))
      const detail = makeCollection({
        id: 9,
        categoryId: 10,
        // canEdit is owner-scoped; an instructor may still file it.
        permissions: { canEdit: false, canDelete: false, canTransfer: false, canHide: true },
      })
      renderPage({
        currentUser: INSTRUCTOR,
        selectedCollectionId: 9,
        detail,
        categories: [
          makeCategory({ id: 10, label: 'Histology' }),
          makeCategory({ id: 20, label: 'Epithelium', parentId: 10 }),
        ],
        loadCollection,
        onUpdate,
        onMoveCollectionToCategory,
      })

      // Edit is offered for filing even though metadata editing is not.
      await user.click(screen.getByRole('button', { name: 'Edit collection' }))
      expect(await screen.findByText('File Collection')).toBeInTheDocument()
      expect(screen.getByLabelText('Collection name')).toBeDisabled()
      await user.click(await screen.findByRole('combobox', { name: 'Category' }))
      await user.click(await screen.findByRole('option', { name: /Epithelium/ }))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(onMoveCollectionToCategory).toHaveBeenCalled())
      // No PATCH — a version-only body is a content write the backend 403s.
      expect(onUpdate).not.toHaveBeenCalled()
      const [movedCollection, targetId] = onMoveCollectionToCategory.mock.calls[0]
      expect(movedCollection.id).toBe(9)
      expect(targetId).toBe(20)
      // Filing skipped `update`, so the open detail is refetched directly —
      // otherwise the breadcrumb and next filing's version go stale.
      await waitFor(() => expect(loadCollection).toHaveBeenCalledWith(9))
    })

    it('retries a failed category move without replaying the PATCH (#1567)', async () => {
      const user = userEvent.setup()
      // PATCH bumps the version server-side; the first move then fails. On
      // retry the editor must not resend the PATCH at the old version — its
      // baseline advances to the saved record, so only the move replays.
      const patched = makeCollection({ id: 9, name: 'Renamed', categoryId: 10, version: 5 })
      const onUpdate = vi.fn().mockResolvedValue(patched)
      const onMoveCollectionToCategory = vi
        .fn()
        .mockResolvedValueOnce(new ApiError(503, 'move service down'))
        .mockResolvedValueOnce(true)
      const loadCollection = vi
        .fn()
        .mockResolvedValue(makeCollection({ id: 9, name: 'Renamed', categoryId: 20, version: 6 }))
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9, name: 'Old name', categoryId: 10, version: 4 }),
        categories: [
          makeCategory({ id: 10, label: 'Histology' }),
          makeCategory({ id: 20, label: 'Epithelium', parentId: 10 }),
        ],
        loadCollection,
        onUpdate,
        onMoveCollectionToCategory,
      })

      await user.click(screen.getByRole('button', { name: 'Edit collection' }))
      const nameField = await screen.findByDisplayValue('Old name')
      await user.clear(nameField)
      await user.type(nameField, 'Renamed')
      await user.click(await screen.findByRole('combobox', { name: 'Category' }))
      await user.click(await screen.findByRole('option', { name: /Epithelium/ }))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      // Move failed → editor stays open (the snackbar carried the precise
      // message; the dialog's generic alert proves it didn't close).
      expect(await screen.findByText('Failed to update collection.')).toBeInTheDocument()
      expect(onUpdate).toHaveBeenCalledTimes(1)

      // Retry: baseline advanced to the PATCH result, so no second PATCH —
      // the move replays against the bumped version and the dialog closes.
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onMoveCollectionToCategory).toHaveBeenCalledTimes(2))
      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(onMoveCollectionToCategory.mock.calls[1][0]).toEqual(
        expect.objectContaining({ version: 5 }),
      )
      await waitFor(() => expect(screen.queryByText('Edit Collection')).not.toBeInTheDocument())
    })

    it('still PATCHes a hidden-only diff for a filing-only curator (#1567)', async () => {
      const user = userEvent.setup()
      const onUpdate = vi.fn().mockResolvedValue(makeCollection({ id: 9, hidden: true }))
      const onMoveCollectionToCategory = vi.fn()
      renderPage({
        currentUser: INSTRUCTOR,
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          categoryId: 10,
          hidden: false,
          permissions: { canEdit: false, canDelete: false, canTransfer: false, canHide: true },
        }),
        categories: [makeCategory({ id: 10, label: 'Histology' })],
        onUpdate,
        onMoveCollectionToCategory,
      })
      await user.click(screen.getByRole('button', { name: 'Edit collection' }))
      await user.click(await screen.findByRole('button', { name: 'Visibility: Hide collection' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      // {hidden, version} rides the backend's curatorial hidden-only path.
      await waitFor(() => expect(onUpdate).toHaveBeenCalled())
      expect(onMoveCollectionToCategory).not.toHaveBeenCalled()
    })
  })
})
