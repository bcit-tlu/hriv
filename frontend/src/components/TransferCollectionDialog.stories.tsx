import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ApiError } from '../api'
import { AuthContext, type AuthContextValue } from '../authContextValue'
import type { CollectionSummary, Program, Role, User } from '../types'
import TransferCollectionDialog, { type CollectionTransferTarget } from './TransferCollectionDialog'

const FIXED_AT = '2026-09-01T09:00:00Z'

const programs: Program[] = [
  { id: 1, name: 'Radiography', oidc_group: null, created_at: FIXED_AT, updated_at: FIXED_AT },
  { id: 2, name: 'Sonography', oidc_group: null, created_at: FIXED_AT, updated_at: FIXED_AT },
  { id: 3, name: 'CT', oidc_group: null, created_at: FIXED_AT, updated_at: FIXED_AT },
]

function makeUser(role: Role, overrides: Partial<User> = {}): User {
  return {
    id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role,
    active: true,
    program_ids: role === 'admin' ? [] : [1, 3],
    program_names: role === 'admin' ? [] : ['Radiography', 'CT'],
    group_ids: [],
    group_names: [],
    ...overrides,
  }
}

const people: User[] = [
  makeUser('instructor', { id: 7, name: 'Ada Lovelace', email: 'ada@example.com' }),
  makeUser('instructor', { id: 8, name: 'Grace Hopper', email: 'grace@example.com' }),
  makeUser('student', { id: 20, name: 'Sam Student', email: 'sam@example.com' }),
  makeUser('instructor', {
    id: 9,
    name: 'Retired Rose',
    email: 'rose@example.com',
    active: false,
  }),
]

function makeAuth(role: Role): AuthContextValue {
  return {
    currentUser: makeUser(role),
    users: role === 'admin' ? people : [],
    loading: false,
    login: async () => undefined,
    logout: () => undefined,
    addUser: () => undefined,
    deleteUser: () => undefined,
    refreshUsers: () => undefined,
    canManageUsers: role === 'admin',
    canEditContent: role === 'admin' || role === 'instructor',
    canViewPeople: role !== 'student',
    oidcError: null,
    clearOidcError: () => undefined,
  }
}

const owned: CollectionSummary = {
  id: 12,
  name: 'Skull comparison',
  description: 'Frontal and lateral views side by side.',
  type: 'synchronized',
  visibility: 'private',
  owner: { kind: 'user', userId: 7, name: 'Ada Lovelace' },
  imageCount: 2,
  coverThumb: null,
  version: 3,
  createdAt: FIXED_AT,
  updatedAt: FIXED_AT,
  permissions: { canEdit: true, canDelete: true, canTransfer: true },
}

const orphaned: CollectionSummary = { ...owned, id: 14, name: 'Legacy set', owner: null }

interface StoryArgs {
  role: Role
  collection: CollectionSummary | null
  onTransfer: (id: number, target: CollectionTransferTarget) => Promise<unknown>
  onClose: () => void
}

function TransferCollectionDialogExample({ role, collection, onTransfer, onClose }: StoryArgs) {
  return (
    <AuthContext.Provider value={makeAuth(role)}>
      <TransferCollectionDialog
        open
        onClose={onClose}
        collection={collection}
        programs={programs}
        onTransfer={onTransfer}
      />
    </AuthContext.Provider>
  )
}

const meta = {
  title: 'Components/TransferCollectionDialog',
  component: TransferCollectionDialogExample,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Ownership transfer for a collection (#1419). Admins may pick any active user or any program; instructors may only pick programs they belong to. Backend authorization re-checks the same matrix and the dialog surfaces 403/409/422 errors inline.',
      },
    },
    chromatic: { delay: 300 },
  },
  argTypes: {
    role: {
      control: 'inline-radio',
      options: ['admin', 'instructor'],
      description: 'Role of the signed-in user; drives the available target choices.',
    },
  },
  args: {
    role: 'admin',
    collection: owned,
    onTransfer: fn(async () => undefined),
    onClose: fn(),
  },
} satisfies Meta<typeof TransferCollectionDialogExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText('Transfer ownership')).toBeInTheDocument()
    await expect(body.getByText(/currently owned by Ada Lovelace/)).toBeInTheDocument()
    await expect(body.getByRole('radio', { name: 'A program' })).toBeChecked()
  },
}

export const AdminUserTarget: Story = {
  name: 'Admin User Target',
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole('radio', { name: 'A user' }))
    await userEvent.click(body.getByLabelText('New owner'))
    const options = await body.findAllByRole('option')
    // Retired Rose is inactive and filtered out.
    await expect(options.map((o) => o.textContent)).toEqual([
      'Ada Lovelace (ada@example.com)',
      'Grace Hopper (grace@example.com)',
      'Sam Student (sam@example.com)',
    ])
  },
}

export const InstructorProgramOnly: Story = {
  name: 'Instructor Program Only',
  args: { role: 'instructor' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.queryByRole('radio', { name: 'A user' })).not.toBeInTheDocument()
    await userEvent.click(body.getByLabelText('New owning program'))
    const listbox = await body.findByRole('listbox')
    // The instructor belongs to Radiography + CT — Sonography is out of reach.
    await expect(within(listbox).getByText('Radiography')).toBeInTheDocument()
    await expect(within(listbox).getByText('CT')).toBeInTheDocument()
    await expect(within(listbox).queryByText('Sonography')).not.toBeInTheDocument()
  },
}

export const OrphanedReassign: Story = {
  name: 'Orphaned Reassign',
  args: { collection: orphaned },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText(/This collection is orphaned/)).toBeInTheDocument()
    await userEvent.click(body.getByLabelText('New owning program'))
    await userEvent.click(within(await body.findByRole('listbox')).getByText('Sonography'))
    await expect(body.getByTestId('transfer-confirm')).toBeEnabled()
  },
}

export const ConflictError: Story = {
  name: 'Conflict Error',
  args: {
    onTransfer: fn(async () => {
      throw new ApiError(409, '')
    }),
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByLabelText('New owning program'))
    await userEvent.click(within(await body.findByRole('listbox')).getByText('Radiography'))
    await userEvent.click(body.getByTestId('transfer-confirm'))
    await expect(
      await body.findByText(
        'This item was modified by another user. Please refresh and try again.',
      ),
    ).toBeInTheDocument()
  },
}
