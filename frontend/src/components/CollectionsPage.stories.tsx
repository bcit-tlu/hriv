import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import { AuthContext, type AuthContextValue } from '../authContextValue'
import { matchesCollectionFilters, type CollectionListFilters } from '../useCollectionsData'
import type { Collection, CollectionSummary, ImageItem, Program, Role, User } from '../types'
import CollectionsPage from './CollectionsPage'

const FIXED_AT = '2026-09-01T09:00:00Z'

const programs: Program[] = [
  { id: 1, name: 'Radiography', oidc_group: null, created_at: FIXED_AT, updated_at: FIXED_AT },
]

function makeUser(role: Role): User {
  return {
    id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role,
    active: true,
    program_ids: [1],
    program_names: ['Radiography'],
    group_ids: [],
    group_names: [],
  }
}

function makeAuth(user: User): AuthContextValue {
  return {
    currentUser: user,
    users: [],
    loading: false,
    login: async () => undefined,
    logout: () => undefined,
    addUser: () => undefined,
    deleteUser: () => undefined,
    refreshUsers: () => undefined,
    canManageUsers: user.role === 'admin',
    canEditContent: user.role === 'admin' || user.role === 'instructor',
    canViewPeople: user.role !== 'student',
    oidcError: null,
    clearOidcError: () => undefined,
  }
}

function makeSummary(overrides: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: 1,
    name: 'Skull comparison',
    description: null,
    type: 'synchronized',
    visibility: 'private',
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: 2,
    coverThumb: '/hriv-splash2.jpg',
    categoryId: null,
    sortOrder: 0,
    version: 1,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    permissions: { canEdit: true, canDelete: true, canChangeScope: true, canTransfer: false },
    ...overrides,
  }
}

function makeImage(id: number, name: string): ImageItem {
  return {
    id,
    name,
    thumb: '/hriv-splash2.jpg',
    // .storybook/static/sample.dzi parses but serves no tiles, so mounted
    // viewers are deterministic instead of racing an open-failed fallback.
    tileSources: '/sample.dzi',
    active: true,
    sortOrder: id,
    version: 1,
  }
}

const summaries: CollectionSummary[] = [
  makeSummary(),
  makeSummary({
    id: 2,
    name: 'Fracture healing timeline',
    type: 'sequence',
    visibility: 'public',
    imageCount: 6,
    owners: [{ kind: 'program', programId: 1, name: 'Radiography' }],
    permissions: { canEdit: false, canDelete: false, canChangeScope: false, canTransfer: false },
  }),
  makeSummary({
    id: 3,
    name: 'Cohort 2026A review set',
    visibility: 'restricted',
    imageCount: 4,
    owners: [{ kind: 'user', userId: 8, name: 'Grace Hopper' }],
    permissions: { canEdit: false, canDelete: false, canChangeScope: false, canTransfer: false },
  }),
  makeSummary({
    id: 4,
    name: 'Draft — nothing added yet',
    type: 'sequence',
    imageCount: 0,
    coverThumb: null,
  }),
]

const detail: Collection = {
  ...makeSummary(),
  description: 'Frontal and lateral views side by side.',
  images: [makeImage(101, 'Skull — frontal'), makeImage(102, 'Skull — lateral')],
  programIds: [],
  groupIds: [],
  viewportState: {},
  memberCount: 2,
}

interface StoryArgs {
  role: Role
  collections: CollectionSummary[]
  loading: boolean
  error: string | null
  selectedCollectionId: number | null
  detail: Collection | null
  detailLoading: boolean
  detailError: string | null
  onOpenCollection: (id: number) => void
  onOpenImage: (image: ImageItem) => void
}

