import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ApiError } from '../api'
import { AuthContext, type AuthContextValue } from '../authContextValue'
import type { CollectionSummary, Program, Role, User } from '../types'
import CollectionOwnersDialog from './CollectionOwnersDialog'

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

function makeAuth(role: Role): AuthContextValue {
  return {
    currentUser: makeUser(role),
    users: [],
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

function makeSummary(overrides: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: 12,
    name: 'Skull comparison',
    description: 'Frontal and lateral views side by side.',
    type: 'synchronized',
    visibility: 'private',
    hidden: false,
    owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
    imageCount: 2,
    coverThumb: null,
    coverImageId: null,
    categoryId: null,
    sortOrder: 0,
    programIds: [],
    groupIds: [],
    version: 3,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    permissions: {
      canEdit: true,
      canDelete: true,
      canChangeScope: true,
      canTransfer: true,
      canHide: false,
    },
    ...overrides,
  }
}

const coOwned = makeSummary({
  id: 13,
  name: 'Cohort review set',
  owners: [
    { kind: 'user', userId: 7, name: 'Ada Lovelace' },
    { kind: 'user', userId: 8, name: 'Grace Hopper' },
  ],
})
const orphaned = makeSummary({ id: 14, name: 'Legacy set', owners: [] })
const programOwned = makeSummary({
  id: 15,
  name: 'Lab 2 — Epithelium set',
  owners: [{ kind: 'program', programId: 1, name: 'Radiography' }],
})

interface StoryArgs {
  role: Role
  collection: CollectionSummary
  onSaveOwners: (id: number, userIds: number[]) => Promise<unknown>
  onTransfer: (id: number, programId: number | null) => Promise<unknown>
  onClose: () => void
}

function CollectionOwnersDialogExample({
  role,
  collection,
  onSaveOwners,
  onTransfer,
  onClose,
}: StoryArgs) {
  return (
    <AuthContext.Provider value={makeAuth(role)}>
      <CollectionOwnersDialog
        open
        onClose={onClose}
        collection={collection}
        programs={programs}
        onSaveOwners={onSaveOwners}
        onTransfer={onTransfer}
      />
    </AuthContext.Provider>
  )
}

const meta = {
  title: 'Components/CollectionOwnersDialog',
  component: CollectionOwnersDialogExample,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Manage a collection’s co-owners and program ownership (#1531). The user picker replaces the whole `collection_owners` set via `PUT /api/collections/{id}/owners`; the program select reassigns `owner_program_id` via `POST …/transfer` (assigning a program clears the user-owner rows). Rendered where `permissions.canTransfer` allows; the backend re-checks the same matrix.',
      },
    },
  },
  args: {
    role: 'admin',
    collection: coOwned,
    onSaveOwners: fn(async () => undefined),
    onTransfer: fn(async () => undefined),
    onClose: fn(),
  },
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<StoryArgs>

export const Basic: Story = {
  name: 'Co-owned — user pane with member table',
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('heading', { name: 'Owners' })).toBeInTheDocument()
    await expect(body.getByText(/Ada Lovelace, Grace Hopper/)).toBeInTheDocument()
    await expect(body.getByRole('radio', { name: 'User' })).toBeChecked()
    // Nothing changed → confirm stays disabled.
    await expect(body.getByTestId('owners-confirm')).toBeDisabled()
  },
}

export const InstructorProgramsOnly: Story = {
  name: 'Instructor — program chips narrowed to memberships',
  args: { role: 'instructor', collection: coOwned },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole('radio', { name: 'Program' }))
    // Instructor belongs to programs 1 + 3 — Sonography is hidden.
    await expect(body.getByTestId('program-choice-1')).toBeInTheDocument()
    await expect(body.getByTestId('program-choice-3')).toBeInTheDocument()
    await expect(body.queryByTestId('program-choice-2')).not.toBeInTheDocument()
  },
}

export const OrphanedReassign: Story = {
  name: 'Orphaned — reassign to a program',
  args: { role: 'admin', collection: orphaned },
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText(/This collection is orphaned/)).toBeInTheDocument()
    await userEvent.click(body.getByRole('radio', { name: 'Program' }))
    await userEvent.click(body.getByTestId('program-choice-2'))
    await userEvent.click(body.getByTestId('owners-confirm'))
    await expect(args.onTransfer).toHaveBeenCalledWith(14, 2)
  },
}

export const ProgramOwned: Story = {
  name: 'Program-owned — owning program chip starts filled + deletable',
  args: { collection: programOwned },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('radio', { name: 'Program' })).toBeChecked()
    const chip = await body.findByTestId('program-choice-1')
    await expect(chip.className).toContain('MuiChip-filled')
    await expect(within(chip).getByTestId('CancelIcon')).toBeInTheDocument()
  },
}

export const ConflictError: Story = {
  name: 'Stale version 409 surfaces inline',
  args: {
    collection: programOwned,
    onTransfer: fn(async () => {
      throw new ApiError(409, 'Stale version', { version: 9 })
    }),
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    // No directory fetch needed on the Program pane — pick a different
    // program chip, then the transfer 409s.
    await userEvent.click(await body.findByTestId('program-choice-2'))
    await userEvent.click(body.getByTestId('owners-confirm'))
    await expect(await body.findByTestId('owners-error')).toHaveTextContent(/Stale version/)
  },
}
