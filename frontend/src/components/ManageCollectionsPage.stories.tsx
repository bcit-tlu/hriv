import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import { AuthContext, type AuthContextValue } from '../authContextValue'
import type { ApiCollectionSummary } from '../api'
import type { Category, Role, User } from '../types'
import ManageCollectionsPage from './ManageCollectionsPage'

const FIXED_AT = '2026-09-01T09:00:00Z'

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

function makeApiSummary(overrides: Partial<ApiCollectionSummary> = {}): ApiCollectionSummary {
  return {
    id: 1,
    name: 'Skull comparison',
    description: 'Frontal vs lateral',
    type: 'synchronized',
    visibility: 'private',
    hidden: false,
    owners: [{ user_id: 7, name: 'Ada Lovelace' }],
    image_count: 2,
    cover_thumb: '/hriv-splash2.jpg',
    version: 1,
    category_id: 2,
    sort_order: 0,
    created_at: FIXED_AT,
    updated_at: FIXED_AT,
    permissions: {
      can_edit: true,
      can_delete: true,
      can_change_scope: true,
      can_transfer: true,
      can_hide: false,
    },
    ...overrides,
  }
}

const rows: ApiCollectionSummary[] = [
  makeApiSummary(),
  makeApiSummary({
    id: 2,
    name: 'Fracture healing timeline',
    type: 'sequence',
    visibility: 'public',
    hidden: false,
    image_count: 6,
    owners: [{ program_id: 1, name: 'Radiography' }],
    category_id: null,
    permissions: {
      can_edit: false,
      can_delete: false,
      can_change_scope: false,
      can_transfer: false,
      can_hide: false,
    },
  }),
  makeApiSummary({
    id: 3,
    name: 'Cohort 2026A review set',
    visibility: 'restricted',
    hidden: false,
    image_count: 4,
    owners: [
      { user_id: 8, name: 'Grace Hopper' },
      { user_id: 9, name: 'Alan Turing' },
    ],
    category_id: 3,
    cover_thumb: null,
    permissions: {
      can_edit: true,
      can_delete: false,
      can_change_scope: false,
      can_transfer: true,
      can_hide: false,
    },
  }),
]

const categories: Category[] = [
  {
    id: 1,
    label: 'Anatomy',
    parentId: null,
    children: [
      {
        id: 2,
        label: 'Skeletal',
        parentId: 1,
        children: [],
        images: [],
        collections: [],
        programIds: [],
        groupIds: [],
        status: null,
        sortOrder: 0,
        version: 1,
        metadataExtra: {},
      },
    ],
    images: [],
    collections: [],
    programIds: [],
    groupIds: [],
    status: null,
    sortOrder: 0,
    version: 1,
    metadataExtra: {},
  },
  {
    id: 3,
    label: 'Histology',
    parentId: null,
    children: [],
    images: [],
    collections: [],
    programIds: [],
    groupIds: [],
    status: null,
    sortOrder: 0,
    version: 1,
    metadataExtra: {},
  },
]

interface StoryArgs {
  role: Role
  rows: ApiCollectionSummary[]
  loading: boolean
  error: boolean
  onOpenCollection: (id: number) => void
  onError: (message: string) => void
}

function ManageCollectionsPageExample(args: StoryArgs) {
  const user = makeUser(args.role)
  return (
    <AuthContext.Provider value={makeAuth(user)}>
      <Box sx={{ p: 3 }}>
        <ManageCollectionsPage
          categories={categories}
          programs={[]}
          groups={[]}
          currentUser={user}
          onOpenCollection={args.onOpenCollection}
          onError={args.onError}
          loadCollections={async () => {
            if (args.error) throw new Error('boom')
            if (args.loading) return new Promise<ApiCollectionSummary[]>(() => undefined)
            return args.rows
          }}
        />
      </Box>
    </AuthContext.Provider>
  )
}

const meta = {
  title: 'Components/ManageCollectionsPage',
  component: ManageCollectionsPageExample,
  parameters: {
    layout: 'fullscreen',
    // FilterPopoverButton caption labels use the theme's muted grey (4.26:1) — palette debt, see #1345.
    a11y: { test: 'todo' },
    docs: {
      description: {
        component:
          'Manage → Collections: the all-collections table for non-students (#1554), mirroring Manage → Images — stored filter facets, sortable columns, client-side pagination, browse-location category breadcrumbs, and row actions gated on API permissions (Edit / Owners). Delete lives inside the edit dialog; filing moved into the edit dialog’s category picker (#1566).',
      },
    },
  },
  argTypes: {
    role: {
      control: 'inline-radio',
      options: ['admin', 'instructor', 'staff'],
      description:
        'Signed-in role — staff see every row the API returns but only permission-backed actions.',
    },
  },
  args: {
    role: 'admin',
    rows,
    loading: false,
    error: false,
    onOpenCollection: fn(),

    onError: fn(),
  },
} satisfies Meta<typeof ManageCollectionsPageExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const table = await canvas.findByTestId('manage-collections-table')
    // Read-only rows open the collection view on click; editable rows fetch
    // the full record first (not deterministic in the sandbox).
    await userEvent.click(within(table).getByText('Fracture healing timeline'))
    await expect(args.onOpenCollection).toHaveBeenCalledWith(2)
    // Sort by Name — Fracture… now precedes Skull…
    await userEvent.click(within(table).getByRole('button', { name: 'Name' }))
    const order = within(table)
      .getAllByTestId(/^manage-collection-row-/)
      .map((r) => r.getAttribute('data-testid'))
    await expect(order[0]).toBe('manage-collection-row-3')
  },
}

export const StaffView: Story = {
  name: 'Staff View',
  args: { role: 'staff' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = await canvas.findByTestId('manage-collections-table')
    // No row carries a Move action — filing lives in the edit dialog's
    // category picker now (#1566).
    await expect(within(table).queryByRole('button', { name: /^Move / })).not.toBeInTheDocument()
  },
}

export const Loading: Story = {
  args: { rows: [], loading: true },
  parameters: {
    chromatic: { pauseAnimationAtEnd: true },
  },
}

export const Empty: Story = {
  args: { rows: [] },
}

export const LoadError: Story = {
  name: 'Load Error',
  args: { rows: [], error: true },
}