function CollectionsPageExample(args: StoryArgs) {
  const [filters, setFilters] = useState<CollectionListFilters>({
    type: 'all',
    mine: false,
    owner: 'any',
  })
  const user = makeUser(args.role)
  // The real page receives a server-filtered list; mirror that here so the filter bar has effect.
  const collections = args.collections.filter((c) => matchesCollectionFilters(c, filters, user))
  return (
    <AuthContext.Provider value={makeAuth(user)}>
      <Box sx={{ p: 3 }}>
        <CollectionsPage
          currentUser={user}
          programs={programs}
          groups={[]}
          collections={collections}
          loading={args.loading}
          error={args.error}
          filters={filters}
          onFiltersChange={setFilters}
          ownerOptions={[
            { kind: 'user', userId: 7, name: 'Ada Lovelace' },
            { kind: 'user', userId: 8, name: 'Grace Hopper' },
            { kind: 'program', programId: 1, name: 'Radiography' },
          ]}
          selectedCollectionId={args.selectedCollectionId}
          detail={args.detail}
          detailLoading={args.detailLoading}
          detailError={args.detailError}
          onOpenCollection={args.onOpenCollection}
          onCloseCollection={() => undefined}
          onOpenImage={args.onOpenImage}
          selectedCollectionItemId={null}
          onSelectCollectionItem={() => undefined}
          onReorderImages={async () => undefined}
          onCollectionImageRenewed={() => undefined}
          onViewerError={() => undefined}
          onSaveViewport={async () => undefined}
          loadCollection={async () => detail}
          onCreate={async () => undefined}
          onUpdate={async () => undefined}
          onDelete={async () => undefined}
          onSaveOwners={async () => undefined}
          onTransfer={async () => undefined}
        />
      </Box>
    </AuthContext.Provider>
  )
}

const meta = {
  title: 'Components/CollectionsPage',
  component: CollectionsPageExample,
  parameters: {
    layout: 'fullscreen',
    // Unselected ToggleButton text uses the theme's muted grey (4.37:1) — palette debt, see #1345.
    a11y: { test: 'todo' },
    docs: {
      description: {
        component:
          'The Collections tab: filter bar (type, My collections, owner — the owner select is hidden for students), responsive card grid, create button, and the detail view — the sequence viewer for sequence collections (#1416) and the synchronized viewer for synchronized collections (#1417).',
      },
    },
  },
  argTypes: {
    role: {
      control: 'inline-radio',
      options: ['admin', 'instructor', 'staff', 'student'],
      description:
        'Role of the signed-in user (admins also get the orphaned owner filter; students see no owner filter).',
    },
  },
  args: {
    role: 'admin',
    collections: summaries,
    loading: false,
    error: null,
    selectedCollectionId: null,
    detail: null,
    detailLoading: false,
    detailError: null,
    onOpenCollection: fn(),
    onOpenImage: fn(),
  },
} satisfies Meta<typeof CollectionsPageExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  parameters: {
    // Card action area nests icon buttons + restricted chip palette — see #1345.
    a11y: { test: 'todo' },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByTestId('collection-card')).toHaveLength(4)
    await userEvent.click(canvas.getAllByTestId('collection-card-action-area')[1])
    await expect(args.onOpenCollection).toHaveBeenCalledWith(2)
  },
}

export const Filtered: Story = {
  parameters: {
    a11y: { test: 'todo' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Sequence' }))
    await userEvent.click(canvas.getByRole('button', { name: 'My collections' }))
    await expect(canvas.getByRole('button', { name: 'Sequence' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(canvas.getByLabelText('Owner')).toHaveAttribute('aria-disabled', 'true')
    await expect(canvas.getAllByTestId('collection-card')).toHaveLength(1)
    await expect(canvas.getByRole('button', { name: /^Edit / })).toBeInTheDocument()
  },
}

export const Loading: Story = {
  args: { collections: [], loading: true },
  parameters: {
    chromatic: { pauseAnimationAtEnd: true },
  },
}

export const Empty: Story = {
  args: { collections: [] },
}

export const LoadError: Story = {
  name: 'Load Error',
  args: { collections: [], error: 'Failed to load collections.' },
}

export const Detail: Story = {
  args: { selectedCollectionId: 1, detail },
  parameters: {
    a11y: { test: 'todo' },
    // The synchronized detail mounts real OpenSeadragon viewers whose tile
    // fetches fail in the sandbox; freeze the frame for a stable snapshot.
    chromatic: { pauseAnimationAtEnd: true, delay: 300 },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const buttons = canvas.getAllByRole('button', { name: /^Open Skull/ })
    await expect(buttons).toHaveLength(2)
    await userEvent.click(buttons[0])
    await expect(args.onOpenImage).toHaveBeenCalledWith(detail.images[0])
  },
}

export const DetailNotFound: Story = {
  name: 'Detail Not Found',
  args: {
    selectedCollectionId: 999,
    detailError:
      'This collection could not be found. It may have been deleted or you may not have access to it.',
  },
}

export const CreateDialogOpen: Story = {
  name: 'Create Dialog Open',
  parameters: {
    a11y: { test: 'todo' },
    chromatic: { delay: 300 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'New collection' }))
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText('New Collection')).toBeInTheDocument()
  },
}
