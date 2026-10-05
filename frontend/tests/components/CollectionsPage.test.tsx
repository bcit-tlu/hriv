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
import { makeCollection, makeCollectionSummary, makeImage } from '../helpers/fixtures'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return { ...actual, fetchCollection: vi.fn(), fetchImage: vi.fn() }
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
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onTransfer: vi.fn().mockResolvedValue(undefined),
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
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Skull comparison')
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
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Skull comparison')
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
      void (props.onReorder as (ids: number[]) => Promise<unknown>)([22, 21])
      expect(onReorderImages).toHaveBeenCalledWith(9, [22, 21])
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

  describe('ownership and transfer (#1419)', () => {
    it('shows a Managed by program hint for program-owned collections', () => {
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          owner: { kind: 'program', programId: 1, name: 'Radiography' },
        }),
      })
      expect(screen.getByText(/Managed by program Radiography/)).toBeInTheDocument()
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
          programIds: [1, 99],
          groupIds: [4],
        }),
      })
      const chips = screen.getAllByTestId('detail-program-chip')
      expect(chips.map((c) => c.textContent)).toEqual(['Radiography', 'Program 99'])
      expect(screen.getByTestId('detail-group-chip')).toHaveTextContent('Cohort A')
    })

    it('gates the detail Transfer button on canTransfer', async () => {
      const user = userEvent.setup()
      const onTransfer = vi.fn().mockResolvedValue(undefined)
      const { unmount } = renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          permissions: { canEdit: true, canDelete: true, canTransfer: false },
        }),
        onTransfer,
      })
      expect(screen.queryByRole('button', { name: 'Transfer' })).not.toBeInTheDocument()
      unmount()

      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({
          id: 9,
          permissions: { canEdit: true, canDelete: true, canTransfer: true },
        }),
        onTransfer,
      })
      await user.click(screen.getByRole('button', { name: 'Transfer' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Transfer ownership')).toBeInTheDocument()
      await user.click(within(dialog).getByLabelText('New owning program'))
      // No programs passed → confirm stays disabled; the affordance itself is what is gated here.
      expect(within(dialog).getByTestId('transfer-confirm')).toBeDisabled()
    })

    it('shows a card Transfer affordance only when canTransfer', async () => {
      const user = userEvent.setup()
      renderPage({
        collections: [
          makeCollectionSummary({
            id: 3,
            name: 'Ownable',
            permissions: { canEdit: true, canDelete: true, canTransfer: true },
          }),
          makeCollectionSummary({
            id: 4,
            name: 'Shared',
            permissions: { canEdit: true, canDelete: true, canTransfer: false },
          }),
        ],
      })
      expect(screen.getByRole('button', { name: 'Transfer Ownable' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Transfer Shared' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Transfer Ownable' }))
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(within(screen.getByRole('dialog')).getByText('Transfer ownership')).toBeInTheDocument()
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
            owner: null,
            permissions: { canEdit: false, canDelete: true, canTransfer: true },
          }),
        ],
        onTransfer,
      })
      expect(screen.getByText(/No owner/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Transfer Orphaned set' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/This collection is orphaned/)).toBeInTheDocument()
      await user.click(within(dialog).getByLabelText('New owning program'))
      await user.click(within(await screen.findByRole('listbox')).getByText('Ultrasound'))
      await user.click(within(dialog).getByTestId('transfer-confirm'))
      await waitFor(() => expect(onTransfer).toHaveBeenCalledWith(5, { programId: 2 }))
    })
  })

  describe('browse integration (#1529)', () => {
    it('uses the provided label for the detail back button', () => {
      const onCloseCollection = vi.fn()
      renderPage({
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9 }),
        onCloseCollection,
        detailBackLabel: 'Back to Browse',
      })
      fireEvent.click(screen.getByRole('button', { name: 'Back to Browse' }))
      expect(onCloseCollection).toHaveBeenCalled()
    })

    it('offers Move on the detail header for admins regardless of ownership', async () => {
      const user = userEvent.setup()
      const onMoveCollection = vi.fn()
      const detail = makeCollection({
        id: 9,
        name: 'Filed one',
        // Someone else's collection: filing is curatorial, not owner-scoped.
        permissions: { canEdit: false, canDelete: false, canTransfer: false },
      })
      renderPage({ selectedCollectionId: 9, detail, onMoveCollection })
      await user.click(screen.getByRole('button', { name: 'Move' }))
      expect(onMoveCollection).toHaveBeenCalledWith(detail)
    })

    it('hides the detail Move button for non-curatorial roles', () => {
      renderPage({
        currentUser: STUDENT,
        selectedCollectionId: 9,
        detail: makeCollection({ id: 9 }),
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
})
