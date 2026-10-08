import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthContext, type AuthContextValue } from '../authContextValue'
import type { Category, Collection, Group, Program, Role, User } from '../types'
import CollectionEditDialog from './CollectionEditDialog'

const FIXED_AT = '2026-09-01T09:00:00Z'

const programs: Program[] = [
  { id: 1, name: 'Radiography', oidc_group: null, created_at: FIXED_AT, updated_at: FIXED_AT },
  { id: 2, name: 'Sonography', oidc_group: null, created_at: FIXED_AT, updated_at: FIXED_AT },
]

const groups: Group[] = [
  {
    id: 10,
    name: 'Cohort 2026A',
    description: null,
    createdByUserId: 7,
    memberIds: [20, 21],
    instructorIds: [7],
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
  },
  {
    id: 11,
    name: 'Cohort 2026B',
    description: null,
    createdByUserId: 8,
    memberIds: [22],
    instructorIds: [8],
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
  },
]

function makeUser(role: Role): User {
  return {
    id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role,
    active: true,
    program_ids: role === 'admin' ? [] : [1],
    program_names: role === 'admin' ? [] : ['Radiography'],
    group_ids: [],
    group_names: [],
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

const existing: Collection = {
  id: 12,
  name: 'Skull comparison',
  description: 'Frontal and lateral views side by side.',
  type: 'synchronized',
  visibility: 'restricted',
  hidden: false,
  owners: [{ kind: 'user', userId: 7, name: 'Ada Lovelace' }],
  imageCount: 2,
  coverThumb: null,
  categoryId: null,
  sortOrder: 0,
  version: 3,
  createdAt: FIXED_AT,
  updatedAt: FIXED_AT,
  permissions: {
    canEdit: true,
    canDelete: true,
    canChangeScope: true,
    canTransfer: false,
    canHide: false,
  },
  images: [],
  programIds: [1],
  groupIds: [10],
  viewportState: {},
  memberCount: 0,
}

const categories: Category[] = [
  {
    id: 1,
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
    cardImageId: null,
  },
]

interface StoryArgs {
  role: Role
  collection: Collection | null
  categories?: Category[]
  onSave: (...args: unknown[]) => Promise<void>
  onClose: () => void
  onViewCollection?: () => void
}

function CollectionEditDialogExample({
  role,
  collection,
  categories: categoryList = [],
  onSave,
  onClose,
  onViewCollection,
}: StoryArgs) {
  return (
    <AuthContext.Provider value={makeAuth(role)}>
      <CollectionEditDialog
        open
        onClose={onClose}
        onSave={onSave}
        collection={collection}
        categories={categoryList}
        programs={programs}
        groups={groups}
        onViewCollection={onViewCollection}
      />
    </AuthContext.Provider>
  )
}

const meta = {
  title: 'Components/CollectionEditDialog',
  component: CollectionEditDialogExample,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Create/edit dialog for a collection: name, description, type (create only), visibility, and — for `restricted` — the program/group pickers reused from the category dialogs. Students and staff never see the Restricted option.',
      },
    },
    chromatic: { delay: 300 },
  },
  argTypes: {
    role: {
      control: 'inline-radio',
      options: ['admin', 'instructor', 'staff', 'student'],
      description:
        'Role of the signed-in user; drives which visibility options and chips are enabled.',
    },
  },
  args: {
    role: 'admin',
    collection: null,
    onSave: fn(async () => undefined),
    onClose: fn(),
  },
} satisfies Meta<typeof CollectionEditDialogExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('dialog')).toBeInTheDocument()
    await expect(body.getByRole('radio', { name: /Sequence/ })).toBeChecked()
  },
}

export const Editing: Story = {
  args: { collection: existing },
  parameters: {
    // Restricted chips reuse the group palette — known contrast debt, see #1345.
    a11y: { test: 'todo' },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByText('Edit Collection')).toBeInTheDocument()
    await expect(body.getByTestId('collection-type-chip')).toHaveTextContent('Synchronized')
  },
}

export const InstructorCreateWithCategory: Story = {
  name: 'Instructor Create With Category',
  args: { role: 'instructor', categories },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('combobox', { name: 'Category' })).toBeInTheDocument()
    await expect(body.getByRole('button', { name: 'Create' })).toBeDisabled()
  },
}

export const EditingWithViewCollection: Story = {
  name: 'Editing With View Collection',
  args: { collection: existing, onViewCollection: fn() },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement.ownerDocument.body).getByRole('button', { name: 'View Collection' }),
    ).toBeInTheDocument()
  },
}

export const PrivateFilingWarning: Story = {
  args: {
    collection: { ...existing, categoryId: 1, visibility: 'private' },
    categories,
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByText(
        'This collection is private. Filed on Browse, its tile is visible only to its owners and to staff, instructors and admins — not to other students.',
      ),
    ).toBeInTheDocument()
  },
}

export const RestrictedAsInstructor: Story = {
  name: 'Restricted As Instructor',
  args: { role: 'instructor' },
  parameters: {
    a11y: { test: 'todo' },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(body.getByLabelText('Collection name'), 'Cohort review')
    await userEvent.click(body.getByRole('radio', { name: /^Restricted/ }))
    await expect(body.getByText('Sonography').closest('.MuiChip-root')).toHaveClass('Mui-disabled')
    await expect(body.getByText('Cohort 2026B').closest('.MuiChip-root')).toHaveClass(
      'Mui-disabled',
    )
  },
}

export const AsStudent: Story = {
  name: 'As Student',
  args: { role: 'student' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.queryByRole('radio', { name: /^Restricted/ })).not.toBeInTheDocument()
  },
}

export const ValidationError: Story = {
  name: 'Validation Error',
  parameters: {
    a11y: { test: 'todo' },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(body.getByLabelText('Collection name'), 'Needs a scope')
    await userEvent.click(body.getByRole('radio', { name: /^Restricted/ }))
    await expect(
      body.getByText('Select at least one program or group, or choose Public instead.'),
    ).toBeInTheDocument()
    await expect(body.getByRole('button', { name: 'Create' })).toBeDisabled()
  },
}
